import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * One settings section: a header (title, description, a status badge on the
 * right), its body, and an optional footer bar for the section's actions.
 */
export function SettingsCard({
  title,
  description,
  badge,
  footer,
  flush,
  children,
}: {
  title: string;
  description?: ReactNode;
  badge?: ReactNode;
  footer?: ReactNode;
  /** No body padding: the body draws its own rows edge to edge. */
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-gray-800 bg-gray-900/40">
      <header className="flex items-start justify-between gap-4 border-b border-gray-800 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          {description && <p className="mt-1 text-xs leading-relaxed text-gray-500">{description}</p>}
        </div>
        {badge && <div className="shrink-0">{badge}</div>}
      </header>
      <div className={cn(!flush && 'px-5 py-4')}>{children}</div>
      {footer && (
        <footer className="flex items-center justify-end gap-2 border-t border-gray-800 bg-gray-950/40 px-5 py-3">
          {footer}
        </footer>
      )}
    </section>
  );
}

/** Primary and secondary buttons, so every card's footer looks the same. */
export const primaryButton =
  'rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 ' +
  'disabled:cursor-not-allowed disabled:opacity-40';
export const secondaryButton =
  'rounded-md px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-white ' +
  'disabled:cursor-not-allowed disabled:opacity-40';

/** An inline error banner for a card's body. */
export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
      {children}
    </div>
  );
}
