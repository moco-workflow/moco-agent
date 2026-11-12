import { Bot } from 'lucide-react';
import { useAgent } from '@/lib/agent-context';

/**
 * Which deployed agent this UI talks to. Conversations, settings and the
 * knowledge catalog are all per agent, so switching changes every page.
 */
export function AgentSwitcher() {
  const { agents, agentId, selectAgent, displayName } = useAgent();

  // Until list_agents answers (or if it fails) the current agent is the only
  // choice there is; a one-item select would only look broken.
  if (agents.length <= 1) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-gray-400" title={agentId}>
        <Bot className="h-3.5 w-3.5" />
        {displayName}
      </span>
    );
  }

  const listed = agents.some((a) => a.agent_id === agentId);

  return (
    <label className="flex items-center gap-1.5 text-xs text-gray-400">
      <Bot className="h-3.5 w-3.5" />
      <span className="sr-only">Agent</span>
      <select
        value={agentId}
        onChange={(e) => selectAgent(e.target.value)}
        className="rounded-md border border-gray-800 bg-gray-900 px-2 py-1 text-xs text-gray-200 focus:border-blue-600 focus:outline-none"
      >
        {/* A remembered agent that is no longer deployed stays selectable, so the
            select shows what is actually in use rather than silently another. */}
        {!listed && <option value={agentId}>{agentId} (not deployed)</option>}
        {agents.map((a) => (
          <option key={a.agent_id} value={a.agent_id} disabled={a.version === null}>
            {a.display_name || a.agent_id}
            {a.version === null ? ' (broken)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
