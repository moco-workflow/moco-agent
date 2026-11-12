import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  RotateCw,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { isRefreshing, isStalled } from '@/hooks/use-sources';
import { summarizeSource } from '@/lib/source-kinds';
import { getSource } from '@/lib/agent-api';
import { useAuth } from '@/lib/auth/auth-context';
import { useAgent } from '@/lib/agent-context';
import type { IndexSource, KnowledgeSource } from '@/types/admin';

export function SourceRow({
  source,
  canManage,
  searchable,
  onReindex,
  onRefresh,
  onSetRefreshInterval,
  onDelete,
}: {
  source: KnowledgeSource;
  /** Server-enforced as well: shared needs an admin, guests write nothing. */
  canManage: boolean;
  /** Whether the selected agent's answers can draw on this source. */
  searchable: boolean;
  onReindex: () => Promise<void>;
  /** Background re-index that keeps the source serving (ready sources only). */
  onRefresh: () => Promise<void>;
  /** Scheduled refresh interval in hours; null turns it off. */
  onSetRefreshInterval: (everyHours: number | null) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const { getAuthToken } = useAuth();
  const { agentId } = useAgent();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the row was indexed from. list_sources does not carry it, so it is
  // read on first expand.
  const [indexed, setIndexed] = useState<IndexSource[] | null>(null);

  const stalled = isStalled(source);
  // A run in flight would race a second one over the same table; a stalled one
  // has nothing running. `deleting` is on its way out.
  const canReindex =
    canManage && (source.status === 'ready' || source.status === 'failed' || stalled);
  const canDelete = canManage && source.status !== 'deleting' && (source.status !== 'indexing' || stalled);
  const refreshing = isRefreshing(source);
  // Refresh needs a serving source and no refresh already running (the harness refuses
  // a second one anyway). Only pgvector sources are re-indexed.
  const canRefresh =
    canManage && source.status === 'ready' && source.kind !== 'wfspec' && !refreshing;

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && indexed === null) {
      try {
        const token = await getAuthToken();
        const result = await getSource(agentId, source.name, source.scope, token);
        setIndexed(result.source.refresh?.sources ?? []);
      } catch {
        setIndexed([]);
      }
    }
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40">
      <div className="flex items-center gap-3 p-3">
        <button
          type="button"
          onClick={() => void toggle()}
          className="shrink-0 text-gray-500 hover:text-white"
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-white">{source.name}</span>
            <span
              className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-400"
              title={source.scope === 'shared' ? 'Shared: managed by admins' : 'Private to you'}
            >
              {source.scope}
            </span>
            <StatusBadge source={source} stalled={stalled} />
            {refreshing && (
              <span
                className="flex items-center gap-1 rounded bg-blue-950 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-blue-300"
                title="Re-indexing in the background; answers still use the current data"
              >
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                refreshing
              </span>
            )}
            {!searchable && source.status === 'ready' && (
              <span
                className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-500"
                title={
                  source.scope === 'shared'
                    ? "Not in this agent's knowledge.sources, so its answers never search it."
                    : 'This agent does not search private sources (knowledge.allow_user_sources is off).'
                }
              >
                not used by this agent
              </span>
            )}
          </div>
          {source.description && (
            <p className="mt-0.5 truncate text-xs text-gray-500">{source.description}</p>
          )}
        </div>

        <span className="shrink-0 text-xs text-gray-500">
          {source.status === 'ready' ? `${source.node_count ?? 0} chunks` : ''}
        </span>

        {canRefresh && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(onRefresh)}
            className="shrink-0 rounded-md p-1.5 text-gray-500 hover:bg-gray-800 hover:text-white disabled:opacity-50"
            aria-label={`Refresh ${source.name}`}
            title="Refresh: re-index in the background while it keeps answering"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
        )}

        {canReindex && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(onReindex)}
            className="shrink-0 rounded-md p-1.5 text-gray-500 hover:bg-gray-800 hover:text-white disabled:opacity-50"
            aria-label={`Re-index ${source.name}`}
            title="Re-index from the stored sources (the source is offline until it finishes)"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
          </button>
        )}

        {canDelete && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="shrink-0 rounded-md p-1.5 text-gray-500 hover:bg-gray-800 hover:text-red-400"
            aria-label={`Delete ${source.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {error && (
        <p className="border-t border-gray-800 px-3 py-2 text-xs text-red-300">{error}</p>
      )}

      {stalled && (
        <p className="border-t border-gray-800 px-3 py-2 text-xs text-amber-300">
          Indexing for over 45 minutes with no verdict. The indexer may have died — nothing
          records a final status if its worker does. Re-index to start a fresh run.
        </p>
      )}

      {source.refresh_error && !refreshing && (
        <p className="border-t border-gray-800 px-3 py-2 text-xs text-amber-300">
          Last refresh failed
          {source.refresh_failed_at ? ` (${new Date(source.refresh_failed_at).toLocaleString()})` : ''}
          ; answers still use the previous data.{' '}
          <span className="font-mono text-amber-200/80">{source.refresh_error}</span>
        </p>
      )}

      {source.status === 'failed' && source.error && (
        <p className="border-t border-gray-800 px-3 py-2 font-mono text-xs text-red-300">
          {source.error}
        </p>
      )}

      {open && (
        <div className="space-y-3 border-t border-gray-800 px-3 py-3 text-xs">
          {source.keywords && source.keywords.length > 0 && (
            <Detail label="Keywords" value={source.keywords.join(', ')} />
          )}
          <Detail label="Table" value={source.table_name ?? '—'} mono />
          {source.indexed_at && (
            <Detail label="Last indexed" value={new Date(source.indexed_at).toLocaleString()} />
          )}
          {source.updated_by && <Detail label="Updated by" value={source.updated_by} />}
          <RefreshSchedule
            source={source}
            canManage={canManage}
            onChange={(hours) => run(() => onSetRefreshInterval(hours))}
          />

          <div>
            <p className="mb-1 font-medium text-gray-400">Indexed from</p>
            {indexed === null ? (
              <p className="text-gray-600">Loading…</p>
            ) : indexed.length === 0 ? (
              <p className="text-gray-600">—</p>
            ) : (
              <ul className="space-y-0.5">
                {indexed.map((s, i) => (
                  <li key={i} className="truncate text-gray-500">
                    <span className="text-gray-400">{s.kind}</span> — {summarizeSource(s)}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {source.embed_model_info && (
            <div>
              <p className="mb-1 font-medium text-gray-400">Embedding model</p>
              <p className="text-gray-500">
                {source.embed_model_info.model_name || 'the default model (server environment)'} ({source.embed_model_info.embed_dim}d) at{' '}
                {source.embed_model_info.base_url || 'the default endpoint (server environment)'}
              </p>
              <p className="mt-0.5 text-gray-600">
                Fixed at index time — the same model is used to query it.
              </p>
            </div>
          )}
        </div>
      )}

      {confirming && (
        <div className="border-t border-gray-800 bg-red-950/20 px-3 py-3">
          <p className="text-xs text-gray-300">
            Delete <span className="font-medium text-white">{source.name}</span>? Its vector
            table ({source.table_name}) is dropped too; the embeddings are not cheap to rebuild.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(onDelete)}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
            >
              {busy ? 'Deleting…' : 'Delete'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="rounded-md px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Interval choices for the scheduled refresh; null is off. */
const REFRESH_INTERVALS: { hours: number | null; label: string }[] = [
  { hours: null, label: 'Off' },
  { hours: 1, label: 'Every hour' },
  { hours: 6, label: 'Every 6 hours' },
  { hours: 24, label: 'Daily' },
  { hours: 168, label: 'Weekly' },
];

/**
 * The scheduled refresh (the hourly knowledge-refresh job re-indexes a shared source
 * once its interval has passed). Private sources are refreshed by hand only: the job
 * cannot list other users' sources.
 */
function RefreshSchedule({
  source,
  canManage,
  onChange,
}: {
  source: KnowledgeSource;
  canManage: boolean;
  onChange: (everyHours: number | null) => Promise<void>;
}) {
  const current = source.refresh_every_hours ?? null;
  const known = REFRESH_INTERVALS.some((i) => i.hours === current);
  const label =
    REFRESH_INTERVALS.find((i) => i.hours === current)?.label ?? `Every ${current} hours`;

  if (source.kind === 'wfspec') return null;
  if (source.scope !== 'shared') {
    return (
      <Detail label="Auto refresh" value="Shared sources only; use Refresh to update a private one" />
    );
  }
  if (!canManage) return <Detail label="Auto refresh" value={label} />;
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 font-medium text-gray-400">Auto refresh</span>
      <select
        value={current === null ? '' : String(current)}
        onChange={(e) => void onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200"
        aria-label={`Auto refresh for ${source.name}`}
      >
        {!known && <option value={String(current)}>{label}</option>}
        {REFRESH_INTERVALS.map((i) => (
          <option key={i.label} value={i.hours === null ? '' : String(i.hours)}>
            {i.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="w-24 shrink-0 font-medium text-gray-400">{label}</span>
      <span className={cn('text-gray-500', mono && 'font-mono')}>{value}</span>
    </div>
  );
}

function StatusBadge({ source, stalled }: { source: KnowledgeSource; stalled: boolean }) {
  if (source.status === 'indexing' || source.status === 'deleting') {
    return (
      <span
        className={cn(
          'flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide',
          stalled ? 'bg-amber-950 text-amber-300' : 'bg-blue-950 text-blue-300'
        )}
      >
        {stalled ? (
          <AlertTriangle className="h-2.5 w-2.5" />
        ) : (
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
        )}
        {stalled ? 'stalled' : source.status}
      </span>
    );
  }
  if (source.status === 'failed') {
    return (
      <span className="flex items-center gap-1 rounded bg-red-950 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-red-300">
        <AlertTriangle className="h-2.5 w-2.5" />
        failed
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 rounded bg-green-950 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-green-300">
      <CheckCircle2 className="h-2.5 w-2.5" />
      ready
    </span>
  );
}
