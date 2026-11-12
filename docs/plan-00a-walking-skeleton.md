# Plan 00a — Phase 0: walking skeleton + measurements

Design: `design.md` §19 (phase 0, M1–M6), §4.3 (versioning), §6.10, §5.6. Overview:
[plan-00](plan-00-overview.md).

## 1. Scope

Build the thinnest end-to-end slice that exercises the hard parts of the platform: a deployed
entity, the turn pipeline, the idle checkpoint, rehydration, the upgrade-on-idle rule, and the
110s budget. Also run the six measurements whose numbers every later phase would otherwise
guess.

In scope: `agent-cli` → `agent-session` → one profile → `agent-loop` (one step) → `llm-invoke`,
with `session-store` and config from the defaults + definition only.

Out of scope: routing, prompts as wfspecs (inline messages are fine), memory, knowledge, guard,
stored config tiers, admin. Each is added in phase 1 by its own plan, wired into this skeleton.

## 2. wfspecs to create

Everything here is the **first version** of a wfspec that its owning plan later completes, and
lives where that plan says. Nothing is throwaway except the measurement harness.

Paths are relative to `moco-agent/`. The harness is flat, under `workflow/src/` (plan-00 §4, F41).

| wfspec | Owning plan | Phase-0 subset |
| --- | --- | --- |
| `workflow/src/agent-cli.yaml` | 16 | `message`/`question`, `session_id?`, `message_id?`; mints a throwaway session and a `message_id`; stamps `sent_at`; start-or-signal; `wait_for` with `match_expression` on `message_id`; `timing` passed through (M4) |
| `workflow/src/agent-session.yaml` | 14 | states `init → idle → receiving → running → delivering → idle`, `ticking`, `retiring`, `done`; idle checkpoint; `idle_tick` retire (incl. throwaway); upgrade-on-idle; timestamp queue depth (F35) |
| `workflow/src/session-store.yaml` | 14 | `create`, `get`, `commit_turn`, **`patch_meta`** (brought forward: retire and reactivate need it); `schema_version: 1` on rows, v0 readable |
| `workflow/src/deployed-version.yaml` | 14 | the upgrade probe: targeted package version, as a `sync` child (F39) |
| `workflow/src/agent-loop.yaml` | 11 | one `thinking` step, no retrieval, no tools; profile contract output |
| `workflow/src/llm-invoke.yaml` | 02 | `chat` only; role resolution incl. the `decision` alias; error taxonomy; estimated usage (F36) |
| `workflow/src/agent-harness-defaults.yaml` | 04 | defaults tier + model catalog + the phase-0 `profile_library` stand-in for `profile.chat` |
| `workflow/src/agent-config.yaml` | 04 | `resolve` = defaults ⊕ definition; `config_version` |
| `workflow/src/agent-harness.yaml` | 17 (packaging) | the package's main wfspec: `harness_version`, entry points (P21) |
| `agents/skeleton/src/agent.skeleton.yaml` (+ main `agent-skeleton.yaml`) | 18 | a one-profile definition (`chat`), package `agent-skeleton` (F40) |
| `eval/measure/src/*.yaml` | 00a | package `agent-harness-measure`: runner + drivers M1–M6 (dev stage only) |
| `scripts/dev-stage.sh`, `scripts/measure.sh` | 00a | publish + deploy + chat by name; run the measurements |

## 3. Dependencies

- Platform only: a dev stage to publish to, `openai.chat.completions` with a gateway key,
  `typesafe.system_one` (M1), `llama_index.query` against `moco-docs` (M5), Temporal.
- Nothing from other plans; this plan seeds 02, 04, 11, 14, 16 and 18.

## 4. Reuse

| From `moco-examples-internal/moco-agent/src/` | For |
| --- | --- |
| `moco-agent-cli.yaml` | `agent-cli` start-or-signal skeleton (add `message_id` matching) |
| `moco-agent-session.yaml` | entity skeleton, idle checkpoint, rehydration |
| `session-store.yaml` | id guard, key format, commit shape |
| `agent-providers.yaml` | model catalog entries |

## 5. Implementation steps

1. **Package + dev stage.** `workflow/moco.json`, a skeleton agent package, and a
   publish-and-run script for the dev stage (§5.6). Everything from here runs by name.
2. **`llm-invoke chat`** + **`agent-harness-defaults`** + **`agent-config resolve`** (defaults ⊕
   definition).
3. **`session-store`** with `create`, `get`, `commit_turn`.
4. **`agent-loop`** one-step: render inline messages from the last N exchanges → `llm-invoke` →
   profile contract output.
5. **`agent-session`**: `init` (resolve config, get/create, rehydrate conversation) → `idle` →
   on `user_message {message_id}` run the loop with `budget_sec` → `delivering` (emit
   `agent_answer {message_id}`, `commit_turn`) → `idle`. Queue depth 1, `busy` beyond it.
6. **Lifecycle**: idle checkpoint; `idle_tick` retire (`retire_after_idle_sec`,
   `retire_throwaway_after_idle_sec` for `meta.throwaway`); upgrade-on-idle: compare the running
   harness version constant with the deployed one and end without retiring when they differ.
7. **`agent-cli`**: mint `session_id` (throwaway) and `message_id` if absent; start-or-signal;
   `wait_for` with `match_expression: message_id == …`, 120s; on timeout return `status: error`
   with `workflow_id`.
8. **Measurements** (each a small driver wfspec + a results table appended to this plan):
   - **M1** System One latency by question count 1/5/10/20/30, warm and cold, TypeSafe and Laya.
   - **M2** `sync` child workflow vs inline `set` (v1: transform) overhead on Temporal (100 iterations).
   - **M3** `list_states` latency at 50/200/500/1000 rows with a `key_pattern`.
   - **M4** skeleton turn time, split by state, over 50 turns.
   - **M5** `llama_index.query` latency on `moco-docs`, top_k 5/10.
   - **M6** idle checkpoint with one queued message and a pending summary held in memory:
     verify nothing is lost.
9. **Fold the numbers back**: update design §7.3 (question-count bounds), §12 (timing table),
   §6.4.5 (recall caps), and the defaults (`turn_budget_sec`, `classifier.timeout_sec`,
   pre-filter sizes).

**Implementation notes** (what building steps 1–8 changed; findings F35–F41 in plan-00 §6):

- Step 1: `moco publish` needs a main wfspec per package, and package names allow no dots, so
  the skeleton ships as package `agent-skeleton` and is loaded as
  `agent-skeleton/agent.skeleton`. Deploying is `sys.deploy.package.release` (operator
  `deploy`); `scripts/dev-stage.sh` wraps publish, deploy and a chat turn.
- Step 5: there is no in-memory queue (F35). A message that arrives mid-turn waits in the signal
  buffer, and `receiving` answers `busy` when it waited behind two turns. The profile runs as a
  `sync` child bounded by `budget_sec`, wrapped so that its timeout cannot fail the entity (F38).
  A failed exchange is persisted to the transcript (with the fixed apology) but kept out of
  `recent`.
- Step 6: the first task — can a wfspec learn the deployed harness version? — is answered:
  `builtin.deploy.query.get_targeted_wfspec_version`, keyed by **package** name (verified
  against the deployed `moco-agent`, 5.8.0). `get_latest_package` is not stage- or
  targeting-aware. When a retire and an upgrade are both due, retiring wins.
- Step 7: on timeout `agent-cli` also returns `session_workflow_id`, so the caller knows which
  entity to look at.
- Step 8: the drivers are one package with a runner (`agent-harness-measure`). M6 was reframed
  by F35: since nothing queues in memory, the entity asks to checkpoint after *every* handled
  event. It runs twice. `burst` buffers events and checks none is lost (the runtime defers the
  checkpoint). `spaced` empties the buffer, so real continue-as-news happen, and checks that
  in-memory state survives them.

## 6. Tests

`workflow/tests/` — the first cases of each owning plan's suite. **Implemented: 98 cases in
9 suites, all passing with `moco test` on Temporal (~1m40s)** (agent-config 10, llm-invoke 16,
session-store 24 + 3 unit, agent-loop 3 + 3 unit, agent-session 27 unit, agent-cli 10 unit,
P16 fixture 2). Written in DSL v1 and converted to v2 in design v4.2; the same 98 cases pass
after the conversion. The entity cannot be driven by events in a test, so its decisions live in named
steps and are unit-tested (as in the old agent):

- `session-store`: id guard; `commit_turn` shape incl. `schema_version`; reading a row without
  `schema_version` (treated as v0) works.
- `agent-session` (children mocked by `task_name`): one turn; queue full → `busy` with the
  right `message_id`; retire after idle; throwaway retire; upgrade-on-idle ends without setting
  `retired`.
- `agent-cli`: matches only its own `message_id` when two answers arrive — proven on the real
  engine by `tests/fixtures` (another caller's answer arrives first; with none for us, nothing
  is taken). `emit_event`/`wait_for` cannot be mocked, so `build-ids` and `format-result` are
  unit-tested.
- **Deployed checks (manual, recorded in this plan)**: two-turn conversation; kill the worker
  mid-idle and resume; redeploy the harness and confirm the next message runs the new version
  with the same persisted rows.

## 7. Phase split

All phase 0. The exit criterion gates the start of phase 1.

## 8. Risks & open issues

- If M2 shows child workflows are expensive, the plans' module boundaries (one wfspec per
  module call) need revisiting before phase 1: more modules become inline expressions or merged
  wfspecs. That is the main reason to measure first.
- If M1 shows System One is slow beyond ~10 questions, `qset.route` is split (open question 1)
  and the tool/source pre-filters shrink.
- M6 failing means continue-as-new drops signals that were buffered but not yet handled. The
  fallback is queue depth 0 (every message during a turn gets `busy`), and pending state must
  be re-read from persist_state after each checkpoint.
- ~~Upgrade-on-idle needs a readable "deployed harness version".~~ *Resolved (F39)*:
  `get_targeted_wfspec_version` by package name, in a `sync` child. Remaining race: a message
  that arrives in the moment between the tick's decision and the entity ending is lost with the
  entity. Its caller times out and resends; that is accepted for phase 0.
- A local run needs a working model key. The harness default (`global/DEMO_DEEPSEEK_APIKEY`)
  is not present on this dev box, so `agent.skeleton` overrides `models.inference` with the
  internal gateway (`dsp.gemma-4-26b`, `MY_LLM_TOKEN`), taken from the old agent's working
  user-tier `model_config`. That needed no harness change, which is the point of the agent
  tier. The first live call found a bug the mocks could not: in-memory, the chat activity
  returns a pydantic object rather than a dict, so `llm-invoke` now normalises it.
- F36: token counts are estimates until the chat activity returns `usage`.

## 9. Done when

A two-turn conversation on the dev stage survives a worker restart and a redeploy with identical
persisted rows, and M1–M6 are recorded here with the design and defaults updated from them.

**Status (2026-09-29): deployed checks pass and M1–M6 are measured.** `agent-harness` (0.1.0,
then 0.1.1), `agent-skeleton` 0.1.0 and `agent-harness-measure` (0.1.0, then 0.1.1) are published
to the local `dev` stage. On this server, publishing already deploys for the owner, so
`dev-stage.sh` treats "Duplicate deployment" as done. What remains of the exit criterion is
step 9: folding the numbers into the design and defaults. **Done 2026-10-05**: all the
proposals below were accepted and are in design v4.3 (§4.3, §6.2.3, §6.4.5, §6.5.1, §6.9.8, §7.3,
§12, open question 1) and the module plans. No default value changed: `classifier.timeout_sec:
10` and `turn_budget_sec: 110` stand. Laya (M1) is not measured. **The phase-0 exit criterion
is met**, and the deployed checks also pass on the DSL v2 build (see below).

**DSL v2 redeploy (2026-10-05).** All three packages republished as 0.2.0 (DSL v2);
`harness_version` reports `0.2.0`. Turn 5 on `p0-check-1`, whose rows were all written by the
v1 harness, was answered from the rehydrated conversation ("Your name is Ada, and you like
Temporal."). Rows: the 8 earlier transcript entries unchanged, 2 appended, `turn_count` 5, usage
added. A fresh session (`v2-check-1`) records `config_version` `d0.2.0+a0.2.0`. Found F43: in a
`--debug` run the entity recorded `dNone+a0.2.0` (see plan-00 §6).

**DSL v2 deployed checks (2026-10-06): all PASS**, after the F43 fix and a worker restart.

| Check | Result |
| --- | --- |
| Worker restart with `v2-check-1` idle | Turn 2 answered "Your name is Bo." by the same live entity (`wait_ms` 13) |
| F43, `--debug` path | A `--debug` session records `config_version` `d0.2.0+a0.2.0` (was `dNone+…`) |
| F43, continue-as-new path | M6 `spaced` (4 real continue-as-news) reports package `0.2.1` on every pong; M6 now fails if any execution lacks it. M6 `burst` also passes on v2 |
| Upgrade-on-idle (harness 0.2.0 → 0.2.1) | The idle entity ended one tick after the publish: `ended_as: upgrade`, `stop_reason: upgrade:0.2.0->0.2.1`. Turn 3 started a fresh run that rehydrated ("Your name is Bo."), meta `active`, `turn_count` 3, `created_at` unchanged, `config_version` `d0.2.1+a0.2.0` |

### Deployed checks

| Check | Result |
| --- | --- |
| Two-turn conversation (session `p0-check-1`) | **PASS**. Turn 2 answered "Your name is Ada, and you like Temporal." Rows: all `schema_version` 1, `turn_count` 2, 4 transcript entries, 4 `recent` entries, additive usage, title from the first message, `config_version` `d0.1.0+a0.1.0` |
| Restart the worker mid-idle, then send turn 3 | **PASS**. The base worker was bounced while the session was idle. Turn 3 recalled the name, and the rows are identical to the snapshot except turn 3 appended and `turn_count` / `updated_at` / `usage` advanced (`created_at` unchanged) |
| Redeploy the harness (0.1.0 → 0.1.1) | **PASS**. The idle entity ended one tick after the publish (~5 min) with `ended_as: upgrade`, `stop_reason: upgrade:0.1.0->0.1.1`, and meta `status` stayed `active`. Turn 4 started a fresh run that rehydrated ("You like Temporal."), with only turn 4 appended. The new run outlived its next tick, so it recorded 0.1.1 and did not upgrade again |

### Measurements

All on Temporal (workflow mode) against the local dev server, 2026-09-28, run from the driver
files (`moco run eval/measure/src/<driver>.yaml`).

**M1: `typesafe.system_one`, hosted TypeSafe, 5 calls per count, 0 failures**

| questions | warm p50 | warm p90 | first call |
| --- | --- | --- | --- |
| 1 | 426 ms | 725 ms | 2193 ms |
| 5 | 1778 ms | 2296 ms | 1423 ms |
| 10 | 2881 ms | 2926 ms | 2485 ms |
| 20 | 4855 ms | 4983 ms | 4988 ms |
| 30 | 7352 ms | 7578 ms | 7551 ms |

Latency is close to linear, about 240 ms per question, with little cold-start penalty on hosted
TypeSafe.

**M1 on self-hosted Laya** (the worker's local server, 2026-10-06, 4 calls per count, 0 failures)

| questions | default model, warm p50 | `typed-decisions`, warm p50 | first call |
| --- | --- | --- | --- |
| 1 | 433 ms | 487 ms | 506 / 776 ms |
| 5 | 1489 ms | 1401 ms | 1401 / 1419 ms |
| 10 | 2610 ms | 2474 ms | 2468 / 2458 ms |

Laya matches hosted TypeSafe within ~10%, so the 10-question synchronous cap and
`classifier.timeout_sec: 10` hold on both backends.

**M2: 100 calls per variant; cost per call after subtracting a 1-iteration baseline run
(1094 ms wall)**

| variant | cost per call |
| --- | --- |
| transform (a `set` task in v2) | ≈ 0.3 ms |
| `inline` child | ≈ 3 ms |
| `sync` child | ≈ 195–200 ms (193 ms workflow time) |

**M3: `list_states` with `key_pattern mem:fact:*`, 5 calls each**

| rows | limit | p50 | max |
| --- | --- | --- | --- |
| 50 | 50 | 21 ms | 25 ms |
| 200 | 50 / 200 | 22 / 24 ms | 33 / 25 ms |
| 500 | 50 / 500 | 38 / 36 ms | 43 / 45 ms |
| 1000 | 50 / 1000 | 35 / 42 ms | 39 / 44 ms |

**M5: `llama_index.query`, retrieve mode, `kb_moco_docs`, local Ollama `nomic-embed-text`, 5
calls each**

| top_k | first call | warm p50 | warm p90 |
| --- | --- | --- | --- |
| 5 | 2012 ms | 274 ms | 404 ms |
| 10 | 308 ms | 245 ms | 335 ms |

**M6: nothing is lost across the idle checkpoint. PASS in both modes.**
- `burst`: 5 pings arrive while each takes ~2s. All 5 are answered in order, the sentinel is
  intact, and there are 0 continue-as-news. That is by design: the Temporal runtime *defers*
  continue-as-new while any received event is unprocessed
  (`temporalio_workflow_runtime_context.continue_as_new_checkpoint`), so buffered messages
  cannot be dropped.
- `spaced`: 5 pings, each after the previous pong. There are 4 real continue-as-news, and the
  count, the `seen` list and the sentinel survive every one.
- The plan-00a §8 fallback (queue depth 0) is **not** needed.

**M4: 50 sequential turns on a fresh session, deployed skeleton, gateway `dsp.gemma-4-26b`,
50/50 ok (52 s)**

| metric | first turn | warm p50 | warm p90 | max |
| --- | --- | --- | --- | --- |
| `cli_ms` (end to end, the driver's round trip around `agent-cli`) | 1147 ms | 1000 ms | 1099 ms | 1212 ms |
| `wait_ms` (`agent-cli` emit → session picks it up; the first turn includes the entity start and `init`) | 639 ms | 343 ms | 394 ms | 442 ms |
| `run_ms` (the profile: `sync` agent-loop + model) | 398 ms | 428 ms | 500 ms | 669 ms |

Harness overhead is about 0.6 s per turn (≈ 0.35 s signal delivery + ≈ 0.2 s `sync` child +
delivery). Everything else is the model.

The first M4 attempt failed at once: the driver called a bare `agent-cli` from inside
`agent-harness-measure`, which is looked up as a *package* named `agent-cli` (P21). A child that
fails to start also escapes DSL v1's `catch_exception`, like P19 (in v2, `on_error` on the
calling task catches both). The fix was `agent-harness/agent-cli`.

### What the numbers mean (step 9, fold-back proposals — **applied in design v4.3**, 2026-10-05)

- **M2 → module boundaries hold** (plan-00a §8's main risk). Call harness modules `inline`
  (~3 ms). Reserve `sync` (~0.2 s each) for calls that need their own timeout or failure
  isolation: the profile run, the version probe. The skeleton already follows this; phase-1
  plans should state it as a convention.
- **M1 → question-count bounds (§7.3).** "≤ 20 source nouls, ≤ 20 tool nouls" costs ~5 s per
  call on the synchronous path, and the tool selector runs on every loop step. **Proposal**:
  cap synchronous qsets at ~10 questions (~3 s), which covers `qset.route` with a handful of
  sources plus its fixed questions, and keep 20 for offline callers. Open question 1 is answered
  for hosted TypeSafe: split `qset.route` only if it exceeds ~10 questions.
  `classifier.timeout_sec: 10` is right for ≤ 20 questions; offline 30 s × 2 stays.
- **M3 → listing is cheap, fetching is the cost (§6.4.5, F16).** Listing 1000 rows takes
  ~40 ms. But `list_states` returns keys only, and recall scores *values*, so "about 450 listed
  rows" per turn means up to 450 `get_state` reads. **Next measurement (M3b)**: a parallel
  `get_state` fan-out of 50/200 rows. Until then, keep the per-kind `limit` low (50) and cache
  agent scope as designed.
- **M4 → §12 and `turn_budget_sec`.** The skeleton's own overhead (~0.6 s) is negligible
  against the 110 s budget; `turn_budget_sec: 110` stands. §12's estimates for `preparing`,
  routing and `assembling` still need phase 1 to exist. Each phase-1 stage called as a `sync`
  child adds ~0.2 s (M2), so prefer `inline`.
- **M5 → rag budget.** Warm retrieval is ~0.3 s per source, and the first call ~2 s. Retrieval
  is a small part of the rag profile's 20–40 s estimate, which is dominated by the model call.
  A per-source timeout of 10 s is generous.
