import { useEffect, useRef, useState } from 'react';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SessionSummary } from '@/types/admin';

interface SessionRowProps {
  session: SessionSummary;
  isActive: boolean;
  /** Guests share one identity, so they may read but not edit. */
  readOnly: boolean;
  onSelect: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => Promise<void>;
  onDelete: (sessionId: string) => Promise<void>;
}

export function SessionRow({
  session,
  isActive,
  readOnly,
  onSelect,
  onRename,
  onDelete,
}: SessionRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const [isBusy, setIsBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) inputRef.current?.select();
  }, [isEditing]);

  // A rename landing from elsewhere (or the agent titling the conversation after
  // its first answer) should show up here, but must not yank the field out from
  // under someone who is mid-edit.
  useEffect(() => {
    if (!isEditing) setDraft(session.title);
  }, [session.title, isEditing]);

  async function commitRename() {
    const title = draft.trim();
    if (!title || title === session.title) {
      setDraft(session.title);
      setIsEditing(false);
      return;
    }
    setIsBusy(true);
    try {
      await onRename(session.session_id, title);
      setIsEditing(false);
    } catch {
      setDraft(session.title);
      setIsEditing(false);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${session.title}"? The transcript is not recoverable.`)) {
      return;
    }
    setIsBusy(true);
    try {
      await onDelete(session.session_id);
    } finally {
      setIsBusy(false);
    }
  }

  if (isEditing) {
    return (
      <div className="flex items-center gap-1 rounded-md bg-gray-800 px-2 py-1.5">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitRename();
            if (e.key === 'Escape') {
              setDraft(session.title);
              setIsEditing(false);
            }
          }}
          disabled={isBusy}
          className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none"
          aria-label="Conversation title"
        />
        <button
          onClick={() => void commitRename()}
          disabled={isBusy}
          className="text-gray-400 hover:text-white"
          aria-label="Save title"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => {
            setDraft(session.title);
            setIsEditing(false);
          }}
          disabled={isBusy}
          className="text-gray-400 hover:text-white"
          aria-label="Cancel rename"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group flex items-center gap-1 rounded-md px-2 py-1.5 transition-colors',
        isActive ? 'bg-gray-800' : 'hover:bg-gray-850 hover:bg-gray-800/50'
      )}
    >
      <button
        onClick={() => onSelect(session.session_id)}
        aria-current={isActive ? 'true' : undefined}
        className="min-w-0 flex-1 text-left"
        title={`${session.title || 'Untitled conversation'} · ${session.turn_count} turn${session.turn_count === 1 ? '' : 's'}`}
      >
        <span
          className={cn(
            'block truncate text-xs',
            isActive ? 'text-white' : 'text-gray-400 group-hover:text-gray-200'
          )}
        >
          {session.title || 'Untitled conversation'}
        </span>
      </button>

      {!readOnly && (
        // Hidden until hover so the list stays quiet, but kept focusable so the
        // actions are reachable from the keyboard.
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <button
            onClick={() => setIsEditing(true)}
            disabled={isBusy}
            className="text-gray-500 hover:text-white"
            aria-label={`Rename ${session.title}`}
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            onClick={() => void handleDelete()}
            disabled={isBusy}
            className="text-gray-500 hover:text-red-400"
            aria-label={`Delete ${session.title}`}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
