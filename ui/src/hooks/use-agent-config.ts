import { useCallback, useState } from 'react';
import { useAuth } from '@/lib/auth/auth-context';
import { useAgent } from '@/lib/agent-context';
import { resetConfig, saveConfig } from '@/lib/agent-api';
import type { ConfigTier, HarnessConfig } from '@/types/admin';

interface UseAgentConfigReturn {
  /** Which action is in flight, for the button that started it. */
  busy: string | null;
  error: string | null;
  /** A PARTIAL patch to one tier; the server merges it field by field. */
  save: (tier: ConfigTier, patch: Partial<HarnessConfig>, tag?: string) => Promise<void>;
  /** Empties one top-level section of a tier (or the whole tier with null). */
  reset: (tier: ConfigTier, section: string | null, tag?: string) => Promise<void>;
  /** Several steps as one action, reloading once at the end. */
  sequence: (
    /** A step with `resetSection` (null = the whole tier) resets before it saves. */
    steps: { tier: ConfigTier; patch?: Partial<HarnessConfig>; resetSection?: string | null }[],
    tag?: string
  ) => Promise<void>;
}

/**
 * Writes to the selected agent's config tiers. Reads come from AgentContext,
 * which is reloaded after every write: the server decides what each tier holds
 * and what the merge resolves to, so nothing is patched locally.
 */
export function useAgentConfig(): UseAgentConfigReturn {
  const { getAuthToken } = useAuth();
  const { agentId, reloadConfig } = useAgent();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sequence = useCallback<UseAgentConfigReturn['sequence']>(
    async (steps, tag = 'save') => {
      setBusy(tag);
      setError(null);
      try {
        const token = await getAuthToken();
        for (const step of steps) {
          if ('resetSection' in step) {
            await resetConfig(agentId, step.resetSection ?? null, step.tier, token);
          }
          if (step.patch && Object.keys(step.patch).length > 0) {
            await saveConfig(agentId, step.patch, step.tier, token);
          }
        }
        await reloadConfig();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save settings');
        throw err;
      } finally {
        setBusy(null);
      }
    },
    [agentId, getAuthToken, reloadConfig]
  );

  const save = useCallback<UseAgentConfigReturn['save']>(
    (tier, patch, tag) => sequence([{ tier, patch }], tag),
    [sequence]
  );

  const reset = useCallback<UseAgentConfigReturn['reset']>(
    (tier, section, tag) => sequence([{ tier, resetSection: section }], tag),
    [sequence]
  );

  return { busy, error, save, reset, sequence };
}
