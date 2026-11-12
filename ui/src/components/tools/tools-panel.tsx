import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { clearToolPref, listToolPrefs, listTools, setToolPref } from '@/lib/agent-api';
import { useAuth } from '@/lib/auth/auth-context';
import { useAgent } from '@/lib/agent-context';
import { AgentToolsets } from './agent-toolsets';
import { cn } from '@/lib/utils';
import type { ToolManifest, ToolPermission, ToolPref } from '@/types/admin';

const PERMISSION_LABELS: Record<ToolPermission, string> = {
  auto: 'Runs without asking',
  approve: 'Asks first',
  deny: 'Never',
};

const EFFECT_STYLES: Record<string, string> = {
  none: 'bg-gray-800 text-gray-400',
  read: 'bg-gray-800 text-gray-300',
  write: 'bg-amber-950 text-amber-300',
  external: 'bg-red-950 text-red-300',
};

/** The group for tools that name no toolset. */
const NO_TOOLSET = '';

/**
 * The tools an agent can use, grouped by toolset (closed by default), and the
 * caller's own preference for each (design §6.9.7):
 * tighten any tool to "asks first" or "never"; "runs without asking" only where the
 * harness allows it (a read-only tool whose manifest asks approval and allows session
 * grants, with no agent override). The harness enforces this; the UI only offers what
 * would apply.
 */
export function ToolsPanel() {
  const { getAuthToken } = useAuth();
  const { agentId, agentConfig, readOnly, role, displayName } = useAgent();
  const [tools, setTools] = useState<ToolManifest[]>([]);
  const [prefs, setPrefs] = useState<Record<string, ToolPref>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  // Only the latest load may land: an older, slower one would overwrite fresher prefs.
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    // The role decides whether prefs exist at all; wait for it rather than load twice.
    if (readOnly === null) return;
    const seq = ++loadSeq.current;
    setIsLoading(true);
    try {
      const token = await getAuthToken();
      const [t, p] = await Promise.all([
        listTools(agentId, token),
        readOnly === false ? listToolPrefs(agentId, token) : Promise.resolve({ prefs: [] }),
      ]);
      if (seq !== loadSeq.current) return;
      setTools((t.tools ?? []).filter((x) => x.status === 'enabled' || x.status === 'deprecated'));
      setPrefs(Object.fromEntries((p.prefs ?? []).map((x) => [x.name, x])));
      setError(null);
    } catch (err) {
      if (seq === loadSeq.current) setError(err instanceof Error ? err.message : 'Could not load tools');
    } finally {
      if (seq === loadSeq.current) setIsLoading(false);
    }
  }, [agentId, getAuthToken, readOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const toolsets = (agentConfig?.config.toolsets as string[] | undefined) ?? [];
  const overrides =
    ((agentConfig?.config.tools as { overrides?: Record<string, unknown> } | undefined)?.overrides) ?? {};
  const offered = (t: ToolManifest) => (t.toolsets ?? []).some((s) => toolsets.includes(s));
  const visible = tools.filter((t) => showAll || offered(t));
  // A tool in several toolsets is listed under each; without "show all", only under
  // the toolsets the agent offers.
  const groups = new Map<string, ToolManifest[]>();
  for (const t of visible) {
    const sets = (t.toolsets ?? []).filter((s) => showAll || toolsets.includes(s));
    for (const s of sets.length ? sets : [NO_TOOLSET]) groups.set(s, [...(groups.get(s) ?? []), t]);
  }
  const groupNames = [...groups.keys()].sort((a, b) =>
    a === NO_TOOLSET ? 1 : b === NO_TOOLSET ? -1 : a.localeCompare(b)
  );

  const change = async (name: string, value: ToolPermission | '') => {
    const token = await getAuthToken();
    if (value === '') await clearToolPref(agentId, name, token);
    else await setToolPref(agentId, name, value, token);
    setPrefs((prev) => {
      const next = { ...prev };
      if (value === '') delete next[name];
      else next[name] = { name, permission: value };
      return next;
    });
  };

  return (
    <div>
      {role === 'admin' && !isLoading && <AgentToolsets tools={tools} />}
      <div className="mb-4 flex items-center gap-3">
        <p className="flex-1 text-sm text-gray-500">
          {showAll ? 'Every enabled tool in this deployment.' : `The tools ${displayName} can use (its toolsets: ${toolsets.join(', ') || 'none'}).`}{' '}
          Your preference applies to you alone and can only make a tool stricter, except where its
          author allows it to run without asking.
        </p>
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-gray-400">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Show all tools
        </label>
      </div>
      {error && (
        <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-300">{error}</div>
      )}
      {isLoading && <p className="text-xs text-gray-500">Loading…</p>}
      {!isLoading && visible.length === 0 && !error && <p className="text-sm text-gray-500">No tools.</p>}
      <div className="space-y-2">
        {groupNames.map((g) => (
          <ToolsetGroup key={g || '-'} name={g} offered={g !== NO_TOOLSET && toolsets.includes(g)} showAll={showAll} count={groups.get(g)!.length}>
            {groups.get(g)!.map((t) => (
              <ToolRow
                key={`${t.scope}-${t.name}`}
                tool={t}
                pref={prefs[t.name]}
                agentOverride={t.name in overrides}
                canEdit={readOnly === false}
                onChange={(v) => change(t.name, v)}
              />
            ))}
          </ToolsetGroup>
        ))}
      </div>
    </div>
  );
}

function ToolsetGroup({
  name,
  offered,
  showAll,
  count,
  children,
}: {
  name: string;
  offered: boolean;
  showAll: boolean;
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="rounded-lg border border-gray-800 bg-gray-900/20"
    >
      <summary className="flex cursor-pointer select-none list-none items-center gap-2 px-3 py-2.5 hover:bg-gray-900/60 [&::-webkit-details-marker]:hidden">
        <span className={cn('text-sm font-medium', name ? 'font-mono text-gray-100' : 'italic text-gray-400')}>
          {name || 'No toolset'}
        </span>
        <span className="text-xs text-gray-500">
          {count} {count === 1 ? 'tool' : 'tools'}
        </span>
        {showAll && offered && (
          <span className="rounded bg-blue-950 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-blue-300">offered</span>
        )}
        <ChevronDown className={cn('ml-auto h-4 w-4 shrink-0 text-gray-500 transition-transform', open && 'rotate-180')} />
      </summary>
      <div className="space-y-2 border-t border-gray-800/70 p-2">{children}</div>
    </details>
  );
}

function ToolRow({
  tool,
  pref,
  agentOverride,
  canEdit,
  onChange,
}: {
  tool: ToolManifest;
  pref?: ToolPref;
  agentOverride: boolean;
  canEdit: boolean;
  onChange: (value: ToolPermission | '') => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  // The choice being saved, shown at once (a save takes a few seconds).
  const [pending, setPending] = useState<ToolPermission | '' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const effects = tool.policy?.side_effects ?? 'none';
  const base = tool.policy?.permission ?? 'auto';
  // The harness's loosening rule (tool-policy): auto only for a read-only tool whose
  // manifest asks approve and allows session grants, with no agent override.
  const canAuto =
    base === 'approve' && (effects === 'none' || effects === 'read') && tool.policy?.allow_session_grant === true && !agentOverride;
  const options: { value: ToolPermission | ''; label: string }[] = [
    { value: '', label: `Default (${PERMISSION_LABELS[base].toLowerCase()})` },
    ...(canAuto ? [{ value: 'auto' as const, label: PERMISSION_LABELS.auto }] : []),
    ...(base !== 'approve' ? [{ value: 'approve' as const, label: PERMISSION_LABELS.approve }] : []),
    ...(base !== 'deny' ? [{ value: 'deny' as const, label: PERMISSION_LABELS.deny }] : []),
  ];

  const pick = async (value: ToolPermission | '') => {
    setBusy(true);
    setPending(value);
    setError(null);
    try {
      await onChange(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-white">{tool.name}</span>
            <span className={cn('rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide', EFFECT_STYLES[effects])}>
              {effects === 'none' ? 'no side effects' : effects}
            </span>
            {tool.origin?.startsWith('provider:') && (
              <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400">{tool.origin}</span>
            )}
            {tool.status === 'deprecated' && (
              <span className="rounded bg-amber-950 px-1.5 py-0.5 text-[10px] uppercase text-amber-300">deprecated</span>
            )}
            {tool.credential?.mode === 'user' && (
              <span
                className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400"
                title={tool.credential.connect_hint ?? undefined}
              >
                needs your secret {tool.credential.secret_key}
              </span>
            )}
          </div>
          {tool.description && <p className="mt-1 text-xs text-gray-500">{tool.description}</p>}
        </div>
        <div className="shrink-0">
          {canEdit ? (
            <select
              value={pending ?? pref?.permission ?? ''}
              disabled={busy}
              aria-busy={busy}
              onChange={(e) => void pick(e.target.value as ToolPermission | '')}
              aria-label={`Your preference for ${tool.name}`}
              className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200"
            >
              {pref && !options.some((o) => o.value === pref.permission) && (
                <option value={pref.permission}>{PERMISSION_LABELS[pref.permission]} (not applied)</option>
              )}
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-gray-500">{PERMISSION_LABELS[base]}</span>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </div>
  );
}
