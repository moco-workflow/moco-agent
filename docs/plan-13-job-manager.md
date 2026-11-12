# Plan 13 — Job manager (`job-manager`, `job-store`)

Design: `design.md` §6.12, §3 P6, §6.9.9 (async tools), §13.2. Overview:
[plan-00](plan-00-overview.md).

**Status (2026-10-14, harness 0.6.2):** steps 1-8 built and verified live on the dev stage --
the builder (plan-18 step 8) and an async tool (`tool-job`, plan-10 step 14). Also built: the
janitor's stuck-job sweep (plan-17) and the admin jobs area (`admin.jobs`). Findings F54-F57
(plan-00 §6).

## 1. Scope

Run async profile work (and, later, async tools) as detached entity workflows; track it in a
row; bring results back into the conversation — even when the session retired meanwhile.

Out of scope: the builder's own logic (plan-18); pending-action rows (plan-12).

## 2. wfspecs to create

`workflow/src/` (flat, F41)

| wfspec | Modes | Owns |
| --- | --- | --- |
| `job-store.yaml` | `create`, `get`, `transition`, `mark_delivered`, `list {session_id?, status?}`, `delete` | `job:<job_id>` (topic `session-job`) in `<uid>:agent.<id>.sessions` |
| `job-manager.yaml` | `start`, `report`, `send`, `get`, `list`, `cancel`, `mark_delivered`, `reconcile`, `delete` | facade |
| `job-entity.yaml` | — | Generic detached state machine (`init → running ⇄ awaiting → done`), workflow id `agent-job-<agent_id>-<uid>-<job_id>`: runs the job wfspec, reports how it ended, waits for `job_reply` / `job_cancel` / expiry. |
| `job-signal.yaml` | `start_job`, `to_job`, `to_session` | Every event the job manager sends, in a wfspec of its own so tests can mock it (F53); entity refs by expression (F56). |

**The job wfspec follows the profile contract** (§6.8.1), so a `kind: wfspec` profile can be its
own job body: input `{agent_id, profile, query, job_input, job_id, session_id, config,
resolved_refs, budget_sec, resume}`; status `ok`/`declined` → completed, `needs_approval` with a
`pending_action` → awaiting_input, anything else (or the run timeout `limits.job_timeout_sec`,
default 3600) → failed. A reply re-runs it with `resume: {pending_action, decision, feedback}`,
as a profile is resumed. The session opens the job's question as its pending action with
`detail.job_id`; `resuming` sends the answer (`job-manager send`) instead of running a profile, and
a reject cancels the job.

## 3. Dependencies

- Calls: `builtin.state` (store); detached child start of `job-entity`; `emit_event`
  (`subagent_event`) into the session entity via start-or-signal.
- Called by: session `finalizing` (`start` — per F6 the session, not the profile/executor,
  starts jobs), `init` (`reconcile`), `relaying` (`get`, `mark_delivered`), `resuming`
  (`send` via `hitl resolve → job_send`); `session-store delete` (`cancel`); `agent-admin` jobs
  area; janitor (fail stuck jobs).

## 4. Reuse

| From | To |
| --- | --- |
| `build-store.yaml` (row shape, namespace, status handling) | `job-store` generalised from builds to any job |
| `workflow-builder.yaml` pause/resume via events | `job-entity` event loop (`send`) |

## 5. Implementation steps

1. **Row shape** (§6.12, with `schema_version`) and lifecycle: `queued → running → completed | failed | cancelled`,
   `running ⇄ awaiting_input`, `awaiting_input → cancelled` on cancel/expiry. Illegal →
   `invalid_state`.
2. **`start`** (called by the session in `finalizing`, from a profile's or tool's
   `job_request`): enforce `limits.max_async_jobs` (1 in v1); mint `job_id`; write `queued`; start
   `job-entity` detached; return `{job_id, workflow_id}`.
3. **`job-entity`**: run the profile wfspec with its input; map its outputs to `report` calls.
   `report` writes the row **then** emits `subagent_event {kind: progress | pending_action |
   complete}` — the row is the truth, the event a nudge.
4. **`send`**: emit into the job entity (plan review replies).
5. **`reconcile {session_id, meta.jobs}`** → `{to_relay}`: terminal jobs with `delivered_at`
   null, so a session that retired mid-job catches up at `init`.
6. **`cancel`**: send the job entity a cancel event; the entity writes `cancelled` itself (it is
   the row's only live writer, §4.3). Only when the entity is gone does the caller write
   `cancelled` / the janitor write `failed` directly. The session cascades `hitl cancel` for the
   job's pending action.
7. **Delivery to the user (F12)**: relayed results become turns in the transcript; the UI learns
   of them by polling `agent-admin get_session` while `meta.jobs` has a non-terminal job, and
   optionally through the `progress#` SSE channel. Document this in `agent-cli`'s contract.
8. **Async tools** (phase 3): `tool-executor` returns `async_started` + a `job_request`; the
   session calls `start` with the tool binding as the job wfspec.

## 6. Tests

`workflow/tests/jobs/`

- Lifecycle transitions + illegal ones.
- `start` over the limit → `ok: false, code: limit_exceeded`.
- `report` writes before emitting (assert order via mocks).
- `reconcile` returns only terminal undelivered jobs.
- Session-level (plan-14): job completes while the session is retired → next `init` relays it.
- Cancel cascades.

## 7. Phase split

Phase 3 per §19, together with async tools and the builder (F9 resolved).

## 8. Risks & open issues

- No CAS (P15): handled by the single-writer rule; the job entity re-reads its row before each
  `report` and stops if a cancel event has arrived.
- No push channel (P4): polling `get_session` is the only guaranteed delivery path (F12).
- Detached children under `moco run <file>` fall back to inline (P7): unit tests mock
  `job-entity` by `task_name`, and real async behaviour is tested on the dev stage.

## 9. Done when

The builder (plan-18) runs as a job with a plan-review pending action, and its completion is
relayed into the conversation after the session retired and woke again (§18 E2E).
