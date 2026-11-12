import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth/auth-context';
import { useAgent } from '@/lib/agent-context';
import {
  deleteSource,
  listSources,
  refreshSource,
  registerSource,
  reindexSource,
  setSourceRefresh,
} from '@/lib/agent-api';
import type { KnowledgeSource, RegisterSourceRequest, SourceScope } from '@/types/admin';

/**
 * Backoff while anything is indexing. A GitHub crawl can run 40 minutes; a flat
 * 5s poll would fire ~480 requests at it.
 */
const POLL_BACKOFF_MS = [5_000, 5_000, 10_000, 20_000, 30_000];

/**
 * After this long in `indexing`, treat a source as stalled. If the worker dies
 * mid-run nothing ever records `ready` or `failed`, so the row would otherwise
 * spin forever. source-registry stamps `updated_at` on the transition into
 * `indexing`, and the indexer writes nothing until its verdict.
 */
export const STALL_AFTER_MS = 45 * 60_000;

/** knowledge refresh takes a refresh older than this as dead (refresh_stale_sec). */
const REFRESH_STALE_MS = 2 * 60 * 60_000;

/** A refresh is running (and not so old that the harness would take it as dead). */
export function isRefreshing(source: KnowledgeSource, now = Date.now()): boolean {
  const started = source.refreshing?.started_at ? Date.parse(source.refreshing.started_at) : NaN;
  return Number.isFinite(started) && now - started < REFRESH_STALE_MS;
}

export function isStalled(source: KnowledgeSource, now = Date.now()): boolean {
  if (source.status !== 'indexing') return false;
  if (!source.updated_at) return false;
  const since = Date.parse(source.updated_at);
  return Number.isFinite(since) && now - since > STALL_AFTER_MS;
}

interface UseSourcesReturn {
  sources: KnowledgeSource[];
  isLoading: boolean;
  error: string | null;
  isIndexing: boolean;
  refresh: () => Promise<void>;
  /** Creates the row and starts the indexer; a taken name is refused. */
  register: (request: RegisterSourceRequest) => Promise<void>;
  /** Re-runs the indexer over the sources stored on the row. */
  reindex: (name: string, scope: SourceScope) => Promise<void>;
  /** Removes the row and drops its vector table. */
  remove: (name: string, scope: SourceScope) => Promise<void>;
  /** Re-indexes a ready source in the background; it keeps serving meanwhile. */
  refreshNow: (name: string, scope: SourceScope) => Promise<void>;
  /** Sets (or, with null, clears) the scheduled refresh interval in hours. */
  setRefreshInterval: (name: string, scope: SourceScope, everyHours: number | null) => Promise<void>;
}

export function useSources(): UseSourcesReturn {
  const { getAuthToken, isGuest, isAuthDisabled } = useAuth();
  const { agentId } = useAgent();
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Chained timeout, never setInterval: a slow poll must not overlap the next.
  const timerRef = useRef<number | null>(null);
  const attemptRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const fetchOnce = useCallback(
    async (isPoll: boolean) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      const token = await getAuthToken();
      // A null token for a signed-in user means the refresh just failed and
      // ProtectedRoute is about to redirect; there is nobody left to show a list to.
      if (token === null && !isGuest && !isAuthDisabled) return;

      try {
        const result = await listSources(agentId, token, { poll: isPoll, signal: controller.signal });
        if (controller.signal.aborted) return;
        setSources(result.sources ?? []);
        setError(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        // A failed poll is not worth surfacing -- the previous list is still on
        // screen and the next tick will very likely succeed.
        if (!isPoll) setError(err instanceof Error ? err.message : 'Could not load sources');
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    },
    [agentId, getAuthToken, isGuest, isAuthDisabled]
  );

  // A background refresh is polled like an index run, so the row settles on its own.
  const isIndexing = sources.some(
    (d) => (d.status === 'indexing' && !isStalled(d)) || isRefreshing(d)
  );

  // Schedule the next poll only while something is actually in flight, and stop
  // entirely when the tab is hidden.
  useEffect(() => {
    stoppedRef.current = false;
    clearTimer();

    if (!isIndexing || document.visibilityState === 'hidden') {
      attemptRef.current = 0;
      return;
    }

    const delay = POLL_BACKOFF_MS[Math.min(attemptRef.current, POLL_BACKOFF_MS.length - 1)];
    timerRef.current = window.setTimeout(() => {
      attemptRef.current += 1;
      if (!stoppedRef.current) void fetchOnce(true);
    }, delay);

    return () => {
      stoppedRef.current = true;
      clearTimer();
    };
  }, [isIndexing, sources, fetchOnce]);

  // Resume immediately when the tab comes back, rather than waiting out a
  // backoff that elapsed while nothing was polling.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        attemptRef.current = 0;
        void fetchOnce(true);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [fetchOnce]);

  useEffect(() => {
    void fetchOnce(false);
    return () => {
      stoppedRef.current = true;
      clearTimer();
      controllerRef.current?.abort();
    };
  }, [fetchOnce]);

  const refresh = useCallback(async () => {
    attemptRef.current = 0;
    await fetchOnce(false);
  }, [fetchOnce]);

  const register = useCallback(
    async (request: RegisterSourceRequest) => {
      const token = await getAuthToken();
      // Returns as soon as the indexer is launched; the row shows `indexing` on
      // the refresh below and settles when the indexer records its verdict.
      await registerSource(agentId, request, token);
      attemptRef.current = 0;
      await fetchOnce(false);
    },
    [agentId, getAuthToken, fetchOnce]
  );

  const reindex = useCallback(
    async (name: string, scope: SourceScope) => {
      const token = await getAuthToken();
      await reindexSource(agentId, name, scope, token);
      attemptRef.current = 0;
      await fetchOnce(false);
    },
    [agentId, getAuthToken, fetchOnce]
  );

  const remove = useCallback(
    async (name: string, scope: SourceScope) => {
      const token = await getAuthToken();
      await deleteSource(agentId, name, scope, token);
      await fetchOnce(false);
    },
    [agentId, getAuthToken, fetchOnce]
  );

  const refreshNow = useCallback(
    async (name: string, scope: SourceScope) => {
      const token = await getAuthToken();
      await refreshSource(agentId, name, scope, token);
      attemptRef.current = 0;
      await fetchOnce(false);
    },
    [agentId, getAuthToken, fetchOnce]
  );

  const setRefreshInterval = useCallback(
    async (name: string, scope: SourceScope, everyHours: number | null) => {
      const token = await getAuthToken();
      await setSourceRefresh(agentId, name, scope, everyHours, token);
      await fetchOnce(false);
    },
    [agentId, getAuthToken, fetchOnce]
  );

  return {
    sources,
    isLoading,
    error,
    isIndexing,
    refresh,
    register,
    reindex,
    remove,
    refreshNow,
    setRefreshInterval,
  };
}
