# Plan 12 — HITL manager (`hitl`)

Design: `design.md` §6.11, §3 P8, §6.9.9 (approval), §6.12 (job pending actions). Overview:
[plan-00](plan-00-overview.md).

## 1. Scope

The generic human-in-the-loop mechanism: own the pending-action row and its lifecycle. It does
not execute anything. On a decision it returns the resume input (or a job event), and the
session runs it.

v4 simplification (S5, F13): four statuses, `awaiting | resolved | expired | cancelled`. The
decision (`approve | approve_session | reject | revise`) is a field. A revision is a new row.

Out of scope: building the pending action (loop, plan-11; jobs, plan-13); session grants
(`tool-policy grant`, called by the session); rendering approval UI.

## 2. wfspecs to create

`workflow/src/hitl/`

| wfspec | Modes | Owns |
| --- | --- | --- |
| `hitl.yaml` | `open`, `get`, `resolve`, `expire`, `cancel`, `list` | `session:<sid>:pending` in `<uid>:agent.<id>.sessions` |

## 3. Dependencies

- Calls: `builtin.state` (own row only).
- Called by the session entity, which is the row's only live writer (§4.3): `init` (`get`),
  `finalizing` (`open`), `resuming` (`resolve`), `idle_tick` (`expire`); `session-store delete`
  and `job-manager cancel` paths (`cancel`, via the session); `agent-admin list_pending`
  (`list`, read-only); the janitor, for **retired** sessions only (`expire`).

## 4. Reuse

- `workflow-builder.yaml` / `build-store.yaml`: the plan-review pause and the bespoke `build_*`
  routes are replaced by a `plan_review` pending action; port the review summary text.

## 5. Implementation steps

1. **Row shape** (§6.11): `schema_version`, `id = pa-<sid>-<turn>`, `kind`, `profile`, `status`,
   `summary`, `detail` (opaque), `decision: {decision, feedback, by, ts}`, `created_at`,
   `expires_at`.
2. **Lifecycle**: `open → awaiting`; `awaiting → resolved | expired | cancelled`. Everything
   else → `invalid_state`.
3. **`open`**: fails with `code: already_open` if an `awaiting` row exists. `id` collisions (a
   second suspension in the same turn after a revise) get a `-<n>` suffix.
4. **`resolve {id, decision, feedback?}`**: id must match the awaiting row; writes the decision
   and `resolved`; returns `{resume: {pending_action, decision, feedback, approval_token}}` for
   loop-kind actions or `{job_send: {job_id, event}}` for job-kind actions. `approval_token` =
   `id` + the held call's `args_hash`.
5. **Revise**: the same `resolve` path. For `tool_call` it acts as a reject with the feedback
   appended to the synthetic tool result, and the profile opens a fresh row if it suspends again.
6. **`expire`**: `now > expires_at` → `expired`; the session writes a system note into the
   transcript.
7. **`list`**: the user's awaiting actions for this agent (topic `session-pending`, status
   `awaiting`).
8. **Admin path**: `agent-admin resolve_pending` emits `user_message {action}` into the session
   (no direct `resolve`), so the UI and chat paths share one code path in the entity.

## 6. Tests

`workflow/tests/hitl/`

- Every legal transition; every illegal one → `invalid_state` (e.g. resolving an expired row).
- `open` while one is awaiting → `already_open`.
- `resolve` with a stale id → `invalid_state`; returns `resume` vs `job_send` by kind.
- Revise, then a new `open` in the same turn succeeds with a suffixed id.
- Expire at the boundary.
- A message unrelated to the pending action leaves it `awaiting` (session-level test in plan-14).

## 7. Phase split

Phase 2 (with tools). The `plan_review` kind is used in phase 3 by the builder.

**Status (2026-10-12):** steps 1–7 implemented (`hitl.yaml`, `hitl.test.yaml` 23 cases), with the
`owner_user_id` admin override for the janitor (F50; removed 2026-11-09 when F50 closed:
`session-housekeep` expires due actions as the session's own user). Decisions per kind: `tool_call` approve /
approve_session / reject / revise, `user_input` reply / reject. Step 8 (`agent-admin
resolve_pending`) is with plan-16's pending area.

## 8. Risks & open issues

- Only one action may be open; `ask_user` takes precedence over tool approval in the same step
  (plan-11, F20).
- The janitor must never touch rows of live sessions (P15). It checks `meta.status: retired`
  first.

## 9. Done when

Phase 2 exit (§19): an approve-and-resume survives a session retire — the pending row persists,
`init` rehydrates it, and the approval resumes the held call.
