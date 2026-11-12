import { useCallback } from 'react';
import { useAuth } from '@/lib/auth/auth-context';
import { useAgent } from '@/lib/agent-context';
import { checkSitemap } from '@/lib/agent-api';
import type { CheckSitemapResult } from '@/types/admin';

/**
 * Resolve a `site` source's URL to the sitemap the crawler will read.
 *
 * Shared by the live check under the field and the authoritative pass the form
 * runs on submit, so both agree on what "found" means.
 */
export function useSitemapCheck(): {
  check: (url: string, signal?: AbortSignal) => Promise<CheckSitemapResult>;
} {
  const { getAuthToken } = useAuth();
  const { agentId } = useAgent();

  const check = useCallback(
    async (url: string, signal?: AbortSignal) => {
      const token = await getAuthToken();
      return checkSitemap(agentId, url, token, signal);
    },
    [agentId, getAuthToken]
  );

  return { check };
}
