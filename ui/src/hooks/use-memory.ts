import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/auth-context';
import { useAgent } from '@/lib/agent-context';
import { editMemory, forgetMemory, listMemory, resolveMemory } from '@/lib/agent-api';
import type { MemoryItem } from '@/types/admin';

interface UseMemoryReturn {
  /** Active and conflicted items; retired ones are history, not what the agent uses. */
  items: MemoryItem[];
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  edit: (key: string, patch: { title?: string; text?: string }) => Promise<void>;
  forget: (key: string) => Promise<void>;
  resolve: (key: string, to: 'active' | 'retired') => Promise<void>;
}

/** What the selected agent remembers about the signed-in user (design §6.4.7). */
export function useMemory(enabled: boolean): UseMemoryReturn {
  const { getAuthToken } = useAuth();
  const { agentId } = useAgent();
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!enabled) {
        setItems([]);
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      try {
        const token = await getAuthToken();
        const result = await listMemory(agentId, token, signal);
        if (signal?.aborted) return;
        setItems((result.items ?? []).filter((i) => i.status !== 'retired'));
        setError(null);
      } catch (err) {
        if (signal?.aborted) return;
        setError(err instanceof Error ? err.message : 'Could not load memory');
      } finally {
        if (!signal?.aborted) setIsLoading(false);
      }
    },
    [agentId, enabled, getAuthToken]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const edit = useCallback(
    async (key: string, patch: { title?: string; text?: string }) => {
      const token = await getAuthToken();
      const { item } = await editMemory(agentId, key, patch, token);
      setItems((prev) => prev.map((i) => (i.key === key ? item : i)));
    },
    [agentId, getAuthToken]
  );

  const forget = useCallback(
    async (key: string) => {
      const token = await getAuthToken();
      await forgetMemory(agentId, key, token);
      setItems((prev) => prev.filter((i) => i.key !== key));
    },
    [agentId, getAuthToken]
  );

  const resolve = useCallback(
    async (key: string, to: 'active' | 'retired') => {
      const token = await getAuthToken();
      const { item } = await resolveMemory(agentId, key, to, token);
      setItems((prev) =>
        to === 'retired' ? prev.filter((i) => i.key !== key) : prev.map((i) => (i.key === key ? item : i))
      );
    },
    [agentId, getAuthToken]
  );

  return { items, isLoading, error, reload: () => load(), edit, forget, resolve };
}
