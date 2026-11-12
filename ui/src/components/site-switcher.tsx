import { BookOpen, Bot, FlaskConical, House, LayoutDashboard } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SiteId = 'home' | 'docs' | 'playground' | 'agent' | 'console';

/**
 * The Moco apps all sit under one host root behind the shared nginx (see
 * `moco-nginx/conf.d/locations.conf`), which is what makes cross-app navigation
 * a same-tab link rather than a new window.
 *
 * These are plain `<a>` hrefs on purpose: react-router only knows this app's own
 * basename, so a client-side navigation to `/docs` would resolve against this SPA
 * and render its not-found route instead of leaving for the docs site.
 *
 * Keep this set and its labels in step with the switchers in moco-home, moco-doc,
 * moco-ui and the sibling apps under moco-apps/.
 */
const SITES: { id: SiteId; href: string; label: string; Icon: typeof House }[] = [
  { id: 'home', href: '/', label: 'Home', Icon: House },
  { id: 'docs', href: '/docs', label: 'Docs', Icon: BookOpen },
  { id: 'playground', href: '/apps/playground', label: 'Playground', Icon: FlaskConical },
  { id: 'agent', href: '/apps/moco-agent', label: 'Agent', Icon: Bot },
  { id: 'console', href: '/ui', label: 'Console', Icon: LayoutDashboard },
];

/** Cross-app navigation. `current` is the app doing the rendering. */
export function SiteSwitcher({ current }: { current: SiteId }) {
  return (
    <nav aria-label="Moco apps" className="flex items-center gap-0.5">
      {SITES.map(({ id, href, label, Icon }) => (
        <a
          key={id}
          href={href}
          aria-current={id === current ? 'page' : undefined}
          title={label}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors',
            id === current
              ? 'text-gray-300'
              : 'text-gray-500 hover:bg-gray-800 hover:text-white'
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {/* Labels only on wide screens: the page nav and agent picker need the room. */}
          <span className="hidden 2xl:inline">{label}</span>
        </a>
      ))}
    </nav>
  );
}
