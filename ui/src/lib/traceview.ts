/**
 * Links a run to the trace viewer SPA (`moco-apps/moco-traceview-ui`).
 *
 * A copy of `moco-apps/moco-playground-ui/src/lib/traceview.ts` apart from the dev-server
 * port below. There is no shared package between these apps, and the alternative — a
 * relative import across the app boundary — is outside both builds' `include: ["src"]`.
 * If `parse_workflow_id` ever changes, both copies change.
 *
 * The viewer is a separate app served at `/apps/traceview` behind the shared nginx
 * (`moco-nginx/conf.d/locations.conf`), so the path is hardcoded here exactly as it is in
 * `site-switcher.tsx` and in moco-ui's execution history table. It is not under
 * `config.apiBaseUrl`: that points at the API origin, while this is a sibling static app.
 * The consequence is that the link only resolves on the shared host — on the Vite dev
 * server at :3001 it 404s, and the viewer has to be opened on its own port instead.
 */

const HEX32 = /^[0-9a-f]{32}$/;

/**
 * Whether the trace viewer can resolve this id, mirroring `parse_workflow_id`
 * (`moco-server/.../common/traceview_grant.py`).
 *
 * A moco workflow id is `<wfspec_name>:<version>:<user_id>:<trace_id>`, and the viewer
 * rejects anything whose last segment is not a 32-lowercase-hex trace id or that has no
 * owner segment before it. Reading from the right is what makes that stable: `wfspec_name`
 * is dotted and may itself contain colons, so only the last two segments are variable-free.
 *
 * Worth checking rather than linking blindly, because an unlinkable id is a *normal*
 * outcome here: the bookend events carry a best-effort label that falls back to the bare
 * trace id when the spec will not parse (`_label_for` in moco-server's workflow router).
 */
export function isTraceableWorkflowId(workflowId: string | undefined): workflowId is string {
  if (!workflowId) return false;

  const lastColon = workflowId.lastIndexOf(':');
  if (lastColon <= 0) return false;
  if (!HEX32.test(workflowId.slice(lastColon + 1))) return false;

  // An owner segment has to exist as well, or the server treats the id as malformed
  // rather than as unowned.
  return workflowId.lastIndexOf(':', lastColon - 1) >= 0;
}

/** The viewer URL for one run. */
export function traceviewUrl(workflowId: string): string {
  return `/apps/traceview?workflow_id=${encodeURIComponent(workflowId)}`;
}
