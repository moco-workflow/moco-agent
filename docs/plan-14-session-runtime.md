# Plan 14 — Session runtime & turn pipeline (`agent-session`, `session-store`, `conversation-compactor`)

Design: `design.md` §6.10 (all), §4.3 (concurrency, versioning), §3 P4/P5/P6/P15/P16, §5.4,
§8.1, §9, §11.2, §12. Overview: [plan-00](plan-00-overview.md).

## 1. Scope

Own one conversation with one agent:

- the entity lifecycle (init, idle checkpoint, retire, **upgrade-on-idle**, throwaway retire);
- turn serialisation with `message_id` correlation and a depth-1 queue;
- the **turn pipeline** (preparing → routing → assembling → running / resuming / clarifying →
  finalizing → delivering);
- **conversation memory and its compaction** (moved here from plan-07, F22/F34);
- **usage, cost limits and feedback** (the folded telemetry module, S9);
- relaying job events, and the persisted record.

It is the integration point of the harness and exists from phase 0 (plan-00a).

Out of scope: everything it orchestrates (other plans); the client entry point (plan-16).

## 2. wfspecs to create

`workflow/src/` (flat, F41). **Built** (2026-10-06): the phase-1 turn pipeline (steps 6–13, 15–17),
`session-store` `list` / `get_turns` / `delete` / `put_context`, `conversation-compactor`
(`compact` and `title`), and `agent-config version` for the per-turn check. Left: `rename` is
`patch_meta {title}`; the delete cascade (memory, hitl, jobs) arrives with those modules;
`turn-finalize` stays inside the session as `finalize-turn`; cost checks are phase 2 (step 22).

| wfspec | Modes / events | Owns |
| --- | --- | --- |
| `agent-session.yaml` | entity; events `user_message`, `subagent_event`, `compacted`, `idle_tick`, `retire` | in-memory: definition, `resolved_refs`, config, `meta`, conversation, pending summary, `queue`, agent-scope memory snapshot, `tag_vocabulary`, `turn_ctx`; `usage_day:<date>` rows |
| `session-store.yaml` | `create`, `get`, `list`, `patch_meta`, `commit_turn`, `put_context`, `get_turns`, `submit_feedback`, `rename`, `delete` | `session:<sid>:meta` / `turns[:<page>]` / `context` / `toolcalls` / `feedback:<turn>` |
| `conversation-compactor.yaml` | detached; emits `compacted` | — |
| `turn-finalize.yaml` | helper | result normalisation, fixed apology text, status mapping |

## 3. Dependencies

Calls, by state: `agent-config` (plan-04); `context-builder` (plan-08); `knowledge catalog`
(plan-06); `profile-availability` + `query-router` (plan-09); `memory` (plan-07);
`profile-runner` (plan-11); `hitl` (plan-12); `job-manager` (plan-13); `hook-runner` (plan-03);
`guard check_input` (plan-05); `access` (plan-04); `tool-policy grant` (plan-10); `llm-invoke`
(title, compactor); `builtin.deploy.query.get_latest_package` (upgrade check).

Called by: `agent-cli` (start-or-signal + `wait_for` on `message_id`), `agent-admin` (session
area via `session-store`; `resolve_pending` via a `user_message {action}` event), `job-entity`
events, the compactor (`compacted` event).

## 4. Reuse

| From | To |
| --- | --- |
| `moco-agent-session.yaml` — entity skeleton, rehydration, idle checkpoint, event handling, summary trimming | `agent-session` + `conversation-compactor`, **rewritten** to be definition-driven and profile-agnostic |
| `session-store.yaml` — id guard, namespace, key format, topics, `feedback_save` | `session-store` rewritten: turns/context split, one `commit_turn` write, `submit_feedback` |
| `moco-agent.yaml` supervisor | **dropped**: reaping → janitor (plan-17); `reload_config` → `config_version` check |

## 5. Implementation steps

### Phase 0 (plan-00a) — implemented

1. `session-store` `create` / `get` / `commit_turn`, with `schema_version` on every row, plus
   `patch_meta` (brought forward from phase 1: retiring sets `status: retired`, and a new
   message reactivates it; the transition is checked).
2. Entity skeleton: `init → idle → running → delivering → idle`, `retiring`; idle checkpoint;
   `idle_tick` retire (incl. `retire_throwaway_after_idle_sec` for `meta.throwaway`).
3. `message_id` on `user_message` and `agent_answer`; queue depth 1; `busy` beyond it. There is
   no in-memory queue (F35): a message that arrives mid-turn waits in the signal buffer, and
   `receiving` answers `busy` when its `sent_at` predates the start of the previous turn.
4. **Upgrade-on-idle** (§4.3): on `idle_tick`, compare the running harness version constant
   with the deployed one; if they differ and nothing is in flight, end without retiring
   (`meta.status` stays `active`). Continue-as-new was checked and does *not* switch versions.
   The version is the targeted **package** version (`get_targeted_wfspec_version`, keyed by
   package name), read in `init` and on each tick by the `deployed-version` probe running as a
   `sync` child (F39). `get_latest_package` is not stage- or targeting-aware.
   **Superseded in 0.11 (F66)**: the entity stops once idle `session.idle_stop_sec` (600 s)
   with no active job -- curator flush and episode first, row left `active` -- and the next
   message boots the deployed packages; the janitor retires the row later (design §4.3).

### Phase 1

5. Remaining `session-store` modes: `list`, `patch_meta` (usage additive), `put_context` (entity
   only), `get_turns` (500/page), `rename`, `delete` (cascades `memory retire_by_session` from
   phase 2, `hitl cancel`, `job-manager cancel`). Readers accept rows without `schema_version`.
6. **`init`**: `agent-config resolve` (definition + `resolved_refs` + config); `session-store
   get/create`; `hitl get`; `job-manager reconcile` (phase 3); agent-scope memory snapshot and
   `tag_vocabulary` (phase 2; capped at 500); expire a due pending action.
7. **`preparing`**: config version check (re-resolve on mismatch); **cost check** (below);
   `context-builder conversation`; `knowledge catalog`; `profile-availability`; `guard
   check_input` if enabled.
8. **`routing`**: `query-router`.
9. **`assembling`**: `memory recall` (phase 2); `context-builder assemble` with
   `conversation`, `pending_action`, `jobs` as input (F8).
10. **`running`**: `profile-runner` with `budget_sec = min(profile.budget_sec,
    limits.turn_budget_sec − elapsed_since_message)`.
11. **`clarifying`**: `result = {status: clarify, answer: clarify.question}`.
12. **`finalizing`**: normalise via `turn-finalize`; fixed apology on `error`.
13. **`delivering`**: emit `agent_answer {message_id, ...}`; `session-store commit_turn`
    (transcript, context, meta incl. usage, tool-call `audit` records); `usage_day` counter
    update; spawn the compactor / title when due (detached). A failed write is retried once, then
    `meta.write_failed`.
14. **Usage** (§6.10.5): every child returns `usage`; a pure merge in `turn_ctx`, incl.
    `decided_by` per qset.
15. **Conversation compaction** (§6.10.6): when `recent` exceeds `summary_trigger_tokens`, spawn
    `conversation-compactor` with the current context. It emits `compacted {summary,
    upto_turn}` with plain `emit_event` (not start-or-signal). The entity applies it in `idle`,
    or holds it and applies it in `delivering` during a turn, only when `upto_turn` is newer. On
    failure, keep `recent` up to 2× the trigger, then drop-trim and set `summary_degraded`.
16. **Title**: after the first delivered turn, `prompt.session.title` runs detached; until then
    the title is the first message clamped to 60 chars.
17. **Guests**: only `access.guest_profiles`; no memory `record`, no feedback.

### Phase 2

18. Hooks: `turn.received` in `preparing` (patch `message`, may block → the reason is the
    answer); `answer.ready` in `finalizing` (patch `answer`, `sources`).
19. **`resuming`**: `hitl resolve` → `profile-runner` with `resume`; `approve_session` →
    `tool-policy grant` first. `finalizing`: `hitl open` on `needs_approval`.
20. **Explicit handoff**: re-dispatch once if the target profile is available and its
    `estimated_sec` fits the remaining budget; otherwise deliver the first answer with a
    slash-command hint (F10).
21. **Memory**: `memory touch used_memory` and `memory record` (curator) every
    `curate_every_turns` turns, on 👍 and on the `states_preference` signal. The session records
    `last_curated_turn` itself. On retire: `memory record {trigger: retire}`.
22. **Cost limits** (§6.10.5): in `preparing`, read `usage_day:<today>`; over
    `user_daily_turns` / `user_daily_tokens`, or `config:limits.paused` set by the janitor's
    agent-wide rollup → fixed "limit reached" answer with no model call.
23. **Feedback**: `session-store submit_feedback` writes the row and calls `memory feedback`
    (👎) or `memory record {trigger: feedback}` (👍). Implicit feedback (`negative_feedback ≥
    0.8`) is recorded as `source: implicit`, and changes memory only when
    `decisions.feedback.implicit_enabled`.

### Phase 3

24. **`relaying`**: on `subagent_event` for a known job — `progress` updates meta only;
    `pending_action` → `hitl open` + a transcript turn; `complete` → transcript turn +
    `mark_delivered`. No client waits on these (F12). `finalizing` starts jobs from
    `job_request` (F6). **Done** (2026-10-14): `relaying` is entered from `init` (reconcile) and
    on `subagent_event`, reads the rows (never the event), commits finished jobs as
    assistant-only turns before `mark_delivered`, opens a job's question unless an action is
    already held; `resuming` sends the answer to the job (reject → cancel); `meta.jobs` mirrors
    the active jobs and blocks retirement; unit cases `plan-relay`, `finish-relay`,
    `finish-job`, `finish-job-resume`, `decide-tick`.
25. `record_episode` on retire; the `progress#` channel (§11.4).

## 6. Tests

`workflow/tests/` (flat). **Done** (phase 1): `agent-session.unit.test.yaml` (33: routed budget,
clarify recorded and remembered, compaction overflow, `apply-compacted` newer-only, action
messages), `session-store.test.yaml` (29), `conversation-compactor` (3 + 2 unit). Live on the dev
stage (`p1-e2e-1`, 8 turns): rag answers with citations, a pronoun follow-up rewritten, the
title generated by the detached job ("Configuring Moco Activity Retry Policies"), a timed-out
profile answered with the apology and kept out of `recent`, and the first exchange compacted
into the summary (`summary_upto_turn` 8) and applied in `idle`.

**Design choices made while building:**
- Compaction runs whenever exchanges fall out of `recent` (the `recent_turns` window), not on a
  separate token trigger; the compactor folds exactly the dropped exchanges.
- The title job answers with a `titled` event and the entity writes it (one live writer, §4.3).
- Every child call in the pipeline has `on_error: {catch: true}` and a degraded fallback (default
  profile, minimal bundle, empty catalog): an error in a session task would end the entity.

- `session-store`: each mode; `commit_turn` writes transcript, context, meta and toolcalls
  together; paging; delete cascade calls; reading a v0 row.
- Lifecycle table (§6.10.2): every row, incl. queue full → `busy` with the right `message_id`;
  pending expiry on idle tick; retire with and without an active job; throwaway retire;
  upgrade-on-idle ends without `retired`.
- Turn pipeline with every child mocked by `task_name`: profile path, pending_reply path,
  clarify path, handoff (fits / doesn't fit), profile error → apology + turn still persisted,
  hook block at `turn.received`, cost limit → refusal with zero model calls.
- Compaction: `compacted` with an older `upto_turn` is ignored; `compacted` during a turn is
  applied in `delivering`; compactor failure → degraded path.
- Budget: the profile's `budget_sec` shrinks by the time spent in preparing and routing.
- Rehydration: stop after `delivering`, restart → identical state from persist_state.
- Model-call accounting for §9's example turn: 1 classifier + 1 decision + 1 inference + 2
  classifier.

## 7. Phase split

- **Phase 0**: steps 1–4.
- **Phase 1**: steps 5–17.
- **Phase 2**: steps 18–23. **Status (2026-10-12):** step 19 implemented and verified live
  (pending reload in `init`, router `pending_reply`, `resuming` → `hitl resolve` → `tool-policy
  grant` → resume, `hitl open` in finalizing, expire on idle_tick, audit rows and
  `meta.tool_counts`, `ping` for the janitor's probe, `has_tools` for availability). Open: 18
  (hooks), 20 (handoff), 21 (memory), 22 (cost limits), 23 (feedback).
  **Update (2026-10-12):** steps 18-23 all implemented (unit suite 55 cases): hooks, handoff (once,
  estimated_sec), memory, per-user cost limits + the agent-wide pause, explicit and implicit
  feedback (session-store submit_feedback), check_input, `kind: wfspec` profiles via run-profile.
- **Phase 3**: steps 24–25. **Status (2026-10-16):** done. `record_episode` on retire (0.7.0)
  and the progress channel (0.9.0): `progress#` with a `stage` at received, routed, running,
  answered (session) and searching, thinking, calling (loop); seen live on the debug feed. The
  harness UI does not render it yet.

## 8. Risks & open issues

- **F70 (resolved, 0.14.0)**: `classify-setup` turns a setup failure (auth / unconfigured, or a profile or retrieval error matching `session.setup_patterns`) into `session.setup_text` + hint and a `setup` field on the answer event and transcript entry; unit suite `agent-session.setup.unit`.
- **F47 (open, L since 2026-10-18 -- a dev-machine limit; add worker instances): low concurrency
  tolerance on the dev worker.** Two or three active sessions
  turning at once pushed entity workflow tasks past the 10 s workflow-task timeout; retries back
  off ~2 min, so answers arrive after the client's 120 s wait (the turn is still persisted). A
  long-lived session's post-eviction workflow task took 54.7 s. Candidate fixes, to measure
  first: bound the entity's history (`checkpoint_policy.event_count`), or move preparing →
  finalizing into one `sync` "turn" child so the entity's history grows by one child per turn
  and replay stays cheap (the cost: ~0.2 s per turn, M2). See plan-00 F47.

- **Per-turn `config_version` check** (§6.1.2): a full `agent-config resolve` costs two `sync`
  catalog calls via `agent-registry load`. Check only the two tier rows' versions each turn, and
  re-resolve when they change; package redeploys are already caught by upgrade-on-idle (plan-04 §8).

- **F35 (resolved)**: the design's in-memory queue could not exist. The pipeline states added in
  phase 1 (`preparing`, `routing`, ...) sit between `receiving` and `delivering`, and every turn
  must start from `idle`, because automatic chains refuse to revisit a state.
- **F38 (resolved)**: every budgeted `sync` child (profiles; phase-1 router, context, ...) is
  called by a task with `on_error: {catch: true}`, which catches the timeout raised in the
  parent. A `sync` call without it would fail the entity when its timeout fires.
- **F41**: `session.checkpoint_sec` (240) must stay below `session.idle_tick_sec` (300),
  because every tick leaves `idle` and cancels the checkpoint timer. Timestamps are compared
  with tzinfo stripped: a naive and an aware datetime cannot be subtracted, and a diagnostics
  field must never fail a turn.
- Phase-0 choices: a failed exchange is persisted (with the apology) but not added to `recent`;
  when retire and upgrade are both due, the entity retires; `agent_answer.timing`
  (`wait_ms`, `run_ms`, `turn_ms`, `budget_sec`) feeds M4 and the §12 table.

- Upgrade-on-idle reads the deployed package version on every tick: one `sync` child per tick
  (M2 prices it). Cache it for a few minutes if that proves costly.
- A depth-1 queue still means a queued caller usually times out (P6). That is accepted, and the
  answer appears in `get_session`. Phase-0 M6 verifies the queue survives the idle checkpoint.
- P6: every synchronous turn must finish in ~110s; `turn_budget_sec` and the §12 table come from
  phase-0 M4.
- Cost-limit defaults are placeholders (open question 14).

## 9. Done when

Phase 0: plan-00a's exit. Phase 1 exit (§19): moco-assistant reaches parity with the old rag path
through `agent-session`, and a minimal second agent runs with no change to this wfspec. Phase 2:
approve-and-resume survives a retire; cost limits refuse without a model call. Phase 3: an async
job's completion is relayed after the session retired.
