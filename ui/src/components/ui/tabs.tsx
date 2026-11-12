import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  Icon?: ComponentType<{ className?: string }>;
  /** Shown after the label, e.g. a count or an "admin" chip. */
  badge?: ReactNode;
}

/** An underlined tab bar. The caller owns the selection (typically a URL param). */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" className="mb-6 flex gap-1 border-b border-gray-800">
      {tabs.map(({ id, label, Icon, badge }) => {
        const selected = id === value;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(id)}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors',
              selected
                ? 'border-blue-500 font-medium text-white'
                : 'border-transparent text-gray-400 hover:border-gray-700 hover:text-gray-200'
            )}
          >
            {Icon && <Icon className="h-4 w-4" />}
            {label}
            {badge}
          </button>
        );
      })}
    </div>
  );
}
