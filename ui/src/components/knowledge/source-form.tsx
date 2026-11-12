import { useState } from 'react';
import { Field, inputClass } from '@/components/ui/field';
import { ProviderModelSelect } from '@/components/ui/provider-model-select';
import { SecretSelect } from '@/components/ui/secret-select';
import { SourceEditor } from './source-editor';
import { cleanSource, specFor } from '@/lib/source-kinds';
import { matchCatalog } from '@/lib/catalog';
import { useSitemapCheck } from '@/hooks/use-sitemap-check';
import type {
  CatalogProvider,
  EmbedModelInfo,
  IndexSource,
  RegisterSourceRequest,
  SourceScope,
} from '@/types/admin';

/** source-registry's name rule; the name becomes the vector table's. */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

const EMPTY_EMBED: EmbedModelInfo = {
  model_name: '',
  embed_dim: 768,
  base_url: '',
  apikey_secret_key: '',
};

export function SourceForm({
  defaultEmbed,
  canShare,
  privateSearched,
  secretOptions,
  providers,
  onCancel,
  onSubmit,
}: {
  /** The agent's models.embedding; used unless overridden. */
  defaultEmbed: EmbedModelInfo | null;
  /** Shared sources need an admin (access, enforced server-side too). */
  canShare: boolean;
  /** Whether this agent searches private sources at all. */
  privateSearched: boolean;
  secretOptions: string[];
  /** The catalog's embedding endpoints. Empty is fine — the fields go free-text. */
  providers: CatalogProvider[];
  onCancel: () => void;
  onSubmit: (request: RegisterSourceRequest) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [keywords, setKeywords] = useState('');
  const [scope, setScope] = useState<SourceScope>(canShare ? 'shared' : 'private');
  const [sources, setSources] = useState<IndexSource[]>([specFor('web').make()]);

  // No default embedding means the agent cannot index without one given here.
  const [overrideEmbed, setOverrideEmbed] = useState(defaultEmbed === null);
  const [embed, setEmbed] = useState<EmbedModelInfo>(defaultEmbed ?? EMPTY_EMBED);
  const [customEmbed, setCustomEmbed] = useState(false);
  const embedMatched =
    !customEmbed && matchCatalog(providers, 'embedding', embed.base_url ?? '', embed.model_name ?? '');
  const showCustomEmbedFields = providers.length === 0 || customEmbed || !embedMatched;

  const [phase, setPhase] = useState<'idle' | 'checking' | 'starting'>('idle');
  const [error, setError] = useState<string | null>(null);
  const { check } = useSitemapCheck();
  const submitting = phase !== 'idle';

  /**
   * Resolve every `site` source to the sitemap the crawler will actually read,
   * and refuse the ones that have none. The live check under the field is only
   * advisory (debounced, maybe mid-flight); this is the authoritative pass.
   *
   * A check that could not be run is NOT a rejection: that says something about
   * the backend, not about the URL.
   */
  const resolveSiteSources = async (): Promise<{
    sources: IndexSource[];
    errors: string[];
  }> => {
    const errors: string[] = [];
    const resolved = await Promise.all(
      sources.map(async (source) => {
        if (source.kind !== 'site' || !source.url.trim()) return source;
        try {
          const result = await check(source.url.trim());
          if (result.is_sitemap) return { ...source, url: result.url };
          errors.push(
            `No sitemap found for ${source.url.trim()} — tried ` +
              result.checked
                .map((p) => `${p.url} (${p.reason || p.error || 'not a sitemap'})`)
                .join(', ') +
              '. Point this source at a sitemap URL, or index the pages ' +
              'individually with a "Web pages" source.'
          );
          return source;
        } catch {
          return source;
        }
      })
    );
    return { sources: resolved, errors };
  };

  const submit = async () => {
    setError(null);
    const trimmedName = name.trim();
    if (!NAME_PATTERN.test(trimmedName)) {
      setError('Name: lowercase letters, digits and dashes, starting with a letter or digit (max 48).');
      return;
    }
    try {
      setPhase('checking');
      const { sources: resolvedSources, errors } = await resolveSiteSources();
      // Written back either way, so the URL actually submitted is the one on screen.
      setSources(resolvedSources);
      if (errors.length > 0) {
        setError(errors.join(' '));
        return;
      }

      setPhase('starting');
      await onSubmit({
        name: trimmedName,
        scope,
        description: description.trim(),
        keywords: keywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
        index_sources: resolvedSources.map(cleanSource),
        // Omitted unless overridden, so the source uses the agent's model.
        // An empty endpoint or model is sent as null: the server's environment default.
        embed_model_info: overrideEmbed
          ? { ...embed, base_url: embed.base_url || null, model_name: embed.model_name || null }
          : null,
      });
    } catch (err) {
      // The harness's error messages are written to be shown verbatim.
      setError(err instanceof Error ? err.message : 'Could not start indexing');
    } finally {
      setPhase('idle');
    }
  };

  const setEmbedField = <K extends keyof EmbedModelInfo>(k: K, v: EmbedModelInfo[K]) =>
    setEmbed((e) => ({ ...e, [k]: v }));

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
      <h2 className="mb-4 text-sm font-semibold text-white">New knowledge source</h2>

      {error && (
        <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="space-y-3">
        <Field
          label="Name"
          required
          hint="Becomes the table name and cannot be changed. Lowercase letters, digits and dashes."
        >
          <input
            type="text"
            value={name}
            placeholder="moco-docs"
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field
          label="Description"
          required
          hint="The router picks sources by description — say what questions this source answers."
        >
          <input
            type="text"
            value={description}
            placeholder="Moco platform documentation: workflows, activities, runtimes"
            onChange={(e) => setDescription(e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Keywords" hint="Comma separated. Helps routing.">
          <input
            type="text"
            value={keywords}
            placeholder="moco, wfspec, activity"
            onChange={(e) => setKeywords(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-gray-400">
        Visibility
      </h3>
      <div className="space-y-2 text-sm text-gray-300">
        <label className="flex items-start gap-2">
          <input
            type="radio"
            checked={scope === 'shared'}
            disabled={!canShare}
            onChange={() => setScope('shared')}
            className="mt-1"
          />
          <span className={canShare ? undefined : 'opacity-50'}>
            Shared
            <span className="block text-xs text-gray-500">
              Available to every agent that lists it in knowledge.sources. Admins only.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            checked={scope === 'private'}
            onChange={() => setScope('private')}
            className="mt-1"
          />
          <span>
            Private
            <span className="block text-xs text-gray-500">
              Yours alone.
              {!privateSearched &&
                ' This agent does not search private sources (knowledge.allow_user_sources is off).'}
            </span>
          </span>
        </label>
      </div>

      <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-gray-400">
        Index from
      </h3>
      <SourceEditor sources={sources} onChange={setSources} secretOptions={secretOptions} />

      <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-gray-400">
        Embedding
      </h3>
      {defaultEmbed && (
        <label className="mb-2 flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={overrideEmbed}
            onChange={(e) => setOverrideEmbed(e.target.checked)}
            className="h-4 w-4 rounded border-gray-700 bg-gray-900"
          />
          Override the embedding model for this source
        </label>
      )}
      {!overrideEmbed && defaultEmbed ? (
        <p className="text-xs text-gray-500">
          Using the agent's model: {defaultEmbed.model_name || 'the default model (server environment)'} ({defaultEmbed.embed_dim}d) at{' '}
          {defaultEmbed.base_url || 'the default endpoint (server environment)'}
        </p>
      ) : (
        <div className="space-y-3">
          {!defaultEmbed && (
            <p className="text-xs text-gray-500">
              This agent has no models.embedding, so the source needs its own.
            </p>
          )}
          <ProviderModelSelect
            providers={providers}
            kind="embedding"
            baseUrl={embed.base_url ?? ''}
            modelId={embed.model_name ?? ''}
            isCustom={customEmbed}
            onCustom={() => setCustomEmbed(true)}
            onPick={(p, m, url) => {
              setCustomEmbed(false);
              // All four at once: a half-applied selection would pair one model's
              // name with another's dimension.
              setEmbed({
                base_url: url,
                model_name: m.id,
                embed_dim: m.embed_dim ?? embed.embed_dim,
                apikey_secret_key: p.apikey_secret_key ?? '',
              });
            }}
          />
          {showCustomEmbedFields && (
            <>
              <Field label="Endpoint" hint="Leave empty for the server's default embedding endpoint.">
                <input
                  type="url"
                  value={embed.base_url ?? ''}
                  onChange={(e) => setEmbedField('base_url', e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Model name" hint="Leave empty for the server's default embedding model.">
                <input
                  type="text"
                  value={embed.model_name ?? ''}
                  onChange={(e) => setEmbedField('model_name', e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field
                label="Dimensions"
                required
                hint="Must match the model. Fixed once the source is built."
              >
                <input
                  type="number"
                  min={1}
                  value={embed.embed_dim}
                  onChange={(e) => setEmbedField('embed_dim', Number(e.target.value))}
                  className={inputClass}
                />
              </Field>
              <Field label="API key secret" hint="The NAME of a secret, never its value.">
                <SecretSelect
                  value={embed.apikey_secret_key}
                  options={secretOptions}
                  onChange={(v) => setEmbedField('apikey_secret_key', v)}
                />
              </Field>
            </>
          )}
        </div>
      )}

      <div className="mt-5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {phase === 'checking'
            ? 'Checking sources…'
            : phase === 'starting'
              ? 'Starting…'
              : 'Start indexing'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-md px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-white"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
