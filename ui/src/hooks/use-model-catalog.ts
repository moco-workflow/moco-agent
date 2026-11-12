import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/auth-context';
import { useAgent } from '@/lib/agent-context';
import { listModels } from '@/lib/agent-api';
import type { CatalogProvider } from '@/types/admin';

/**
 * The harness's model catalog (agent-harness-defaults). A convenience: every
 * field it fills can be typed by hand, so a failed fetch leaves an empty list and
 * the forms fall back to free text.
 */
export function useModelCatalog(): { providers: CatalogProvider[] } {
  const { getAuthToken, isGuest, isAuthDisabled } = useAuth();
  const { agentId } = useAgent();
  const [providers, setProviders] = useState<CatalogProvider[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const token = await getAuthToken();
      if (token === null && !isGuest && !isAuthDisabled) return;
      try {
        const result = await listModels(agentId, token, controller.signal);
        if (!controller.signal.aborted) setProviders(result.providers ?? []);
      } catch {
        if (!controller.signal.aborted) setProviders([]);
      }
    })();
    return () => controller.abort();
  }, [agentId, getAuthToken, isGuest, isAuthDisabled]);

  return { providers };
}
