import { useState } from 'react';
import { ExternalLink, ThumbsDown, ThumbsUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isTraceableWorkflowId, traceviewUrl } from '@/lib/traceview';

/**
 * Statuses worth a word under the answer. `ok` says nothing a reader needs; the
 * answer text of the others already explains itself, the badge only labels it.
 */
const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  declined: { label: 'declined', className: 'bg-amber-950 text-amber-300' },
  clarify: { label: 'needs clarification', className: 'bg-blue-950 text-blue-300' },
  busy: { label: 'busy', className: 'bg-amber-950 text-amber-300' },
  error: { label: 'error', className: 'bg-red-950 text-red-300' },
  needs_approval: { label: 'needs approval', className: 'bg-blue-950 text-blue-300' },
  async_started: { label: 'running in background', className: 'bg-blue-950 text-blue-300' },
};

const SETUP_BADGE = { label: 'setup needed', className: 'bg-amber-950 text-amber-300' };

interface MessageActionsProps {
  /** Which profile answered: chat, rag, ... */
  route?: string | null;
  status?: string;
  /** The agent-cli run behind the answer. No id, no trace link -- never a guessed one. */
  workflowId?: string;
  /** Rate the answer; absent when this answer cannot be rated (no turn, guest, ...). */
  onRate?: (rating: 'up' | 'down') => Promise<void>;
  /** The rating already given in this browser session. */
  feedback?: 'up' | 'down';
  /** The turn failed because a model is not set up (F70): labelled as such, not "error". */
  setupNeeded?: boolean;
}

/**
 * The row under an answer: which profile answered, any non-ok status, thumbs (a 👎
 * also lowers the memory items the answer used) and the trace link.
 */
export function MessageActions({ route, status, workflowId, onRate, feedback, setupNeeded }: MessageActionsProps) {
  const canTrace = isTraceableWorkflowId(workflowId);
  const badge = setupNeeded ? SETUP_BADGE : status ? STATUS_LABELS[status] : undefined;
  const [sending, setSending] = useState<'up' | 'down' | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);

  if (!route && !badge && !canTrace && !onRate) return null;

  const rate = async (rating: 'up' | 'down') => {
    if (!onRate || feedback) return;
    setSending(rating);
    setRateError(null);
    try {
      await onRate(rating);
    } catch (err) {
      setRateError(err instanceof Error ? err.message : 'Could not send feedback');
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="mt-2 flex items-center gap-1.5 border-t border-gray-700/60 pt-2">
      {route && (
        <span
          className="rounded bg-gray-700/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-400"
          title="The profile that answered"
        >
          {route}
        </span>
      )}
      {badge && (
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide',
            badge.className
          )}
        >
          {badge.label}
        </span>
      )}
      {onRate && (
        <div className="ml-auto flex items-center gap-0.5">
          {(['up', 'down'] as const).map((r) => {
            const Icon = r === 'up' ? ThumbsUp : ThumbsDown;
            const chosen = feedback === r;
            return (
              <button
                key={r}
                type="button"
                disabled={Boolean(feedback) || sending !== null}
                onClick={() => void rate(r)}
                aria-label={r === 'up' ? 'Good answer' : 'Bad answer'}
                aria-pressed={chosen}
                title={feedback ? 'Thanks for the feedback' : r === 'up' ? 'Good answer' : 'Bad answer'}
                className={cn(
                  'rounded-md p-1 transition-colors disabled:cursor-default',
                  chosen && r === 'up' && 'text-green-400',
                  chosen && r === 'down' && 'text-red-400',
                  !chosen &&
                    'text-gray-500 hover:bg-gray-700/50 hover:text-gray-200 disabled:opacity-40 disabled:hover:bg-transparent',
                  sending === r && 'animate-pulse'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            );
          })}
          {rateError && <span className="ml-1 text-[11px] text-red-300">{rateError}</span>}
        </div>
      )}
      {canTrace && (
        <a
          href={traceviewUrl(workflowId)}
          target="_blank"
          // noopener matters here: the viewer is same-origin behind nginx and
          // would otherwise be handed a live `window.opener`.
          rel="noopener noreferrer"
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-700/50 hover:text-gray-200',
            !onRate && 'ml-auto'
          )}
        >
          <ExternalLink className="h-3 w-3" aria-hidden />
          View trace
        </a>
      )}
    </div>
  );
}
