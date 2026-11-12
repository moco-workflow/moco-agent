import type { ComponentType, ReactNode } from 'react';
import { AppNav, type NavTarget } from '@/components/app-nav';
import { AgentSwitcher } from '@/components/agent-switcher';
import { BrandMark } from '@/components/brand-mark';
import { SiteSwitcher } from '@/components/site-switcher';
import { UserMenu } from '@/components/user-menu';

/**
 * Layout for the non-chat screens. ChatWindow keeps its own shell, because it
 * owns a full-height column with the input bar pinned to the bottom and folding
 * that into a shared layout route would be churn for no gain.
 */
export function PageShell({
  current,
  title,
  Icon,
  subtitle,
  children,
}: {
  current: NavTarget;
  title: string;
  Icon: ComponentType<{ className?: string }>;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col h-screen bg-gray-950">
      <header className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3 overflow-hidden">
          {/* Brand first, then the per-page Icon/title — ChatWindow's own header
              uses the mark as the title icon because there the title is the app
              name, but here the title is the page. */}
          <BrandMark className="h-5 w-5" />
          <span aria-hidden className="h-4 w-px shrink-0 bg-gray-800" />
          <div className="flex shrink-0 items-center gap-2">
            <Icon className="h-5 w-5 text-blue-500" />
            <h1 className="text-sm font-semibold text-white">{title}</h1>
          </div>
          <span aria-hidden className="h-4 w-px shrink-0 bg-gray-800" />
          <AppNav current={current} />
          <span aria-hidden className="h-4 w-px shrink-0 bg-gray-800" />
          <AgentSwitcher />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <SiteSwitcher current="agent" />
          <UserMenu />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          {subtitle && <p className="mb-6 text-sm text-gray-500">{subtitle}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}
