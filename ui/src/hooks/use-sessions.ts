import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteSession as deleteSessionApi,
  listSessions,
  renameSession as renameSessionApi,
} from '@/lib/agent-api';
import { useAuth } from '@/lib/auth/auth-context';
import { useAgent } from '@/lib/agent-context';
import type { SessionSummary } from '@/types/admin';

/**
 * localStorage, so a conversation outlives the tab; one pointer PER AGENT,
 * because sessions are stored per agent and an id from one is unknown to another.
 */
const activeKey = (agentId: string) => `moco-agent.active-session.${agentId}`;

interface UseSessionsReturn {
  sessions: SessionSummary[];
  activeSessionId: string;
  isLoading: boolean;
  error: string | null;
  selectSession: (sessionId: string) => void;
  newSession: () => void;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  removeSession: (sessionId: string) => Promise<void>;
  /** Call after a turn completes so the sidebar picks up the new title/count. */
  refresh: () => Promise<void>;
}

/**
 * Minted here, not by the backend: agent-cli creates the session on its first
 * message. A UUID satisfies session-store's `^[A-Za-z0-9_.-]{1,64}$`.
 */
function mintSessionId(): string {
  return crypto.randomUUID();
}

export function useSessions(): UseSessionsReturn {
  const { getAuthToken, isGuest, isAuthDisabled } = useAuth();
  const { agentId } = useAgent();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>(
    () => localStorage.getItem(activeKey(agentId)) || mintSessionId()
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Switching agents switches the conversation list and the open conversation.
  const shownAgent = useRef(agentId);
  useEffect(() => {
    if (shownAgent.current === agentId) return;
    shownAgent.current = agentId;
    setSessions([]);
    setIsLoading(true);
    setActiveSessionId(localStorage.getItem(activeKey(agentId)) || mintSessionId());
  }, [agentId]);

  useEffect(() => {
    localStorage.setItem(activeKey(shownAgent.current), activeSessionId);
  }, [activeSessionId]);

  // One controller per in-flight list, so a refresh triggered by a finished turn
  // cannot be overtaken by the one it replaced.
  const inFlight = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    const token = await getAuthToken();
    if (token === null && !isGuest && !isAuthDisabled) return;

    try {
      const result = await listSessions(agentId, token, { signal: controller.signal });
      if (controller.signal.aborted) return;
      // A throwaway session is a CLI one-shot; it has no place in a sidebar. Newest
      // first, by created time: updated_at also moves on a rename, retire or curation.
      const created = (s: SessionSummary) => Date.parse(s.created_at) || 0;
      setSessions(
        (result.sessions ?? []).filter((s) => !s.throwaway).sort((a, b) => created(b) - created(a))
      );
      setError(null);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Could not load conversations');
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, [agentId, getAuthToken, isGuest, isAuthDisabled]);

  useEffect(() => {
    void refresh();
    return () => inFlight.current?.abort();
  }, [refresh]);

  const selectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
  }, []);

  /**
   * Nothing is created server-side here. The conversation appears in the list
   * once its first message is in, so an abandoned "New chat" leaves no row.
   */
  const newSession = useCallback(() => {
    setActiveSessionId(mintSessionId());
  }, []);

  const renameSession = useCallback(
    async (sessionId: string, title: string) => {
      const token = await getAuthToken();
      await renameSessionApi(agentId, sessionId, title, token);
      setSessions((prev) =>
        prev.map((s) => (s.session_id === sessionId ? { ...s, title } : s))
      );
    },
    [agentId, getAuthToken]
  );

  const removeSession = useCallback(
    async (sessionId: string) => {
      const token = await getAuthToken();
      await deleteSessionApi(agentId, sessionId, token);
      setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
      // Deleting the conversation you are looking at has to leave you somewhere.
      setActiveSessionId((current) => (current === sessionId ? mintSessionId() : current));
    },
    [agentId, getAuthToken]
  );

  return {
    sessions,
    activeSessionId,
    isLoading,
    error,
    selectSession,
    newSession,
    renameSession,
    removeSession,
    refresh,
  };
}
