import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '@/lib/auth/auth-context';
import { getConfig, getReadiness, listAgents } from '@/lib/agent-api';
import { config as appConfig } from '@/lib/config';
import type { AccessRole, AgentSummary, GetConfigResult, ReadinessResult } from '@/types/admin';

/** Remembered across visits: the agent is a choice, not a per-tab state. */
const AGENT_KEY = 'moco-agent.agent-id';

interface AgentContextValue {
  /** Every deployed agent package; empty until list_agents answers. */
  agents: AgentSummary[];
  agentId: string;
  selectAgent: (agentId: string) => void;
  /** The selected agent's resolved config, role and tiers. */
  agentConfig: GetConfigResult | null;
  configError: string | null;
  isConfigLoading: boolean;
  reloadConfig: () => Promise<void>;
  /**
   * Which model roles are set up (F70); null until known, or when the harness
   * predates get_readiness. Reloaded with the config, and after a key upload.
   */
  readiness: ReadinessResult | null;
  reloadReadiness: () => Promise<void>;
  /** null until get_config answers. */
  role: AccessRole | null;
  /**
   * Guests share one identity, so the harness refuses their writes. null until
   * known: a banner renders only on `true`, a mutating control only on `false`.
   */
  readOnly: boolean | null;
  displayName: string;
}

const AgentContext = createContext<AgentContextValue | null>(null);

/**
 * Which agent the whole UI talks to. Every harness call carries an agent_id, and
 * sessions, config and the knowledge catalog are all per agent, so this sits
 * above every page.
 */
export function AgentProvider({ children }: { children: ReactNode }) {
  const { getAuthToken, isAuthenticated, isGuest, isAuthDisabled } = useAuth();
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentId, setAgentId] = useState<string>(
    () => localStorage.getItem(AGENT_KEY) || appConfig.defaultAgentId
  );
  const [agentConfig, setAgentConfig] = useState<GetConfigResult | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [isConfigLoading, setIsConfigLoading] = useState(true);
  const [readiness, setReadiness] = useState<ReadinessResult | null>(null);

  const loadReadiness = useCallback(
    async (signal?: AbortSignal) => {
      const token = await getAuthToken();
      if (token === null && !isGuest && !isAuthDisabled) return;
      try {
        const result = await getReadiness(agentId, token, signal);
        if (!signal?.aborted) setReadiness(result);
      } catch {
        // A setup guide is a convenience: an older harness or a failed check shows none.
        if (!signal?.aborted) setReadiness(null);
      }
    },
    [agentId, getAuthToken, isGuest, isAuthDisabled]
  );

  useEffect(() => {
    localStorage.setItem(AGENT_KEY, agentId);
  }, [agentId]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const controller = new AbortController();
    void (async () => {
      const token = await getAuthToken();
      if (token === null && !isGuest && !isAuthDisabled) return;
      try {
        const result = await listAgents(agentId, token, controller.signal);
        if (!controller.signal.aborted) setAgents(result.agents ?? []);
      } catch {
        // The switcher degrades to the current agent alone.
      }
    })();
    return () => controller.abort();
    // agentId is only the envelope's required agent_id: the list does not depend
    // on it, so it is fetched once per sign-in, not once per switch.
  }, [isAuthenticated, getAuthToken, isGuest, isAuthDisabled]);

  const loadConfig = useCallback(
    async (signal?: AbortSignal) => {
      setIsConfigLoading(true);
      setConfigError(null);
      const token = await getAuthToken();
      // A null token for a signed-in user means the refresh failed and the
      // redirect to /login is imminent; asking now would read back as a guest.
      if (token === null && !isGuest && !isAuthDisabled) return;
      try {
        const result = await getConfig(agentId, token, signal);
        if (!signal?.aborted) setAgentConfig(result);
        if (!signal?.aborted) void loadReadiness(signal);
      } catch (err) {
        if (signal?.aborted) return;
        setAgentConfig(null);
        setConfigError(err instanceof Error ? err.message : 'Could not load the agent');
      } finally {
        if (!signal?.aborted) setIsConfigLoading(false);
      }
    },
    [agentId, getAuthToken, isGuest, isAuthDisabled, loadReadiness]
  );

  useEffect(() => {
    if (!isAuthenticated) return;
    const controller = new AbortController();
    setAgentConfig(null);
    setReadiness(null);
    void loadConfig(controller.signal);
    return () => controller.abort();
  }, [isAuthenticated, loadConfig]);

  const value = useMemo<AgentContextValue>(() => {
    const role = agentConfig?.role ?? null;
    const listed = agents.find((a) => a.agent_id === agentId);
    return {
      agents,
      agentId,
      selectAgent: setAgentId,
      agentConfig,
      configError,
      isConfigLoading,
      reloadConfig: () => loadConfig(),
      readiness,
      reloadReadiness: () => loadReadiness(),
      role,
      readOnly: role === null ? null : role === 'guest' || role === 'denied',
      displayName:
        (agentConfig?.config.display_name as string | undefined) ||
        listed?.display_name ||
        agentId,
    };
  }, [agents, agentId, agentConfig, configError, isConfigLoading, loadConfig, readiness, loadReadiness]);

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgent(): AgentContextValue {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error('useAgent must be used inside AgentProvider');
  return ctx;
}
