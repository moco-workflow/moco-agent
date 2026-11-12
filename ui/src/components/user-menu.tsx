import { useEffect, useRef, useState } from 'react';
import { LogOut, UserRound } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';

/** "ada.lovelace@corp.com" -> "AL"; a single-word label -> its first two letters. */
function initialsFor(label: string): string {
  // Destructured and sliced rather than indexed: some of these apps build with
  // noUncheckedIndexedAccess, where `parts[0][0]` is not known to be a string.
  const [first, second] = label.replace(/@.*$/, '').split(/[.\s_-]+/).filter(Boolean);
  if (!first) return '?';
  if (!second) return first.slice(0, 2).toUpperCase();
  return (first.slice(0, 1) + second.slice(0, 1)).toUpperCase();
}

/**
 * Signed-in user chip with an account menu.
 *
 * Mirrors the console's `app-topbar.tsx` account menu — same avatar, same
 * fields, same labels — so login status reads identically across every Moco
 * SPA. The console keeps its own Radix + design-token implementation because
 * neither that dependency nor those tokens exist in the `moco-apps` SPAs; this
 * is the dark-palette equivalent, copied verbatim between them.
 */
export function UserMenu({ className = '' }: { className?: string }) {
  const { user, displayName, isGuest, isApiKeySession, isAuthDisabled, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  // displayName already falls back to the ID token's `sub`; this last guard is
  // for a token that carried no identity claims at all.
  const label = displayName || 'Signed in';

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((isOpen) => !isOpen)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 text-xs transition-colors hover:bg-gray-800"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-500/10 text-[0.6875rem] font-semibold text-blue-400">
          {isGuest ? <UserRound className="h-3.5 w-3.5" /> : initialsFor(label)}
        </span>
        <span className="hidden max-w-[14rem] truncate text-gray-400 sm:block">{label}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 min-w-[15rem] overflow-hidden rounded-lg border border-gray-800 bg-gray-900 shadow-xl"
        >
          <div className="space-y-1.5 border-b border-gray-800 px-2.5 py-2.5">
            <p className="truncate text-sm font-medium text-white">{user.name || label}</p>
            {user.email && <p className="truncate text-xs text-gray-400">{user.email}</p>}
            {isGuest && (
              <span className="mt-1 inline-block rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                Guest session
              </span>
            )}
            {isApiKeySession && (
              <span className="mt-1 inline-block rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                API key session
              </span>
            )}
            {isAuthDisabled && (
              <span className="mt-1 inline-block rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                Auth disabled
              </span>
            )}
          </div>
          {!isAuthDisabled && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                logout();
              }}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm text-red-400 transition-colors hover:bg-red-500/10"
            >
              <LogOut className="h-4 w-4" />
              {isGuest ? 'Exit guest mode' : 'Sign out'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
