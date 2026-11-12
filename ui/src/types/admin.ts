/**
 * Mirrors what agent-harness/agent-admin returns: every op answers the call
 * envelope `{ok, data, error}` (design §4.3), and these are the `data` shapes.
 *
 * Field names in IndexSource and EmbedModelInfo are load-bearing: they are read
 * verbatim by knowledge-index-run and copied into llama_index's EmbedModelInfo.
 * Renaming one here silently breaks indexing rather than failing to compile.
 */

// ── Envelope ──────────────────────────────────────────────────────────────

export interface HarnessError {
  code: string;
  message: string;
  retryable?: boolean;
}

export interface Envelope<T> {
  ok: boolean;
  data: T | null;
  error: HarnessError | null;
}

// ── Agents ────────────────────────────────────────────────────────────────

export interface AgentSummary {
  agent_id: string;
  package: string;
  /** Null when the agent's definition could not be loaded. */
  display_name: string | null;
  version: string | null;
}

export interface ListAgentsResult {
  agents: AgentSummary[];
}

// ── Config ────────────────────────────────────────────────────────────────

/**
 * One chat model role (models.inference, models.decision). Secrets are NAMES. A null
 * model or base_url is the worker's environment default.
 */
export interface ModelRole {
  provider?: string | null;
  model?: string | null;
  base_url?: string | null;
  apikey_secret_key?: string | null;
  max_tokens?: number | null;
  temperature?: number | null;
}

/** models.classifier: System One. Null model / base_url: TYPESAFE_DEFAULT_*. */
export interface ClassifierRole {
  provider?: string | null;
  model?: string | null;
  base_url?: string | null;
  apikey_secret_key?: string | null;
  enabled?: boolean;
  timeout_sec?: number;
}

export interface EmbedModelInfo {
  /** Null: the worker's environment default (MOCO_LLM_DEFAULT_EMBED_MODEL_NAME). */
  model_name: string | null;
  embed_dim: number;
  /** Null: the worker's environment default (MOCO_LLM_DEFAULT_EMBED_MODEL_BASE_URL). */
  base_url: string | null;
  apikey_secret_key: string;
}

/**
 * The resolved configuration. Only the sections the UI reads are typed; the rest
 * (decisions, limits, session, context, ...) are agent-tier tuning, shown raw.
 */
export interface HarnessConfig {
  display_name?: string;
  persona_text?: string;
  profiles?: string[];
  disabled_profiles?: string[];
  router?: { default_profile?: string; classifier?: boolean };
  models?: {
    inference?: ModelRole;
    /** Null means "use inference with a low max_tokens". */
    decision?: ModelRole | null;
    classifier?: ClassifierRole;
    embedding?: EmbedModelInfo & { provider?: string | null };
  };
  knowledge?: { sources?: string[]; allow_user_sources?: boolean };
  [section: string]: unknown;
}

/** The caller's role, by the definition's access lists (access identify). */
export type AccessRole = 'admin' | 'user' | 'guest' | 'denied';

/**
 * Which stored tier a save or reset addresses. `user` applies to the caller
 * alone; `agent` is the shared tier every user's overrides sit on, admin only.
 */
export type ConfigTier = 'user' | 'agent';

export interface GetConfigResult {
  config: HarnessConfig;
  /** The ENABLED profile names (definition.profiles minus disabled), sorted. */
  profiles: string[];
  config_version: string;
  /** Each stored tier's own sections -- what is set there, not inherited. */
  tiers: { agent: Partial<HarnessConfig>; user: Partial<HarnessConfig> };
  /** Dotted paths a user may set (models.inference.model, persona_text, ...). */
  user_settable: string[];
  role: AccessRole;
}

/** One model role's setup state (model-readiness, F70). */
export type ReadinessStatus = 'ready' | 'missing' | 'unknown' | 'off' | 'inherited';

export interface RoleReadiness {
  status: ReadinessStatus;
  /** no_secret_name | secret_missing | env_default | classifier_unset | classifier_disabled | ... */
  reason: string;
  secret: { name: string | null; scope: 'user' | 'global' | null; exists: boolean | null };
  fix: { fields: string[]; secret_name: string | null; scope: 'user' | 'global' | null };
  hint: string | null;
}

export interface ReadinessResult {
  /** false only when a role is `missing`. */
  ready: boolean;
  roles: Record<'inference' | 'decision' | 'classifier' | 'embedding', RoleReadiness>;
}

/** A turn that failed because a model is not set up (agent-cli `setup`). */
export interface TurnSetup {
  role: string;
  reason: string;
  secret_name: string | null;
  scope: 'user' | 'global' | null;
}

export interface SaveConfigResult {
  config_version: string;
}

export interface CatalogModel {
  id: string;
  label: string;
  max_tokens?: number;
  tools?: boolean;
  json_mode?: boolean;
  context_window?: number;
  embed_dim?: number;
}

export interface CatalogProvider {
  id: string;
  kind: 'inference' | 'embedding' | 'classifier';
  label: string;
  base_urls: string[];
  apikey_secret_key: string | null;
  models: CatalogModel[];
}

export interface ListModelsResult {
  providers: CatalogProvider[];
}

// ── Knowledge ─────────────────────────────────────────────────────────────

export type SourceStatus = 'indexing' | 'ready' | 'failed' | 'deleting';

/** shared: every user of every agent that lists it; private: the caller only. */
export type SourceScope = 'shared' | 'private';

export interface IndexSource_Web {
  kind: 'web';
  urls: string[];
  /** trafilatura for HTML; leave unset (= download) for PDF/DOCX/CSV. */
  loader?: 'download' | 'trafilatura';
}

export interface IndexSource_Site {
  kind: 'site';
  /**
   * The sitemap itself, NOT the landing page: the crawler feeds it straight to
   * SitemapReader. A page URL here indexes nothing. check_sitemap resolves one
   * into the other.
   */
  url: string;
  prefix?: string | null;
  max_depth: number;
  limit: number;
}

export interface IndexSource_Github {
  kind: 'github';
  owner: string;
  repo: string;
  branch?: string | null;
  token_secret_key?: string | null;
  api_base_url?: string;
  include_directories: string[];
  include_extensions: string[];
}

export interface IndexSource_Files {
  kind: 'files';
  /** Relative to MOCO_RAG_FILE_DIR; escaping that root is rejected server-side. */
  path: string;
  recursive: boolean;
  required_extensions: string[];
}

export interface IndexSource_Gdrive {
  kind: 'gdrive';
  credentials_secret_key: string;
  folder_id?: string | null;
  file_ids: string[];
  drive_id?: string | null;
}

/** One thing to index into a knowledge source. */
export type IndexSource =
  | IndexSource_Web
  | IndexSource_Site
  | IndexSource_Github
  | IndexSource_Files
  | IndexSource_Gdrive;

export type IndexSourceKind = IndexSource['kind'];

/** A source-registry row, as list_sources projects it. */
export interface KnowledgeSource {
  name: string;
  scope: SourceScope;
  kind: string;
  status: SourceStatus;
  description?: string;
  keywords?: string[];
  node_count?: number | null;
  indexed_at?: string | null;
  error?: string | null;
  table_name?: string;
  /** Fixed at index time. The same model must be used to query. */
  embed_model_info?: EmbedModelInfo | null;
  /** Bumped on every transition; a long-`indexing` row with an old one has died. */
  updated_at?: string;
  updated_by?: string;
  /**
   * A refresh in flight (harness 0.7+): the source keeps serving from table_name while
   * the other table of its pair is built, then swaps. Null/absent when none runs.
   */
  refreshing?: { table_name: string; started_at: string } | null;
  /** Why the last refresh failed; the source still serves its previous data. */
  refresh_error?: string | null;
  refresh_failed_at?: string | null;
  /** Scheduled refresh interval (shared sources; the hourly knowledge-refresh job). */
  refresh_every_hours?: number | null;
}

/** get_source: the full row, including what it was indexed from. */
export interface KnowledgeSourceDetail extends KnowledgeSource {
  refresh?: { sources?: IndexSource[] };
}

export interface ListSourcesResult {
  sources: KnowledgeSource[];
}

export interface GetSourceResult {
  source: KnowledgeSourceDetail;
}

export interface RegisterSourceRequest {
  name: string;
  scope: SourceScope;
  description: string;
  keywords: string[];
  index_sources: IndexSource[];
  /** Omit to use the agent's models.embedding. */
  embed_model_info?: EmbedModelInfo | null;
}

export interface RegisterSourceResult {
  source: KnowledgeSource;
  indexer?: unknown;
}

/** One URL check_sitemap tried. */
export interface SitemapProbe {
  url: string;
  status_code?: number | null;
  is_success?: boolean;
  is_sitemap: boolean;
  entry_count?: number;
  /** Empty when `is_sitemap`. Written to be shown to a user verbatim. */
  reason?: string;
  error?: string;
}

/** The first probe that was a sitemap (else the last one), plus every probe. */
export interface CheckSitemapResult extends SitemapProbe {
  checked: SitemapProbe[];
}

// ── Conversations ─────────────────────────────────────────────────────────

/** A session meta row (session-store). */
export interface SessionSummary {
  session_id: string;
  title: string;
  /** `active` while the entity may still be running, `retired` once it ended. */
  status: 'active' | 'retired';
  turn_count: number;
  last_route?: string | null;
  throwaway?: boolean;
  created_at: string;
  updated_at: string;
}

/** One transcript entry; a turn is a user entry and an assistant entry. */
export interface SessionTurn {
  turn: number;
  message_id?: string;
  role: 'user' | 'assistant';
  content: string;
  ts?: string;
  route?: string | null;
  sources?: AnswerSource[];
  status?: string;
  /** Assistant entries: the agent-cli run that asked (harness 0.3.3+), for the trace link. */
  workflow_id?: string | null;
  /** Assistant entries: set when the turn failed because a model is not set up (F70). */
  setup?: TurnSetup | null;
}

export interface ListSessionsResult {
  sessions: SessionSummary[];
}

export interface GetSessionResult {
  meta: SessionSummary;
  context: unknown;
  turns: SessionTurn[];
  next_page: number | null;
}

/** A passage an answer cites as [n]. */
export interface AnswerSource {
  n?: number;
  title?: string | null;
  url?: string | null;
  source?: string | null;
}

// ── Long-term memory (design §6.4) ────────────────────────────────────────

/** profile | fact | lesson | episode, or a kind the agent defines. */
export type MemoryKind = string;

/** active, conflicted (contradicts another item, awaiting a decision), retired. */
export type MemoryStatus = 'active' | 'conflicted' | 'retired';

/** One memory-store row in the caller's user scope. */
export interface MemoryItem {
  key: string;
  kind: MemoryKind;
  slug: string;
  scope: 'user' | 'agent';
  title: string;
  text: string;
  tags?: string[];
  /** Explicit "remember", curated or promoted: weighs more and is never evicted by the cap. */
  pinned?: boolean;
  status: MemoryStatus;
  /** One entry per session + turn it was learned or confirmed in. */
  evidence?: { session_id?: string; turn?: number | null; source?: string; ts?: string }[];
  conflicts_with?: string[];
  created_at?: string;
  updated_at?: string;
  last_used_at?: string | null;
}

export interface ListMemoryResult {
  items: MemoryItem[];
}

export interface MemoryItemResult {
  item: MemoryItem;
}

export interface ForgetMemoryResult {
  retired: string[];
}

/** A memory-promote proposal: one note several users share, awaiting an admin (§6.16). */
export interface MemoryProposal {
  key: string;
  slug: string;
  kind: string;
  status: 'proposed' | 'approved' | 'rejected' | 'expired';
  title: string;
  text: string;
  tags?: string[];
  /** The user-scope items it was merged from. */
  members?: { user_id: string; key: string; title?: string }[];
  user_count?: number;
  created_at?: string;
  expires_at?: string;
  decided_by?: string;
  decided_at?: string;
  reason?: string;
  item_key?: string;
}

export interface ListProposalsResult {
  proposals: MemoryProposal[];
}

export interface RunPromotionResult {
  users: number;
  items: number;
  groups: number;
  confirmed: number;
  proposed: string[];
  expired: string[];
  skipped: { slug: string | null; reason: string }[];
}

// ── Tools, preferences and providers (design §6.9) ────────────────────────

export type ToolPermission = 'auto' | 'approve' | 'deny';
export type SideEffects = 'none' | 'read' | 'write' | 'external';

/** A tool manifest as tool-registry lists it (the fields the UI reads). */
export interface ToolManifest {
  name: string;
  title?: string;
  description?: string;
  version?: number;
  status: 'draft' | 'enabled' | 'disabled' | 'deprecated' | 'retired';
  scope?: 'shared' | 'agent';
  origin?: string;
  toolsets?: string[];
  binding?: Record<string, unknown>;
  credential?: { mode?: 'none' | 'service' | 'user'; secret_key?: string | null; connect_hint?: string | null };
  policy?: {
    side_effects?: SideEffects;
    permission?: ToolPermission;
    allow_session_grant?: boolean;
  };
}

export interface ListToolsResult {
  tools: ToolManifest[];
}

export interface ToolPref {
  name: string;
  permission: ToolPermission;
  set_at?: string;
}

export interface ListToolPrefsResult {
  prefs: ToolPref[];
}

/** tool-stats-rollup's per-tool figures. */
export interface ToolStat {
  name: string;
  calls?: number;
  errors?: number;
  error_rate?: number;
  p50_ms?: number | null;
  p95_ms?: number | null;
  last_error?: { message?: string; ts?: string } | null;
  /** `failing` when the error rate is high over enough calls. */
  flag?: 'failing' | null;
  [key: string]: unknown;
}

export type ProviderStatus = 'connecting' | 'ready' | 'drifted' | 'failed' | 'disabled';

export interface ProviderDrift {
  hash?: string;
  added?: string[];
  changed?: string[];
  removed?: string[];
  detected_at?: string;
}

/**
 * Where a provider's tools come from: an MCP server, moco activities, or deployed
 * workflows that declare `header.metadata.tool`.
 */
export type ProviderKind = 'mcp' | 'activity' | 'workflow';

/** Per-tool import settings; `fixed_input` (activity) is merged over the model's arguments. */
export interface ProviderToolOverride {
  side_effects?: SideEffects;
  permission?: ToolPermission;
  toolsets?: string[];
  fixed_input?: Record<string, unknown>;
}

/** A tool_provider row: a source whose allowlisted tools are imported. */
export interface ToolProvider {
  name: string;
  kind: ProviderKind;
  scope: 'shared' | 'agent';
  endpoint: string | null;
  credential?: { mode?: 'none' | 'service' | 'user'; secret_key?: string | null };
  import?: {
    include?: string[];
    defaults?: { side_effects?: SideEffects; permission?: ToolPermission; toolsets?: string[] };
    overrides?: Record<string, ProviderToolOverride>;
  };
  sync?: { every_hours?: number };
  status: ProviderStatus;
  /** The last listing; its tools carry what preview shows (activity, workflow: schema). */
  snapshot?: { hash?: string; synced_at?: string; tools?: PreviewTool[] } | null;
  pending?: (ProviderDrift & { tools?: { name: string; description?: string }[] }) | null;
  tools?: string[];
  import_errors?: { tool: string; error?: { message?: string } }[];
  error?: string | null;
  updated_at?: string;
}

export interface ListProvidersResult {
  providers: ToolProvider[];
}

/** One tool a provider offers. activity and workflow listings carry their schema. */
export interface PreviewTool {
  name: string;
  description?: string;
  hash?: string;
  /** activity, workflow: the JSON-schema input (activity: flattened). */
  input_schema?: { type?: string; properties?: Record<string, unknown>; required?: string[] } | null;
  /** activity: too large to import as a tool. */
  schema_too_large?: boolean;
  /** activity: the least side effects its tool may have (tool-registry); a provider can only raise it. */
  min_side_effects?: SideEffects;
  /** workflow: the declaration's side effects, mode, tool name and package version. */
  side_effects?: SideEffects;
  mode?: 'sync' | 'async';
  tool_name?: string;
  package?: string;
  version?: string;
}

export interface PreviewProviderResult {
  server?: { name?: string; version?: string };
  kind?: ProviderKind;
  tools: PreviewTool[];
}

export interface ProviderResult {
  provider: ToolProvider;
  imported?: string[];
  disabled?: string[];
  /** update: the tools it no longer imports, removed from the registry. */
  deleted?: string[];
  import_errors?: { tool: string; error?: { message?: string } }[];
  drift?: ProviderDrift | null;
}

export interface RegisterProviderRequest {
  name: string;
  scope: 'shared' | 'agent';
  kind?: ProviderKind;
  /** mcp only. */
  endpoint?: string;
  credential?: { mode: 'none' | 'service' | 'user'; secret_key?: string };
  import_spec: {
    include: string[];
    /** side_effects is required except for workflows, which declare their own. */
    defaults: { side_effects?: SideEffects; permission?: ToolPermission; toolsets?: string[] };
    overrides?: Record<string, ProviderToolOverride>;
  };
  sync?: { every_hours?: number };
}

// ── Jobs and usage ─────────────────────────────────────────────────────────

export type JobStatus = 'queued' | 'running' | 'awaiting_input' | 'completed' | 'failed' | 'cancelled';

/** A background job row (job-store). */
export interface JobRow {
  job_id: string;
  session_id: string;
  profile?: string;
  summary?: string;
  status: JobStatus;
  progress?: unknown;
  pending_action?: { id?: string; kind?: string; summary?: string } | null;
  result?: { answer?: string; sources?: AnswerSource[] } | null;
  error?: { code?: string; message?: string } | null;
  created_at?: string;
  updated_at?: string;
  delivered_at?: string | null;
  workflow_id?: string;
}

export interface ListJobsResult {
  jobs: JobRow[];
}

export interface UsageReport {
  sessions: number;
  totals: {
    turns: number;
    llm_calls: number;
    classifier_calls: number;
    tool_calls: number;
    tokens_in: number;
    tokens_out: number;
  };
  by_route: Record<string, { sessions: number; turns: number }>;
  tools: ToolStat[];
}

