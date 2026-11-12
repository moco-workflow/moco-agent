import { useCallback, useEffect, useState } from 'react';
import { Check, Play, Users, X } from 'lucide-react';
import { approveProposal, listProposals, rejectProposal, runPromotion } from '@/lib/agent-api';
import { useAuth } from '@/lib/auth/auth-context';
import { useAgent } from '@/lib/agent-context';
import type { MemoryProposal } from '@/types/admin';

/**
 * Memory promotion (design §6.16, admins): notes at least three users hold, merged into one
 * proposal. Approving makes it an agent-wide memory item every user of the agent gets;
 * nothing reaches the agent scope without this. Promotion runs daily; Run now runs it here.
 */
export function ProposalsPanel() {
  const { getAuthToken } = useAuth();
  const { agentId, displayName } = useAgent();
  const [proposals, setProposals] = useState<MemoryProposal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runNote, setRunNote] = useState<string | null>(null);
  const [showDecided, setShowDecided] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const token = await getAuthToken();
      const result = await listProposals(agentId, token);
      setProposals(result.proposals ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load proposals');
    } finally {
      setIsLoading(false);
    }
  }, [agentId, getAuthToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const runNow = async () => {
    setRunning(true);
    setRunNote(null);
    try {
      const token = await getAuthToken();
      const r = await runPromotion(agentId, token);
      setRunNote(
        r.proposed.length
          ? `${r.proposed.length} new proposal${r.proposed.length === 1 ? '' : 's'} from ${r.users} users.`
          : `No new proposals (${r.users} users, ${r.items} notes read, ${r.groups} candidate groups, ${r.confirmed} confirmed).`
      );
      await load();
    } catch (err) {
      setRunNote(err instanceof Error ? err.message : 'Promotion failed');
    } finally {
      setRunning(false);
    }
  };

  const open = proposals.filter((p) => p.status === 'proposed');
  const decided = proposals.filter((p) => p.status !== 'proposed');

  return (
    <div>
      <div className="mb-4 flex items-start gap-3">
        <p className="flex-1 text-sm text-gray-500">
          Notes that several users of {displayName} hold. Approve one and it becomes memory every
          user gets; reject it and it is not proposed again.
        </p>
        <button
          type="button"
          disabled={running}
          onClick={() => void runNow()}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-800 disabled:opacity-50"
        >
          <Play className="h-3.5 w-3.5" />
          {running ? 'Running…' : 'Run now'}
        </button>
      </div>
      {runNote && <p className="mb-4 text-xs text-gray-400">{runNote}</p>}
      {error && (
        <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-300">{error}</div>
      )}
      {isLoading && <p className="text-xs text-gray-500">Loading…</p>}
      {!isLoading && open.length === 0 && !error && (
        <p className="text-sm text-gray-500">No proposals waiting.</p>
      )}
      <div className="space-y-2">
        {open.map((p) => (
          <ProposalRow key={p.key} proposal={p} onDecided={load} />
        ))}
      </div>

      {decided.length > 0 && (
        <div className="mt-8">
          <button
            type="button"
            onClick={() => setShowDecided((v) => !v)}
            className="text-xs text-gray-500 hover:text-gray-300"
          >
            {showDecided ? 'Hide' : 'Show'} decided ({decided.length})
          </button>
          {showDecided && (
            <ul className="mt-2 space-y-1">
              {decided.map((p) => (
                <li key={p.key} className="text-xs text-gray-500">
                  <span className="text-gray-400">{p.title}</span> — {p.status}
                  {p.decided_by ? ` by ${p.decided_by}` : ''}
                  {p.decided_at ? `, ${new Date(p.decided_at).toLocaleDateString()}` : ''}
                  {p.reason ? ` (${p.reason})` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ProposalRow({ proposal, onDecided }: { proposal: MemoryProposal; onDecided: () => Promise<void> }) {
  const { getAuthToken } = useAuth();
  const { agentId } = useAgent();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40">
      <div className="flex items-start gap-3 p-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white">{proposal.title}</span>
            <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-400">
              {proposal.kind}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-400">{proposal.text}</p>
          <p className="mt-1.5 flex items-center gap-1 text-[11px] text-gray-600">
            <Users className="h-3 w-3" />
            {proposal.user_count ?? proposal.members?.length ?? 0} users
            {proposal.tags?.length ? ` · ${proposal.tags.map((t) => `#${t}`).join(' ')}` : ''}
            {proposal.expires_at ? ` · expires ${new Date(proposal.expires_at).toLocaleDateString()}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(async () => approveProposal(agentId, proposal.slug, await getAuthToken()))}
            className="flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" /> Approve
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setRejecting(true)}
            className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" /> Reject
          </button>
        </div>
      </div>
      {rejecting && (
        <div className="flex items-center gap-2 border-t border-gray-800 px-3 py-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why (optional)"
            aria-label="Reason"
            className="flex-1 rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-200"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(async () => rejectProposal(agentId, proposal.slug, reason.trim(), await getAuthToken()))}
            className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => setRejecting(false)}
            className="rounded-md px-2 py-1 text-xs text-gray-400 hover:bg-gray-800"
          >
            Cancel
          </button>
        </div>
      )}
      {error && <p className="border-t border-gray-800 px-3 py-2 text-xs text-red-300">{error}</p>}
    </div>
  );
}
