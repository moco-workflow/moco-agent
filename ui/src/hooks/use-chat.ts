import { useCallback, useEffect, useState } from 'react';
import { getSession, HarnessCallError, sendTurn, submitFeedback } from '@/lib/agent-api';
import { mintTraceId, openProgressStream, type TurnProgress } from '@/lib/progress-stream';
import { useAuth } from '@/lib/auth/auth-context';
import { useAgent } from '@/lib/agent-context';
import type { ChatMessage, PendingDecision } from '@/types/chat';
import type { SessionTurn } from '@/types/admin';

/** session-store pages the transcript; a long conversation needs a few reads. */
const MAX_TRANSCRIPT_PAGES = 10;

interface UseChatOptions {
  /** The conversation to show and to send into. Owned by useSessions. */
  sessionId: string;
  /** Called after a turn completes, so the sidebar can pick up title and count. */
  onTurnComplete?: () => void;
}

interface UseChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  /** True while the stored transcript for a newly-selected conversation loads. */
  isHydrating: boolean;
  sendMessage: (text: string) => Promise<void>;
  /** Answer the pending action of the last answer with a button (approve, reject, ...). */
  respond: (decision: PendingDecision) => Promise<void>;
  /** Rate an answer; resolves once the server has it, throws if it refused. */
  rate: (messageId: string, rating: 'up' | 'down') => Promise<void>;
  /** The latest stage of the turn in flight (null before the first, and when idle). */
  progress: TurnProgress | null;
  /** Ask again the question an answer replied to (after fixing the setup it named). */
  retry: (messageId: string) => Promise<void>;
}

/** What the user bubble says for a button reply. */
const DECISION_LABELS: Record<PendingDecision, string> = {
  approve: 'Approved',
  approve_session: 'Approved for this session',
  reject: 'Rejected',
};

/**
 * The stored transcript as this UI renders it. Every entry carries its turn
 * number, and the assistant entry keeps its sources, route, status and the
 * agent-cli run id, so a restored answer looks like a live one, trace link included.
 */
export function turnsToMessages(turns: SessionTurn[]): ChatMessage[] {
  const messages: ChatMessage[] = turns.map((t, i) => ({
    id: `restored-${t.turn}-${t.role}-${i}`,
    role: t.role === 'user' ? 'user' : 'agent',
    content: t.content,
    timestamp: t.ts ? Date.parse(t.ts) || 0 : 0,
    turn: t.turn,
    ...(t.role === 'assistant' && {
      sources: t.sources ?? [],
      route: t.route ?? null,
      status: t.status,
      workflowId: t.workflow_id ?? undefined,
      setup: t.setup ?? null,
    }),
  }));
  // A conversation that stopped on an approval still waits on it: the transcript keeps
  // no pending action, so the last answer's status stands in for it (the session itself
  // says so if the action has expired meanwhile).
  const last = messages[messages.length - 1];
  if (last && last.role === 'agent' && last.status === 'needs_approval') {
    messages[messages.length - 1] = { ...last, pendingAction: { kind: 'tool_call' } };
  }
  return messages;
}

/** Matches agent-cli's message_id check, `^[A-Za-z0-9_.-]{1,64}$`. */
function mintMessageId(): string {
  return `m-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function useChat({ sessionId, onTurnComplete }: UseChatOptions): UseChatReturn {
  const { getAuthToken } = useAuth();
  const { agentId } = useAgent();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isHydrating, setIsHydrating] = useState(false);
  const [progress, setProgress] = useState<TurnProgress | null>(null);

  // `cancelled` guards the async gap: switching conversations twice in quick
  // succession must not let the first transcript land on the second.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function hydrate() {
      setMessages([]);
      setIsHydrating(true);
      try {
        const token = await getAuthToken();
        const turns: SessionTurn[] = [];
        let page: number | null = 0;
        for (let n = 0; page !== null && n < MAX_TRANSCRIPT_PAGES; n += 1) {
          const result = await getSession(agentId, sessionId, token, {
            page,
            signal: controller.signal,
          });
          turns.push(...(result.turns ?? []));
          page = result.next_page;
        }
        if (!cancelled) setMessages(turnsToMessages(turns));
      } catch (err) {
        // not_found is the normal answer for a freshly minted id. Any other
        // failure must not block asking a new question either.
        if (!cancelled && !(err instanceof HarnessCallError && err.code === 'not_found')) {
          console.warn('[chat] could not load the transcript', err);
        }
        if (!cancelled) setMessages([]);
      } finally {
        if (!cancelled) setIsHydrating(false);
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [agentId, sessionId, getAuthToken]);

  const runTurn = useCallback(
    async (text: string, action?: { decision: string }) => {
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: action ? DECISION_LABELS[action.decision as PendingDecision] ?? action.decision : text,
        timestamp: Date.now(),
      };

      // Whatever the last answer waited on is answered now (by a button or a typed reply).
      setMessages((prev) => [
        ...prev.map((m) => (m.pendingAction ? { ...m, pendingAction: null } : m)),
        userMessage,
      ]);
      setIsLoading(true);
      setProgress(null);
      let stream: { close: () => void } | null = null;

      try {
        const token = await getAuthToken();
        // Progress (design §11.4): subscribe to this turn's trace before sending it.
        // Best effort -- a stream that never says ready only delays the send by 2 s.
        const traceId = mintTraceId();
        const progressStream = openProgressStream(traceId, token, (p) => setProgress(p));
        stream = progressStream;
        await progressStream.ready;
        const result = await sendTurn(
          { agentId, sessionId, message: action ? '' : text, messageId: mintMessageId(), action },
          token,
          undefined,
          traceId
        );
        const turn = result.turn ?? undefined;
        setMessages((prev) => [
          ...prev.map((m) => (m.id === userMessage.id ? { ...m, turn } : m)),
          {
            id: crypto.randomUUID(),
            role: 'agent',
            content: result.answer,
            sources: result.sources ?? [],
            timestamp: Date.now(),
            turn,
            route: result.route ?? null,
            status: result.status,
            workflowId: result.workflow_id,
            pendingAction: result.status === 'needs_approval' ? result.pending_action ?? { kind: 'tool_call' } : null,
            setup: result.setup ?? null,
          },
        ]);
        onTurnComplete?.();
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'agent',
            content: '',
            timestamp: Date.now(),
            error: err instanceof Error ? err.message : 'Network error',
          },
        ]);
      } finally {
        stream?.close();
        setProgress(null);
        setIsLoading(false);
      }
    },
    [agentId, sessionId, getAuthToken, onTurnComplete]
  );

  const sendMessage = useCallback((text: string) => runTurn(text), [runTurn]);
  const respond = useCallback(
    (decision: PendingDecision) => runTurn('', { decision }),
    [runTurn]
  );

  const rate = useCallback(
    async (messageId: string, rating: 'up' | 'down') => {
      const message = messages.find((m) => m.id === messageId);
      if (!message || message.turn === undefined) return;
      const token = await getAuthToken();
      await submitFeedback(agentId, { sessionId, turn: message.turn, rating }, token);
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, feedback: rating } : m)));
    },
    [agentId, sessionId, messages, getAuthToken]
  );

  const retry = useCallback(
    async (messageId: string) => {
      const at = messages.findIndex((m) => m.id === messageId);
      const asked = messages.slice(0, Math.max(at, 0)).reverse().find((m) => m.role === 'user');
      if (asked?.content) await runTurn(asked.content);
    },
    [messages, runTurn]
  );

  return { messages, isLoading, isHydrating, sendMessage, respond, rate, progress, retry };
}
