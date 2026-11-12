import { useEffect, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react';
import { SessionRow } from './session-row';
import type { SessionSummary } from '@/types/admin';

/** Remembered so a trip to Knowledge/Settings does not re-expand the sidebar. */
const COLLAPSED_KEY = 'moco-agent.sessions-collapsed';

interface SessionSidebarProps {
  sessions: SessionSummary[];
  activeSessionId: string;
  isLoading: boolean;
  error: string | null;
  /**
   * null until get_config says. This is the only place in the chat tree that
   * renders a read-only BANNER, so it is the only one that has to tell "locked"
   * apart from "not known yet"; the rows merely gate a control, for which
   * `?? true` is the right reading of null.
   */
  readOnly: boolean | null;
  onSelect: (sessionId: string) => void;
  onNew: () => void;
  onRename: (sessionId: string, title: string) => Promise<void>;
  onDelete: (sessionId: string) => Promise<void>;
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  isLoading,
  error,
  readOnly,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: SessionSidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_KEY) === '1'
  );

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, isCollapsed ? '1' : '0');
  }, [isCollapsed]);

  // A freshly minted conversation has no server-side row until its first answer,
  // so it is not in `sessions`. Showing a placeholder keeps the active item
  // visible instead of leaving nothing highlighted.
  const activeIsUnsaved = !sessions.some((s) => s.session_id === activeSessionId);

  if (isCollapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-gray-800 bg-gray-950 p-2">
        <button
          onClick={() => setIsCollapsed(false)}
          aria-expanded={false}
          aria-label="Expand conversations"
          title="Expand conversations"
          className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
        <button
          onClick={onNew}
          aria-label="New chat"
          title="New chat"
          className="rounded-md border border-gray-800 p-1.5 text-gray-300 transition-colors hover:border-gray-700 hover:bg-gray-800 hover:text-white"
        >
          <Plus className="h-4 w-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-gray-800 bg-gray-950">
      <div className="flex items-center gap-1 p-2">
        <button
          onClick={onNew}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-gray-800 px-2.5 py-1.5 text-xs text-gray-300 transition-colors hover:border-gray-700 hover:bg-gray-800 hover:text-white"
        >
          <Plus className="h-3.5 w-3.5" />
          New chat
        </button>
        <button
          onClick={() => setIsCollapsed(true)}
          aria-expanded
          aria-label="Collapse conversations"
          title="Collapse conversations"
          className="shrink-0 rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-white"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2" aria-label="Conversations">
        {activeIsUnsaved && (
          <div className="rounded-md bg-gray-800 px-2 py-1.5">
            <span className="block truncate text-xs text-white">New conversation</span>
          </div>
        )}

        {sessions.map((session) => (
          <SessionRow
            key={session.session_id}
            session={session}
            isActive={session.session_id === activeSessionId}
            readOnly={readOnly ?? true}
            onSelect={onSelect}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}

        {isLoading && sessions.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-gray-600">Loading…</p>
        )}

        {!isLoading && !error && sessions.length === 0 && !activeIsUnsaved && (
          <p className="px-2 py-1.5 text-xs text-gray-600">No conversations yet.</p>
        )}

        {error && <p className="px-2 py-1.5 text-xs text-red-400">{error}</p>}
      </nav>

      {readOnly === true && (
        <p className="border-t border-gray-800 px-3 py-2 text-[11px] leading-snug text-gray-500">
          Guest sessions share one identity, so conversations here are read-only.
        </p>
      )}
    </aside>
  );
}
