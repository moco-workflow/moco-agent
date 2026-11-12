# moco agent harness — Implementation plan overview

Companion to `design.md` (draft v4.3). One plan file per top-level module (§4.1), numbered in
**build order**: a module only depends on lower-numbered plans, so the files can be implemented
top to bottom. Each module plan uses the same nine sections: Scope, wfspecs to create,
Dependencies, Reuse, Implementation steps, Tests, Phase split, Risks & open issues, Done when.

**Phase 2 status (2026-10-12):** implemented and deployed (harness 0.5.0); all four §19 exit
checks verified live. Open in phase 2: classifier evaluation (plan-18 step 9), memory caps/decay
and turn-page archive (plan-17), agent-cli `overrides`, F47 (worker concurrency) and the platform
findings F50-F52 (F50 closed and F51 obsolete since 2026-11-09).

**Phase 3 status (2026-10-14, in progress, harness 0.6.2):** plan-13 job manager built
(`job-store`, `job-manager`, `job-entity`, `job-signal`) and wired into the session (`init`
reconcile, `relaying`, `finalizing` start, `resuming` reply → `send` / reject → `cancel`, no
retire while a job is active, a finished job drops the action it held, delete cascade); the
janitor's stuck-job sweep (plan-17); the admin jobs area (`admin.jobs`; the old UI's build ops
mapped onto it); plan-18 step 8 `builder` (moco-assistant 1.5.1). Verified live on the dev
stage, with a session-started builder job: plan → plan_review relayed and opened → approve →
implement → result relayed as a turn (`delivered_at`, `meta.jobs` empty); reject; revise →
revision 2; admin `cancel_job` → cancelled turn, stale action cancelled. Async tools (plan-10
step 14) built; verified live through a `tool-job` dispatching `http.request` inside a job.
**2026-10-15 (harness 0.6.3):** platform schedules replace the `agent-scheduler` entity
(design §6.16, P13, F23): `agent-schedules` installs `agent-harness.janitor`, `.tool_stats`
(hourly) and `.keep_warm` (every 5 min, installed paused) in the namespace owning the harness;
`seed-tools` calls it instead of pinging the entity. Verified live on the dev stage: the install
created the three, a triggered janitor fire retired 9 sessions whose entities a worker restart
had killed (the old entity had died with them), and a re-install (and a `seed-tools` run) kept
an admin's resume of keep-warm.
**2026-10-16 (harness 0.7.1):** knowledge refresh and episodic memory. Refresh keeps a source
serving (F58): `knowledge refresh` indexes the other table of the source's pair (`kb_` ⇄
`kbr_`) while the row stays `ready`, then swaps; the hourly `knowledge-refresh` schedule
refreshes shared sources whose `refresh.every_hours` is due; admin `refresh_source` /
`set_source_refresh`. Episodes: on retire the session calls `memory record_episode`, which
digests the conversation (`prompt.episode.digest`, detached `memory-episode`) into one
`episode` item per session; the router offers `refers_to_past` when
`long_term.episodes.enabled`. Full suite 951 cases (6 prompt-catalog fixture failures fixed, their suites re-run green). **Verified live (0.7.1)**: a private source
refreshed from `kb_…` to `kbr_…` while staying `ready`, new content in, old table dropped; a
refresh against a dead URL kept the source `ready` on its data with `refresh_error`, shadow
dropped; the `knowledge-refresh` job found a due shared source, skipped it as `unused`, then
refreshed it through `skeleton` once listed, and a second run was a no-op. A two-turn
moco-assistant session retired by event wrote its episode (`episode_upto_turn: 2`); a new
session asking "last time we talked about retries…" scored `refers_to_past` 1 and used the
episode; deleting the session retired it. The schedule install found **no** existing harness
schedules: they are Temporal-held, so a reset Temporal dev server loses them until the next
`agent-schedules install` (or `seed-tools`).
**2026-10-16 (harness 0.8.0 → 0.9.0): the rest of phase 3.** Memory promotion (`memory-promote`,
daily `memory-promote-all`, admin proposal ops; `memory-store` admin `owner_user_id`,
`session-store list_users` -- both removed in 0.15.0, F50), the janitor's memory caps and lazy decay (a phase-2 leftover the owner
override unblocked; since 0.15.0 in `session-housekeep`), per-user tool preferences (`tool-policy set_pref` / `clear_pref` /
`list_prefs`), MCP tool providers (`tool-provider`, `tool.mcp-call`, hourly `tool-provider-sync`),
the five deferred hook events, the progress channel (`progress#`), the legacy-domain migration
(`knowledge-migrate-legacy`), and vector recall (`memory-vector`, on the new moco-core
`llama_index.index_texts` / `delete_docs`; off by default). **Verified live (0.9.0):** proposal
list / approve / reject (System One confirmation verified once moco-systemone was up, F60), tool preferences, the whole
provider lifecycle against a local MCP server (preview, allowlisted import, call, no-op sync,
drift disabling only the changed tool, accept, disable), and progress events on the debug feed.
After a machine restart picked up the new moco-core activities, vector recall was verified live
too (upsert, search filtered to the caller, delete; harness 0.9.1 lowers the provisional
`min_score` to 0.45 after the dev model scored a relevant item 0.48 and an unrelated one 0.39).
The same restart dropped every schedule (F61; reinstalled). **0.9.2 → 0.9.3:** moco-assistant now runs
with the classifier on at 20 s (verified live: a rag turn with all 8 decisions from System One, no
degraded checks, 16 s). That exposed `decide`'s fixed 10 s / 30 s × 2 variants, built on P20's
"activity timeouts must be literals" -- which turned out false (F37): 0.9.3 uses one classify task
with the configured budget, `llm-invoke` honours `timeout_sec`, and the loop passes its remaining
budget to every model call. **0.9.4–0.9.7:** progress relayed per turn through agent-cli (the
UI's typing indicator shows it), `list_sources` carries the refresh state, and a delete-triggered
retire skips curation and the episode (F62). UI step 1 (progress, refresh controls, Memory page)
verified in a headless Chrome against the dev stage. **UI steps 2-3 (2026-10-17):** chat
approvals and feedback, memory proposals, Tools (preferences, providers) and Activity (jobs,
usage) pages; verified in the browser except the job actions. Not live: hooks (no hook extension
deployed; unit-tested). `plan_execute` stays deferred: no agent needs it, and it
would need plan state across HITL suspend/resume. Next: F47, the harness UI for the new admin
ops (proposals, providers, tool prefs), then the open phase-2 items. Findings F54-F65.
**2026-10-17 → 18 (harness 0.10.0 → 0.11.0): F66.** The harness is one package per module (§4; a run fetches only the packages it touches: agent-cli's history 2.37 MB → 39 KB), and the session entity stops 10 min after going idle instead of probing for upgrades. Verified live: full suite green per package, answer set 12/12, every admin area, a builder job through job-entity, schedules re-targeted, an idle stop that wrote the episode and left the row `active`, and a resume after it with the history intact.
**2026-10-18 → 20 (harness 0.12.0 → 0.13.0, `-tools` 0.14.0): tools from the platform.** A session delete retires the memory no remaining session backs (F65, session/memory/foundation 0.12.0); `deployed-version` removed. Tool providers gained kinds `activity` (moco activities, from moco-core's new `builtin.activity.list_manifests`) and `workflow` (deployed workflows declaring `header.metadata.tool`), F67; activity tools are clamped to a per-type minimum side effect kept beside the allowlist in `tool-registry` (F68). An admin picks an agent's toolsets with no republish (UI Tools → Agent toolsets, a `save_config` at scope `agent`), and `tool-provider update` edits a ready or failed provider in place, re-importing as `enable` does. Verified live: F65's two-session delete, F68's `sql.execute` clamp. Verified in headless Chrome (2026-10-27): Agent toolsets untick → save → reload persisted, `get_config` agreed, and the next turn's selector no longer offered the workflow tools (restored after); a provider Edit → Save ran `update_provider`, re-imported and stayed `ready`. **2026-10-27: deferred hook events live.** moco-assistant 1.6.1 declares an observe-only `hook.moco.trace` on the five; all fired, after F69 (foundation 0.13.1: the loop could not resolve a bare hook name, so tool hooks never ran). Still not browser-verified: the job actions (builder jobs need the agent worker).
**2026-10-27 (harness 0.14.0): first-run setup (F70).** `model-readiness` / `get_readiness`, the session's setup answer and `setup` reply field, the classifier off unless stated (`worker_default`), and the UI setup checklist with in-place key upload. The dev stage's three agents state `worker_default: true` at the agent tier.
**2026-11-09 (harness 0.15.0): F50 closed, no cross-user state.** moco-core rejects `:` in a `builtin.state` namespace, so `in_global_ns: true` + `<uid>:…` no longer reaches another user's rows, and the admin `owner_user_id` on session-store, hitl, job-store and memory-store is gone. Per case (design §6.16): reaping, due-pending expiry, retention and memory caps/decay run as the user in the new `session-housekeep` (detached at every idle stop; lazy); stuck jobs are failed by `job-manager reconcile` at session start; cross-user aggregates read global rows keyed by user, control data only (`usage_day:<day>:<uid>` in `agent.<id>.usage`, `tool_audit:<uid>:<sid>` in `agent.<id>.tool-audit`, and the opt-in promotion pool `pool:<uid>:<key>` in `agent.<id>.memory-pool`, new `memory.long_term.promotion`, default off). `agent-janitor` is now only the cost rollup; the `session_user` index and `session-store list_users` are removed (F51 obsolete).

Phase 0 comes before all of them: [plan-00a](plan-00a-walking-skeleton.md) builds a thin
end-to-end slice through plans 02, 04, 11, 14 and 16, and runs the measurements that later
phases depend on.

## 1. Module map

| Plan | Module | Layer | Design § | First phase |
| --- | --- | --- | --- | --- |
| [00a](plan-00a-walking-skeleton.md) | Walking skeleton + measurements | cross-cutting | 19 | 0 |
| [01](plan-01-prompt-manager.md) | Prompt manager | Foundation | 6.3 | 1 |
| [02](plan-02-model-layer.md) | Model layer (`llm-invoke`, `decide`) | Foundation | 6.2 | 0 (`llm-invoke`) / 1 |
| [03](plan-03-extension-registry-and-hooks.md) | Extension registry, profile library, hooks | Foundation | 5 | 1 (hooks: 2) |
| [04](plan-04-config-manager.md) | Access + config manager | Foundation | 6.1, 6.13 | 0 (defaults) / 1 |
| [05](plan-05-guardrails.md) | Guardrails (`guard`) | Agent | 6.13 | 1 |
| [06](plan-06-knowledge-manager.md) | Knowledge manager | Agent | 6.5 | 1 |
| [07](plan-07-memory-manager.md) | Memory manager (long-term) | Agent | 6.4 | 2 |
| [08](plan-08-context-manager.md) | Context manager | Agent | 6.6 | 1 |
| [09](plan-09-query-router.md) | Query router | Agent | 6.7, 7.2 | 1 |
| [10](plan-10-tools-manager.md) | Tools manager | Agent | 6.9 | 2 |
| [11](plan-11-agent-loop.md) | Agent loop | Agent | 6.8 | 0 (one step) / 1 / 2 (tools) |
| [12](plan-12-hitl-manager.md) | HITL manager | Orchestration | 6.11 | 2 |
| [13](plan-13-job-manager.md) | Job manager | Orchestration | 6.12 | 3 |
| [14](plan-14-session-runtime.md) | Session runtime, turn pipeline, compaction, usage & feedback | Orchestration | 6.10 | 0 (skeleton) / 1 |
| [15](plan-15-telemetry-feedback.md) | Telemetry & feedback — **folded into 14** (kept as a pointer) | — | 6.14 | — |
| [16](plan-16-interface-layer.md) | Interface layer | Interface | 6.15 | 0 (`agent-cli`) / 1 |
| [17](plan-17-maintenance.md) | Scheduler + maintenance | Offline | 6.16 | 2 |
| [18](plan-18-reference-agent.md) | Reference agent `moco-assistant` + `ops-assistant` | Agent packages | Part II | 0 (skeleton def) / 1 |

## 2. Build order and parallelism

```
 phase 0:  00a skeleton = 04 defaults + 02 llm-invoke + 11 one-step loop + 14 skeleton + 16 agent-cli
           + measurements M1–M6
 phase 1:  04 access ─▶ 01 prompt ─▶ 02 decide ─▶ 03 registry ─▶ 04 config tiers ─┬─▶ 05 guard ─────┐
                                                                                   ├─▶ 06 knowledge ─┤
                                                                                   └─▶ 09 router ────┤
                                                   08 context (needs 14's conversation row) ─────────┤
                                                   11 loop, no tools ◀─ 05, 06, 08 ──────────────────┤
                                                   14 full pipeline ◀─ all of the above ─────────────┘
                                                   16 admin areas, 18 moco-assistant parity
 phase 2:  07 memory · 10 tools ─▶ 11 tool loop ─▶ 12 hitl ─▶ 14 resuming · 03 hooks · 17 maintenance
 phase 3:  13 jobs ─▶ 18 builder · 10 providers · 07 episodes/promotion
```

- `access` is a Foundation wfspec with no dependencies, built first in phase 1. In v3 it lived
  in plan-05, after plan-04 which needs it (F24).
- After plan-04, **05, 06 and 09 can be built in parallel**. Plan-08 depends only on data shapes
  (the conversation row, the recall result), which can be mocked.
- Plan-14 exists from phase 0 as the skeleton, and every phase-1 module is wired into it as it
  lands. It is never a big-bang integration at the end.

## 3. Phase cross-walk (design §19 → plan)

| §19 item | Plan |
| --- | --- |
| **Phase 0** skeleton: agent-cli → agent-session → one profile → loop → llm-invoke | 00a (touches 02, 04, 11, 14, 16, 18) |
| measurements M1–M6 | 00a |
| **Phase 1** `access` | 04 |
| agent-registry + definitions | 03 |
| config tiers | 04 |
| `llm-invoke`, `decide` | 02 |
| prompt manager | 01 |
| full session runtime + turn pipeline, compaction, usage accounting | 14 |
| context manager with built-in providers | 08 |
| router pipeline | 09 |
| agent loop (no tools), `chat` + `rag` profiles | 11, 03 (profile library) |
| knowledge (pgvector) | 06 |
| guard (screen, output) | 05 |
| agent-cli, agent-admin (agents, config, sessions, knowledge) | 16 |
| conformance kit for profiles | 03 (kit harness), 11 (profile cases) |
| answer evaluation set, moco-assistant parity, minimal second agent | 18 |
| **Phase 2** tools manager (four-layer policy, selector, executor, artifacts, builtin tools) | 10 |
| tool-calling loop, `react` profile | 11 |
| HITL | 12 |
| long-term memory, curator, recall, `memory` profile, forget | 07 |
| feedback, cost limits | 14 |
| three hooks | 03 |
| `kind: wfspec` profiles (`claude`), explicit handoff | 11, 18 |
| `source.<kind>` wfspec retrievers | 06 |
| custom context providers | 08 |
| schedules (`agent-schedules`), janitor, retention, tool-stats rollup | 17 |
| ops-assistant with no new logic wfspecs | 18 |
| **Phase 3** job manager + builder, async tools | 13, 18, 10 |
| episodic memory, promotion | 07, 17 |
| knowledge refresh | 17, 06 |
| per-user tool preferences, MCP tool providers | 10 |
| deferred hook events | 03 |
| `plan_execute` as a `kind: wfspec` profile | 11 (deferred) |
| vector recall, private-table naming migration | 07, 06 |
| progress channel | 14 |

## 4. Package layout

```
moco-agent/
├── docs/                          # design.md, this overview, plan-00a … plan-18
├── workflow/                      # the harness: one package per module (F66)
│   ├── harness/                   # package: agent-harness — agent-cli, agent-admin, main
│   │   ├── moco.json              # sources: src/**/*.yaml, tests: tests/**/*.test.yaml
│   │   ├── src/*.yaml             # flat within the package
│   │   └── tests/*.test.yaml      # <wfspec>.test.yaml (integration), <wfspec>.unit.test.yaml
│   │       └── fixtures/{src,tests}/  # test-only wfspecs (never published)
│   ├── admin/                     # agent-harness-admin      admin.*
│   ├── foundation/                # agent-harness-foundation access, namespace-admin, agent-config,
│   │                              #   agent-harness-defaults, agent-registry, package-catalog,
│   │                              #   prompt-render, llm-invoke, decide, hook-runner, claude-capabilities
│   ├── prompts/                   # agent-harness-prompts    prompt.*, qset.*, profile.*
│   ├── session/                   # agent-harness-session    agent-session, session-store, hitl,
│   │                              #   conversation-compactor, session-probe, profile-availability
│   ├── loop/                      # agent-harness-loop       agent-loop, context-builder, query-router, guard
│   ├── tools/                     # agent-harness-tools      tool-*, tool.mcp-call, seed-tools
│   ├── knowledge/                 # agent-harness-knowledge  knowledge, source-registry, source.pgvector,
│   │                              #   knowledge-indexer, -index-run, -refresh, -migrate-legacy, sitemap-probe
│   ├── memory/                    # agent-harness-memory     memory, memory-*, profile-memory, seed-memory
│   ├── jobs/                      # agent-harness-jobs       job-manager, job-store, job-signal, job-entity
│   └── ops/                       # agent-harness-ops        agent-janitor, agent-schedules, keep-warm,
│                                  #   conformance-kit
├── agents/
│   ├── skeleton/                  # package: agent-skeleton (phase 0, plan-00a)
│   ├── moco-assistant/            # package: agent-moco-assistant (plan-18)
│   └── ops-assistant/             # package: agent-ops-assistant (plan-18, the "minimal second agent")
├── eval/
│   └── measure/                   # package: agent-harness-measure (phase-0 drivers M1–M6)
│                                  # + classifier and answer evaluation sets (plan-18)
└── scripts/                       # dev-stage.sh (publish + deploy + chat), measure.sh,
                                   # check-packages.py, check-prompt-catalog.sh
```

**Why one package per module (F66).** The engine loads a whole package whenever it resolves a
wfspec in it, and a break-away child (`sync`, `detached`, an entity) starts with an empty store:
as one package, every agent-loop, compactor, job, indexer and schedule run fetched, recorded and
parsed all ~95 harness files. Split, a run fetches only the packages it touches. Each new
package has a small main wfspec named after it; `agent-harness`'s main lists the set
(`packages`), and `scripts/check-packages.py` keeps the list honest.

**Refs.** A bare name resolves only inside packages already loaded in the run; otherwise the
engine looks it up as a *package*. So:

- a call into another harness package is **package-qualified**: `agent-harness-foundation/access`;
- a call inside the caller's own package stays **bare**: in `moco test` the bundle is registered
  under the tested wfspec's name, so a qualified ref to the own package would hit the deployed copy;
- names built in expressions are qualified too (the default profile wfspec
  `agent-harness-loop/agent-loop`, `job-signal`'s `session_wfspec`, a tool job's `wfspec`,
  `profile.memory`'s `profile-memory`, the schedule targets), and data that the caller's own
  package resolves (`tool.mcp-call` in provider manifests, `source.pgvector`) stays bare.

`scripts/check-packages.py` enforces all of it (one owner per wfspec name, a main per package,
every literal ref, every `agent-harness*/<name>` string in wfspecs, tests, scripts and the UI)
and exits non-zero on drift. Agent extensions (`subagent.*`, `hook.*`) stay bare: the agent
package is loaded by agent-registry in the same run.

**Flat within a package (F41).** The CLI's bundler (`moco run <file>`, unit tests) only
discovers child wfspecs in the *same directory*, the test runner only finds the wfspec under
test at `tests/../src/<name>.yaml`, and an integration test sends only that one directory. So
inside a package, `src/` stays flat. **A test sees only its own package**: a cross-package child
resolves to the package deployed on the stage (or is mocked by task name). Deploy the harness
(`scripts/dev-stage.sh harness`) before running `moco test`, and run it per package
(`cd workflow/<pkg> && moco test`). Test-only wfspecs live in `harness/tests/fixtures/src/`.

**Versions.** Each harness package has its own version; bump only what changed (a re-publish of
an existing version is silently ignored). The **harness version** is `agent-harness`'s:
`harness_version` and an agent definition's `harness: ">=x <y"` range refer to it, read by
agent-registry from the `agent-harness` catalog. Bump it when a cross-package contract changes.
Contracts between packages stay backward compatible within a major version (already required:
`sync` children resolve afresh, F39). A redeploy of any package reaches a live session at its
next idle stop (§4.3: the entity ends 10 min after going idle), so nothing needs to track which
packages a session pinned.

The module plans (plan-01 … plan-18, plan-00a) were written before the split and cite
`workflow/src/` and `workflow/tests/`: read those as the module's package directory above.

**Package naming (P21).** Every package needs a main wfspec named after it, and package names
cannot contain dots. Agent packages are therefore `agent-<agent_id>`, and the harness loads the
definition as `agent-<agent_id>/agent.<agent_id>`. Harness packages all start with
`agent-harness`, which agent-registry `list` excludes from the agents.

Harness and agent packages deploy into the **same namespace** (§17, P7). Local development
publishes both to a dev stage and runs entry points by name (§5.6). There are no generated
dispatch tables.

## 5. Shared conventions (every plan assumes these)

- **DSL v2** (`moco-core/docs/dsl/spec.md`): every harness and agent wfspec has `header` /
  `main`, no `wfspec_version` (the package version is the version), and named tasks. Failures
  that must become data are caught with `on_error: {catch: true}` on the task that fails,
  `sync` children included (P19). Code ported from the v1 parity baseline goes through
  `python -m scripts.dsl_convert --to v2` first (design §15).
- **Call envelope** (§4.3): `input: {mode, agent_id, ...}` →
  `output: {ok, data, error: null | {code, message, retryable}}`. Expected failures return
  `ok: false`; only bugs and misconfiguration raise.
- **Authority** is `__user_info__.user_id`, never an input.
- **One owner per key layout** (§4.3, §8). Other modules call the owner with a `mode`.
- **One live writer per row** (§4.3, P15): the session entity for its session rows, the job
  entity for its job row. Others send that writer an event. Background jobs touch only rows of
  retired sessions or long-term memory items.
- **Row state machine pattern**: every transitioning mode does `get → check status ∈ allowed →
  set`. Illegal → `ok: false, code: invalid_state`.
- **`schema_version`** on every persisted row. Readers accept the current and previous versions
  and upgrade on write.
- **Layering**: the Agent layer never calls the Orchestration layer. Anything that needs the
  session or the job manager is *returned* (`job_request`, `audit` records, `pending_action`) and
  the session acts on it.
- **Addressing**: workflow ids and namespaces from the §4.3 table; validate `agent_id`
  (`^[a-z][a-z0-9-]{1,31}$`) and `session_id` (`^[A-Za-z0-9_.-]{1,64}$`) at the owner.
- **Call depth** (design §4.3, M2): module calls are `inline` (~3 ms); `sync` (~0.2 s) only
  where a call needs its own timeout or failure isolation.
- **System One question caps** (design §7.3, M1): ≤ 10 questions per synchronous call, ≤ 20
  offline.
- **Logging**: `#`-suffixed variables for route, `decision#`, `usage#`, hook outcomes, dropped
  context (§11.3).
- **qsets** sort `state` and `questions` keys before returning (§6.3.2).
- **Tests**: `moco test` in the default workflow mode (Temporal); asserts use bare variables (not `__OUTPUT__`); mock
  `typesafe.system_one` and dynamic children **by `task_name`** (P7); a mock's raw output is `_`.

## 6. Design review findings

Severity: **H** = blocks a phase exit criterion or is a correctness/safety bug; **M** = must be
decided before the owning plan starts; **L** = doc fix. Status: **resolved** = folded into
`design.md` v4; **open** = still needs a decision or platform work.

### First review (of v3)

| # | Sev | Finding | Status | Plan |
| --- | --- | --- | --- | --- |
| F1 | H | No MCP tool-listing activity (only `mcp.call_tool`), so tool providers can't import or detect drift. | **Resolved (platform, P14).** `mcp.list_tools` returns tools with per-tool and snapshot hashes. Providers stay in phase 3 by scheduling; MCP tools until then are authored manifests with an `mcp` binding. | 10 |
| F2 | M | `builtin.state` has no compare-and-set; status checks race with other writers. | **Resolved** as P15 + the "one live writer" rules (§4.3). CAS stays on the platform wish list. | 07, 12, 13, 14, 17 |
| F3 | L | `graphql.` in the tool allowlist only offers `graphql.subscribe`. | **Resolved**: removed from the allowlist. | 10 |
| F4 | L | Credential-readiness check needs secret existence without the value. | **Resolved**: `builtin.secret.list` returns key names only (verified in `secret_activity_provider.py`). | 10 |
| F5 | M | `guard authorize` (Agent) called from Foundation owners. | **Resolved**: `access` is a Foundation wfspec (§6.13). | 04, 05 |
| F6 | M | `tool-executor` / async profiles call `job-manager start` (Orchestration). | **Resolved**: they return `job_request`; the session starts the job (§6.12). | 10, 11, 13, 14 |
| F7 | L | `feedback submit` (Agent) calls `session-store`. | **Resolved**: telemetry folded into the session runtime (§6.10.5). | 14 |
| F8 | M | `pending` / `jobs` context providers read hitl/job rows. | **Resolved**: passed in as input (§6.6.2). | 08 |
| F9 | H | Phasing: async tools before the job manager; phase-1 providers with no data. | **Resolved**: async tools in phase 3; providers without data return no block. | 08, 10, 13 |
| F10 | H | rag → claude handoff almost never fits the budget. | **Resolved**: implicit handoff removed; explicit handoff checks `estimated_sec`; claude reached by routing / `/claude`; claude timeouts derive from `budget_sec`. | 11, 14, 18 |
| F11 | H | Queued messages time out and can't be correlated. | **Resolved**: `message_id` + `match_expression` (P16), queue depth 1. | 14, 16 |
| F12 | M | Async result delivery unspecified. | **Resolved**: UI polls `get_session` while a job is active (§6.12). | 13, 14, 16 |
| F13 | M | HITL revise contradicts "at most one open". | **Resolved**: four statuses; decision is a field; revise resolves the row (§6.11). | 12 |
| F14 | M | `answering` can overrun the budget. | **Resolved**: hard timeout + `max_tokens` (§6.8.3). | 11 |
| F15 | L | `contract_version` in no contract schema. | **Resolved**: contract versioning deferred until external extensions exist (§5.5). | 03 |
| F16 | M | Recall lists up to ~1050 rows per turn; `tag_vocabulary` unbounded. | **Resolved in design, to be confirmed by M3**: session scope dropped, agent scope cached, per-kind `key_pattern` + `limit`; `tag_vocabulary` capped at 500. | 07, 09 |
| F17 | M | Shared `tool_stats` row written per call. | **Resolved**: no per-call writes, no circuit breaker; rollup from audit rows (§6.9.11). | 10, 17 |
| F18 | L | Harness defaults location, `retire_scope`, "pure" tool-policy, `gen-dispatch.py` location. | **Resolved**: `agent-harness-defaults`; `memory retire_by_session`; tool-policy described as function + store owner; gen-dispatch dropped. | 04, 07, 10, 03 |
| F19 | L | Cross-reference errors in §6.9. | **Resolved**. | — |
| F20 | M | `ask_user` and tool approval in one step. | **Resolved**: `ask_user` wins (§6.8.3). | 11, 12 |
| F21 | L | Redeployed definition doesn't bump `config_version`. | **Resolved**: hash includes the definition version (§6.1.2). | 04 |
| F22 | L | `memory` read/wrote the session-owned conversation row. | **Resolved**: conversation memory and the compactor moved to the session runtime (§4.1, §6.10.6). | 07, 14 |

### Second review (of v3 + plans)

| # | Sev | Finding | Status | Plan |
| --- | --- | --- | --- | --- |
| F23 | H | moco has **no scheduler**; every "scheduled" job had no trigger. | **Resolved**: first an `agent-scheduler` entity; since 2026-10-15 platform schedules, one per job, installed by `agent-schedules` (§6.16, P13; open question 16 resolved). | 17 |
| F24 | H | Build-order cycle: plan-04 needed `access` from plan-05. | **Resolved**: `access` moved into plan-04, built first. | 04, 05 |
| F25 | H | Throwaway sessions (guests, one-off CLI) leaked entities for 24h. | **Resolved**: `retire_throwaway_after_idle_sec` (default 600). | 14, 16 |
| F26 | H | No rule for upgrading live entities or row shapes. | **Resolved**: `schema_version` on rows; upgrade by ending an idle entity so the next message starts the deployed version (§4.3). Continue-as-new was checked and does *not* switch versions. | 14 |
| F27 | M | No cost controls. | **Resolved**: per-user daily caps + agent-wide pause (§6.10.5). Defaults are placeholders (open question 14). | 14, 17 |
| F28 | M | No retention policy. | **Resolved**: §8.1. Defaults are placeholders (open question 15). | 17 |
| F29 | M | Prompt name resolution probed for existence on every render. | **Resolved**: resolved once in `agent-registry load` (`resolved_refs`). | 01, 03 |
| F30 | M | Measurements that set budgets and caps were never scheduled. | **Resolved**: phase 0, M1–M6 (§19). | 00a |
| F31 | M | No answer-quality evaluation. | **Resolved**: answer evaluation set (§18). | 18 |
| F32 | L | `ui/` exists but no plan covers it. | **Resolved** (2026-10-07): open question 10 answered — `moco-agent/ui` ports `moco-agent-ui` to the harness contract; covered by plan-16 step 9. | plan-16 |
| F33 | M | `tool-executor` audited through `session-store` (Agent → Orchestration). | **Resolved**: the executor returns `audit` records, which the session writes in `commit_turn`. | 10, 14 |
| F34 | M | The detached compactor and the entity both wrote the conversation row. | **Resolved**: the compactor emits `compacted`, and the entity applies it with the `upto_turn` guard (§6.10.6). | 14 |

### Phase-0 implementation (of v4, while building the walking skeleton)

| # | Sev | Finding | Status | Plan |
| --- | --- | --- | --- | --- |
| F35 | H | A state machine handles one event at a time and runs a whole transition chain before reading the next (P17). §6.10.2's "enqueue during a turn" and "queue full → busy" rows could never fire. Automatic chains also refuse to revisit a state, so `delivering → running` for a queued message would raise. | **Resolved** in v4.1: the queue is the signal buffer; depth is enforced from `sent_at` timestamps (§6.10.2); every turn starts from `idle`. Implemented in `agent-session` `classify-message`. M6 now tests a checkpoint taken while signals are buffered. | 14, 16 |
| F36 | M | `openai.chat.completions` returns no `usage` and no `finish_reason` (P20), so usage accounting and cost caps (§6.10.5) have no real token counts. | **Open (platform)**: `llm-invoke` estimates tokens (chars / 4, `estimated: true`). Cost caps in phase 2 need the activity to return `usage`. | 02, 14 |
| F37 | M | An activity's `retry_policy.timeout_sec` must be an integer literal, and `tool_choice` cannot be templated (P20). `llm-invoke` cannot honour `timeout_sec`; the loop's `answering` hard timeout (§6.8.3) cannot be set per call. | **Resolved (2026-10-16), the timeout half was never true**: activity `retry_policy` fields take expressions (verified live: `timeout_sec: "{{ t }}"` timed out at t; `max_attempts` likewise). `llm-invoke` now bounds each request by `timeout_sec`, the loop passes its remaining budget, `decide` uses one classify task with the configured budget, and the builder's agent timeouts derive from its config. **Still open**: `tool_choice` cannot be templated (its schema has no expression form). | 02, 11 |
| F38 | H | A `sync` child's run timeout raises in the parent; `catch_exception` on the child does not cover it (P19). A slow profile would have failed the session entity. | **Resolved**: in v4.1 by wrapping every budgeted `sync` call in an inline guard function; since v4.2 (DSL v2) by `on_error: {catch: true}` on the calling task itself, which catches the parent-side timeout (verified on Temporal). The guard functions are gone. | 11, 14 |
| F39 | M | Pinning (P18): the entity and its inline children stay on their starting package, across continue-as-new; `sync`/`async`/`detached` children resolve afresh. `get_latest_package` ignores stage and targeting. | **Resolved** in v4.1 §4.3: upgrade-on-idle compares **package** versions via `get_targeted_wfspec_version` (keyed by package name), in a `sync` child (`deployed-version`) so the package payload stays out of the entity's history. Harness contracts stay backward compatible within a major. *Superseded in 0.11 (F66): the entity stops 10 min after going idle instead of probing.* | 14 |
| F40 | M | Packaging (P21): package names cannot contain dots; every package needs a main wfspec named after it; a bare name outside the loaded packages is looked up as a package. An `agent.<id>` package is impossible. | **Resolved** in v4.1 §17: agent packages are `agent-<agent_id>` (main `agent-<agent_id>` + definition `agent.<agent_id>`), loaded package-qualified. The harness gets a main `agent-harness` that reports `harness_version`. | 03, 04, 18 |
| F41 | L | Tooling: the bundler and test runner only look beside the file, integration tests load one directory, `emit_event`/`wait_for` cannot be mocked, and (DSL v1 only) top-level `output_data` cannot see variables set in a state's `on_enter`. The checkpoint timer is cancelled on every state exit, so `checkpoint_sec` must be shorter than `idle_tick_sec`. | **Resolved**: flat layout within each package (§4, F66); state-machine wfspecs declare their result in the top-level `output` (v2 reads the context the callbacks wrote); entity decisions live in named `set` tasks and are unit-tested; P16 matching is proven by a fixture; `session.checkpoint_sec` (240) < `session.idle_tick_sec` (300). | all |

### DSL v2 migration (v4.2)

| # | Sev | Finding | Status | Plan |
| --- | --- | --- | --- | --- |
| F43 | M | A package rebuilt from raw content has no version under DSL v2: `WorkflowSpecStore.add_wfspec_package_content` takes the version from the main document, and a v2 document has none. Content-built packages occur after **continue-as-new** (`serialized_state`) and when a `--debug` run passes package content to children. Then `__sys_info__.wfspec_version` is `None`: the harness's `config_version` becomes `dNone+a…` and `harness_version` null. Harmless in phase 0 (config is resolved once, in `init`, which does not re-run after a checkpoint), but phase 1's per-turn `config_version` check (design §6.1.2) would see a change after every checkpoint. | **Fixed in moco-core** (2026-10-05): continue-as-new state carries `wfspec_store_versions` beside `wfspec_store` (old state still restores, unversioned), and content handed to a debug-mode child carries the package version. Unit-tested, and verified on the dev stage 2026-10-06 (M6 `spaced` reports the package version after every continue-as-new; a `--debug` session records `d0.2.0+a0.2.0`). | 04, 14 |
| F48 | M | Agent admins were only `access.admin_user_ids`, empty by default: the first admin had to be hand-written into a deployed definition, every change was a config save or a redeploy, and groups were impossible. The platform already has namespace RBAC (`<ns>:admin` role, `<ns>:manage_ns` privilege, nested groups); `wfspec.owner` is unusable (overwritten with the publisher on every publish). | **Resolved** 2026-10-09 in design §6.13 / §6.1.1 (proposal: `proposal-namespace-admin.md`): holders of `<ns>:manage_ns` in the namespace owning `agent-<id>` are admins too, unless the definition sets `access.namespace_admins: false` (definition-only). `namespace-admin` (Foundation) does the two deploy-DB reads; `agent-config resolve` stamps the computed `access.caller_is_namespace_admin`, which no tier can set; `access` counts it after deny and guest. No moco-core or moco-db change. Open, platform: `builtin.deploy.*` reads are unauthorised (any wfspec can ask about any user), and `sys.deploy.wfspec set` should be checked for moving a wfspec out of a namespace it has no rights in. | 04, 05 |
| F47 | L | **Low concurrency tolerance on the single local dev worker.** Back-to-back turns on fresh sessions (with each session's detached title job and the older sessions' idle ticks: 2–3 active sessions) made an entity's workflow task exceed Temporal's 10 s workflow-task timeout. Two timeouts, then ~2 min of retry backoff, so the CLI gave up (120 s) though the loop had finished in 23 s; the next case's loop hit its 90 s budget. One workflow task took 54.7 s in a long-lived session (837 events) after such evictions. A trivial workflow on the idle worker: 0.6 s; live tasks of a normal turn: ≤ 0.5 s; paced turns (20 s apart) all succeed. | **Severity lowered to L (2026-10-18)**: a single local dev worker's limit, not a design flaw -- a deployment adds worker instances (two now run on the dev stage), and F66 shrank the histories that replay. **Open (diagnosis).** Not pinned down: CPU starvation of workflow tasks (one Python process runs workflow tasks and a 200-thread activity pool; the GIL) vs replay of long inline-heavy histories after cache eviction (phase 1 put many inline children into the entity). An in-process `Replayer` measurement was dominated by module import / build-id hashing on `/mnt/c` and did not finish. Next: profile the worker under load (`sudo py-spy record --pid <worker>`), read the worker log for workflow-task warnings, and try bounding the entity's history (checkpoint by `event_count`, or one `sync` turn child so the entity replays one event per turn). The eval script paces cases meanwhile. | 14, 16, 18 |
| F46 | L | System One dominates turn latency on local Laya: it serves one request at a time, and latency grows with the state. A phase-1 rag turn spent ~18.5 of ~22 s there (routing 3.4 s, four "parallel" screening calls 7.4 s serialised, `check_output` 7.7 s); the model took 0.75 s. | **Severity lowered to L (2026-10-18)**: a property of the local CPU classifier (moco-systemone on qwen3:0.6b), not of the harness; a faster backend removes it. **Open (deployment)**: within budget (110 s), but slow. Options, not taken yet: a concurrent System One backend (hosted TypeSafe); a smaller `check_output` state, or dropping it from rag's `output_checks` until the evaluation shows it separates (it scored 0.58 vs 0.52, plan-05 §8). | 05, 11, 14 |
| F45 | M | Local Laya cannot detect follow-ups: the `needs_context` noul scored follow-ups 0.24–0.39 and self-contained questions 0.19–0.31 (three wordings), so pronoun follow-ups would be retrieved unrewritten. | **Mitigated** in query-router: with history, a deictic message also triggers the rewrite (8/8 on the probe set, verified live). Revisit with hosted TypeSafe and the plan-18 evaluation. | 09 |
| F44 | M | System One judges the whole `state`: batching several items into one state and asking a noul per item made every item score alike (a blatant injection ~0.55, like benign passages). | **Resolved** in design §6.3.2 (rule) and plan-05: one request per item via `decide_many`. Other qsets checked: route / tools / memory.match ask many questions about ONE state (the message), which is the working pattern. | 01, 05, 07, 10 |
| F42 | M | The phase-0 harness was written in DSL v1, while the platform's authoring tools (devkit skills, schema, examples) are now v2-only. Phase-1 modules written in v2 would sit beside v1 ones, and v1 workarounds (P19 guard functions, `output_name` results, function-wrapped activities) would keep spreading. | **Resolved** in v4.2: every wfspec converted with `scripts.dsl_convert` and simplified; 98/98 tests pass on Temporal. v1 scratch names `_x@` became task-local `_x` (v2 rejects `_` + `@`). The parity baseline stays v1 and is ported through the converter. | all |

### Phase 2 implementation (2026-10-11)

| # | Sev | Finding | Status | Plan |
| --- | --- | --- | --- | --- |
| F49 | M | `http.*` and `mcp.call_tool` take no `*_secret_key`, which looked like a gap: a credentialed http/mcp tool would put a secret value into workflow input (secrets are names, §4.3). | **Resolved.** An `Authorization` header may carry a static secret (an API key) or a token acquired at call time, so a secret-name field is not the general answer. The rule: where the secret is known to be static, pass its name (`*_secret_key`); where a field accepts either, pass an encrypted secret, which works both ways: `http.request` and `mcp.call_tool` (moco-core, 2026-10-13) take `encrypted_auth_token`, the still-encrypted, short-lived output of `builtin.secret.get`, and decrypt it inside the activity. The harness does not fetch secrets at dispatch, so `tool-registry validate` rejects `credential: service/user` on an `http.`/`mcp` binding; such a tool binds a `tool.*` wfspec that fetches the encrypted secret (or acquires the token) and calls the activity. | 10 |
| F50 | M | `builtin.state` with `in_global_ns: true` and a qualified namespace (`<uid>:agent.<id>.sessions`) reached any user's rows: only the secret store was fenced. The janitor, memory-promote and tool-stats-rollup relied on it. | **Closed (2026-11-09, platform):** an unintended loophole, fixed in moco-core (`_build_namespace` rejects `:`). The harness no longer crosses users (0.15.0): `owner_user_id` removed; per-user hygiene runs as the user (`session-housekeep`, `job-manager reconcile`); cross-user aggregates read global rows keyed by user, control data only (usage, tool audit, the opt-in memory promotion pool). Design §6.16, §8. | 07, 12, 13, 14, 17 |
| F51 | M | `builtin.state.list_namespaces` lists only global namespaces (`in_global_ns: true`) or the caller's own: no wfspec can enumerate other users' session namespaces, so a deployment-wide janitor cannot find them. | **Obsolete (2026-11-09):** nothing needs to enumerate other users' namespaces since F50 closed. The `session_user:<uid>:<agent_id>` index and `session-store list_users` are removed; the rollups list global per-agent namespaces (`agent.<id>.usage`, `.tool-audit`, `.memory-pool`) of the agents agent-registry returns. | 14, 17 |
| F52 | M | A `parallel` loop whose body is an **inline** child that starts a `sync` grandchild (agent-config → agent-registry → `package-catalog`) fails with `WorkflowAlreadyStartedError` in all but one iteration: the grandchild's workflow id does not include the iteration. A sync child directly in the loop body (knowledge's retrievers) is fine. | **Open (platform, moco-core child ids).** The janitor and the rollup resolve agent configs sequentially. | 17 |
| F53 | L | Mocks cover only `activity` and `workflow` tasks (F41); an `emit_event` in a tested path really signals, and an unmocked state write really writes to the local store. `seed-tools`' scheduler start started a real entity from a test. | **Resolved in the harness**: liveness probes live in their own wfspec (`session-probe`, mockable); `seed-tools` takes `start_scheduler: false` in tests; every write task is mocked by its exact name. | 03, 17 |

### Phase 3 implementation (2026-10-14)

| # | Sev | Finding | Status | Plan |
| --- | --- | --- | --- | --- |
| F54 | H | A child started by `emit_event` `entity_workflow` (or `mode: detached`) inherited its starter's `wfspec_callstack`, and the engine RAISED on any repeated name. A job entity started from a session (stack `agent-cli, agent-session, job-manager, job-signal`) could therefore never call `job-manager`, report, or wake a session; the error was caught by `read-row`'s on_error and the job silently stayed `queued`. | **Resolved (platform, moco-core 2026-10-14)**: a repeated name only logs a warning; the call stack is still recorded and runaway recursion still stops at the depth limit (100). | 13 |
| F55 | L | A `job_cancel` that arrives while the job wfspec runs waits in the signal buffer (P17): it takes effect at the job's next wait for input, and a run that finishes first completes the job. | **Accepted**: the builder's cancel point that matters is the plan review; `job-manager cancel` still writes the row directly when no entity runs. | 13 |
| F57 | M | `claude_agent.query`'s `result` is the agent's LAST message. In the first live builder run it was a reply to a background `find` command's completion notice, sent after the plan: the "plan" relayed for review was that reply, and the implement run got it as the approved plan. | **Resolved in the builder**: both runs return the transcript (assistant text and tool names, no tool results); the plan is the last text with a `VERDICT:` line, the build the last text with the artifact envelope; no verdict → the plan step fails; the prompts forbid background commands. `subagent.claude` still reads `result` (no Bash, so less exposed): **open, low**. | 18 |
| F58 | M | A due refresh as designed (v4.3: `ready → indexing`, then the indexer with `overwrite`) hides the source from every catalog for the whole run and overwrites the live table: a refresh that fails (a dead site, 0 chunks) leaves the source empty and `failed` until an admin acts. A schedule must not take a working source down. | **Resolved (design §6.5.2, 2026-10-16)**: refresh is a shadow-table rebuild that keeps the row `ready` (`kb_<x>` ⇄ `kbr_<x>`), swapped by a guarded `source-registry patch` (`if_refreshing`); a failure drops the new table and records `refresh_error`. Reindex keeps its old meaning. | 06, 17 |
| F56 | L | The CLI bundler rejects a literal `workflow.ref` cycle, and the job path is one by design (agent-session → job-manager → job-signal → agent-session, and job-entity → job-manager → job-signal → job-entity). | **Worked around**: `job-signal` names `job-entity` and `agent-session` by expression (context `job_entity_wfspec`, `session_wfspec`), so they resolve by name on the deployed stage; its tests mock it. | 13 |
| F59 | M | `moco test` sends an integration suite's whole `src/` directory in one `/mcp` request (so dynamic refs resolve), and the dev nginx kept its default `client_max_body_size` (1m). Once the harness's `src/` passed 1 MB (2026-10-16), every integration suite failed with `413 Request Entity Too Large`, and `moco publish` was next. | **Resolved (ops)**: `client_max_body_size 16m` in `moco-nginx/conf.d/locations.conf` (hot-reloaded on the dev container) and in the Helm chart (`nginx.clientMaxBodySize`). A smaller CLI request (the literal-ref closure plus the dynamic targets) would be the lasting fix. Since the package split (F66) a suite sends only its own package (the largest, tools, is ~190 KB). | — |
| F60 | H | System One decisions failed on the dev stage (`TypeSafeAPIConnectionError`): routing fell back to the LLM, screening and output checks were skipped, the curator's gate failed closed (nothing learned), promotion confirmed nothing. First read as "the hosted classifier is unreachable"; the real cause was the local **moco-systemone** container being down. The harness names no classifier endpoint (`models.classifier` is null), so `typesafe.system_one` uses the worker default `TYPESAFE_DEFAULT_BASE_URL=http://localhost:8002`, model `qwen3:0.6b` (every worker `set_vars` script). Separately, outbound HTTPS from the workers fails certificate checks (`index_web` on public sites). | **Resolved (environment, 2026-10-16)**: moco-systemone running; verified live (one question ~0.5 s, the promotion confirm step end to end). Do NOT point the harness at the hosted TypeSafe model (catalog entry `typesafe`): the self-hosted one is the deployment's choice. It runs on CPU and is slow (F46). moco-assistant's agent tier has `models.classifier.enabled: false` (an operator choice, left as is). | 05, 07, 09 |
| F61 | L | Platform schedules live in Temporal: a reset Temporal dev server drops them, and the harness had no schedules until the next install (found 2026-10-16, after worker changes). | **Worked around**: `agent-schedules install` (or `seed-tools`) is idempotent; re-run it after a Temporal reset. | 17 |
| F62 | M | Deleting a session raced its memory writers: `delete_session` retires the items whose only evidence is that session, then signals the entity to retire -- and the retire ran the curator and wrote an episode from the deleted conversation, leaving orphans (seen live 2026-10-16). | **Resolved for retire (0.9.7)**: the delete's `retire` carries `deleted: true`, and the session then skips curation and the episode (verified live: no episode after deleting a two-turn session). **Still open**: a curator started DURING the last turn (periodic or early) can finish after the delete; narrow, since it needs a delete within seconds of a turn. | 07, 14, 16 |
| F63 | M | With the self-hosted classifier (qwen3:0.6b on CPU) the memory curator over-merges: unrelated exchanges ("what is a wfspec?", a helm preference) were judged repeats of one remembered lesson (`same_<i>` ≥ 0.6), and preference statements were flagged in plain questions (`states_preference`), so one item collected evidence from unrelated sessions. | **Open (tuning)**: the classifier evaluation (plan-18 step 9) should set `decisions.memory.same_min_p` and the router's preference threshold for this model; a higher `same_min_p` (0.8+) is the likely fix. | 07, 09, 18 |
| F64 | L | `forget` tombstones the normalised TITLE, so the curator relearned a forgotten item under a reworded title ("The user's zzqa test fruit is starfruit." → "zzqa test fruit is starfruit"). | **Open (design limit)**: lexical tombstones; matching candidates against tombstones with `qset.memory.match` (or vectors, when on) would close it. | 07 |
| F65 | L | `retire_by_session` retires the items whose ONLY evidence is the deleted session, so an item backed by two sessions survives both deletes with evidence from deleted sessions only (seen 2026-10-17). | **Resolved (0.12.0)**: `session-store delete` lists the user's remaining sessions after deleting the rows and passes them as `memory retire_by_session`'s `live_session_ids`; an item is retired when the deleted session is evidence for it and no live session is (if the list fails, the old only-evidence rule applies). The delete reports `retired_memory`. Verified live: an item remembered in two sessions stayed active after the first delete and was retired by the second. Items orphaned before 0.12 stay until one of their sessions is deleted, or the user forgets them. | 07, 14 |
| F66 | M | The engine resolves a wfspec to its **whole package**, and a break-away child (`sync`, `detached`, an entity) starts with an empty store and no cache across runs (`wfspec_store`, `deploy_resolver`). As one package (95 wfspecs, 1.1 MB), every agent-loop, compactor, job, indexer, schedule and agent-cli/agent-admin run fetched all of it through a local activity, wrote it into its history and parsed it; continue-as-new carried it forward. | **Resolved (0.10.0, phase 1)**: one package per module (§4), cross-package refs qualified, `check-packages.py`, independent versions with `agent-harness` as the harness version. Measured on the dev stage (median Temporal history per run, 0.9.7 → 0.10.0): agent-cli 2.37 MB → 39 KB, agent-loop 2.43 MB → 0.81 MB, compactor and memory-curator 1.2 MB → 0.46 MB, deployed-version 1.2 MB → 0.21 MB, package-catalog and source.pgvector 1.2 MB → 0.14–0.17 MB. Consequence: a test sees only its own package, so cross-package children resolve against the dev stage. **Rollout**: a session entity started on 0.9.x keeps its old package inline but starts its break-away children as `agent-harness/<wfspec>`, which 0.10.0 no longer has: its upgrade probe fails (read as "cannot tell", so it never upgrades) and its next turn's agent-loop would too. Send such sessions a `retire` event when deploying 0.10.0 (done on the dev stage for the two live ones); a new message then boots 0.10.0. Phase 2 has the same trap for 0.10.x sessions: keep `deployed-version` (or retire them) until none is left. **Phase 2 (0.11.0, resolved)**: the session entity stops 10 min after going idle with no active job (`session.idle_stop_sec`; row stays `active`; the curator flush and the episode run at the stop, as the session's user), and the janitor retires the row past `retire_after_idle_sec` with no memory step (its writes would land in the janitor's scope). The upgrade probe and the interim bump rule are gone; `deployed-version` stayed one release so 0.10.x sessions could still upgrade, and was deleted in 0.12.0. `session.retired` hooks now fire only for sessions the entity retires itself. | 14, 16, 17 |
| F67 | M | **Platform.** Offering moco activities and deployed workflows as tools needed three things the platform lacked: no activity listed activity manifests at run time (only the static wfspec JSON schema had input schemas); `builtin.deploy.query.get_user_deployments` dropped the `manifest` column its SQL function returns; and a workflow had no way to declare itself a tool. Also found: the claude_agent bridge's `google_drive.` prefix matched no activity (the prefix is `gdrive.`). | **Resolved (0.12, 2026-10-18)**: moco-core `builtin.activity.list_manifests` (the activity catalog, input schemas flattened by the new shared `schema_util`, per-activity and listing hashes; the bridge now uses the same flattener); `UserDeploymentInfo.manifest`; the `header.metadata.tool` convention, checked by `moco validate` and collected by `moco publish` into `manifest.tools`; the bridge prefix fixed. Harness: `tool-provider` kinds `activity` and `workflow`, `tool.run-workflow`, executor `merge_args`, registry target check (design §6.9.4). | 10 |
| F68 | M | The activity allowlist admits families by prefix, so destructive activities are eligible (`sql.execute`, `gdrive.delete`, `llama_index.drop_table`), and an activity tool's `side_effects` was whatever its author or provider admin declared: an activity provider importing several activities under one `read` default would run `sql.execute` without asking. | **Resolved (0.12, 2026-10-18)**: `tool-registry` `activity_min_side_effects` beside the allowlist (unlisted allowlisted types: external); `validate` refuses less; every read clamps stored rows up (auto → approve for write/external); providers apply it at import via the registry's `activity_rules` (their allowlist copy removed); UI shows "at least …". Verified live: `sql.execute` imported under a `read` default came out write/approve. Later: a `side_effects` field on moco-core `ActivityManifest`, this map the fallback (design §6.9.3). | 10 |
| F69 | H | `hook-runner` ran a hook by its bare `wfspec` name. In the session entity the agent package is loaded, so the name resolved; in the agent loop (a `sync` child, empty store) it was looked up as a package and failed (`No runnable WorkflowSpec version found for hook.moco.trace`), and a failed hook reads as `continue`. So every `tool.before` and `tool.after` hook silently never ran: a `tool.before` veto would have let the call through. Found 2026-10-27 by the first live run of the deferred events. | **Resolved (foundation 0.13.1)**: hook-runner runs a bare name as `agent-<agent_id>/<name>` (design §5.4), +1 case. Verified live with `hook.moco.trace` (moco-assistant 1.6.1, `mode: async` on the five deferred events): route.decided, context.assembled, three tool.after from the loop, turn.committed, and session.retired on delete all ran. **Open, same pattern, not verified**: guard runs custom checks by bare name and is reached from the loop through tool-executor, so an agent-package check on tool calls would likely fail the same way; context-builder providers and the custom router are called from the session (inline), where the name resolves. No deployed agent has a custom check. | 03, 05 |
| F70 | H | **First run was invisible.** On a fresh stack (moco-dev-server with no `.env`, a new user with no key) every turn answered "Sorry, something went wrong…": `llm-invoke` mapped a missing secret or worker variable to `auth` and only logged it, and a role with no key name raised into `profile_failed`. A dead embedding endpoint read as "not found", and the UI could pick a key's name but not store its value. Worse, a classifier with no `base_url` fell back to `TYPESAFE_DEFAULT_BASE_URL` and then to the **hosted** TypeSafe API, which the harness must never call. | **Resolved (harness 0.14.0, 2026-10-27; design §6.2.1, §6.2.4, §11.2)**: static `model-readiness` + `agent-admin get_readiness`; the session answers a setup failure with `session.setup_text` and a `setup` field (agent-loop catches `llm-invoke`'s raise as `unconfigured`; all-sources-failed retrieval says "couldn't search"); `decide` calls System One only with `base_url` or `worker_default: true`; the UI shows a setup checklist (chat welcome, Settings), stores a key in place (`sys.secret upload`, encrypted in the browser), offers "Ask again", and a worker-default checkbox. Readiness is static by choice: a role on the worker's default is `unknown`, and a real failure gets the setup answer. **Verified live (2026-10-27)**: a user-tier key name that was not stored → readiness `secret_missing` and the setup answer with `setup`; in headless Chrome the welcome checklist, the setup callout, "Set key" storing the value (encrypted, `sys.secret upload`), and "Ask again" → the rejected-key answer. That run found a gateway's "invalid JWT token format" reading as `provider_error`: foundation 0.14.1 adds the rejected-key phrasings to `llm-invoke`'s `auth` list and `setup_patterns`. Classifier: 0 System One calls with nothing stated, calls again with `worker_default`. | 02, 04, 11, 14, 16 |

## 7. Simplifications adopted in v4

| # | Simplification | Removes | Plan |
| --- | --- | --- | --- |
| S1 | Phase 0 walking skeleton + measurements | a big-bang phase-1 integration | 00a |
| S2 | Router strategies collapse to one pipeline + `router.<custom>` | 3 strategies, `prompt.route` | 09 |
| S3 | No `strategy` field; derived from `tools` | a config field and its validation | 11, 03 |
| S4 | Memory: no session facts; kinds `profile/fact/lesson/episode`; support = distinct sessions; no `refines`/merge in the curator | a scope, a provider, 3 kinds, 5 weight rules, a chat-model call | 07 |
| S5 | HITL: four statuses, decision as a field | 3 statuses, the `complete` step, F13 | 12 |
| S6 | No implicit handoff | `handoff.on_declined`, most of F10 | 11 |
| S7 | Tools: providers → phase 3; no circuit breaker / per-call stats; four-layer policy | `tool-health`, `quarantined`, `tool_pref` in v1, F17 | 10 |
| S8 | Built-in context providers are `set` tasks (v1: transforms) | 9 child workflows per turn | 08 |
| S9 | Telemetry folded into the session runtime | a module, F7 | 14, 15 |
| S10 | `agent-models` merged into `agent-harness-defaults` | a wfspec | 04 |
| S11 | Three hook events in v1 | 5 events and their patch allowlists | 03 |
| S12 | Contract versioning deferred | version negotiation, F15 | 03 |
| S13 | `decision` role is an optional alias of `inference` | one required model config | 02, 04 |
| S14 | No generated dispatch tables; develop against a dev stage | `gen-dispatch.py`, its CI check, generated wfspecs | 03, 01 |

Also removed as a side effect: `prompt.clarify`, `qset.memory.rerank`, `qset.compact.salience`,
`loop.single`/`loop.react` → `loop`. Together this is roughly 15 fewer harness wfspecs than v3.

## 8. Decisions still open

- P15: platform request (compare-and-set). F1 / P14 is resolved (`mcp.list_tools`), P13 too (platform schedules, `builtin.schedule.*`).
- F36, F37 / P20: platform requests: usage from the chat activity, and a templatable
  `tool_choice`. (Expression-valued activity timeouts already work: F37's timeout half was a
  wrong belief, corrected 2026-10-16.)
- F32 / open question 10: the UI.
- Open questions 14–15: cost-limit and retention defaults (16, scheduler ownership, is resolved).
- Open questions 2, 3, 4, 8, 9, 11–13 are unchanged from v3 and none blocks phase 0 or 1.
