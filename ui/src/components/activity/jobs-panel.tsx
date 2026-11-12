import { useCallback, useEffect, useRef, useState } from 'react';
import { Ban, Check, Loader2, MessageSquare, X } from 'lucide-react';
import { answerJob, cancelJob, listJobs } from '@/lib/agent-api';
import { useAuth } from '@/lib/auth/auth-context';
import { useAgent } from '@/lib/agent-context';
import { cn } from '@/lib/utils';
import { MarkdownContent } from '@/components/markdown-content';
import type { JobRow } from '@/types/admin';

const ACTIVE = new Set(['queued', 'running', 'awaiting_input']);
const STATUS_STYLES: Record<string, string> = {
  queued: 'bg-blue-950 text-blue-300',
  running: 'bg-blue-950 text-blue-300',
  awaiting_input: 'bg-amber-950 text-amber-300',
  completed: 'bg-green-950 text-green-300',
  failed: 'bg-red-950 text-red-300',
  cancelled: 'bg-gray-800 text-gray-400',
};
/** Poll while a job is active; jobs run for minutes, so not faster than this. */
const POLL_MS = 10_000;

/**
 * The caller's background jobs (design §6.12): long work a turn started, such as the
 * builder's plan → review → implement. A job waiting on you (its plan review) can be
 * answered here; its result also arrives in the conversation as a turn of its own.
 */
export function JobsPanel() {
  const { getAuthToken } = useAuth();
  const { agentId } = useAgent();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const load = useCallback(
    async (poll = false) => {
      try {
        const token = await getAuthToken();
        const r = await listJobs(agentId, token, { poll });
        setJobs(
          [...(r.jobs ?? [])].sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
        );
        setError(null);
      } catch (err) {
        if (!poll) setError(err instanceof Error ? err.message : 'Could not load jobs');
      } finally {
        setIsLoading(false);
      }
    },
    [agentId, getAuthToken]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const anyActive = jobs.some((j) => ACTIVE.has(j.status));
  useEffect(() => {
    if (!anyActive) return;
    timer.current = window.setTimeout(() => void load(true), POLL_MS);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [anyActive, jobs, load]);

  return (
    <div>
      <p className="mb-4 text-sm text-gray-500">
        Work a conversation started in the background. Results also arrive in that conversation.
      </p>
      {error && (
        <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-300">{error}</div>
      )}
      {isLoading && <p className="text-xs text-gray-500">Loading…</p>}
      {!isLoading && jobs.length === 0 && !error && <p className="text-sm text-gray-500">No background jobs.</p>}
      <div className="space-y-2">
        {jobs.map((j) => (
          <JobRowView key={j.job_id} job={j} onChanged={() => load()} />
        ))}
      </div>
    </div>
  );
}

function JobRowView({ job, onChanged }: { job: JobRow; onChanged: () => Promise<void> }) {
  const { getAuthToken } = useAuth();
  const { agentId } = useAgent();
  const [open, setOpen] = useState(job.status === 'awaiting_input');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState('');

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(null);
    }
  };
  const answer = (decision: 'approve' | 'reject' | 'revise', text?: string) =>
    run(decision, async () => answerJob(agentId, job.job_id, decision, text, await getAuthToken()));

  const button = 'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors disabled:opacity-50';

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-3 p-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-white">{job.summary || job.profile || job.job_id}</span>
            <span className={cn('flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide', STATUS_STYLES[job.status])}>
              {(job.status === 'running' || job.status === 'queued') && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
              {job.status.replace('_', ' ')}
            </span>
            {job.profile && <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400">{job.profile}</span>}
          </div>
          <p className="mt-0.5 text-[11px] text-gray-600">
            {job.created_at ? `started ${new Date(job.created_at).toLocaleString()}` : ''}
            {job.updated_at ? ` · updated ${new Date(job.updated_at).toLocaleString()}` : ''}
          </p>
        </div>
      </button>

      {open && (
        <div className="space-y-3 border-t border-gray-800 px-3 py-3 text-xs">
          {job.status === 'awaiting_input' && (
            <div className="rounded border border-amber-900/50 bg-amber-950/10 p-3 text-amber-100">
              <p className="mb-2 flex items-center gap-1 font-medium text-amber-200">
                <MessageSquare className="h-3.5 w-3.5" /> Waiting for you
              </p>
              {job.pending_action?.summary && (
                <MarkdownContent content={job.pending_action.summary} className="text-xs text-gray-200" />
              )}
              {revising ? (
                <div className="mt-2 space-y-2">
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    rows={3}
                    placeholder="What should change?"
                    aria-label="Revision feedback"
                    className="w-full rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-200"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={!feedback.trim() || busy !== null}
                      onClick={() => void answer('revise', feedback.trim())}
                      className={cn(button, 'bg-blue-600 text-white hover:bg-blue-500')}
                    >
                      {busy === 'revise' ? 'Sending…' : 'Send revision'}
                    </button>
                    <button type="button" onClick={() => setRevising(false)} className={cn(button, 'text-gray-400 hover:bg-gray-800')}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" disabled={busy !== null} onClick={() => void answer('approve')} className={cn(button, 'bg-blue-600 text-white hover:bg-blue-500')}>
                    <Check className="h-3.5 w-3.5" /> {busy === 'approve' ? 'Approving…' : 'Approve'}
                  </button>
                  <button type="button" disabled={busy !== null} onClick={() => setRevising(true)} className={cn(button, 'bg-gray-700 text-gray-100 hover:bg-gray-600')}>
                    Revise…
                  </button>
                  <button type="button" disabled={busy !== null} onClick={() => void answer('reject')} className={cn(button, 'text-gray-300 hover:bg-gray-800')}>
                    <X className="h-3.5 w-3.5" /> Reject
                  </button>
                </div>
              )}
            </div>
          )}
          {job.status === 'completed' && job.result?.answer && (
            <MarkdownContent content={job.result.answer} className="text-xs text-gray-200" />
          )}
          {job.status === 'failed' && job.error && (
            <p className="font-mono text-red-300">
              {job.error.code ? `${job.error.code}: ` : ''}
              {job.error.message}
            </p>
          )}
          <p className="text-gray-600">
            Job {job.job_id} · conversation {job.session_id}
          </p>
          {ACTIVE.has(job.status) && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run('cancel', async () => cancelJob(agentId, job.job_id, await getAuthToken()))}
              className={cn(button, 'text-red-300 hover:bg-red-950/40')}
            >
              <Ban className="h-3.5 w-3.5" /> {busy === 'cancel' ? 'Cancelling…' : 'Cancel job'}
            </button>
          )}
          {error && <p className="text-red-300">{error}</p>}
        </div>
      )}
    </div>
  );
}
