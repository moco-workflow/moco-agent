import { useEffect, useMemo, useState } from 'react';
import { OwnershipBadge } from '@/components/ui/field';
import { ErrorNote, SettingsCard, primaryButton, secondaryButton } from '@/components/ui/settings-card';
import { useAgentConfig } from '@/hooks/use-agent-config';
import { useAgent } from '@/lib/agent-context';
import type { ToolManifest } from '@/types/admin';

/**
 * Which toolsets the agent offers (config.toolsets, design §6.9.6), for the agent's
 * admins. Saved to the agent tier, so a provider's toolset can be attached without
 * republishing the agent. Lists replace on merge, so the whole list is saved.
 * The choices are the toolsets the deployment's tools name, plus any the config
 * already holds (a toolset with no enabled tool offers nothing, but stays removable).
 */
export function AgentToolsets({ tools }: { tools: ToolManifest[] }) {
  const { agentConfig } = useAgent();
  const { busy, error, save, reset } = useAgentConfig();
  const current = useMemo(
    () => (agentConfig?.config.toolsets as string[] | undefined) ?? [],
    [agentConfig]
  );
  const [draft, setDraft] = useState<string[]>(current);

  // A reload (after a save, or another admin's) replaces the draft.
  useEffect(() => setDraft(current), [current]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of tools) for (const s of t.toolsets ?? []) c[s] = (c[s] ?? 0) + 1;
    return c;
  }, [tools]);
  const names = useMemo(
    () => [...new Set([...Object.keys(counts), ...current])].sort(),
    [counts, current]
  );

  if (!agentConfig) return null;
  const isOwn = 'toolsets' in (agentConfig.tiers.agent ?? {});
  const dirty = draft.length !== current.length || draft.some((s) => !current.includes(s));
  const disabled = busy !== null;

  const toggle = (name: string, on: boolean) =>
    setDraft((prev) => (on ? [...prev, name] : prev.filter((s) => s !== name)));

  return (
    <SettingsCard
      title="Agent toolsets"
      description="The toolsets every user of this agent is offered. Attach a provider's toolset here; tools added to it later are picked up without a change."
      badge={<OwnershipBadge isOwn={isOwn} tier="agent" />}
      footer={
        <>
          {isOwn && (
            <button
              type="button"
              onClick={() => void reset('agent', 'toolsets', 'toolsets-reset').catch(() => {})}
              disabled={disabled}
              className={secondaryButton}
            >
              {busy === 'toolsets-reset' ? 'Resetting…' : 'Reset to definition'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void save('agent', { toolsets: names.filter((n) => draft.includes(n)) }, 'toolsets').catch(() => {})}
            disabled={disabled || !dirty}
            className={primaryButton}
          >
            {busy === 'toolsets' ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {error && <ErrorNote>{error}</ErrorNote>}
      {names.length === 0 ? (
        <p className="text-xs text-gray-500">No tool names a toolset yet.</p>
      ) : (
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {names.map((name) => (
            <label key={name} className="flex items-center gap-1.5 text-xs text-gray-300">
              <input
                type="checkbox"
                checked={draft.includes(name)}
                disabled={disabled}
                onChange={(e) => toggle(name, e.target.checked)}
              />
              <span className="font-mono">{name}</span>
              <span className="text-gray-500">
                {counts[name] ? `${counts[name]} tool${counts[name] === 1 ? '' : 's'}` : 'no enabled tools'}
              </span>
            </label>
          ))}
        </div>
      )}
    </SettingsCard>
  );
}
