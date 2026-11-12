import { useSearchParams } from 'react-router-dom';
import { Activity, BarChart3, ListChecks } from 'lucide-react';
import { PageShell } from '@/components/ui/page-shell';
import { Tabs, type TabItem } from '@/components/ui/tabs';
import { JobsPanel } from '@/components/activity/jobs-panel';
import { UsagePanel } from '@/components/activity/usage-panel';
import { useAgent } from '@/lib/agent-context';

/** Background jobs and usage, both the caller's own. `?tab=usage` keeps the tab. */
export function ActivityPage() {
  const { readOnly } = useAgent();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'usage' ? 'usage' : 'jobs';
  const tabs: TabItem<'jobs' | 'usage'>[] = [
    { id: 'jobs', label: 'Jobs', Icon: ListChecks },
    { id: 'usage', label: 'Usage', Icon: BarChart3 },
  ];
  return (
    <PageShell current="activity" title="Activity" Icon={Activity}>
      <Tabs tabs={tabs} value={tab} onChange={(id) => setParams(id === 'jobs' ? {} : { tab: id }, { replace: true })} />
      {readOnly === true ? (
        <p className="text-sm text-gray-500">Guests share one identity, so there is no activity to show.</p>
      ) : tab === 'usage' ? (
        <UsagePanel />
      ) : (
        <JobsPanel />
      )}
    </PageShell>
  );
}
