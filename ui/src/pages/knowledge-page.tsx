import { useState } from 'react';
import { Info, Library, Plus } from 'lucide-react';
import { PageShell } from '@/components/ui/page-shell';
import { SourceRow } from '@/components/knowledge/source-row';
import { SourceForm } from '@/components/knowledge/source-form';
import { useSources } from '@/hooks/use-sources';
import { useSecretNames } from '@/hooks/use-secret-names';
import { useModelCatalog } from '@/hooks/use-model-catalog';
import { useAgent } from '@/lib/agent-context';
import type { KnowledgeSource } from '@/types/admin';

export function KnowledgePage() {
  const { sources, isLoading, error, isIndexing, register, reindex, remove, refreshNow, setRefreshInterval } =
    useSources();
  const { agentConfig, readOnly, role, displayName } = useAgent();
  const { options: secretOptions } = useSecretNames();
  const { providers } = useModelCatalog();
  const [adding, setAdding] = useState(false);

  const knowledge = agentConfig?.config.knowledge ?? {};
  const listed = knowledge.sources ?? [];
  const privateSearched = Boolean(knowledge.allow_user_sources);
  const isAdmin = role === 'admin';

  // Mirrors knowledge catalog: shared sources the agent lists, plus private ones
  // when the agent allows them.
  const searchable = (s: KnowledgeSource) =>
    s.scope === 'shared' ? listed.includes(s.name) : privateSearched;
  const canManage = (s: KnowledgeSource) =>
    readOnly === false && (s.scope === 'private' || isAdmin);

  return (
    <PageShell
      current="knowledge"
      title="Knowledge"
      Icon={Library}
      subtitle={`Indexed sources an agent can answer from, each with its own vector index. ${displayName} searches the shared sources in its knowledge.sources${privateSearched ? ' and your private ones' : ''}.`}
    >
      {readOnly === true && (
        <div className="mb-6 flex gap-2 rounded-lg border border-amber-900/60 bg-amber-950/30 p-3 text-xs text-amber-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            You are signed in as a guest. Guests share one identity, so you can see the sources
            but not add or remove any.
          </p>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-300">
          {error}
        </div>
      )}

      {!adding && readOnly === false && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mb-4 flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
        >
          <Plus className="h-3.5 w-3.5" />
          Add source
        </button>
      )}

      {adding && agentConfig && (
        <div className="mb-6">
          <SourceForm
            defaultEmbed={agentConfig.config.models?.embedding ?? null}
            canShare={isAdmin}
            privateSearched={privateSearched}
            secretOptions={secretOptions}
            providers={providers}
            onCancel={() => setAdding(false)}
            onSubmit={async (request) => {
              await register(request);
              setAdding(false);
            }}
          />
        </div>
      )}

      {isIndexing && (
        <p className="mb-3 text-xs text-blue-300">
          Indexing in progress — this page refreshes itself, no need to reload.
        </p>
      )}

      {isLoading && sources.length === 0 ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : sources.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-800 p-8 text-center">
          <Library className="mx-auto mb-3 h-10 w-10 text-gray-700" />
          <p className="text-sm text-gray-400">No knowledge sources yet</p>
          <p className="mt-1 text-xs text-gray-600">
            A retrieval profile declines rather than guesses when there is nothing to search.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {sources.map((s) => (
            <SourceRow
              key={`${s.scope}:${s.name}`}
              source={s}
              canManage={canManage(s)}
              searchable={searchable(s)}
              onReindex={() => reindex(s.name, s.scope)}
              onRefresh={() => refreshNow(s.name, s.scope)}
              onSetRefreshInterval={(hours) => setRefreshInterval(s.name, s.scope, hours)}
              onDelete={() => remove(s.name, s.scope)}
            />
          ))}
        </div>
      )}
    </PageShell>
  );
}
