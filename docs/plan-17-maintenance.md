# Plan 17 — Schedules + maintenance (`agent-schedules`, offline wfspecs)

Design: `design.md` §6.16, §8.1 (retention), §6.10.5 (cost limits), §6.9.11 (stats), §3 P13.
Overview: [plan-00](plan-00-overview.md).

## 1. Scope

- **`agent-schedules`**: each periodic job is a platform schedule (P13, F23), installed at
  deploy. (Until 2026-10-15 one long-lived `agent-scheduler` entity ran them; moco had no
  scheduler then.)
- The jobs: session reaping, pending/job hygiene for retired sessions, memory caps and
  lazy decay, retention, turn-page archiving, the agent-wide usage rollup for cost limits, the
  tool-stats rollup, the optional classifier keep-warm, and in phase 3 knowledge refresh, memory
  promotion and provider sync.
- Deploy-time seeding.

Out of scope: the logic the jobs invoke. Each job calls the owning module's modes (layering
rule) and never touches another module's rows directly.

## 2. wfspecs to create

`workflow/src/maintenance/`

| wfspec | Trigger | Calls |
| --- | --- | --- |
| `agent-schedules.yaml` | `install` from `seed-tools` at deploy (or an admin); `status` | owns the job table; per job `builtin.schedule.create` (`if_exists: keep`, paused if off by default) then `builtin.schedule.update` without `paused`; the namespace owning `agent-harness` from `builtin.deploy.wfspec.get`. No state rows |
| `agent-janitor.yaml` | hourly | `session-store list/patch_meta/delete`; `memory record {trigger: retire}` for reaped sessions; `hitl expire` and `job-manager` fail for **retired** sessions only; `memory-store` caps and lazy decay; retention (§8.1); turn-page archive; agent-wide daily usage rollup → `config:limits.paused` |
| `tool-stats-rollup.yaml` | hourly | read per-session `toolcalls` rows → write `tool_stats:<name>`; retire deprecated tools past grace (`tool-registry`) |
| `keep-warm.yaml` | every 5 min, off by default | one tiny `decide` call |
| `seed-memory.yaml`, `seed-tools.yaml` | deploy / admin | `memory-store save` (agent scope, `pinned: true`); `tool-registry save/validate` + `save_toolset` from `tool-catalog` and agent toolsets; `agent-schedules install` |
| `knowledge-refresh.yaml` | phase 3, hourly check | `source-registry list` (shared, ready) → due by `refresh.every_hours` → `agent-registry list` + `agent-config resolve` (only when something is due) → `knowledge refresh` through an agent listing the source |
| `memory-promote` | phase 3, daily / admin | implemented in plan-07; scheduled here |
| `tool-provider-sync.yaml` | phase 3, per provider `sync.every` | `tool-provider sync` (lists via `mcp.list_tools`) |

## 3. Dependencies

Owners: plans 04, 06, 07, 10, 12, 13, 14, 02. Platform: `builtin.state.list_namespaces` with a
pattern and `limit`; schedules (`builtin.schedule.*`, moco-core `docs/scheduler.md`);
`builtin.deploy.wfspec.get` for the owning namespace.

## 4. Reuse

| From | To |
| --- | --- |
| `moco-agent.yaml` supervisor reaping (per user) | `agent-janitor` session reaping (one deployment-wide schedule instead of one supervisor per user) |
| `seed-knowledge.yaml` curated notes | `seed-memory` (new item schema) |
| `knowledge-indexer.yaml` refresh logic | `knowledge-refresh` |

## 5. Implementation steps

1. **Schedules**: `agent-schedules install` reads the namespace owning `agent-harness`, then for
   each job of its table creates schedule `agent-harness.<job>` running `agent-harness/<wfspec>`
   (`if_exists: keep`, `paused` when the job is off by default) and updates an existing one
   without `paused`, so redeploys carry interval / wfspec / input changes but keep what an admin
   paused or resumed. The platform's overlap policy (`skip`) stops a slow run from stacking.
   `status` lists the harness's schedules. Operating them (pause, run now, history) is the
   platform's: moco UI Schedules, `moco schedule`.
2. **Liveness**: none needed. A schedule fires whether or not any harness workflow runs;
   `seed-tools` re-installs at every deploy. **Migration** from the entity: install, then
   terminate the old `agent-harness-scheduler` workflow (`moco terminate agent-harness-scheduler`)
   so jobs do not run twice; its `scheduler:state` row is left unused.
3. **Janitor skeleton**: page through `<uid>:agent.<id>.sessions` namespaces with
   `list_namespaces(pattern, limit)`; bounded work per run; idempotent.
4. **Session reaping**: `meta.status: active`, but no running entity, and idle past
   `retire_after_idle_sec` → `retired`, then `memory record {trigger: retire}`. Entities ended by
   upgrade-on-idle are *not* reaped until they are also idle past the retire threshold (their
   status is `active` by design, §4.3). **Since 0.11 (F66)** every named session ends this way (the idle stop),
   so reaping is the normal retire path, and it runs no memory step: the idle stop already
   recorded memory and the episode as the session's user.
5. **Hygiene for retired sessions only** (P15): expire pending actions; fail jobs stuck in
   `running` past a max age whose entity is gone.
6. **Memory**: enforce per-scope caps (unpinned, lowest effective weight first); lazy-retire
   unpinned items with `effective_weight < 0.25` unused for 180 days.
7. **Retention** (§8.1): `session-store delete` for retired sessions older than `session_days`;
   drop archived turn pages older than `archived_turns_days`.
8. **Turn page archive**: move old turns to `turns:<page>` via `session-store`.
9. **Cost rollup**: sum today's `usage_day` per agent; over `agent_daily_tokens` → set
   `config:limits.paused` through `agent-config save` (system caller); clear it at the start of
   the next day.
10. **`tool-stats-rollup`**: calls, error rate, p50/p95, approvals / rejections / grants,
    truncations, last error per tool; flag tools failing persistently for the usage report.
11. **Seeds**: idempotent (deterministic keys), re-runnable on every deploy.
12. **Phase 3**: `knowledge-refresh`, the `memory-promote` schedule, `tool-provider-sync`.
    `knowledge-refresh` (built 2026-10-16): due = shared pgvector source, `ready`,
    `refresh.every_hours ≥ 1` and `refresh.sources`, not refreshing (one older than 2 h is
    dead), last attempt (`indexed_at` / `refresh_failed_at`) at least `every_hours` ago;
    oldest first, `max_sources` (3) per run. Each goes through the first agent (by id)
    whose resolved `knowledge.sources` lists it, so that agent's admin check authorises
    the shared write; unlisted sources are skipped (`unused`). Private sources: their owner
    (F51).

## 6. Tests

`workflow/tests/maintenance/`

- `agent-schedules`: the specs it installs (an off-by-default job created paused, `paused`
  never sent on the update of an existing one); a kept schedule is updated, a created one is not;
  an unknown namespace or a failing create returns `ok: false` with the per-job errors.
- (Since 2026-11-09 the reaping, retention and memory cases are `session-housekeep`'s suite,
  and stuck jobs job-manager's; the janitor suite covers only the cost rollup. F50 closed.)
- Janitor on fixture namespaces: reaps only dead, idle sessions; leaves an upgrade-ended
  session alone until it is idle past the threshold; never touches pending rows of live sessions;
  retires decayed unpinned memory; applies retention; respects batch bounds; a second run is a
  no-op.
- Cost rollup sets and clears `limits.paused`.
- Stats rollup computes figures from fixture audit rows; retires deprecated tools past grace.
- Seeds are idempotent and install the schedules (mocked by task name in tests).

## 7. Phase split

- **Phase 2**: scheduler, janitor (reaping, hygiene, memory caps/decay, retention, archive,
  cost rollup), `tool-stats-rollup`, keep-warm, `seed-tools`, `seed-memory`.
  **Status (2026-10-12):** `agent-scheduler`, `agent-janitor` (reaping + due-pending expiry),
  `session-probe`, `tool-stats-rollup`, `seed-tools` implemented; the session index works around
  F51, sequential config resolves around F52. Verified live: the janitor retired a session whose
  entity was terminated, and left a live one alone. Since then: retention (session_days),
  the agent-wide cost rollup / pause, keep-warm (off by default), `seed-memory`; the deployed
  scheduler runs the janitor and the rollup (live: tool_stats written from real audit rows).
  **2026-11-09 (ops 0.12.0, F50 closed):** the janitor keeps only the cost rollup, over global
  `usage_day:<day>:<uid>` rows; reaping, due-pending expiry, retention and memory caps/decay
  moved to `session-housekeep` (session 0.15.0, run as the user at each idle stop), stuck jobs
  to `job-manager reconcile` (jobs 0.11.0), and tool-stats-rollup reads the global
  `tool_audit:*` rows. The session index (F51) is gone.
  Open: memory caps/decay (needs memory-store's owner override), turn-page archive.
  **2026-10-16:** memory caps and lazy decay done -- the janitor runs `memory-store
  enforce_caps` (owner override, admin) on each user × agent scope with long-term memory,
  ≤ `max_memory_scopes` (50) per run; enforce_caps now also retires decayed items.
- **Phase 3**: platform schedules replace the entity; `knowledge-refresh`, `memory-promote`
  schedule, `tool-provider-sync`.
  **Status (2026-10-15):** `agent-schedules` replaces `agent-scheduler` (deleted, with its tests
  and the `seed-tools` ping); see the plan-00 phase-3 status for the live check.
  **2026-10-16:** `knowledge-refresh` built and scheduled (`agent-harness.knowledge_refresh`,
  hourly, on). `memory-promote-all` scheduled daily (`agent-harness.memory_promote`).
  `tool-provider-sync` scheduled hourly (`agent-harness.tool_provider_sync`, 0.9.0): phase 3
  done. A reset Temporal dev server drops the schedules (F61): re-run `agent-schedules install`.

Phase 1 relies on sessions retiring themselves on `idle_tick`. Only sessions whose entity died
wait for the phase-2 janitor.

## 8. Risks & open issues

- A failed fire only postpones maintenance to the next one: jobs are idempotent. A failed
  install is reported by `seed-tools` and is safe to re-run.
- Schedules run as the installing admin (P13). If that user loses admin rights, the jobs keep
  running as them until a re-install by another admin; the platform does not re-check
  permissions at fire time.
- Listing every user's namespaces is O(users); the cursor spreads it across runs. A platform list
  API with prefix paging would help.
- Retention and cost defaults are placeholders (open questions 14, 15).

## 9. Done when

Phase 2 exit (§19): the scheduled jobs survive a worker restart and a redeploy; the janitor retires
a session whose entity was killed; retention deletes an expired session; `tool_stats` is
populated without any per-call writes.
