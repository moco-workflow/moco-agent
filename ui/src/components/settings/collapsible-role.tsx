import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * One model role as a row of the Models card: the role and what it is for on the
 * left, what it resolves to on the right. Closed by default -- four roles of
 * several fields each bury everything below them -- and forced open when it has
 * an error to show. The parent draws the dividers between rows.
 */
export function CollapsibleRole({
  title,
  hint,
  summary,
  badges,
  error,
  children,
}: {
  title: string;
  hint: string;
  /** What the role resolves to, e.g. "GPT-4o" over "OpenAI". */
  summary: ReactNode;
  badges?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (error) setOpen(true);
  }, [error]);

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="group"
    >
      <summary className="flex cursor-pointer select-none list-none items-center gap-4 px-5 py-3.5 hover:bg-gray-900/60 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-100">{title}</span>
            {badges}
          </div>
          <p className="mt-0.5 truncate text-xs text-gray-500">{hint}</p>
        </div>
        <div className="min-w-0 max-w-[45%] text-right">{summary}</div>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-gray-500 transition-transform', open && 'rotate-180')}
        />
      </summary>
      <div className="border-t border-gray-800/70 bg-gray-950/30 px-5 py-4">
        {error && (
          <p className="mb-3 rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}
        {children}
      </div>
    </details>
  );
}
