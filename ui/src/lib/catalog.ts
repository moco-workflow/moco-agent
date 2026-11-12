import type { CatalogModel, CatalogProvider } from '@/types/admin';

/** The catalog kinds a model role picks from. */
export type ProviderKind = 'inference' | 'embedding' | 'classifier';

export function providersOfKind(
  providers: CatalogProvider[],
  kind: ProviderKind
): CatalogProvider[] {
  return providers.filter((p) => p.kind === kind);
}

/**
 * Which catalog entry, if any, an already-saved value corresponds to.
 *
 * Matched on endpoint AND model together: the same model id behind a different
 * base_url is a different thing, and inheriting the wrong provider's embed_dim is
 * precisely the failure the catalog exists to prevent. The endpoint need only be
 * ONE OF the provider's `base_urls`.
 *
 * A value matching nothing returns null and is NEVER rewritten -- the picker
 * shows "Custom…" with the saved fields intact.
 */
export function matchCatalog(
  providers: CatalogProvider[],
  kind: ProviderKind,
  baseUrl: string,
  modelId: string
): { provider: CatalogProvider; model: CatalogModel; baseUrl: string } | null {
  for (const provider of providersOfKind(providers, kind)) {
    if (!provider.base_urls.includes(baseUrl)) continue;
    const model = provider.models.find((m) => m.id === modelId);
    if (model) return { provider, model, baseUrl };
  }
  return null;
}

/** Every catalog model of a kind, for a model-only picker (the user tier). */
export function modelsOfKind(
  providers: CatalogProvider[],
  kind: ProviderKind
): { provider: CatalogProvider; model: CatalogModel }[] {
  return providersOfKind(providers, kind).flatMap((provider) =>
    provider.models.map((model) => ({ provider, model }))
  );
}
