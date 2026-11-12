import { useSearchParams } from 'react-router-dom';
import { Plug, Wrench } from 'lucide-react';
import { PageShell } from '@/components/ui/page-shell';
import { Tabs, type TabItem } from '@/components/ui/tabs';
import { ToolsPanel } from '@/components/tools/tools-panel';
import { ProvidersPanel } from '@/components/tools/providers-panel';
import { useAgent } from '@/lib/agent-context';

/** Tools for everyone (with per-user preferences); MCP providers for admins. `?tab=` keeps the tab. */
export function ToolsPage() {
  const { role } = useAgent();
  const [params, setParams] = useSearchParams();
  const isAdmin = role === 'admin';
  const tab = isAdmin && params.get('tab') === 'providers' ? 'providers' : 'tools';
  const tabs: TabItem<'tools' | 'providers'>[] = [
    { id: 'tools', label: 'Tools', Icon: Wrench },
    ...(isAdmin
      ? [
          {
            id: 'providers' as const,
            label: 'Providers',
            Icon: Plug,
            badge: <span className="rounded-full bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400">Admin</span>,
          },
        ]
      : []),
  ];
  return (
    <PageShell current="tools" title="Tools" Icon={Wrench}>
      {tabs.length > 1 && (
        <Tabs
          tabs={tabs}
          value={tab}
          onChange={(id) => setParams(id === 'tools' ? {} : { tab: id }, { replace: true })}
        />
      )}
      {tab === 'providers' ? <ProvidersPanel /> : <ToolsPanel />}
    </PageShell>
  );
}
