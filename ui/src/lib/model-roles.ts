import { matchCatalog, type ProviderKind } from './catalog';
import type { CatalogProvider } from '@/types/admin';

export type ModelRoleName = 'inference' | 'decision' | 'classifier' | 'embedding';

export interface ModelRoleMeta {
  role: ModelRoleName;
  /** The catalog kind its models come from. */
  kind: ProviderKind;
  /** The key naming the model: `model_name` for embedding (llama_index's name). */
  key: 'model' | 'model_name';
  label: string;
  hint: string;
  /** The decision role needs json_mode (agent-config refuses it otherwise). */
  requireJson?: boolean;
}

/** Mirrors agent-config's `model_roles`. */
export const MODEL_ROLES: ModelRoleMeta[] = [
  {
    role: 'inference',
    kind: 'inference',
    key: 'model',
    label: 'Answer model',
    hint: 'Writes the answers (the inference role).',
  },
  {
    role: 'decision',
    kind: 'inference',
    key: 'model',
    label: 'Decision model',
    hint: 'Rewrites, titles and summaries. Unset, it is the answer model with a low token limit.',
    requireJson: true,
  },
  {
    role: 'classifier',
    kind: 'classifier',
    key: 'model',
    label: 'Classifier',
    hint: 'System One: routing, guard and grounding decisions.',
  },
  {
    role: 'embedding',
    kind: 'embedding',
    key: 'model_name',
    label: 'Embedding model',
    hint: 'Used when a knowledge source is registered; each source keeps the model it was built with.',
  },
];

/** A role's config as a plain record, whatever its shape. */
export type RoleConfig = Record<string, unknown>;

/**
 * A role in two parts, for a one-line summary: the model, and where it runs.
 * A catalog match names both by their labels; a custom value shows the model id
 * and the endpoint's host; nulls are the worker's environment default.
 */
export function describeRole(
  cfg: RoleConfig | null | undefined,
  meta: ModelRoleMeta,
  providers: CatalogProvider[]
): { model: string; where: string; custom: boolean } {
  const id = (cfg?.[meta.key] as string | null | undefined) || '';
  const url = (cfg?.base_url as string | null | undefined) || '';
  const hit = matchCatalog(providers, meta.kind, url, id);
  if (hit) return { model: hit.model.label, where: hit.provider.label, custom: false };
  return {
    model: id || 'Environment default',
    where: url ? hostOf(url) : id ? 'environment endpoint' : '',
    custom: Boolean(id || url),
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
