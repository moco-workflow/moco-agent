import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { SetupCard } from '@/components/setup/setup-card';
import { useSearchParams } from 'react-router-dom';
import { Braces, Check, Copy, Info, Settings as SettingsIcon, ShieldCheck, User } from 'lucide-react';
import { PageShell } from '@/components/ui/page-shell';
import { Field, OwnershipBadge, inputClass } from '@/components/ui/field';
import {
  ErrorNote,
  SettingsCard,
  primaryButton,
  secondaryButton,
} from '@/components/ui/settings-card';
import { Tabs, type TabItem } from '@/components/ui/tabs';
import { useAgent } from '@/lib/agent-context';
import { useAgentConfig } from '@/hooks/use-agent-config';
import { useModelCatalog } from '@/hooks/use-model-catalog';
import { useSecretNames } from '@/hooks/use-secret-names';
import { UserModels } from '@/components/settings/user-models';
import { AgentModels } from '@/components/settings/agent-models';
import type { GetConfigResult, HarnessConfig } from '@/types/admin';

/** agent-config refuses a longer persona_text at the user tier. */
const PERSONA_MAX = 2000;

type TabId = 'mine' | 'agent' | 'effective';

/**
 * Settings, one tab per tier: what the caller overrides for themselves, what the
 * agent's admins set for everyone (admins only), and what it all resolves to.
 * The tab lives in `?tab=` so a reload or a shared link keeps it.
 */
export function SettingsPage() {
  const { agentConfig: data, configError, isConfigLoading, readOnly, role, displayName } =
    useAgent();
  const [params, setParams] = useSearchParams();
  const isAdmin = role === 'admin';
  const requested = params.get('tab') as TabId | null;
  const tab: TabId =
    requested === 'effective' || (requested === 'agent' && isAdmin) ? requested : 'mine';

  if (!data) {
    return (
      <PageShell current="settings" title="Settings" Icon={SettingsIcon}>
        <p className={configError ? 'text-sm text-red-400' : 'text-sm text-gray-500'}>
          {configError ?? (isConfigLoading ? 'Loading…' : 'No configuration loaded.')}
        </p>
      </PageShell>
    );
  }

  const tabs: TabItem<TabId>[] = [
    { id: 'mine', label: 'Your settings', Icon: User },
    ...(isAdmin
      ? [
          {
            id: 'agent' as const,
            label: 'Agent defaults',
            Icon: ShieldCheck,
            badge: (
              <span className="rounded-full bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400">
                Admin
              </span>
            ),
          },
        ]
      : []),
    { id: 'effective', label: 'Effective configuration', Icon: Braces },
  ];

  return (
    <PageShell current="settings" title="Settings" Icon={SettingsIcon}>
      <Tabs
        tabs={tabs}
        value={tab}
        onChange={(id) => setParams(id === 'mine' ? {} : { tab: id }, { replace: true })}
      />

      {tab !== 'effective' && (
        <div className="mb-6">
          <SetupCard />
        </div>
      )}

      {tab === 'mine' && (
        <>
          <Intro>
            How {displayName} behaves for you alone. Anything you leave unchanged follows the
            agent&apos;s configuration.
          </Intro>
          {readOnly === true && (
            <Banner tone="amber">
              You are signed in as a guest. Guests share one identity, so settings are read-only.
            </Banner>
          )}
          <UserSettings data={data} locked={readOnly !== false} />
        </>
      )}

      {tab === 'agent' && isAdmin && (
        <>
          <Intro>
            The defaults every user of {displayName} gets, on top of its definition. A user&apos;s
            own settings still take precedence.
          </Intro>
          <Banner tone="blue">
            You can edit these because you are an admin of this agent: on its admin list, or an
            admin of the namespace that owns it.
          </Banner>
          <AgentSettings data={data} />
        </>
      )}

      {tab === 'effective' && <EffectiveConfig data={data} />}
    </PageShell>
  );
}

// ── Your settings: only what agent-config lets a user set ──────────────────

function UserSettings({ data, locked }: { data: GetConfigResult; locked: boolean }) {
  const { providers } = useModelCatalog();
  const { options: secretOptions } = useSecretNames();
  const settable = new Set(data.user_settable);

  return (
    <>
      <UserModels data={data} providers={providers} secretOptions={secretOptions} locked={locked} />
      {settable.has('persona_text') && <PersonaCard data={data} locked={locked} />}
      {settable.has('disabled_profiles') && <ProfilesCard data={data} locked={locked} />}
    </>
  );
}

function PersonaCard({ data, locked }: { data: GetConfigResult; locked: boolean }) {
  const { busy, error, save, reset } = useAgentConfig();
  const saved = data.tiers.user.persona_text;
  const [persona, setPersona] = useState(saved ?? '');
  // Re-seed after every reload (a save, a reset, an agent switch).
  useEffect(() => setPersona(data.tiers.user.persona_text ?? ''), [data]);
  const dirty = persona !== (saved ?? '');

  return (
    <SettingsCard
      title="Persona"
      description="Extra instructions added to the agent's own persona, for your conversations only."
      badge={<OwnershipBadge isOwn={saved !== undefined} />}
      footer={
        <>
          <span className="mr-auto text-xs tabular-nums text-gray-500">
            {persona.length} / {PERSONA_MAX}
          </span>
          {saved !== undefined && (
            <button
              type="button"
              disabled={locked || busy !== null}
              onClick={() => void reset('user', 'persona_text', 'persona').catch(() => undefined)}
              className={secondaryButton}
            >
              Use the agent&apos;s persona
            </button>
          )}
          <button
            type="button"
            disabled={locked || busy !== null || !dirty}
            onClick={() =>
              void save('user', { persona_text: persona }, 'persona').catch(() => undefined)
            }
            className={primaryButton}
          >
            {busy === 'persona' ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {error && <ErrorNote>{error}</ErrorNote>}
      <textarea
        value={persona}
        maxLength={PERSONA_MAX}
        rows={4}
        disabled={locked}
        placeholder="Answer briefly, in British English."
        onChange={(e) => setPersona(e.target.value)}
        className={inputClass}
        aria-label="Persona instructions"
      />
    </SettingsCard>
  );
}

function ProfilesCard({ data, locked }: { data: GetConfigResult; locked: boolean }) {
  const { busy, error, save, reset } = useAgentConfig();
  const saved = data.tiers.user.disabled_profiles;
  const [disabled, setDisabled] = useState<string[]>(saved ?? []);
  useEffect(() => setDisabled(data.tiers.user.disabled_profiles ?? []), [data]);

  const defaultProfile = data.config.router?.default_profile;
  // Every profile the definition offers: the enabled ones plus the disabled.
  const allProfiles = useMemo(
    () => [...new Set([...data.profiles, ...(data.config.disabled_profiles ?? [])])].sort(),
    [data]
  );
  if (allProfiles.length < 2) return null;
  const dirty = [...disabled].sort().join() !== [...(saved ?? [])].sort().join();

  return (
    <SettingsCard
      title="Profiles"
      description="The ways of answering the agent may use for you. The default profile cannot be turned off."
      badge={<OwnershipBadge isOwn={saved !== undefined} />}
      flush
      footer={
        <>
          {saved !== undefined && (
            <button
              type="button"
              disabled={locked || busy !== null}
              onClick={() =>
                void reset('user', 'disabled_profiles', 'profiles').catch(() => undefined)
              }
              className={secondaryButton}
            >
              Use the agent&apos;s profiles
            </button>
          )}
          <button
            type="button"
            disabled={locked || busy !== null || !dirty}
            onClick={() =>
              void save('user', { disabled_profiles: [...disabled].sort() }, 'profiles').catch(
                () => undefined
              )
            }
            className={primaryButton}
          >
            {busy === 'profiles' ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {error && (
        <div className="px-5 pt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      <ul className="divide-y divide-gray-800">
        {allProfiles.map((p) => {
          const isDefault = p === defaultProfile;
          return (
            <li key={p}>
              <label className="flex cursor-pointer items-center gap-3 px-5 py-3 hover:bg-gray-900/60">
                <input
                  type="checkbox"
                  checked={!disabled.includes(p)}
                  disabled={locked || isDefault}
                  onChange={(e) =>
                    setDisabled((d) => (e.target.checked ? d.filter((x) => x !== p) : [...d, p]))
                  }
                  className="h-4 w-4 rounded border-gray-700 bg-gray-900"
                />
                <span className="font-mono text-sm text-gray-200">{p}</span>
                {isDefault && (
                  <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] text-gray-400">
                    Default
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
    </SettingsCard>
  );
}

// ── Agent defaults: the agent tier, admins only ───────────────────────────

function AgentSettings({ data }: { data: GetConfigResult }) {
  const { providers } = useModelCatalog();
  const { options: secretOptions } = useSecretNames();
  return (
    <>
      <AgentModels data={data} providers={providers} secretOptions={secretOptions} />
      <StoredOverridesCard data={data} />
      <PatchCard data={data} />
    </>
  );
}

/** What the agent tier holds, section by section, each resettable to the definition. */
function StoredOverridesCard({ data }: { data: GetConfigResult }) {
  const { busy, error, reset } = useAgentConfig();
  const sections = Object.keys(data.tiers.agent).sort();

  return (
    <SettingsCard
      title="Stored overrides"
      description="Every section this tier changes. Resetting a section returns it to the agent definition."
      flush
    >
      {error && (
        <div className="px-5 pt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {sections.length === 0 ? (
        <p className="px-5 py-4 text-xs text-gray-500">
          None. The agent definition applies unchanged.
        </p>
      ) : (
        <ul className="divide-y divide-gray-800">
          {sections.map((s) => (
            <li key={s} className="flex items-start gap-4 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm text-gray-200">{s}</p>
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-gray-500">
                  {JSON.stringify(data.tiers.agent[s], null, 2)}
                </pre>
              </div>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void reset('agent', s, `reset:${s}`).catch(() => undefined)}
                className={secondaryButton}
              >
                {busy === `reset:${s}` ? 'Resetting…' : 'Reset'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}

/**
 * Any other agent-tier section, as a JSON patch. agent-config validates it (admins
 * may set anything except agent_id, harness and access.namespace_admins). A save
 * MERGES the patch field by field, so a key removed from the text is not removed
 * from the tier -- that is what Stored overrides' Reset is for.
 */
function PatchCard({ data }: { data: GetConfigResult }) {
  const { busy, error, save } = useAgentConfig();
  const [text, setText] = useState('{}');
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    setText('{}');
    setParseError(null);
  }, [data]);

  const apply = () => {
    let patch: unknown;
    try {
      patch = JSON.parse(text);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Not valid JSON');
      return;
    }
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      setParseError('The patch must be a JSON object of sections.');
      return;
    }
    setParseError(null);
    void save('agent', patch as Partial<HarnessConfig>, 'agent').catch(() => undefined);
  };

  return (
    <SettingsCard
      title="Advanced: apply a patch"
      description="Change any other section (limits, decisions, guard, ...) as JSON, merged field by field into this tier."
      footer={
        <button
          type="button"
          onClick={apply}
          disabled={busy !== null || text.trim() === '{}' || text.trim() === ''}
          className={primaryButton}
        >
          {busy === 'agent' ? 'Applying…' : 'Apply patch'}
        </button>
      }
    >
      {(error || parseError) && <ErrorNote>{parseError ?? error}</ErrorNote>}
      <Field label="Patch" hint='For example {"decisions": {"guard": {"grounded_min_p": 0.6}}}'>
        <textarea
          value={text}
          rows={6}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          className={`${inputClass} font-mono text-xs`}
        />
      </Field>
    </SettingsCard>
  );
}

// ── Effective configuration: what it all resolves to ──────────────────────

const LAYERS = ['Harness defaults', 'Agent definition', 'Agent defaults', 'Your settings', 'Session'];

function EffectiveConfig({ data }: { data: GetConfigResult }) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(data.config, null, 2);
  const copy = () =>
    void navigator.clipboard?.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });

  return (
    <>
      <Intro>
        What the agent actually runs with for you. Each layer overrides the one before it, field by
        field; secrets appear by name only.
      </Intro>
      <ol className="mb-6 flex flex-wrap items-center gap-2 text-xs">
        {LAYERS.map((l, i) => (
          <li key={l} className="flex items-center gap-2">
            <span className="rounded-full border border-gray-800 bg-gray-900 px-2.5 py-1 text-gray-300">
              {l}
            </span>
            {i < LAYERS.length - 1 && <span className="text-gray-600">→</span>}
          </li>
        ))}
      </ol>
      <SettingsCard
        title="Resolved configuration"
        description={
          <>
            Version <code className="font-mono text-gray-400">{data.config_version}</code>
          </>
        }
        badge={
          <button type="button" onClick={copy} className={`${secondaryButton} flex items-center gap-1.5`}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy JSON'}
          </button>
        }
        flush
      >
        <pre className="max-h-[32rem] overflow-auto bg-gray-950/60 px-5 py-4 font-mono text-xs leading-relaxed text-gray-400">
          {json}
        </pre>
      </SettingsCard>
    </>
  );
}

// ── Small pieces ──────────────────────────────────────────────────────────

function Intro({ children }: { children: ReactNode }) {
  return <p className="mb-6 text-sm text-gray-400">{children}</p>;
}

function Banner({ tone, children }: { tone: 'amber' | 'blue'; children: ReactNode }) {
  const cls =
    tone === 'amber'
      ? 'border-amber-900/60 bg-amber-950/30 text-amber-200'
      : 'border-blue-900/50 bg-blue-950/20 text-blue-200';
  return (
    <div className={`mb-6 flex gap-2 rounded-lg border p-3 text-xs ${cls}`}>
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{children}</p>
    </div>
  );
}
