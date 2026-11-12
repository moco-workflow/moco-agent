# Plan 16 — Interface layer (`agent-cli`, `agent-admin`)

Design: `design.md` §6.15, §3 P4/P6, §11.4. Overview: [plan-00](plan-00-overview.md).

## 1. Scope

- **`agent-cli`**: the synchronous chat entry point — start-or-signal the session entity, wait
  for the answer, return the contract (with old-UI compatibility fields).
- **`agent-admin`**: the synchronous admin/UI backend — a dispatcher over per-area wfspecs,
  persist_state only, every operation through the owning module.

Out of scope: the UI itself (§20 Q10), business logic (lives in owners).

## 2. wfspecs to create

`workflow/src/` (flat, F41). **Built** (2026-10-06): `agent-cli` phase 1 (`action`, `sources_urls`,
`question_count`), `agent-admin` and `admin.agents` / `admin.config` / `admin.sessions` /
`admin.knowledge`, `sitemap-probe` (converted). `submit_feedback` and `move_source` answer
`not_available` until phase 2.

| wfspec | Notes |
| --- | --- |
| `agent-cli.yaml` | `{agent_id?, message \| question, session_id?, message_id?, action?, overrides?}` → §6.15.1 output (incl. `message_id`). |
| `agent-admin.yaml` | Dispatcher: `{op, agent_id, ...}` → area wfspec. |
| `admin.agents.yaml`, `admin.config.yaml`, `admin.sessions.yaml`, `admin.knowledge.yaml` | Phase 1 areas. |
| `admin.memory.yaml`, `admin.tools.yaml`, `admin.pending.yaml`, `admin.usage.yaml` | Phase 2. |
| `admin.jobs.yaml`, `admin.providers.yaml` | Phase 3. |

Owns no storage.

## 3. Dependencies

- `agent-cli` → `agent-session` (start-or-signal, `wait_for` ≤ 120s).
- `agent-admin` areas → `agent-registry`, `agent-config`, `access`, `session-store` (incl.
  `submit_feedback`, usage report over `meta.usage`), `knowledge`, `memory`, `tool-registry`,
  `tool-policy`, `tool-executor dry_run`, `tool_stats` rows, `hitl list`, `job-manager`; phase 3
  `tool-provider`.
- Offline jobs are platform schedules (plan-17), operated through the platform (moco UI
  Schedules, `moco schedule`), so `agent-admin` has no scheduler area and no liveness ping.
  **Never** the live entity
  (P4), except `resolve_pending`, which emits a `user_message {action}` event, and `delete_session`
  / retire, which signal it.

## 4. Reuse

| From | To |
| --- | --- |
| `moco-agent-cli.yaml` — deterministic entity id, emit `user_question`, wait for `agent_answer`, throwaway session id for one-off questions | `agent-cli` (add `agent_id`, `message_id`, `action`) |
| `agent-admin.yaml` (1800 lines, monolithic) | split into per-area wfspecs; every op now takes `agent_id` |
| `sitemap-probe.yaml` usage in admin | `admin.knowledge check_sitemap` |

## 5. Implementation steps

1. **`agent-cli`** (phase 0, plan-00a): default `agent_id` from a deployment constant;
   `question` alias; mint `session_id` if absent and mark the session **throwaway** (short
   retire, F25); mint `message_id` if absent; workflow id
   `agent-session-<agent_id>-<uid>-<sid>`; start-or-signal `user_message`; `wait_for`
   `agent_answer` with `match_expression` on `message_id` (P16), 120s.
2. **Output contract** (§6.15.1) + compatibility fields `sources_urls`, `question_count` for one
   major version. On `wait_for` timeout: `status: error` + `workflow_id` + `message_id`; the turn
   continues and appears in `get_session` later.
3. **Async results (F12)**: while `job.status` is non-terminal the client polls `agent-admin
   get_session`; `debug_mode` + `GET /events/{trace_id}` is the optional fast path.
4. **`agent-admin` dispatcher**: validate `op` against a literal table per area; resolve the
   definition once for `access` checks (admin ops need `access.admin_user_ids`).
5. **Phase-1 areas**: agents (`list_agents`, `get_definition`, `validate_definition`); config
   (`get_config`, `save_config`, `reset_config`, `list_models`); sessions (`list_sessions`,
   `get_session`, `rename_session`, `delete_session`, `submit_feedback` → phase 2 behaviour);
   knowledge (`list_sources`, `register_source`, `reindex_source`, `delete_source`,
   `move_source`, `check_sitemap`).
6. **Phase-2 areas**: memory, tools (no `set_tool_pref` yet), pending (`resolve_pending` via
   event), usage (`usage_report` with the degraded-classifier flag and tool rejection rates from
   `tool_stats`).
7. **Phase-3 areas**: jobs, tool providers, `set_tool_pref`.
8. Old UI compatibility: map old op names used by `moco-apps/moco-agent-ui` to new ones for one
   major version (list them from the old `agent-admin.yaml`).
9. **The harness UI** (`moco-agent/ui`, F32 resolved): a port of `moco-agent-ui` onto the new
   contract, the old app left untouched. **Done** (2026-10-07): one API module unwraps the
   `{ok, data, error}` envelope (an `ok: false` becomes a typed error carrying `code`); an agent
   picker (`list_agents`) sits above every page; chat sends its own `message_id` and renders
   cited sources, route and status; conversations are per agent; knowledge = `list_sources`,
   `register_source`, `reindex_source`, `delete_source`, `check_sitemap`; settings edit the user
   tier (catalog models, persona, profiles) and, for admins, patch the agent tier. Backend
   additions it needed: `get_config` returns `role` (access identify), `tiers` and
   `user_settable`; `list_sources` rows carry `table_name`, `embed_model_info`, `updated_at`;
   `check_sitemap` returns every probe as `checked`; and agent-config resolve gives a user- or
   session-picked catalog model its provider's endpoint and key (without it, a model from
   another provider was sent to the agent tier's endpoint). Feedback thumbs wait for phase 2.
   Harness 0.3.3: each assistant transcript entry keeps the asking agent-cli run's
   `workflow_id`, so a restored answer keeps its trace link (the transcript is display-only;
   the model reads `context.recent`).
   Harness 0.3.7: Settings edit all four model roles (inference, decision, classifier,
   embedding). Users pick catalog models (and a catalog endpoint where the provider has several);
   admins get free-form per-role fields at the agent tier (model, endpoint, secret name, plus
   max_tokens/temperature, embed_dim, classifier enabled/timeout).
   Harness 0.3.8: every role always shows all its details. Users may also set the secret name
   (every role) and max_tokens / temperature (inference, decision); the model and endpoint stay
   catalog-only. Admin fields stay editable after a catalog pick.
   Harness 0.3.9: one editor (`ModelRoleEditor`) for both tiers — a catalog provider or
   Custom, every field editable, per-role Save and reset. Users may now set custom models and
   endpoints too (user's choice, accepted risk in design §6.1.1); the session tier stays
   catalog-only.

## 6. Tests

`workflow/tests/` (flat). **Done**: `agent-admin.test.yaml` (5: routing, old op names and the
`operator` key, unknown op, build ops not available), `admin.agents` (2), `admin.areas` (4,
sessions), `admin.knowledge` (3), `admin.config` (3). Live: every phase-1 op on the dev stage, incl. old-UI
`list_domains`, `check_sitemap` finding `/docs/sitemap.xml`, and `delete_session` retiring the
live entity (`stop_reason: retire_requested`) with its rows gone.

- `agent-cli` contract test incl. compatibility fields; `question` alias; timeout path; queued
  message with `message_id` correlation.
- `agent-admin`: unknown op → `ok: false, code: unknown_op`; admin-only ops by non-admin →
  `forbidden`; each op delegates to the right owner (mocked by `task_name`).
- `resolve_pending` emits an event instead of calling `hitl resolve`.
- Old-UI op name mapping.

## 7. Phase split

- **Phase 0**: `agent-cli` (plan-00a).
- **Phase 1**: compatibility fields; admin areas agents/config/sessions/knowledge.
- **Phase 2**: memory, tools, pending, usage, feedback. **Status (2026-10-12):** all five areas in
  agent-admin (admin.tools, admin.pending, admin.memory, admin.usage, sessions submit_feedback);
  agent-cli passes pending_action. Open: agent-cli `overrides` (session_overrides).
  The per-admin-call scheduler ping is dropped: platform schedules need no liveness (plan-17).
- **Phase 3**: jobs, tool providers. **UI step 1 (2026-10-16, harness 0.9.4–0.9.7):** turn
  progress in the chat's typing indicator (per-turn relay through agent-cli + the
  `/api/workflow/events` stream), knowledge refresh controls (Refresh, `refreshing` badge, last
  refresh error, Auto refresh interval), and a Memory page (the caller's own items by kind; edit,
  forget, keep/discard a conflict). Verified in headless Chrome against the dev stage.
  **UI steps 2-3 (2026-10-17):** chat approval buttons (approve / approve for this session /
  reject, via agent-cli's `action`) and 👍/👎 (`submit_feedback`); Memory → Proposals (admin);
  a Tools page (tools with each one's permission and the caller's preference; Providers tab for
  admins: preview, register with an allowlist, sync, drift accept/reject, enable/disable); an
  Activity page (Jobs: the caller's background jobs, answer / revise / cancel; Usage). All but
  the jobs actions verified in headless Chrome (no job ran on the stage; the agent worker that
  runs the builder was down).
  **2026-10-20 → 27:** Tools → Agent toolsets (save the agent tier's `toolsets`, reset to the
  definition) and provider Edit (`update_provider`). Both verified in headless Chrome on
  2026-10-27: an unticked toolset persisted across a reload and left the next turn's selector;
  Edit → Save re-imported and kept the provider `ready`. The jobs actions are still unverified,
  for the same reason (the agent worker was not running).

## 8. Risks & open issues

- **F70 (resolved, 0.14.0)**: agent-cli passes `setup` through; the UI shows a setup checklist (chat welcome screen, Settings), stores a missing key in place (`sys.secret upload`, encrypted in the browser, crypto ported from moco-ui), an "Ask again" action, and the classifier's worker-default checkbox.
- Phase 0 (done): `agent-cli` stamps `sent_at` on every `user_message`, which the session uses
  for queue depth (F35). It passes the session's `timing` through (M4) and, on timeout, returns
  `session_workflow_id`. `emit_event`/`wait_for` cannot be mocked: the P16 match is proven by a
  fixture in `workflow/tests/fixtures/`. Entry points are run package-qualified,
  `agent-harness/agent-cli`.

- `message_id` is a contract addition. The old UI ignores it safely; a new UI should send its
  own `message_id` so retries are idempotent.
- §20 Q10 resolved: the harness UI (`moco-agent/ui`, step 9) speaks the new contract only, so
  the compatibility layer (step 8) lives only as long as `moco-apps/moco-agent-ui` is deployed.
  `move_source` still answers `not_available`, so the new UI offers no move.
- §20 Q13 (agents as MCP tools via moco-server) would sit beside `agent-cli`; out of scope here.

## 9. Done when

Phase 1 exit (§19): the old UI works against moco-assistant through `agent-cli` / `agent-admin`
compatibility fields. The harness UI (`moco-agent/ui`) chats with, and administers, every
deployed agent.
