import { Check, CheckCheck, RotateCcw, Wrench, X } from 'lucide-react';
import { cn, formatMessageTime } from '@/lib/utils';
import { MarkdownContent } from './markdown-content';
import { MessageActions } from './message-actions';
import { SourceList } from './source-list';
import { SetupActions } from './setup/setup-actions';
import { secondaryButton } from '@/components/ui/settings-card';
import type { ChatMessage, PendingDecision } from '@/types/chat';

/** Answers worth a rating: a real turn that answered, declined or asked back. */
const RATABLE = new Set(['ok', 'declined', 'clarify']);

interface MessageBubbleProps {
  message: ChatMessage;
  /** Buttons for the pending action; only the LAST answer gets them, and not mid-turn. */
  onRespond?: (decision: PendingDecision) => Promise<void>;
  /** Thumbs; absent for guests. */
  onRate?: (rating: 'up' | 'down') => Promise<void>;
  /** Ask the question again, offered on an answer that named a setup gap (F70). */
  onRetry?: () => Promise<void>;
}

export function MessageBubble({ message, onRespond, onRate, onRetry }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isError = !!message.error;

  return (
    <div className={cn('flex w-full flex-col', isUser ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-lg px-4 py-3',
          isUser && 'bg-blue-600 text-white',
          !isUser && !isError && 'bg-gray-800 text-gray-100',
          isError && 'bg-red-950 border border-red-800 text-red-200'
        )}
      >
        {isError ? (
          <div>
            <p className="text-sm font-medium text-red-300 mb-1">Error</p>
            <p className="text-sm whitespace-pre-wrap">{message.error}</p>
          </div>
        ) : isUser ? (
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        ) : (
          <MarkdownContent content={message.content} className="text-sm text-gray-100" />
        )}
        {message.sources && message.sources.length > 0 && (
          <SourceList sources={message.sources} />
        )}
        {/* Agent answers only, and never on an error bubble: there is no turn
            behind a transport failure and nothing to trace. */}
        {!isUser && !isError && (
          <MessageActions
            route={message.route}
            status={message.status}
            workflowId={message.workflowId}
            onRate={onRate && message.turn !== undefined && RATABLE.has(message.status ?? '') && !message.setup ? onRate : undefined}
            feedback={message.feedback}
            setupNeeded={!!message.setup}
          />
        )}
        {!isUser && !isError && message.setup && (
          <SetupCallout setup={message.setup} onRetry={onRetry} />
        )}
        {!isUser && !isError && message.pendingAction && onRespond && (
          <ApprovalBar
            kind={message.pendingAction.kind}
            offerSession={Boolean(message.pendingAction.offer_session_grant)}
            onRespond={onRespond}
          />
        )}
      </div>
      {/* 0 is a restored turn stored without a time. */}
      {message.timestamp > 0 && (
        <time
          dateTime={new Date(message.timestamp).toISOString()}
          title={new Date(message.timestamp).toLocaleString()}
          className="mt-1 px-1 text-[11px] text-gray-500"
        >
          {formatMessageTime(message.timestamp)}
        </time>
      )}
    </div>
  );
}

/**
 * The answer to a pending action, as buttons. They send the same `action` a typed
 * "yes" / "no" would (agent-cli), so either works. A question (`user_input`) is
 * answered by typing.
 */
function ApprovalBar({
  kind,
  offerSession,
  onRespond,
}: {
  kind?: string;
  offerSession: boolean;
  onRespond: (decision: PendingDecision) => Promise<void>;
}) {
  if (kind === 'user_input') {
    return <p className="mt-2 text-xs text-gray-400">Type your answer below.</p>;
  }
  const button =
    'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors';
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Approve or reject">
      <button
        type="button"
        onClick={() => void onRespond('approve')}
        className={cn(button, 'bg-blue-600 text-white hover:bg-blue-500')}
      >
        <Check className="h-3.5 w-3.5" /> Approve
      </button>
      {offerSession && (
        <button
          type="button"
          onClick={() => void onRespond('approve_session')}
          className={cn(button, 'bg-gray-700 text-gray-100 hover:bg-gray-600')}
          title="Approve, and stop asking for this tool in this conversation"
        >
          <CheckCheck className="h-3.5 w-3.5" /> Approve for this session
        </button>
      )}
      <button
        type="button"
        onClick={() => void onRespond('reject')}
        className={cn(button, 'text-gray-300 hover:bg-gray-700')}
      >
        <X className="h-3.5 w-3.5" /> Reject
      </button>
    </div>
  );
}


/**
 * Under an answer that could not be given because a model is not set up (F70):
 * fix it in place, then ask again. The answer text already says what is missing.
 */
function SetupCallout({ setup, onRetry }: { setup: NonNullable<ChatMessage['setup']>; onRetry?: () => Promise<void> }) {
  const keyField = setup.role === 'embedding' ? 'model_name' : 'model';
  return (
    <div className="mt-3 rounded-md border border-amber-900/60 bg-amber-950/20 p-3" data-setup-role={setup.role}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-amber-200">
        <Wrench className="h-3.5 w-3.5" /> Set up the {setup.role} model
      </p>
      <SetupActions
        secretName={setup.secret_name}
        secretMissing={setup.reason === 'secret_missing' || setup.reason === 'auth_failed'}
        fields={['models.' + setup.role + '.' + keyField, 'models.' + setup.role + '.base_url', 'models.' + setup.role + '.apikey_secret_key']}
      />
      {onRetry && (
        <button type="button" onClick={() => void onRetry()} className={secondaryButton + ' mt-2 inline-flex items-center gap-1 border border-gray-700'}>
          <RotateCcw className="h-3.5 w-3.5" /> Ask again
        </button>
      )}
    </div>
  );
}
