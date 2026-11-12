import { AlertTriangle, CheckCircle2, CircleHelp, CircleOff, Wrench } from 'lucide-react';
import { useAgent } from '@/lib/agent-context';
import { cn } from '@/lib/utils';
import type { ReadinessStatus, RoleReadiness } from '@/types/admin';
import { SetupActions } from './setup-actions';

const ROLE_LABELS: Record<string, { label: string; what: string }> = {
  inference: { label: 'Answer model', what: 'writes every answer' },
  decision: { label: 'Decision model', what: 'small structured calls' },
  classifier: { label: 'Classifier', what: 'routing, screening, memory (System One)' },
  embedding: { label: 'Embedding model', what: 'indexes and searches knowledge' },
};

const STATUS_STYLE: Record<ReadinessStatus, { Icon: typeof CheckCircle2; className: string; label: string }> = {
  ready: { Icon: CheckCircle2, className: 'text-emerald-400', label: 'set up' },
  missing: { Icon: AlertTriangle, className: 'text-red-400', label: 'not set up' },
  unknown: { Icon: CircleHelp, className: 'text-amber-400', label: "worker's default, not verified" },
  off: { Icon: CircleOff, className: 'text-gray-500', label: 'off' },
  inherited: { Icon: CheckCircle2, className: 'text-gray-500', label: 'uses the answer model' },
};

/**
 * The first-run setup guide (F70): which model roles are set up and what fixes
 * the rest, from agent-admin get_readiness. `compact` (the chat's welcome screen)
 * lists only what needs attention and renders nothing once nothing does; the full
 * form (Settings) lists every role.
 */
export function SetupCard({ compact = false }: { compact?: boolean }) {
  const { readiness, displayName } = useAgent();
  if (!readiness) return null;

  const entries = Object.entries(readiness.roles) as [string, RoleReadiness][];
  const shown = compact
    ? entries.filter(([, r]) => r.status === 'missing' || r.reason === 'classifier_unset' || (!readiness.ready && r.status === 'unknown'))
    : entries;
  if (compact && readiness.ready) return null;
  if (shown.length === 0) return null;

  return (
    <section
      aria-label="Model setup"
      className={cn(
        'w-full rounded-xl border p-4 text-left',
        readiness.ready ? 'border-gray-800 bg-gray-900/40' : 'border-amber-900/60 bg-amber-950/20'
      )}
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
        <Wrench className="h-4 w-4" />
        {readiness.ready ? 'Models' : `Set up ${displayName} before the first question`}
      </h2>
      <ul className="mt-3 space-y-3">
        {shown.map(([role, r]) => {
          const style = STATUS_STYLE[r.status] ?? STATUS_STYLE.unknown;
          const meta = ROLE_LABELS[role] ?? { label: role, what: '' };
          const needsAction = r.status === 'missing' || r.status === 'unknown' || r.reason === 'classifier_unset';
          return (
            <li key={role} className="text-xs" data-role={role} data-status={r.status}>
              <div className="flex items-center gap-2">
                <style.Icon className={cn('h-4 w-4 shrink-0', style.className)} />
                <span className="font-medium text-gray-100">{meta.label}</span>
                <span className="text-gray-500">{meta.what}</span>
                <span className={cn('ml-auto', style.className)}>{style.label}</span>
              </div>
              {r.hint && <p className="ml-6 mt-1 text-gray-400">{r.hint}</p>}
              {needsAction && (
                <div className="ml-6">
                  <SetupActions
                    secretName={r.fix.secret_name ?? r.secret.name}
                    secretMissing={r.reason === 'secret_missing'}
                    fields={r.fix.fields}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
