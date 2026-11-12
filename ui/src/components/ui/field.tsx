import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const inputClass =
  'w-full rounded-md border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-white ' +
  'placeholder:text-gray-600 focus:border-blue-600 focus:outline-none ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 text-xs font-medium text-gray-300">
        {label}
        {required && <span className="text-red-400">*</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-400">{error}</span>}
    </label>
  );
}

/**
 * Whether a setting is stored in the tier being edited ("Overridden") or comes
 * from below it. At the user tier "below" is the agent's configuration; at the
 * agent tier it is the definition and the harness defaults.
 */
export function OwnershipBadge({
  isOwn,
  tier = 'user',
}: {
  isOwn: boolean;
  tier?: 'user' | 'agent';
}) {
  const inherited = tier === 'user' ? "Inherited from the agent's configuration." : 'From the agent definition.';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
        isOwn ? 'bg-blue-950 text-blue-300 ring-1 ring-blue-900' : 'bg-gray-800/80 text-gray-400'
      )}
      title={isOwn ? `Set here. It overrides what is below this tier.` : inherited}
    >
      {isOwn ? 'Overridden' : tier === 'user' ? 'Inherited' : 'Definition'}
    </span>
  );
}
