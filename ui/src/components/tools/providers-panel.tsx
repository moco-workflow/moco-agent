import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Pencil, Plus, Power, RefreshCw, Trash2 } from 'lucide-react';
import { listProviders, previewProvider, providerAction, registerProvider, updateProvider } from '@/lib/agent-api';
import { useAuth } from '@/lib/auth/auth-context';
import { useAgent } from '@/lib/agent-context';
import { cn } from '@/lib/utils';
import type {
  PreviewProviderResult,
  PreviewTool,
  ProviderKind,
  ProviderToolOverride,
  SideEffects,
  ToolPermission,
  ToolProvider,
} from '@/types/admin';

/**
 * Sources of tools (design §6.9.4, admins): MCP servers, moco activities, and deployed
 * workflows that declare `header.metadata.tool`. Only the tools ticked when registering
 * are imported; a later change to a tool's description or schema disables it until an
 * admin accepts the change. A ready or failed provider can be edited, which re-imports it.
 */
export function ProvidersPanel() {
  const { getAuthToken } = useAuth();
  const { agentId } = useAgent();
  const [providers, setProviders] = useState<ToolProvider[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const token = await getAuthToken();
      const result = await listProviders(agentId, token);
      setProviders(result.providers ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load providers');
    } finally {
      setIsLoading(false);
    }
  }, [agentId, getAuthToken]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <p className="mb-4 text-sm text-gray-500">
        Import tools from an MCP server, from moco activities, or from deployed workflows that
        declare themselves as tools. Only the tools you tick are imported, each into the
        toolsets you name; if the source later changes one, it is disabled until you accept the change.
      </p>
      {error && (
        <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-300">{error}</div>
      )}
      {adding ? (
        <ProviderForm
          providers={providers}
          onCancel={() => setAdding(false)}
          onDone={async () => {
            setAdding(false);
            await load();
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mb-4 flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
        >
          <Plus className="h-3.5 w-3.5" /> Add provider
        </button>
      )}
      {isLoading && <p className="text-xs text-gray-500">Loading…</p>}
      {!isLoading && providers.length === 0 && !error && !adding && (
        <p className="text-sm text-gray-500">No providers yet.</p>
      )}
      <div className="space-y-2">
        {providers.map((p) => (
          <ProviderRow key={`${p.scope}-${p.name}`} provider={p} onChanged={load} />
        ))}
      </div>
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  ready: 'bg-green-950 text-green-300',
  drifted: 'bg-amber-950 text-amber-300',
  failed: 'bg-red-950 text-red-300',
  disabled: 'bg-gray-800 text-gray-400',
  connecting: 'bg-blue-950 text-blue-300',
};

function ProviderRow({ provider, onChanged }: { provider: ToolProvider; onChanged: () => Promise<void> }) {
  const { getAuthToken } = useAuth();
  const { agentId } = useAgent();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const editable = provider.status === 'ready' || provider.status === 'failed';

  const act = async (action: 'sync' | 'accept_drift' | 'reject_drift' | 'disable' | 'enable' | 'delete') => {
    setBusy(action);
    setError(null);
    setNote(null);
    try {
      const token = await getAuthToken();
      const r = await providerAction(agentId, action, provider.name, provider.scope, token);
      if (action === 'sync') {
        setNote(r.drift ? 'The server changed: review below.' : 'No changes.');
      }
      if (action === 'delete') setConfirming(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(null);
    }
  };

  const drift = provider.pending;
  const button =
    'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors disabled:opacity-50';

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40">
      <div className="flex items-start gap-3 p-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-white">{provider.name}</span>
            <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-400">
              {provider.scope}
            </span>
            <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-400">
              {KIND_LABELS[provider.kind ?? 'mcp'].short}
            </span>
            <span
              className={cn(
                'flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide',
                STATUS_STYLES[provider.status]
              )}
            >
              {provider.status === 'ready' && <CheckCircle2 className="h-2.5 w-2.5" />}
              {(provider.status === 'drifted' || provider.status === 'failed') && (
                <AlertTriangle className="h-2.5 w-2.5" />
              )}
              {provider.status}
            </span>
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-gray-500">
            {provider.endpoint ?? KIND_LABELS[provider.kind ?? 'mcp'].source}
          </p>
          <p className="mt-1 text-[11px] text-gray-600">
            {(provider.tools ?? []).length} tools: {(provider.tools ?? []).join(', ') || '—'}
            {provider.snapshot?.synced_at ? ` · synced ${new Date(provider.snapshot.synced_at).toLocaleString()}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {provider.status !== 'disabled' && provider.status !== 'drifted' && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void act('sync')}
              className={cn(button, 'text-gray-300 hover:bg-gray-800')}
              title="List the server's tools again and compare"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', busy === 'sync' && 'animate-spin')} /> Sync
            </button>
          )}
          <button
            type="button"
            disabled={busy !== null || editing || !editable}
            onClick={() => {
              setEditing(true);
              setConfirming(false);
            }}
            className={cn(button, 'text-gray-400 hover:bg-gray-800')}
            title={
              editable
                ? 'Change the endpoint, credential or imported tools'
                : provider.status === 'drifted'
                  ? 'Accept or keep the change first'
                  : provider.status === 'disabled'
                    ? 'Enable it first'
                    : 'Wait until it is ready'
            }
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void act(provider.status === 'disabled' ? 'enable' : 'disable')}
            className={cn(button, 'text-gray-400 hover:bg-gray-800')}
            title={provider.status === 'disabled' ? 'Enable and re-import its tools' : 'Disable it and all its tools'}
          >
            <Power className="h-3.5 w-3.5" /> {provider.status === 'disabled' ? 'Enable' : 'Disable'}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => setConfirming(true)}
            className={cn(button, 'text-gray-500 hover:bg-gray-800 hover:text-red-400')}
            aria-label={`Delete ${provider.name}`}
            title="Delete the provider and its tools"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {editing && (
        <div className="border-t border-gray-800 p-3">
          <ProviderForm
            existing={provider}
            onCancel={() => setEditing(false)}
            onDone={async () => {
              setEditing(false);
              await onChanged();
            }}
          />
        </div>
      )}
      {confirming && (
        <div className="border-t border-gray-800 bg-red-950/20 px-3 py-3">
          <p className="text-xs text-gray-300">
            Delete <span className="font-medium text-white">{provider.name}</span>?{' '}
            {(provider.tools ?? []).length === 1 ? 'Its imported tool is' : `Its ${(provider.tools ?? []).length} imported tools are`}{' '}
            removed from every agent that offers them.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void act('delete')}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
            >
              {busy === 'delete' ? 'Deleting…' : 'Delete'}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setConfirming(false)}
              className="rounded-md px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {provider.status === 'drifted' && drift && (
        <div className="border-t border-amber-900/50 bg-amber-950/10 px-3 py-2 text-xs text-amber-200">
          <p>
            The server changed its tools
            {drift.detected_at ? ` (${new Date(drift.detected_at).toLocaleString()})` : ''}. Changed and
            removed tools are disabled until you decide.
          </p>
          <ul className="mt-1 space-y-0.5 text-amber-200/80">
            {drift.added?.length ? <li>Added: {drift.added.join(', ')}</li> : null}
            {drift.changed?.length ? <li>Changed: {drift.changed.join(', ')}</li> : null}
            {drift.removed?.length ? <li>Removed: {drift.removed.join(', ')}</li> : null}
          </ul>
          {(drift.tools ?? [])
            .filter((t) => [...(drift.added ?? []), ...(drift.changed ?? [])].includes(t.name))
            .map((t) => (
              <p key={t.name} className="mt-1 text-gray-300">
                <span className="font-mono">{t.name}</span>: {t.description}
              </p>
            ))}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void act('accept_drift')}
              className={cn(button, 'bg-amber-700/60 text-white hover:bg-amber-600')}
            >
              {busy === 'accept_drift' && <Loader2 className="h-3 w-3 animate-spin" />} Accept the change
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void act('reject_drift')}
              className={cn(button, 'text-amber-200 hover:bg-gray-800')}
            >
              Keep the old version
            </button>
          </div>
        </div>
      )}
      {provider.status === 'failed' && provider.error && (
        <p className="border-t border-gray-800 px-3 py-2 font-mono text-xs text-red-300">{provider.error}</p>
      )}
      {(provider.import_errors ?? []).length > 0 && (
        <p className="border-t border-gray-800 px-3 py-2 text-xs text-amber-300">
          Not imported:{' '}
          {(provider.import_errors ?? [])
            .map((e) => `${e.tool} (${e.error?.message ?? 'refused'})`)
            .join('; ')}
        </p>
      )}
      {note && <p className="border-t border-gray-800 px-3 py-2 text-xs text-gray-400">{note}</p>}
      {error && <p className="border-t border-gray-800 px-3 py-2 text-xs text-red-300">{error}</p>}
    </div>
  );
}

const KIND_LABELS: Record<ProviderKind, { short: string; option: string; source: string; list: string }> = {
  mcp: { short: 'mcp', option: 'MCP server', source: 'MCP server', list: 'List its tools' },
  activity: {
    short: 'activities',
    option: 'moco activities',
    source: 'moco activities',
    list: 'List the activities',
  },
  workflow: {
    short: 'workflows',
    option: 'Deployed workflows',
    source: 'deployed workflows (header.metadata.tool)',
    list: 'List the workflow tools',
  },
};

/** A toolset name (tool-registry's toolset_pattern, also the provider name pattern). */
const TOOLSET_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .slice(0, 32)
    .replace(/-+$/, '');
}

/** The toolset a new provider's tools go into unless the admin names another. */
function defaultToolset(kind: ProviderKind, preview: PreviewProviderResult | null, endpoint: string): string {
  if (kind === 'activity') return 'moco-activities';
  if (kind === 'workflow') return 'moco-workflows';
  let host = '';
  try {
    host = new URL(endpoint).hostname.split('.').find((p) => !['mcp', 'www', 'api'].includes(p)) ?? '';
  } catch {
    // not a URL yet
  }
  const name = slug(preview?.server?.name ?? '') || slug(host);
  return TOOLSET_PATTERN.test(name) ? name : 'mcp-tools';
}

/**
 * The provider's name, which nobody sees in a tool name any more: its first toolset,
 * suffixed when that is taken in the scope.
 */
function providerName(toolset: string, scope: 'shared' | 'agent', providers: ToolProvider[]): string {
  const taken = new Set(providers.filter((p) => p.scope === scope).map((p) => p.name));
  if (!taken.has(toolset)) return toolset;
  for (let i = 2; ; i++) {
    const name = `${toolset.slice(0, 31 - String(i).length)}-${i}`;
    if (!taken.has(name)) return name;
  }
}

const inputClass = 'w-full rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-200';

/** A fixed-input editor's text as an object, or an error message. */
function parseFixedInput(text: string): Record<string, unknown> | string {
  if (!text.trim()) return {};
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'must be a JSON object';
    return value as Record<string, unknown>;
  } catch {
    return 'not valid JSON';
  }
}

/**
 * Registers a provider, or with `existing` edits one: name, scope and kind stay, the rest
 * starts from the row and its last listing, and saving re-imports the tools.
 */
function ProviderForm({
  existing,
  providers = [],
  onCancel,
  onDone,
}: {
  existing?: ToolProvider;
  providers?: ToolProvider[];
  onCancel: () => void;
  onDone: () => Promise<void>;
}) {
  const { getAuthToken } = useAuth();
  const { agentId } = useAgent();
  const defaults = existing?.import?.defaults;
  const [kind, setKind] = useState<ProviderKind>(existing?.kind ?? 'mcp');
  const [scope, setScope] = useState<'shared' | 'agent'>(existing?.scope ?? 'shared');
  const [endpoint, setEndpoint] = useState(existing?.endpoint ?? '');
  const [credMode, setCredMode] = useState<'none' | 'service' | 'user'>(existing?.credential?.mode ?? 'none');
  const [secretKey, setSecretKey] = useState(existing?.credential?.secret_key ?? '');
  // Editing: the tools of the last listing (only the imported ones were listed); list
  // the source again to add others.
  const [preview, setPreview] = useState<PreviewProviderResult | null>(() =>
    existing
      ? {
          kind: existing.kind,
          tools:
            existing.snapshot?.tools ?? (existing.import?.include ?? []).map((name) => ({ name })),
        }
      : null
  );
  const [filter, setFilter] = useState('');
  const [include, setInclude] = useState<string[]>(existing?.import?.include ?? []);
  const [fixedInput, setFixedInput] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(existing?.import?.overrides ?? {})
        .filter(([, o]) => o.fixed_input && Object.keys(o.fixed_input).length > 0)
        .map(([t, o]) => [t, JSON.stringify(o.fixed_input, null, 2)])
    )
  );
  const [sideEffects, setSideEffects] = useState<SideEffects | ''>(defaults?.side_effects ?? '');
  const [permission, setPermission] = useState<ToolPermission | ''>(defaults?.permission ?? '');
  const [toolsets, setToolsets] = useState((defaults?.toolsets ?? []).join(', '));
  const [busy, setBusy] = useState<'preview' | 'register' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const credential =
    kind !== 'mcp' || credMode === 'none'
      ? { mode: 'none' as const }
      : { mode: credMode, secret_key: secretKey.trim() };

  const changeKind = (next: ProviderKind) => {
    setKind(next);
    setPreview(null);
    setInclude([]);
    setFixedInput({});
    setFilter('');
    setError(null);
  };

  const doPreview = async () => {
    setBusy('preview');
    setError(null);
    try {
      const token = await getAuthToken();
      const r = await previewProvider(
        agentId,
        kind,
        kind === 'mcp' ? endpoint.trim() : undefined,
        credential,
        token
      );
      setPreview(r);
      if (existing) {
        // Keep what is still offered; a tool the source dropped cannot be imported.
        const listed = new Set(r.tools.map((t) => t.name));
        setInclude((prev) => prev.filter((t) => listed.has(t)));
      } else {
        setInclude([]);
        setFixedInput({});
        setToolsets(defaultToolset(kind, r, endpoint.trim()));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not list the tools');
    } finally {
      setBusy(null);
    }
  };

  const fixedErrors = Object.fromEntries(
    include
      .map((t) => [t, parseFixedInput(fixedInput[t] ?? '')] as const)
      .filter(([, v]) => typeof v === 'string')
  ) as Record<string, string>;

  const toolsetList = toolsets.split(',').map((t) => t.trim()).filter(Boolean);
  const badToolsets = toolsetList.filter((t) => !TOOLSET_PATTERN.test(t));

  const doRegister = async () => {
    if (kind === 'mcp' && !sideEffects) return;
    setBusy('register');
    setError(null);
    try {
      const token = await getAuthToken();
      // The form edits only fixed_input; other per-tool overrides an edited provider
      // has are kept for the tools it still imports.
      const overrides: Record<string, ProviderToolOverride> = {};
      for (const t of include) {
        const { fixed_input: _old, ...kept } = existing?.import?.overrides?.[t] ?? {};
        const fixed = kind === 'activity' ? parseFixedInput(fixedInput[t] ?? '') : {};
        const next: ProviderToolOverride = {
          ...kept,
          ...(typeof fixed !== 'string' && Object.keys(fixed).length > 0 && { fixed_input: fixed }),
        };
        if (Object.keys(next).length > 0) overrides[t] = next;
      }
      const r = await (existing ? updateProvider : registerProvider)(
        agentId,
        {
          name: existing?.name ?? providerName(toolsetList[0] ?? '', scope, providers),
          scope,
          kind,
          ...(kind === 'mcp' && { endpoint: endpoint.trim(), credential }),
          import_spec: {
            include,
            defaults: {
              ...(sideEffects && { side_effects: sideEffects }),
              ...(permission && { permission }),
              toolsets: toolsetList,
            },
            ...(Object.keys(overrides).length > 0 && { overrides }),
          },
        },
        token
      );
      if (r.import_errors?.length) {
        setError(
          `${existing ? 'Saved' : 'Registered'}, but not imported: ${r.import_errors
            .map((e) => `${e.tool}${e.error?.message ? ` (${e.error.message})` : ''}`)
            .join('; ')}`
        );
      }
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : existing ? 'Could not save' : 'Could not register');
    } finally {
      setBusy(null);
    }
  };

  const ready =
    toolsetList.length > 0 &&
    badToolsets.length === 0 &&
    (kind !== 'mcp' || endpoint.trim()) &&
    include.length > 0 &&
    (kind !== 'mcp' || sideEffects) &&
    Object.keys(fixedErrors).length === 0;

  const shown = (preview?.tools ?? []).filter(
    (t) =>
      !filter.trim() ||
      `${t.name} ${t.description ?? ''}`.toLowerCase().includes(filter.trim().toLowerCase())
  );

  return (
    <div
      className={cn(
        'space-y-3 text-xs',
        !existing && 'mb-6 rounded-lg border border-gray-800 bg-gray-900/40 p-4'
      )}
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-gray-400">Source</span>
          <select
            value={kind}
            onChange={(e) => changeKind(e.target.value as ProviderKind)}
            disabled={Boolean(existing)}
            className={cn(inputClass, 'disabled:opacity-60')}
            aria-label="Source"
          >
            {(Object.keys(KIND_LABELS) as ProviderKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k].option}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-gray-400">Scope</span>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as 'shared' | 'agent')}
            disabled={Boolean(existing)}
            className={cn(inputClass, 'disabled:opacity-60')}
          >
            <option value="shared">Shared (every agent)</option>
            <option value="agent">This agent only</option>
          </select>
        </label>
      </div>
      {kind === 'mcp' && (
        <>
          <label className="block space-y-1">
            <span className="text-gray-400">MCP endpoint</span>
            <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://mcp.example.com/mcp" className={inputClass} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-gray-400">Credential</span>
              <select value={credMode} onChange={(e) => setCredMode(e.target.value as 'none' | 'service' | 'user')} className={inputClass}>
                <option value="none">None</option>
                <option value="service">Service (one global secret)</option>
                <option value="user">Each user's own secret</option>
              </select>
            </label>
            {credMode !== 'none' && (
              <label className="space-y-1">
                <span className="text-gray-400">Secret name {credMode === 'service' ? '(global/NAME)' : ''}</span>
                <input value={secretKey} onChange={(e) => setSecretKey(e.target.value)} className={inputClass} />
              </label>
            )}
          </div>
        </>
      )}
      {kind === 'activity' && (
        <p className="text-gray-500">
          Only activities on the harness allowlist are listed. A tool runs the activity with the
          model&apos;s arguments; values you fix (connection secret names, a base URL) override them
          and are hidden from the model. Each activity has a minimum side effect (shown as
          &quot;at least&quot;); the side effects you choose below apply only where they are stricter.
        </p>
      )}
      {kind === 'workflow' && (
        <p className="text-gray-500">
          Lists the workflows deployed to you on this stage that declare{' '}
          <span className="font-mono">header.metadata.tool</span>. A tool runs the workflow as the
          calling user.
        </p>
      )}
      <button
        type="button"
        disabled={(kind === 'mcp' && !endpoint.trim()) || busy !== null}
        onClick={() => void doPreview()}
        className="rounded-md border border-gray-700 px-3 py-1.5 text-gray-200 hover:bg-gray-800 disabled:opacity-50"
      >
        {busy === 'preview' ? 'Listing…' : KIND_LABELS[kind].list}
      </button>

      {preview && (
        <div className="space-y-3">
          <p className="text-gray-400">
            {existing && !preview.server
              ? `Imported from the last listing (${preview.tools.length}). ${KIND_LABELS[kind].list} to add others; untick one to remove it:`
              : `${preview.server?.name ?? 'Source'} offers ${preview.tools.length} tools. Tick the ones to import:`}
          </p>
          {preview.tools.length > 8 && (
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter…"
              aria-label="Filter tools"
              className={inputClass}
            />
          )}
          <div className="max-h-72 space-y-1 overflow-y-auto rounded border border-gray-800 p-2">
            {shown.map((t) => (
              <PreviewRow
                key={t.name}
                kind={kind}
                tool={t}
                checked={include.includes(t.name)}
                onCheck={(on) =>
                  setInclude((prev) => (on ? [...prev, t.name] : prev.filter((x) => x !== t.name)))
                }
                fixed={fixedInput[t.name] ?? ''}
                fixedError={fixedErrors[t.name]}
                onFixed={(text) => setFixedInput((prev) => ({ ...prev, [t.name]: text }))}
              />
            ))}
            {shown.length === 0 && <p className="text-gray-500">Nothing matches.</p>}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="space-y-1">
              <span className="text-gray-400">
                {kind === 'mcp' ? 'Side effects (required)' : 'Side effects (at least)'}
              </span>
              <select value={sideEffects} onChange={(e) => setSideEffects(e.target.value as SideEffects | '')} className={inputClass}>
                <option value="">
                  {kind === 'workflow' ? 'As each workflow declares' : kind === 'activity' ? 'Each activity\'s minimum' : 'Choose…'}
                </option>
                <option value="none">None</option>
                <option value="read">Read</option>
                <option value="write">Write</option>
                <option value="external">External</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-gray-400">Permission</span>
              <select value={permission} onChange={(e) => setPermission(e.target.value as ToolPermission | '')} className={inputClass}>
                <option value="">By side effects</option>
                <option value="auto">Runs without asking</option>
                <option value="approve">Asks first</option>
                <option value="deny">Never</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-gray-400">Toolsets (comma, at least one)</span>
              <input
                value={toolsets}
                onChange={(e) => setToolsets(e.target.value.toLowerCase())}
                className={inputClass}
                aria-label="Toolsets"
              />
              {badToolsets.length > 0 && (
                <span className="block text-[11px] text-red-300">
                  Not a toolset name: {badToolsets.join(', ')} (a-z, 0-9, -; starts with a letter)
                </span>
              )}
            </label>
          </div>
        </div>
      )}

      {existing && (
        <p className="text-gray-500">
          Saving re-imports every ticked tool under these settings; a tool you untick is deleted.
        </p>
      )}
      {error && <p className="text-red-300">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!ready || busy !== null}
          onClick={() => void doRegister()}
          className="rounded-md bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {busy === 'register' ? 'Importing…' : existing ? 'Save' : 'Register'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-gray-400 hover:bg-gray-800 hover:text-white">
          Cancel
        </button>
      </div>
    </div>
  );
}

function PreviewRow({
  kind,
  tool,
  checked,
  onCheck,
  fixed,
  fixedError,
  onFixed,
}: {
  kind: ProviderKind;
  tool: PreviewTool;
  checked: boolean;
  onCheck: (on: boolean) => void;
  fixed: string;
  fixedError?: string;
  onFixed: (text: string) => void;
}) {
  const blocked = Boolean(tool.schema_too_large);
  const params = Object.keys(tool.input_schema?.properties ?? {});
  const required = tool.input_schema?.required ?? [];
  return (
    <div className="py-0.5">
      <label className={cn('flex items-start gap-2', blocked && 'opacity-50')}>
        <input
          type="checkbox"
          checked={checked}
          disabled={blocked}
          onChange={(e) => onCheck(e.target.checked)}
          className="mt-0.5"
          aria-label={`Import ${tool.name}`}
        />
        <span className="min-w-0">
          <span className="font-mono text-gray-200">{tool.name}</span>
          {kind === 'activity' && tool.min_side_effects && (
            <span className="ml-1.5 rounded bg-gray-800 px-1 py-0.5 text-[10px] text-gray-400">
              at least {tool.min_side_effects}
            </span>
          )}
          {kind === 'workflow' && tool.side_effects && (
            <span className="ml-1.5 rounded bg-gray-800 px-1 py-0.5 text-[10px] text-gray-400">
              {tool.side_effects}
              {tool.mode === 'async' ? ' · async' : ''}
              {tool.version ? ` · v${tool.version}` : ''}
            </span>
          )}
          {blocked && <span className="ml-1.5 text-[10px] text-amber-300">schema too large</span>}
          {tool.description && <span className="block text-gray-500">{tool.description}</span>}
        </span>
      </label>
      {kind === 'activity' && checked && (
        <div className="ml-6 mt-1 space-y-1">
          <p className="text-[11px] text-gray-500">
            Parameters: {params.map((p) => (required.includes(p) ? `${p}*` : p)).join(', ') || '—'}
          </p>
          <textarea
            value={fixed}
            onChange={(e) => onFixed(e.target.value)}
            rows={2}
            placeholder='Fixed input (JSON), e.g. {"connection_string_secret_key": "global/DB"}'
            aria-label={`Fixed input for ${tool.name}`}
            className={cn(inputClass, 'font-mono')}
          />
          {fixedError && <p className="text-[11px] text-red-300">Fixed input {fixedError}</p>}
        </div>
      )}
    </div>
  );
}
