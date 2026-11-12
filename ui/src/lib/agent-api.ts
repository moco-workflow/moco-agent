import { CHAT_EXECUTE_OPTIONS, executeWorkflow, type ExecuteOptions } from './api-client';
import { config } from './config';
import type { AgentCliResult } from '@/types/chat';
import type {
  CheckSitemapResult,
  ReadinessResult,
  ConfigTier,
  Envelope,
  GetConfigResult,
  GetSessionResult,
  GetSourceResult,
  HarnessConfig,
  HarnessError,
  ListAgentsResult,
  ListModelsResult,
  ListSessionsResult,
  ListSourcesResult,
  RegisterSourceRequest,
  RegisterSourceResult,
  ForgetMemoryResult,
  JobRow,
  ListJobsResult,
  ListProvidersResult,
  ListToolPrefsResult,
  ListToolsResult,
  PreviewProviderResult,
  ProviderKind,
  ProviderResult,
  RegisterProviderRequest,
  ToolPermission,
  UsageReport,
  ListProposalsResult,
  MemoryProposal,
  RunPromotionResult,
  ListMemoryResult,
  MemoryItemResult,
  SaveConfigResult,
  SessionSummary,
  SourceScope,
} from '@/types/admin';

/**
 * The harness's two entry points (moco-agent/workflow). Harness and agent
 * packages deploy into one namespace, and entry points run package-qualified.
 */
const ADMIN_WFSPEC = `${config.harnessPackage}/agent-admin`;
const CLI_WFSPEC = `${config.harnessPackage}/agent-cli`;

/** Admin ops are persist_state reads/writes plus, at most, a registry load. */
const ADMIN_TIMEOUT_MS = 30_000;
/** Polls must fail fast so they cannot pile up behind a stalled backend. */
const POLL_TIMEOUT_MS = 10_000;
/** check_sitemap waits on the open internet: up to two probes. */
const SITEMAP_TIMEOUT_MS = 40_000;

/**
 * An expected failure the harness reported as `ok: false` (design §4.3). The
 * message is written to be shown to a user; `code` is for branching
 * (forbidden, invalid_input, not_found, not_available, ...).
 */
export class HarnessCallError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(error: HarnessError) {
    super(error.message || error.code);
    this.name = 'HarnessCallError';
    this.code = error.code;
    this.retryable = Boolean(error.retryable);
  }
}

function isEnvelope(value: unknown): value is Envelope<unknown> {
  return typeof value === 'object' && value !== null && 'ok' in value;
}

/**
 * One agent-admin op. Unwraps the envelope: `data` on ok, a HarnessCallError
 * otherwise. A bug or misconfiguration on the server raises instead, which
 * /api/workflow/execute turns into HTTP 500 -- executeWorkflow throws that.
 */
async function admin<T>(
  op: string,
  agentId: string,
  input: Record<string, unknown>,
  token: string | null | undefined,
  options?: ExecuteOptions
): Promise<T> {
  const result = await executeWorkflow(
    ADMIN_WFSPEC,
    { op, agent_id: agentId, ...input },
    token,
    { timeoutMs: ADMIN_TIMEOUT_MS, ...options }
  );
  if (!isEnvelope(result)) {
    throw new Error(`Unexpected response from ${ADMIN_WFSPEC} (${op})`);
  }
  if (!result.ok) {
    throw new HarnessCallError(
      result.error ?? { code: 'unknown', message: `${op} failed with no error` }
    );
  }
  return result.data as T;
}

// ── Chat ──────────────────────────────────────────────────────────────────

/**
 * One turn. agent-cli starts (or signals) the session entity and waits up to
 * 120s for this message's answer; on a timeout it still answers, with a note
 * that the turn is running and will appear in the conversation.
 */
export async function sendTurn(
  request: {
    agentId: string;
    sessionId: string;
    message: string;
    messageId: string;
    /** A reply to the pending action; the message may then be empty. */
    action?: { decision: string; feedback?: string };
  },
  token: string | null | undefined,
  signal?: AbortSignal,
  /** With a trace id, the turn runs in debug mode so its progress can be streamed. */
  traceId?: string
): Promise<AgentCliResult> {
  const result = await executeWorkflow(
    CLI_WFSPEC,
    {
      agent_id: request.agentId,
      session_id: request.sessionId,
      message: request.message,
      message_id: request.messageId,
      ...(request.action && { action: request.action }),
    },
    token,
    { ...CHAT_EXECUTE_OPTIONS, signal, ...(traceId && { traceId, debugMode: true }) }
  );
  if (typeof result !== 'object' || result === null || !('answer' in result)) {
    throw new Error('Unexpected response from the agent');
  }
  return result as AgentCliResult;
}

// ── Agents ────────────────────────────────────────────────────────────────

export function listAgents(
  agentId: string,
  token: string | null | undefined,
  signal?: AbortSignal
): Promise<ListAgentsResult> {
  return admin('list_agents', agentId, {}, token, { signal });
}

// ── Config ────────────────────────────────────────────────────────────────

export function getConfig(
  agentId: string,
  token: string | null | undefined,
  signal?: AbortSignal
): Promise<GetConfigResult> {
  return admin('get_config', agentId, {}, token, { signal });
}

/**
 * A PARTIAL patch, merged field by field into the tier's row. Send only what
 * changed: echoing the resolved config back would freeze every inherited value
 * into this tier. agent-config validates it against the tier's allowlist.
 */
export function saveConfig(
  agentId: string,
  patch: Partial<HarnessConfig>,
  scope: ConfigTier,
  token: string | null | undefined
): Promise<SaveConfigResult> {
  return admin('save_config', agentId, { patch, scope }, token);
}

/** `section` null empties the whole tier. */
export function resetConfig(
  agentId: string,
  section: string | null,
  scope: ConfigTier,
  token: string | null | undefined
): Promise<SaveConfigResult> {
  return admin('reset_config', agentId, { section, scope }, token);
}

/** Which model roles are set up, and what fixes the rest (static; F70). */
export function getReadiness(
  agentId: string,
  token: string | null | undefined,
  signal?: AbortSignal
): Promise<ReadinessResult> {
  return admin('get_readiness', agentId, {}, token, { signal });
}

export function listModels(
  agentId: string,
  token: string | null | undefined,
  signal?: AbortSignal
): Promise<ListModelsResult> {
  return admin('list_models', agentId, {}, token, { signal });
}

// ── Knowledge ─────────────────────────────────────────────────────────────

/** Shared sources plus the caller's private ones, every status. */
export function listSources(
  agentId: string,
  token: string | null | undefined,
  options?: { poll?: boolean; signal?: AbortSignal }
): Promise<ListSourcesResult> {
  return admin(
    'list_sources',
    agentId,
    {},
    token,
    options?.poll
      ? { timeoutMs: POLL_TIMEOUT_MS, signal: options.signal }
      : { signal: options?.signal }
  );
}

export function getSource(
  agentId: string,
  name: string,
  scope: SourceScope,
  token: string | null | undefined,
  signal?: AbortSignal
): Promise<GetSourceResult> {
  return admin('get_source', agentId, { name, scope }, token, { signal });
}

/**
 * Creates the row `indexing` and starts the indexer detached. Returns at once;
 * watch the row's status via listSources.
 */
export function registerSource(
  agentId: string,
  request: RegisterSourceRequest,
  token: string | null | undefined
): Promise<RegisterSourceResult> {
  return admin('register_source', agentId, { ...request }, token);
}

/** Re-runs the indexer with the sources stored on the row. */
export function reindexSource(
  agentId: string,
  name: string,
  scope: SourceScope,
  token: string | null | undefined
): Promise<RegisterSourceResult> {
  return admin('reindex_source', agentId, { name, scope }, token);
}

/**
 * Re-index a READY source in the background while it keeps serving: the indexer builds
 * the other table of its pair and swaps on success (a failure leaves the old data).
 */
export function refreshSource(
  agentId: string,
  name: string,
  scope: SourceScope,
  token: string | null | undefined
): Promise<RegisterSourceResult> {
  return admin('refresh_source', agentId, { name, scope }, token);
}

/** The scheduled refresh interval in hours; 0 or null turns it off. */
export function setSourceRefresh(
  agentId: string,
  name: string,
  scope: SourceScope,
  everyHours: number | null,
  token: string | null | undefined
): Promise<GetSourceResult> {
  return admin('set_source_refresh', agentId, { name, scope, every_hours: everyHours ?? 0 }, token);
}

/** Removes the row and drops its vector table. */
export function deleteSource(
  agentId: string,
  name: string,
  scope: SourceScope,
  token: string | null | undefined
): Promise<{ removed: string }> {
  return admin('delete_source', agentId, { name, scope }, token);
}

/**
 * Resolve a site URL to the sitemap the crawler will actually read. Server-side
 * because the browser cannot read a cross-origin sitemap.
 */
export function checkSitemap(
  agentId: string,
  url: string,
  token: string | null | undefined,
  signal?: AbortSignal
): Promise<CheckSitemapResult> {
  return admin('check_sitemap', agentId, { url }, token, {
    timeoutMs: SITEMAP_TIMEOUT_MS,
    signal,
  });
}

// ── Conversations ─────────────────────────────────────────────────────────
// There is no createSession: the client mints the id and agent-cli creates the
// session on its first message.

export function listSessions(
  agentId: string,
  token: string | null | undefined,
  options?: { limit?: number; signal?: AbortSignal }
): Promise<ListSessionsResult> {
  return admin('list_sessions', agentId, { limit: options?.limit ?? 50 }, token, {
    signal: options?.signal,
  });
}

/** Throws HarnessCallError code `not_found` for an id nobody has used yet. */
export function getSession(
  agentId: string,
  sessionId: string,
  token: string | null | undefined,
  options?: { page?: number; signal?: AbortSignal }
): Promise<GetSessionResult> {
  return admin('get_session', agentId, { session_id: sessionId, page: options?.page ?? 0 }, token, {
    signal: options?.signal,
  });
}

export function renameSession(
  agentId: string,
  sessionId: string,
  title: string,
  token: string | null | undefined
): Promise<{ meta: SessionSummary }> {
  return admin('rename_session', agentId, { session_id: sessionId, title }, token);
}

/** Drops every row of the session, then signals its entity to retire. */
export function deleteSession(
  agentId: string,
  sessionId: string,
  token: string | null | undefined
): Promise<{ deleted_keys: string[] }> {
  return admin('delete_session', agentId, { session_id: sessionId }, token);
}

// ── Memory (the caller's own user scope) ──────────────────────────────────

/** Every item the agent holds about the caller, retired ones included. */
export function listMemory(
  agentId: string,
  token: string | null | undefined,
  signal?: AbortSignal
): Promise<ListMemoryResult> {
  return admin('list_memory', agentId, {}, token, { signal });
}

/** Rewrite an item's title, text or tags. */
export function editMemory(
  agentId: string,
  key: string,
  patch: { title?: string; text?: string; tags?: string[] },
  token: string | null | undefined
): Promise<MemoryItemResult> {
  return admin('edit_memory', agentId, { key, ...patch }, token);
}

/** Retire an item AND tombstone it, so the agent does not learn it again. */
export function forgetMemory(
  agentId: string,
  key: string,
  token: string | null | undefined
): Promise<ForgetMemoryResult> {
  return admin('forget_memory', agentId, { key }, token);
}

/** Settle a conflicted item: keep it (active) or discard it (retired). */
export function resolveMemory(
  agentId: string,
  key: string,
  to: 'active' | 'retired',
  token: string | null | undefined
): Promise<MemoryItemResult> {
  return admin('resolve_memory', agentId, { key, to }, token);
}

// ── Answer feedback ───────────────────────────────────────────────────────

/** A rating of one turn's answer. A 👎 also lowers the memory items that answer used. */
export function submitFeedback(
  agentId: string,
  request: { sessionId: string; turn: number; rating: 'up' | 'down'; comment?: string },
  token: string | null | undefined
): Promise<unknown> {
  return admin(
    'submit_feedback',
    agentId,
    {
      session_id: request.sessionId,
      turn: request.turn,
      rating: request.rating,
      ...(request.comment && { comment: request.comment }),
    },
    token
  );
}

// ── Memory proposals (admin) ──────────────────────────────────────────────

export function listProposals(
  agentId: string,
  token: string | null | undefined,
  signal?: AbortSignal
): Promise<ListProposalsResult> {
  return admin('list_proposals', agentId, {}, token, { signal });
}

/** Approve: the note becomes an agent-wide memory item every user of the agent gets. */
export function approveProposal(
  agentId: string,
  slug: string,
  token: string | null | undefined
): Promise<{ proposal: MemoryProposal }> {
  return admin('approve_proposal', agentId, { slug }, token);
}

export function rejectProposal(
  agentId: string,
  slug: string,
  reason: string,
  token: string | null | undefined
): Promise<{ proposal: MemoryProposal }> {
  return admin('reject_proposal', agentId, { slug, reason }, token);
}

/** Run promotion now for this agent (it also runs daily). Can take a minute. */
export function runPromotion(
  agentId: string,
  token: string | null | undefined
): Promise<RunPromotionResult> {
  return admin('run_promotion', agentId, {}, token, { timeoutMs: 120_000 });
}

// ── Tools and preferences ─────────────────────────────────────────────────

/** Every tool (harness built-ins, shared and this agent's), any status. */
export function listTools(
  agentId: string,
  token: string | null | undefined,
  signal?: AbortSignal
): Promise<ListToolsResult> {
  return admin('list_tools', agentId, {}, token, { signal });
}

/** The caller's own tool preferences for this agent. */
export function listToolPrefs(
  agentId: string,
  token: string | null | undefined,
  signal?: AbortSignal
): Promise<ListToolPrefsResult> {
  return admin('list_tool_prefs', agentId, {}, token, { signal });
}

/**
 * Tighten a tool for yourself (approve / deny), or ask for `auto`. The harness applies
 * `auto` only to a read-only tool whose manifest asks approve and allows session grants.
 */
export function setToolPref(
  agentId: string,
  name: string,
  permission: ToolPermission,
  token: string | null | undefined
): Promise<unknown> {
  return admin('set_tool_pref', agentId, { name, permission }, token);
}

export function clearToolPref(
  agentId: string,
  name: string,
  token: string | null | undefined
): Promise<unknown> {
  return admin('clear_tool_pref', agentId, { name }, token);
}

// ── Tool providers (admin) ────────────────────────────────────────────────

/** MCP listing and import can take a while: one request per tool. */
const PROVIDER_TIMEOUT_MS = 120_000;

export function listProviders(
  agentId: string,
  token: string | null | undefined,
  signal?: AbortSignal
): Promise<ListProvidersResult> {
  return admin('list_providers', agentId, { scope: 'both' }, token, { signal });
}

/** What a source offers: an MCP server's tools, the allowlisted activities, or the
 * workflow tools deployed to you. Nothing is stored. */
export function previewProvider(
  agentId: string,
  kind: ProviderKind,
  endpoint: string | undefined,
  credential: { mode: 'none' | 'service' | 'user'; secret_key?: string } | undefined,
  token: string | null | undefined
): Promise<PreviewProviderResult> {
  return admin(
    'preview_provider',
    agentId,
    { kind, endpoint: endpoint ?? null, credential: credential ?? {} },
    token,
    { timeoutMs: PROVIDER_TIMEOUT_MS }
  );
}

export function registerProvider(
  agentId: string,
  request: RegisterProviderRequest,
  token: string | null | undefined
): Promise<ProviderResult> {
  return saveProvider('register_provider', agentId, request, token);
}

/** Replace a provider's endpoint, credential and import settings, and re-import its tools.
 * Name, scope and kind cannot change; tools it no longer imports are deleted. */
export function updateProvider(
  agentId: string,
  request: RegisterProviderRequest,
  token: string | null | undefined
): Promise<ProviderResult> {
  return saveProvider('update_provider', agentId, request, token);
}

function saveProvider(
  op: 'register_provider' | 'update_provider',
  agentId: string,
  request: RegisterProviderRequest,
  token: string | null | undefined
): Promise<ProviderResult> {
  return admin(
    op,
    agentId,
    {
      name: request.name,
      scope: request.scope,
      kind: request.kind ?? 'mcp',
      endpoint: request.endpoint ?? null,
      credential: request.credential ?? {},
      import_spec: request.import_spec,
      sync: request.sync ?? {},
    },
    token,
    { timeoutMs: PROVIDER_TIMEOUT_MS }
  );
}

/** sync | accept_drift | reject_drift | disable | enable | delete for one provider. */
export function providerAction(
  agentId: string,
  action: 'sync' | 'accept_drift' | 'reject_drift' | 'disable' | 'enable' | 'delete',
  name: string,
  scope: 'shared' | 'agent',
  token: string | null | undefined
): Promise<ProviderResult> {
  const op = {
    sync: 'sync_provider',
    accept_drift: 'accept_provider_drift',
    reject_drift: 'reject_provider_drift',
    disable: 'disable_provider',
    enable: 'enable_provider',
    delete: 'delete_provider',
  }[action];
  return admin(op, agentId, { name, scope }, token, { timeoutMs: PROVIDER_TIMEOUT_MS });
}

// ── Jobs and usage ────────────────────────────────────────────────────────

/** The caller's background jobs with this agent. */
export function listJobs(
  agentId: string,
  token: string | null | undefined,
  options?: { signal?: AbortSignal; poll?: boolean }
): Promise<ListJobsResult> {
  return admin('list_jobs', agentId, {}, token, {
    signal: options?.signal,
    ...(options?.poll && { timeoutMs: POLL_TIMEOUT_MS }),
  });
}

export function cancelJob(
  agentId: string,
  jobId: string,
  token: string | null | undefined
): Promise<{ cancelled?: boolean; job?: JobRow }> {
  return admin('cancel_job', agentId, { job_id: jobId }, token);
}

/**
 * Answer a job's question (e.g. the builder's plan review): approve, reject or revise
 * with feedback. Resumes the session's turn, so this waits for its answer.
 */
export function answerJob(
  agentId: string,
  jobId: string,
  decision: 'approve' | 'reject' | 'revise' | 'reply',
  feedback: string | undefined,
  token: string | null | undefined
): Promise<unknown> {
  return admin('answer_job', agentId, { job_id: jobId, decision, ...(feedback && { feedback }) }, token, {
    timeoutMs: 130_000,
  });
}

/** The caller's own usage with this agent, plus the deployment's per-tool stats. */
export function usageReport(
  agentId: string,
  token: string | null | undefined,
  signal?: AbortSignal
): Promise<UsageReport> {
  return admin('usage_report', agentId, {}, token, { signal });
}

