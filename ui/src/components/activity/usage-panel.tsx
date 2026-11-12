import { useEffect, useState } from 'react';
import { usageReport } from '@/lib/agent-api';
import { useAuth } from '@/lib/auth/auth-context';
import { useAgent } from '@/lib/agent-context';
import type { UsageReport } from '@/types/admin';

const fmt = (n: number | undefined) => (n ?? 0).toLocaleString();

/**
 * The caller's own usage with this agent (summed from their sessions), and the
 * deployment's per-tool figures from the hourly tool-stats rollup. Token counts are
 * estimated (the chat activity reports no usage, P20).
 */
export function UsagePanel() {
  const { getAuthToken } = useAuth();
  const { agentId, displayName } = useAgent();
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const token = await getAuthToken();
        const r = await usageReport(agentId, token, controller.signal);
        if (!controller.signal.aborted) setReport(r);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load usage');
      }
    })();
    return () => controller.abort();
  }, [agentId, getAuthToken]);

  if (error) {
    return <div className="rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-300">{error}</div>;
  }
  if (!report) return <p className="text-xs text-gray-500">Loading…</p>;

  const t = report.totals;
  const tiles: [string, string][] = [
    ['Conversations', fmt(report.sessions)],
    ['Turns', fmt(t.turns)],
    ['Model calls', fmt(t.llm_calls)],
    ['Classifier calls', fmt(t.classifier_calls)],
    ['Tool calls', fmt(t.tool_calls)],
    ['Tokens in / out (est.)', `${fmt(t.tokens_in)} / ${fmt(t.tokens_out)}`],
  ];
  const routes = Object.entries(report.by_route ?? {}).sort((a, b) => b[1].turns - a[1].turns);

  return (
    <div className="space-y-8">
      <p className="text-sm text-gray-500">Your conversations with {displayName}.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
            <p className="text-[11px] text-gray-500">{label}</p>
            <p className="mt-1 text-lg font-semibold text-white">{value}</p>
          </div>
        ))}
      </div>

      {routes.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-white">By profile</h2>
          <table className="w-full text-xs">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="py-1 font-medium">Profile</th>
                <th className="py-1 text-right font-medium">Conversations</th>
                <th className="py-1 text-right font-medium">Turns</th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              {routes.map(([route, r]) => (
                <tr key={route} className="border-t border-gray-800">
                  <td className="py-1.5">{route}</td>
                  <td className="py-1.5 text-right">{fmt(r.sessions)}</td>
                  <td className="py-1.5 text-right">{fmt(r.turns)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-white">Tools (everyone, hourly rollup)</h2>
        {report.tools.length === 0 ? (
          <p className="text-xs text-gray-500">No tool calls recorded yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="py-1 font-medium">Tool</th>
                <th className="py-1 text-right font-medium">Calls</th>
                <th className="py-1 text-right font-medium">Error rate</th>
                <th className="py-1 text-right font-medium">p50 / p95</th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              {report.tools.map((s) => (
                <tr key={s.name} className="border-t border-gray-800" title={s.last_error?.message ?? undefined}>
                  <td className="py-1.5 font-mono">
                    {s.name}
                    {s.flag === 'failing' && (
                      <span className="ml-2 rounded bg-red-950 px-1.5 py-0.5 text-[10px] uppercase text-red-300">failing</span>
                    )}
                  </td>
                  <td className="py-1.5 text-right">{fmt(s.calls)}</td>
                  <td className="py-1.5 text-right">
                    {typeof s.error_rate === 'number' ? `${Math.round(s.error_rate * 100)}%` : '—'}
                  </td>
                  <td className="py-1.5 text-right">
                    {s.p50_ms != null ? `${Math.round(s.p50_ms)} / ${Math.round(s.p95_ms ?? 0)} ms` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
