import { Field, inputClass } from './field';
import { matchCatalog, providersOfKind, type ProviderKind } from '@/lib/catalog';
import type { CatalogModel, CatalogProvider } from '@/types/admin';

/** The sentinel option value. Not a provider id, so it cannot collide with one. */
const CUSTOM = '__custom__';

/**
 * Provider and model pickers over the curated catalog, with a "Custom…" escape
 * hatch that hands the caller back to free-text inputs.
 *
 * THE SELECTION IS DERIVED, NEVER WRITTEN ON MOUNT. What is shown is computed
 * from the current value via matchCatalog on every render, and `onPick` fires
 * only from a user's onChange. A saved value matching no entry therefore renders
 * as "Custom…" with its own fields intact, rather than being snapped onto a
 * near neighbour -- which for an embedding model is how you get a table that can
 * never be queried.
 *
 * `isCustom` is owned by the CALLER, not by this component: choosing "Custom…" on
 * a value that happens to match an entry has to keep the free-text fields open,
 * and that intent outlives any render.
 *
 * With an empty catalog (the fetch failed, or the deployment ships none) this
 * renders nothing at all and no error. Same posture as SecretSelect with an empty
 * options list: the free-text fields below are still perfectly usable.
 */
export function ProviderModelSelect({
  providers,
  kind,
  baseUrl,
  modelId,
  disabled,
  isCustom,
  onPick,
  onCustom,
}: {
  providers: CatalogProvider[];
  kind: ProviderKind;
  /** The endpoint currently in the draft. */
  baseUrl: string;
  /** The model id currently in the draft. */
  modelId: string;
  disabled?: boolean;
  isCustom: boolean;
  /** Fired only on an explicit user selection, with all three parts resolved. */
  onPick: (provider: CatalogProvider, model: CatalogModel, baseUrl: string) => void;
  onCustom: () => void;
}) {
  const candidates = providersOfKind(providers, kind);
  if (candidates.length === 0) return null;

  const matched = isCustom ? null : matchCatalog(providers, kind, baseUrl, modelId);
  // An unmatched value is shown as Custom whether or not the caller asked for it.
  // Anything else would display a provider the draft is not actually using.
  const selectedProviderId = matched?.provider.id ?? CUSTOM;
  const models = matched?.provider.models ?? [];
  const endpoints = matched?.provider.base_urls ?? [];

  const pickProvider = (id: string) => {
    if (id === CUSTOM) {
      onCustom();
      return;
    }
    const provider = candidates.find((p) => p.id === id);
    // Its FIRST endpoint and FIRST model come along with it. Leaving either unset
    // would produce a draft whose parts disagree -- which validates fine and
    // fails at runtime. One extra click to change them beats a silent mismatch.
    const firstModel = provider?.models[0];
    const firstUrl = provider?.base_urls[0];
    if (provider && firstModel && firstUrl) onPick(provider, firstModel, firstUrl);
  };

  const pickEndpoint = (url: string) => {
    if (matched) onPick(matched.provider, matched.model, url);
  };

  const pickModel = (id: string) => {
    if (!matched) return;
    const model = matched.provider.models.find((m) => m.id === id);
    if (model) onPick(matched.provider, model, matched.baseUrl);
  };

  return (
    <>
      <Field label="Provider" hint="Pick one to fill in the endpoint below, or choose Custom to type your own.">
        <select
          value={selectedProviderId}
          disabled={disabled}
          onChange={(e) => pickProvider(e.target.value)}
          className={inputClass}
        >
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value={CUSTOM}>Custom…</option>
        </select>
      </Field>

      {/* Rendered even when there is only one address. Which host the agent is
          about to talk to is worth seeing, not just worth changing -- and with a
          single option it reads as a label rather than a choice. */}
      {matched && endpoints.length > 0 && (
        <Field
          label="Endpoint"
          hint={
            endpoints.length > 1
              ? `${endpoints.length} addresses for this provider — pick the one that is reachable from here.`
              : undefined
          }
        >
          <select
            value={matched.baseUrl}
            disabled={disabled || endpoints.length === 1}
            onChange={(e) => pickEndpoint(e.target.value)}
            className={inputClass}
          >
            {endpoints.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </Field>
      )}

      {matched && (
        <Field label="Model" hint={describe(matched.model)}>
          <select
            value={matched.model.id}
            disabled={disabled}
            onChange={(e) => pickModel(e.target.value)}
            className={inputClass}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
      )}
    </>
  );
}

/**
 * What the selection implies, spelled out. The dimension in particular must never
 * be invisible just because it is no longer typed by hand -- it is the field whose
 * being wrong is silent until query time.
 */
function describe(model: CatalogModel): string {
  const parts: string[] = [];
  if (model.embed_dim !== undefined) parts.push(`${model.embed_dim} dimensions`);
  if (model.max_tokens !== undefined) parts.push(`suggested max tokens ${model.max_tokens}`);
  if (model.context_window !== undefined) parts.push(`${model.context_window.toLocaleString()}-token context`);
  return parts.join(' — ');
}
