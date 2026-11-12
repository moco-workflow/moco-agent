import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * The Moco mark: a stacked monogram, M over W. The M keeps its vertical stems
 * and the W is a pointed zigzag, so the two letters do not merge into one tall
 * ribbon at small sizes.
 *
 * Inline rather than an `<img>` so it can sit on any surface and scale with the
 * surrounding type; the favicon version lives in public/moco-mark.svg. Keep the
 * geometry in step with moco-ui, moco-doc, moco-home and the sibling apps under
 * moco-apps/ — these are separate Vite builds with no shared package, so the
 * component is duplicated the same way site-switcher and lib/utils already are.
 *
 * The gradient id is per-instance: several marks can render at once and a
 * duplicated SVG id makes `fill="url(#…)"` resolve against the wrong node.
 */
export function BrandMark({ className }: { className?: string }) {
  const gradientId = `moco-brand-grad-${useId()}`;

  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden
      className={cn('h-5 w-5 shrink-0', className)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6366F1" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${gradientId})`} />
      <g fill="none" stroke="#FFFFFF" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8.5 14.2V6.5L16 11.3l7.5-4.8v7.7" />
        <path d="M9.5 17.8l3.25 7.7L16 20.9l3.25 4.6 3.25-7.7" />
      </g>
    </svg>
  );
}
