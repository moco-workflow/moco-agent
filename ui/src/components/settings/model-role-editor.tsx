import { useEffect, useState } from 'react';
import { Field, OwnershipBadge, inputClass } from '@/components/ui/field';
import { SecretSelect } from '@/components/ui/secret-select';
import { primaryButton, secondaryButton } from '@/components/ui/settings-card';
import { matchCatalog, providersOfKind } from '@/lib/catalog';
import { describeRole, type ModelRoleMeta, type RoleConfig } from '@/lib/model-roles';
import { useAgentConfig } from '@/hooks/use-agent-config';
import { CollapsibleRole } from './collapsible-role';
import type {
  CatalogModel,
  CatalogProvider,
  ConfigTier,
  GetConfigResult,
  HarnessConfig,
} from '@/types/admin';

/** Provider options that are not provider ids, so they cannot collide with one. */
const CUSTOM = '__custom__';
const ENV = '__env__';

/** '' in a field means "unset": null, the worker's environment default. */
const orNull = (v: unknown) => (v === '' || v === undefined ? null : v);

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

const num = (v: string) => (v === '' ? '' : Number(v));

/** The role as it resolves now. A null decision role is inference with a low token limit. */
function resolvedRole(data: GetConfigResult, meta: ModelRoleMeta): RoleConfig | null {
  const models = (data.config.models ?? {}) as Record<string, unknown>;
  const own = models[meta.role] as RoleConfig | null | undefined;
  if (own) return own;
  if (meta.role !== 'decision') return {};
  return null;
}

/**
 * One model role, edited the same way at either tier.
 *
 * THREE MODES, NEVER MIXED, picked by the Provider select:
 * - a catalog provider: the Provider / Model / Endpoint pickers alone;
 * - Environment default (empty model and endpoint): no model fields at all;
 * - Custom endpoint: free-text Model, Endpoint and Provider label.
 * Showing the text fields under the pickers duplicated every value. The mode is
 * DERIVED from the value on every render (matchCatalog), so a saved value is never
 * snapped onto a near catalog neighbour; choosing "Custom endpoint…" on a value
 * that matches the catalog or is empty is the one intent kept in state.
 *
 * Save writes the role to `tier` with every field explicit (empty = null), and
 * Reset drops this tier's row for the role so it inherits again. At the user tier
 * only the paths agent-config lets a user set are sent (`user_settable`).
 */
export function ModelRoleEditor({
  tier,
  meta,
  data,
  providers,
  secretOptions,
  locked,
}: {
  tier: ConfigTier;
  meta: ModelRoleMeta;
  data: GetConfigResult;
  providers: CatalogProvider[];
  secretOptions: string[];
  locked: boolean;
}) {
  const { busy, error, save, sequence } = useAgentConfig();
  const stored = (data.tiers[tier].models ?? {}) as Record<string, RoleConfig | null>;
  const inTier = meta.role in stored;
  const resolved = resolvedRole(data, meta);
  const fallback = (data.config.models?.inference ?? {}) as RoleConfig;
  // Only the agent tier may set decision to null ("same as the answer model").
  const aliasable = tier === 'agent' && meta.role === 'decision';
  const userTier = tier === 'user';
  const settable = new Set(data.user_settable);
  const allowed = (k: string) => !userTier || settable.has(`models.${meta.role}.${k}`);

  const seed = (): RoleConfig =>
    resolved ?? {
      ...fallback,
      max_tokens:
        (data.config.models as Record<string, unknown> | undefined)?.decision_default_max_tokens ??
        600,
    };
  const [baseline, setBaseline] = useState<RoleConfig>(seed);
  const [alias, setAlias] = useState(aliasable && !resolved);
  const [draft, setDraft] = useState<RoleConfig>(seed);
  const [custom, setCustom] = useState(false);
  useEffect(() => {
    const s = seed();
    setBaseline(s);
    setAlias(aliasable && !resolved);
    setDraft(s);
    setCustom(false);
  }, [data]);

  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
  const tag = `${tier}-${meta.role}`;
  const disabled = locked || busy !== null;
  const dirty =
    alias !== (aliasable && !resolved) || JSON.stringify(draft) !== JSON.stringify(baseline);

  const model = str(draft[meta.key]);
  const baseUrl = str(draft.base_url);
  const roleProviders = providersOfKind(providers, meta.kind);
  const matched = custom ? null : matchCatalog(providers, meta.kind, baseUrl, model);
  const isEnv = !custom && !model && !baseUrl;
  const isCustom = !matched && !isEnv;

  const pick = (p: CatalogProvider, m: CatalogModel, url: string) => {
    setCustom(false);
    setDraft((d) => ({
      ...d,
      provider: p.id,
      [meta.key]: m.id,
      base_url: url,
      apikey_secret_key: p.apikey_secret_key ?? null,
      ...(meta.kind === 'embedding' && m.embed_dim ? { embed_dim: m.embed_dim } : {}),
      ...(meta.kind === 'inference' && m.max_tokens && !d.max_tokens
        ? { max_tokens: m.max_tokens }
        : {}),
    }));
  };

  const pickProvider = (id: string) => {
    if (id === CUSTOM) {
      setCustom(true);
      return;
    }
    if (id === ENV) {
      setCustom(false);
      setDraft((d) => ({ ...d, [meta.key]: '', base_url: '' }));
      return;
    }
    // Its FIRST model and FIRST endpoint come along: parts that disagree validate
    // fine and fail at runtime.
    const p = roleProviders.find((x) => x.id === id);
    if (p?.models[0] && p.base_urls[0]) pick(p, p.models[0], p.base_urls[0]);
  };

  const submit = () => {
    const value: RoleConfig | null = alias
      ? null
      : Object.fromEntries(
          Object.entries(draft)
            .filter(([k]) => allowed(k))
            .map(([k, v]) => [k, orNull(v)])
        );
    void save(tier, { models: { [meta.role]: value } } as Partial<HarnessConfig>, tag).catch(
      () => undefined
    );
  };

  /** Inherit again: reset this tier's `models`, then re-save its other roles. */
  const reset = () => {
    const rest = Object.fromEntries(Object.entries(stored).filter(([r]) => r !== meta.role));
    const patch = Object.keys(rest).length ? ({ models: rest } as Partial<HarnessConfig>) : undefined;
    void sequence([{ tier, resetSection: 'models', patch }], tag).catch(() => undefined);
  };

  // The summary describes what is SAVED, not the unsaved draft.
  const shown = describeRole(alias ? null : resolved, meta, providers);
  const summary =
    meta.role === 'decision' && !resolved ? (
      <span className="text-xs text-gray-400">Same as the answer model</span>
    ) : (
      <>
        <span className="block truncate text-sm text-gray-200" title={shown.model}>
          {shown.model}
        </span>
        {shown.where && (
          <span className="block truncate text-xs text-gray-500" title={shown.where}>
            {shown.custom ? `Custom · ${shown.where}` : shown.where}
          </span>
        )}
      </>
    );

  return (
    <CollapsibleRole
      title={meta.label}
      hint={meta.hint}
      summary={summary}
      error={error}
      badges={inTier ? <OwnershipBadge isOwn tier={tier} /> : undefined}
    >
      <div className="space-y-5">
        {aliasable && (
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={alias}
              disabled={disabled}
              onChange={(e) => setAlias(e.target.checked)}
              className="h-4 w-4 rounded border-gray-700 bg-gray-900"
            />
            Use the answer model (with a lower token limit)
          </label>
        )}

        {!alias && (
          <>
            {/* ── Which model ── */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Provider">
                <select
                  value={matched?.provider.id ?? (isEnv ? ENV : CUSTOM)}
                  disabled={disabled}
                  onChange={(e) => pickProvider(e.target.value)}
                  className={inputClass}
                >
                  <option value={ENV}>Environment default</option>
                  {roleProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                  <option value={CUSTOM}>Custom endpoint…</option>
                </select>
              </Field>

              {matched ? (
                <Field label="Model" hint={specs(matched.model)}>
                  <select
                    value={matched.model.id}
                    disabled={disabled}
                    onChange={(e) => {
                      const m = matched.provider.models.find((x) => x.id === e.target.value);
                      if (m) pick(matched.provider, m, matched.baseUrl);
                    }}
                    className={inputClass}
                  >
                    {matched.provider.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : isEnv ? (
                <p className="self-end pb-2 text-xs text-gray-500">
                  The worker&apos;s configured model and endpoint for this role.
                </p>
              ) : (
                <Field label="Model">
                  <input
                    type="text"
                    value={model}
                    disabled={disabled}
                    placeholder="Environment default"
                    spellCheck={false}
                    onChange={(e) => set(meta.key, e.target.value)}
                    className={inputClass}
                  />
                </Field>
              )}

              {!isEnv && (
                <div className="sm:col-span-2">
                  {matched ? (
                    <Field
                      label="Endpoint"
                      hint={
                        matched.provider.base_urls.length > 1
                          ? 'Pick the address that is reachable from the worker.'
                          : undefined
                      }
                    >
                      <select
                        value={matched.baseUrl}
                        disabled={disabled || matched.provider.base_urls.length === 1}
                        onChange={(e) => pick(matched.provider, matched.model, e.target.value)}
                        className={`${inputClass} font-mono text-xs`}
                      >
                        {matched.provider.base_urls.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ) : (
                    <Field label="Endpoint" hint="Empty: the worker's environment default.">
                      <input
                        type="url"
                        value={baseUrl}
                        disabled={disabled}
                        placeholder="Environment default"
                        spellCheck={false}
                        onChange={(e) => set('base_url', e.target.value)}
                        className={`${inputClass} font-mono text-xs`}
                      />
                    </Field>
                  )}
                </div>
              )}
            </div>

            {/* ── Credentials and tuning ── */}
            <div className="border-t border-gray-800/70 pt-4">
              <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-gray-500">
                Credentials and tuning
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="API key secret" hint="The secret's name, never its value.">
                  <SecretSelect
                    value={str(draft.apikey_secret_key)}
                    options={secretOptions}
                    disabled={disabled}
                    onChange={(v) => set('apikey_secret_key', v)}
                  />
                </Field>

                {isCustom && (
                  <Field label="Provider label" hint="Free text, for display.">
                    <input
                      type="text"
                      value={str(draft.provider)}
                      disabled={disabled}
                      onChange={(e) => set('provider', e.target.value)}
                      className={inputClass}
                    />
                  </Field>
                )}

                {meta.kind === 'inference' && (
                  <>
                    <Field label="Max tokens" hint="1 – 100000.">
                      <input
                        type="number"
                        min={1}
                        max={100000}
                        value={str(draft.max_tokens)}
                        disabled={disabled}
                        onChange={(e) => set('max_tokens', num(e.target.value))}
                        className={inputClass}
                      />
                    </Field>
                    <Field label="Temperature" hint="0 – 2.">
                      <input
                        type="number"
                        min={0}
                        max={2}
                        step={0.1}
                        value={str(draft.temperature)}
                        disabled={disabled}
                        onChange={(e) => set('temperature', num(e.target.value))}
                        className={inputClass}
                      />
                    </Field>
                  </>
                )}

                {meta.kind === 'embedding' && (
                  <Field label="Dimensions" hint="Must match the model; sizes new sources' vectors.">
                    <input
                      type="number"
                      min={1}
                      value={str(draft.embed_dim)}
                      disabled={disabled}
                      onChange={(e) => set('embed_dim', num(e.target.value))}
                      className={inputClass}
                    />
                  </Field>
                )}

                {meta.kind === 'classifier' &&
                  (userTier ? (
                    <Field label="Enabled / timeout" hint="Set by the agent's admins.">
                      <input
                        value={`${draft.enabled === false ? 'Off' : 'On'} · ${str(draft.timeout_sec) || '10'} s`}
                        disabled
                        readOnly
                        className={inputClass}
                      />
                    </Field>
                  ) : (
                    <>
                      <Field label="Timeout (s)" hint="Over 10 runs off the turn path.">
                        <input
                          type="number"
                          min={1}
                          value={str(draft.timeout_sec)}
                          disabled={disabled}
                          onChange={(e) => set('timeout_sec', num(e.target.value))}
                          className={inputClass}
                        />
                      </Field>
                      <label className="flex items-center gap-2 text-sm text-gray-300 sm:col-span-2">
                        <input
                          type="checkbox"
                          checked={draft.enabled !== false}
                          disabled={disabled}
                          onChange={(e) => set('enabled', e.target.checked)}
                          className="h-4 w-4 rounded border-gray-700 bg-gray-900"
                        />
                        Enabled
                        <span className="text-xs text-gray-500">
                          (off: the decision model makes these calls)
                        </span>
                      </label>
                      <label className="flex items-start gap-2 text-sm text-gray-300 sm:col-span-2">
                        <input
                          type="checkbox"
                          checked={draft.worker_default === true}
                          disabled={disabled}
                          onChange={(e) => set('worker_default', e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded border-gray-700 bg-gray-900"
                        />
                        <span>
                          Use the worker&apos;s TYPESAFE_DEFAULT_BASE_URL
                          <span className="block text-xs text-gray-500">
                            Only when it names a self-hosted moco-systemone. With no endpoint and this
                            unticked, the classifier stays off, so the hosted TypeSafe API is never called.
                          </span>
                        </span>
                      </label>
                    </>
                  ))}
              </div>
            </div>
          </>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-gray-800/70 pt-4">
          {dirty && !locked && <span className="mr-auto text-xs text-amber-300/80">Unsaved changes</span>}
          {inTier && (
            <button type="button" onClick={reset} disabled={disabled} className={secondaryButton}>
              {userTier ? "Use the agent's setting" : 'Reset to definition'}
            </button>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={disabled || !dirty}
            className={primaryButton}
          >
            {busy === tag ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </CollapsibleRole>
  );
}

/** What a catalog model implies, spelled out: the dimension above all, wrong silently until query time. */
function specs(model: CatalogModel): string | undefined {
  const parts: string[] = [];
  if (model.embed_dim !== undefined) parts.push(`${model.embed_dim} dimensions`);
  if (model.context_window !== undefined)
    parts.push(`${model.context_window.toLocaleString()}-token context`);
  if (model.max_tokens !== undefined) parts.push(`suggested max tokens ${model.max_tokens}`);
  if (model.tools) parts.push('tools');
  if (model.json_mode) parts.push('JSON mode');
  return parts.length ? parts.join(' · ') : undefined;
}
