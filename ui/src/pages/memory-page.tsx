import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Brain, ChevronDown, Info, Pencil, Pin, Sparkles, Trash2, User } from 'lucide-react';
import { PageShell } from '@/components/ui/page-shell';
import { Tabs, type TabItem } from '@/components/ui/tabs';
import { ProposalsPanel } from '@/components/memory/proposals-panel';
import { useMemory } from '@/hooks/use-memory';
import { useAgent } from '@/lib/agent-context';
import { cn } from '@/lib/utils';
import type { MemoryItem } from '@/types/admin';

/** The built-in kinds, in the order the page shows them; agent-defined kinds follow. */
const KIND_GROUPS: { kind: string; title: string; blurb: string }[] = [
  { kind: 'profile', title: 'About you', blurb: 'Preferences and facts about your environment. Always in context.' },
  { kind: 'fact', title: 'Facts', blurb: 'Answers worth reusing. Brought in when a question touches them.' },
  { kind: 'lesson', title: 'Lessons', blurb: 'How things work here, and what to avoid.' },
  { kind: 'episode', title: 'Past conversations', blurb: 'One summary per finished conversation, used when you refer back.' },
];

export function MemoryPage() {
  const { agentConfig, readOnly, displayName, role } = useAgent();
  const [params, setParams] = useSearchParams();
  const isAdmin = role === 'admin';
  const tab = isAdmin && params.get('tab') === 'proposals' ? 'proposals' : 'mine';
  const tabs: TabItem<'mine' | 'proposals'>[] = [
    { id: 'mine', label: 'My memory', Icon: User },
    ...(isAdmin
      ? [
          {
            id: 'proposals' as const,
            label: 'Proposals',
            Icon: Sparkles,
            badge: (
              <span className="rounded-full bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400">Admin</span>
            ),
          },
        ]
      : []),
  ];
  const longTerm = (agentConfig?.config.memory as { long_term?: { enabled?: boolean } } | undefined)?.long_term;
  const enabled = readOnly === false && longTerm?.enabled === true;
  const { items, isLoading, error, edit, forget, resolve } = useMemory(enabled);

  const kinds = [
    ...KIND_GROUPS,
    ...[...new Set(items.map((i) => i.kind))]
      .filter((k) => !KIND_GROUPS.some((g) => g.kind === k))
      .map((k) => ({ kind: k, title: k, blurb: 'A kind this agent defines.' })),
  ];
  const conflicted = items.filter((i) => i.status === 'conflicted').length;

  return (
    <PageShell
      current="memory"
      title="Memory"
      Icon={Brain}
      subtitle={
        tab === 'mine'
          ? `What ${displayName} remembers about you across conversations. Only you see it; edit or forget anything.`
          : undefined
      }
    >
      {tabs.length > 1 && (
        <Tabs
          tabs={tabs}
          value={tab}
          onChange={(id) => setParams(id === 'mine' ? {} : { tab: id }, { replace: true })}
        />
      )}
      {tab === 'proposals' ? (
        <ProposalsPanel />
      ) : (
      <>
      {readOnly === true && (
        <Notice>
          You are signed in as a guest. Guests share one identity, so the agent keeps no memory
          for them.
        </Notice>
      )}
      {readOnly === false && agentConfig && !longTerm?.enabled && (
        <Notice>{displayName} does not keep long-term memory (memory.long_term.enabled is off).</Notice>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-300">
          {error}
        </div>
      )}

      {enabled && conflicted > 0 && (
        <div className="mb-6 flex gap-2 rounded-lg border border-amber-900/60 bg-amber-950/30 p-3 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {conflicted === 1 ? 'One item contradicts' : `${conflicted} items contradict`} something the
            agent already knew. Keep or discard {conflicted === 1 ? 'it' : 'them'} below.
          </p>
        </div>
      )}

      {enabled && isLoading && <p className="text-xs text-gray-500">Loading…</p>}

      {enabled && !isLoading && items.length === 0 && !error && (
        <p className="text-sm text-gray-500">
          Nothing yet. The agent learns from your conversations; you can also say “remember that…”
          in chat.
        </p>
      )}

      {enabled &&
        kinds.map((group) => {
          const groupItems = items.filter((i) => i.kind === group.kind);
          if (groupItems.length === 0) return null;
          return (
            <MemoryGroup
              key={group.kind}
              title={group.title}
              blurb={group.blurb}
              count={groupItems.length}
              conflicted={groupItems.some((i) => i.status === 'conflicted')}
            >
              {groupItems.map((item) => (
                <MemoryRow
                  key={item.key}
                  item={item}
                  onEdit={(patch) => edit(item.key, patch)}
                  onForget={() => forget(item.key)}
                  onResolve={(to) => resolve(item.key, to)}
                />
              ))}
            </MemoryGroup>
          );
        })}
      </>
      )}
    </PageShell>
  );
}

/**
 * One kind of memory as a collapsible section. Closed by default, but opened while it holds
 * a conflicted item (on load, or when one appears), since the banner above asks the user to
 * resolve it below.
 */
function MemoryGroup({
  title,
  blurb,
  count,
  conflicted,
  children,
}: {
  title: string;
  blurb: string;
  count: number;
  conflicted: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(conflicted);
  useEffect(() => {
    if (conflicted) setOpen(true);
  }, [conflicted]);

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="mb-8"
    >
      <summary className="-mx-2 flex cursor-pointer select-none list-none items-start gap-2 rounded-md px-2 py-1 hover:bg-gray-900/60 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-white">
            {title} <span className="ml-1 text-xs font-normal text-gray-500">{count}</span>
          </h2>
          <p className="text-xs text-gray-500">{blurb}</p>
        </div>
        <ChevronDown
          className={cn('mt-0.5 h-4 w-4 shrink-0 text-gray-500 transition-transform', open && 'rotate-180')}
        />
      </summary>
      <div className="mt-3 space-y-2">{children}</div>
    </details>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-6 flex gap-2 rounded-lg border border-amber-900/60 bg-amber-950/30 p-3 text-xs text-amber-200">
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{children}</p>
    </div>
  );
}

function MemoryRow({
  item,
  onEdit,
  onForget,
  onResolve,
}: {
  item: MemoryItem;
  onEdit: (patch: { title?: string; text?: string }) => Promise<void>;
  onForget: () => Promise<void>;
  onResolve: (to: 'active' | 'retired') => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [text, setText] = useState(item.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      after?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  };

  const conversations = new Set((item.evidence ?? []).map((e) => e.session_id).filter(Boolean)).size;
  const meta = [
    conversations > 0 && `from ${conversations} conversation${conversations === 1 ? '' : 's'}`,
    item.last_used_at && `last used ${new Date(item.last_used_at).toLocaleDateString()}`,
    !item.last_used_at && item.updated_at && `updated ${new Date(item.updated_at).toLocaleDateString()}`,
  ].filter(Boolean);

  return (
    <div
      className={
        item.status === 'conflicted'
          ? 'rounded-lg border border-amber-900/70 bg-amber-950/10'
          : 'rounded-lg border border-gray-800 bg-gray-900/40'
      }
    >
      <div className="flex items-start gap-3 p-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                aria-label="Title"
                className="w-full rounded border border-gray-700 bg-gray-950 px-2 py-1 text-sm text-white"
              />
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={item.kind === 'episode' ? 1500 : 600}
                rows={item.kind === 'episode' ? 5 : 3}
                aria-label="Text"
                className="w-full rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-200"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || !title.trim()}
                  onClick={() =>
                    void run(
                      () => onEdit({ title: title.trim(), text: text.trim() }),
                      () => setEditing(false)
                    )
                  }
                  className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  {busy ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setEditing(false);
                    setTitle(item.title);
                    setText(item.text);
                  }}
                  className="rounded-md px-3 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white">{item.title}</span>
                {item.pinned && (
                  <span title="You asked the agent to remember this" className="text-gray-500">
                    <Pin className="h-3 w-3" />
                  </span>
                )}
                {item.status === 'conflicted' && (
                  <span className="rounded bg-amber-950 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
                    conflicts
                  </span>
                )}
              </div>
              <p className="mt-1 whitespace-pre-line text-xs text-gray-400">{item.text}</p>
              {(item.tags?.length || meta.length > 0) && (
                <p className="mt-1.5 text-[11px] text-gray-600">
                  {item.tags?.length ? item.tags.map((t) => `#${t}`).join(' ') : ''}
                  {item.tags?.length && meta.length ? ' · ' : ''}
                  {meta.join(' · ')}
                </p>
              )}
            </>
          )}
        </div>

        {!editing && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md p-1.5 text-gray-500 hover:bg-gray-800 hover:text-white"
              aria-label={`Edit ${item.title}`}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-md p-1.5 text-gray-500 hover:bg-gray-800 hover:text-red-400"
              aria-label={`Forget ${item.title}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {item.status === 'conflicted' && !editing && (
        <div className="flex items-center gap-2 border-t border-amber-900/50 px-3 py-2 text-xs text-amber-200">
          <span className="flex-1">This contradicts what the agent already knew.</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => onResolve('active'))}
            className="rounded-md bg-amber-700/60 px-2.5 py-1 text-xs text-white hover:bg-amber-600 disabled:opacity-50"
          >
            Keep
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => onResolve('retired'))}
            className="rounded-md px-2.5 py-1 text-xs text-amber-200 hover:bg-gray-800 disabled:opacity-50"
          >
            Discard
          </button>
        </div>
      )}

      {error && <p className="border-t border-gray-800 px-3 py-2 text-xs text-red-300">{error}</p>}

      {confirming && (
        <div className="border-t border-gray-800 bg-red-950/20 px-3 py-3">
          <p className="text-xs text-gray-300">
            Forget <span className="font-medium text-white">{item.title}</span>? The agent stops using
            it and will not learn it again from later conversations.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(onForget, () => setConfirming(false))}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
            >
              {busy ? 'Forgetting…' : 'Forget'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="rounded-md px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
