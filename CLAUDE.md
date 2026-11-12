# moco-agent — agent harness

An **agent harness** built entirely from moco wfspecs: the machinery every conversational agent
needs (config, models, prompts, memory, knowledge, context, routing, agent loop, tools, HITL,
jobs, guardrails). An *agent* is a declarative definition (`agent.<agent_id>`) plus a few
extensions on top of it. The first agent, `moco-assistant`, replaces
`moco-examples-internal/moco-agent` (5.8.0) and is how the harness is validated.

**Status (harness 0.15.0, 2026-11-09): phases 0-3 implemented; UI steps 1-3 done; the harness is split into one package per module and sessions stop on idle (F66); moco activities and deployed workflows are tools (F67, F68), and admins pick an agent's toolsets in the UI; first-run setup is guided (F70); no harness workflow touches another user's state (F50 closed, 0.15.0).** The authoritative status block
is at the top of `docs/plan-00-overview.md`; per phase:

- **Phase 0** (0.2.1, 2026-10-05): walking skeleton (`agent-cli → agent-session → agent-loop →
  llm-invoke`), M1–M6 measured and folded into the design (plan-00a §9).
- **Phase 1** (0.3.1, 2026-10-06): access, prompts, model layer, registry + profile library,
  config tiers, guard, knowledge (pgvector), router, context builder, the `chat` / `rag` loop,
  session turn pipeline with compaction and titles, agent-cli / agent-admin, agents
  `moco-assistant` and `ops-assistant`. moco-assistant 12/12 on the answer set. Left:
  `move_source`.
- **Phase 2** (0.5.0, 2026-10-12): tools manager and tool loop, HITL, memory (store, curator,
  recall, `memory` profile), hooks, guard checks, cost limits, feedback, handoff, `kind: wfspec`
  profiles (claude), wfspec sources, custom context providers and routers, janitor + stats
  rollup, admin areas, conformance kit. Open: classifier evaluation, memory caps/decay,
  turn-page archive, agent-cli overrides.
- **Phase 3** (0.6.2 → 0.9.7, 2026-10-14 → 16): job manager (`job-store`, `job-manager`,
  `job-entity`, `job-signal`) wired into the session, async tools, moco-assistant's
  `builder` (1.5.1), all verified live. Platform schedules replace the `agent-scheduler`
  entity (`agent-schedules`, 0.6.3). `package-catalog` and the (since removed) `deployed-version` use the light
  deploy activities (`list_files`, `exclude_files`; 0.6.4–0.6.5); an empty
  `knowledge.pgvector_secret_key` falls back to the worker's `MOCO_PGVECTOR_CONN` (0.6.6).
  **0.7.0–0.7.1**: knowledge refresh that keeps the source serving (shadow table `kb_` ⇄ `kbr_`,
  F58; hourly `knowledge-refresh` schedule) and episodic memory (`memory record_episode` on
  retire, detached `memory-episode`); verified live on the dev stage (0.7.1).
  **0.8.0–0.9.0**: memory promotion (`memory-promote`, daily `memory-promote-all`, admin
  proposal ops) on a `memory-store` admin `owner_user_id`, which also gave the janitor memory
  caps and decay; per-user tool preferences; MCP tool providers (`tool-provider`,
  `tool.mcp-call`, hourly `tool-provider-sync`); the five deferred hook events; the progress
  channel (`progress#`); `knowledge-migrate-legacy`; vector recall (`memory-vector`, on the new
  moco-core `llama_index.index_texts` / `delete_docs`, off by default). Verified live, the five deferred hook
  events since 2026-10-27 (moco-assistant's observe-only `hook.moco.trace`; that run found F69). `plan_execute` stays
  deferred (no consumer). **0.9.4–0.9.7 + UI step 1**: progress relayed per turn through
  agent-cli and shown in the chat; knowledge refresh controls; a Memory page; delete-triggered
  retire skips curation (F62). UI steps 2-3: chat approvals and 👍/👎, memory proposals,
  Tools (preferences, MCP providers) and Activity (jobs, usage) pages. Next: F63 (classifier
  tuning). **0.10.0**: the harness split into 11 `agent-harness*` packages (F66
  phase 1). **0.11.0**: the session entity stops 10 min after going idle (row stays `active`,
  the janitor retires it), replacing upgrade-on-idle (F66 phase 2). **0.12.0** (session,
  memory, foundation): a session delete retires memory no remaining session backs (F65);
  `deployed-version` removed. Tool providers gained kinds `activity` (moco activities) and
  `workflow` (deployed workflows declaring `header.metadata.tool`), F67 (`docs/agent-tools.md`); activity tools are held to a per-type minimum
  side effect kept beside the allowlist in `tool-registry` (F68). **0.13.0** (tools 0.14.0): an
  admin sets an agent's toolsets in UI Tools → Agent toolsets (agent tier, no republish), and
  `tool-provider update` edits a provider in place (both browser-verified 2026-10-27).
  **F69** (foundation 0.13.1): hook-runner runs a bare hook name as `agent-<agent_id>/<name>`;
  before it, tool.before/tool.after hooks never ran from the agent loop. Open: guard custom
  checks use the same bare-name call from the loop; the UI job actions are not browser-verified.
  **0.14.0** (F70): `model-readiness` / `get_readiness`, a setup answer (and `setup` reply
  field) for a turn that failed because a model is not set up, the classifier off unless
  stated, and a UI setup checklist that stores a missing key in place.
- **0.15.0** (F50 closed): moco-core rejects `:` in a state namespace, so the admin
  `owner_user_id` store override is gone. Per-user hygiene runs as the user (`session-housekeep`
  at each idle stop: reaping, retention, memory caps; `job-manager reconcile`: stuck jobs);
  cross-user aggregates read global rows keyed by user, control data only (usage, tool audit,
  the opt-in `memory.long_term.promotion` pool). The janitor is only the cost rollup.
- **Open platform / ops findings**: F52, plan-00 §6 (F50 closed, F51 obsolete). F47 (one dev worker's concurrency) and F46
  (local classifier latency) are Low: dev-machine limits, solved by more worker instances or a
  faster classifier backend.

`ui/` is the harness UI (React, a port of `moco-apps/moco-agent-ui`; plan-16 step 9). Browser-test
it headless with the local Chrome for Testing (see the root CLAUDE.md, "Browser testing"); never
download a browser. Vite does not watch `/mnt/c`, so restart `npm run dev` after edits.

## Document map

| File | What it is | Authority |
| --- | --- | --- |
| `docs/design.md` | The design (draft v4.3): Part I harness, Part II reference agent, Part III delivery. The "Changes from …" sections at the top summarise v4.3 (measurements), v4.2 (DSL v2) and v4.1 (phase 0) | **Source of truth** for behaviour and contracts |
| `docs/plan-00-overview.md` | Build order, phase cross-walk, shared conventions, **review findings F1–F70** (with status; F35–F41 from phase 0, F42–F43 from the DSL v2 migration, F44–F47 from plans 05, 09, 14 and 18, F48 namespace admins, F49–F53 from phase 2, F54–F65 from phase 3, F66–F70 since), simplifications S1–S14 | Source of truth for build order and open findings |
| `docs/plan-00a-walking-skeleton.md` | Phase 0: walking skeleton + measurements | Where work starts |
| `docs/plan-01` … `docs/plan-18` | One implementation plan per top-level module, numbered in build (dependency) order. `plan-15` is only a pointer (telemetry was folded into `plan-14`) | Per-module roadmap |
| `docs/agent-permission.md` | Reader's guide to roles and permissions (denied / guest / user / admin, namespace admins), summarising design §6.13 | Summary only: design.md wins |
| `docs/agent-tools.md` | Reader's guide to tools: what ships, how a turn uses them, how to enable and control them, summarising design §6.9 | Summary only: design.md wins |
| `docs/proposal-namespace-admin.md` | The proposal behind F48 (namespace admins as agent admins) | Historical: the decision is in design §6.13 |

Design sections are cited as `design.md §x.y`; findings as `F<n>` (defined in plan-00 §6).

**Keep them in sync.** A decision that resolves a finding goes into `design.md` first. Then set
the finding's status in plan-00 §6 and update every plan that lists it under "Risks & open
issues". When a module's scope changes, update its plan and the plan-00 cross-walk. Every module
plan (and `plan-00a`) keeps the same nine sections (Scope, wfspecs to create, Dependencies,
Reuse, Implementation steps, Tests, Phase split, Risks & open issues, Done when) — don't add or
drop sections in one file only.

**Before adding machinery, check plan-00 §7.** v4 deliberately removed router strategies, the
loop `strategy` field, session facts, the memory weight rules, HITL statuses, implicit handoff,
the circuit breaker, generated dispatch tables and five hook events. Re-adding any of them needs
a reason that wasn't known then, usually a phase-0 measurement.

## Layout (see plan-00 §4)

```
moco-agent/
├── docs/                      # design.md, plan-00, plan-00a, plan-01 … plan-18
├── workflow/<pkg>/            # the harness: one package per module (plan-00 §4)
│   ├── moco.json              # harness → agent-harness, tools → agent-harness-tools, ...
│   ├── src/*.yaml             # flat within the package; main: <package>.yaml
│   └── tests/*.test.yaml      # <wfspec>.test.yaml / <wfspec>.unit.test.yaml
│   (harness/tests/fixtures/{src,tests}/: test-only wfspecs, never published)
├── agents/skeleton/           # package: agent-skeleton (phase 0)
├── agents/moco-assistant/     # package: agent-moco-assistant (plan-18)
├── agents/ops-assistant/      # package: agent-ops-assistant (plan-18)
├── eval/measure/              # package: agent-harness-measure (M1–M6 drivers, dev stage only)
├── ui/                        # harness UI: React/Vite, `npm run dev` on :3004 (see ui/README.md)
└── scripts/                   # dev-stage.sh (publish/deploy/chat), measure.sh, check-packages.py
```

The packages: `agent-harness` (agent-cli, agent-admin), `-admin` (admin.*), `-foundation`
(access, namespace-admin, agent-config, agent-harness-defaults, agent-registry, package-catalog,
prompt-render, llm-invoke, decide, hook-runner, claude-capabilities), `-prompts` (prompt.*,
qset.*, profile.*), `-session` (agent-session, session-store, conversation-compactor, hitl,
session-probe, profile-availability), `-loop` (agent-loop, context-builder,
query-router, guard), `-tools`, `-knowledge`, `-memory`, `-jobs`, `-ops` (janitor, schedules,
keep-warm, conformance-kit). The engine loads a whole package per resolved wfspec, and every
break-away child starts empty: that is why the harness is split (F66).

**Refs across packages.** A bare name resolves only inside packages already loaded in the run,
otherwise it is looked up as a package. So a call into another harness package is written
`agent-harness-<pkg>/<wfspec>`, and a call inside the caller's own package stays **bare** (in
`moco test` a qualified ref to the own package would hit the deployed copy). Names built in
expressions follow the same rule. A new wfspec goes into its module's package; run
`scripts/check-packages.py` after any change that adds a wfspec or a ref -- it exits non-zero
on drift. Inside a package `src/` stays flat: the CLI bundler and test runner only look beside
the file (F41).

**Versions.** Each harness package has its own `moco.json` version; bump only the packages that
changed (a re-publish of an existing version is silently ignored). The harness version is
`agent-harness`'s (`harness_version`, an agent's `harness:` range); bump it when a cross-package
contract changes. A live session picks up any redeploy at its next idle stop, so no package
needs bumping just to reach live sessions.

Harness and agent packages deploy into the **same namespace**, so extensions referenced by name
resolve at runtime. Every package needs a main wfspec named after it, and package names cannot
contain dots. Agent packages are therefore `agent-<agent_id>`, and the definition
`agent.<agent_id>` is loaded package-qualified: `agent-<agent_id>/agent.<agent_id>` (F40).
Entry points run as `agent-harness/agent-cli` and `agent-harness/agent-admin`; the rest as
`agent-harness-<pkg>/<wfspec>` (seed-tools in `-tools`, seed-memory in `-memory`).

## Rules that must not be broken

These are the design's load-bearing invariants. A change that violates one is a design change —
raise it, don't just code it.

- **Layering** (design §4.1): a module calls only its own layer or below
  (Interface → Orchestration → Agent → Foundation). Only `agent-session` calls into every layer.
  The Agent layer never calls the Orchestration layer: anything that needs the session or the job
  manager is *returned* (`job_request`, tool `audit` records, `pending_action`) and the session
  acts on it. `access` is Foundation; `guard` is Agent.
- **One owner per storage layout** (§4.3, §8). Only the owning wfspec calls `builtin.state` for
  its keys; everyone else calls the owner with a `mode`. This is the lesson of the old agent,
  where three copies of the session key layout drifted apart.
- **Call envelope** (§4.3): `input: {mode, agent_id, ...}` →
  `output: {ok, data, error: null | {code, message, retryable}}`. Expected failures return
  `ok: false`; raise only for bugs and misconfiguration.
- **Authority** comes from `__user_info__.user_id`, never from an input. Admins are
  `access.admin_user_ids` plus the namespace admins (`<ns>:manage_ns` holders, F48), whose
  per-caller flag `access.caller_is_namespace_admin` only `agent-config resolve` may write.
- **Row state machines**: every transitioning mode checks the current status first; an illegal
  transition returns `ok: false, code: invalid_state`, never a silent overwrite.
- **One live writer per row** (§4.3, no compare-and-set): the session entity writes its session
  rows, the job entity its job row; others send it an event. Background jobs only touch rows of
  retired sessions, or long-term memory items.
- **`schema_version`** on every persisted row; readers accept the current and previous version.
- **Model access**: only `llm-invoke` calls `openai.chat.completions`; only `decide` calls
  `typesafe.system_one`. System One is the **self-hosted moco-systemone** (worker default
  `TYPESAFE_DEFAULT_BASE_URL=http://localhost:8002`, `qwen3:0.6b`). The classifier is OFF
  unless stated (F70): `models.classifier.base_url`, or `worker_default: true` at the agent tier
  (the dev stage's agents have it). Never point it at the hosted TypeSafe model. It runs on CPU and is
  slow; when every decision degrades, check that the moco-systemone container is up (F60).
  Every label / probability / score decision goes to System One, not a chat model.
- **Secrets**: store secret *names*, never values; long-lived entities never cache a secret.
  Pass a secret known to be static by name (`*_secret_key`). Where a field takes a static key or
  an acquired token alike (http / mcp `encrypted_auth_token`), pass the encrypted, short-lived output
  of `builtin.secret.get`; never a plaintext value.
- **Extensions tighten, never loosen**: hooks, guard checks and user/agent config can restrict
  permissions but cannot grant them. `deny` always wins.
- **Memory is not knowledge**: memory is never citable, and conversations never write the
  `agent` scope (only human-approved promotion does).

## Platform facts to design around (design §3)

- No Temporal query/update is exposed: synchronous reads go through `agent-admin` against
  persist_state, never the live entity.
- `checkpoint_policy` only works when the `state_machine` *is* the body — hence one state
  machine in `agent-session`, and the agent loop as a child.
- The client waits 120s (UI aborts at 130s): a synchronous turn must finish in ~110s; longer work
  becomes an async job.
- `mode: detached` falls back to inline when a *file* is run, and the CLI bundler only
  follows literal `workflow.ref` references. So develop against a **dev stage**: publish
  the harness and agent packages and run entry points by name. `moco run <file>` is only for leaf
  wfspecs, and tests mock dynamic children by `task_name`.
- Continue-as-new re-passes the original boot args and carries state over; it does **not** pick
  up a newly deployed wfspec. Live sessions pick it up by stopping 10 min after going idle (§4.3).
- `wait_for.event.match_expression` filters by event data — that is how `agent-cli` matches its
  own `message_id`.
- Offline jobs are **platform schedules** (P13): `agent-schedules install` (called by `seed-tools`
  at deploy) upserts one per job, running as the installing admin, and keeps an admin's
  pause/resume across redeploys. Operate them with the moco UI (Schedules) or `moco schedule`;
  there is no harness scheduler entity. Schedules live in Temporal: a reset Temporal dev
  server loses them, so re-run `agent-schedules install` after one. No embeddings activity (the `llama_index.*` activities
  embed internally), and no compare-and-set on `builtin.state` (P15): where a background job
  must not overwrite a newer writer, the owner checks a guard field before writing (see
  `source-registry patch`'s `if_refreshing`). MCP tools can be listed with `mcp.list_tools`
  (P14), hashes included.
- **One event at a time (P17).** A state machine reads the next event only after the whole
  transition chain has finished, and automatic chains refuse to revisit a state. The message
  queue is Temporal's signal buffer, and queue depth is enforced from `sent_at` timestamps.
- **Pinning (P18).** The entity and its `inline` children stay on the package version they
  started with -- every package they loaded. `sync`/`async`/`detached` children resolve
  afresh. That is why the entity stops 10 min after going idle (`session.idle_stop_sec`, no
  active job): the next message boots the deployed packages (§4.3).
- **`sync` timeouts raise in the parent (P19)**, at the calling task. Give every budgeted `sync`
  call `on_error: {catch: true}` on that task (see `run-profile`): it catches the parent-side
  timeout too. No guard function is needed in DSL v2.
- **P20.** The chat activity returns no usage and no `finish_reason` (usage is estimated), and
  `tool_choice` must be a literal. Activity `retry_policy` fields (`timeout_sec`, `max_attempts`,
  ...) DO take expressions -- the old "timeouts must be literals" was wrong (F37, verified
  2026-10-16). Bound a call by the config / remaining budget directly.

## Writing wfspecs here

- **DSL v2 only** (`header` / `main`; `moco-core/docs/dsl/spec.md`). No `wfspec_version`: the
  package version in `moco.json` is the version, and `__sys_info__.wfspec_version` reports it.
  The `moco-developing-workflows` skill covers the syntax.
- Validate after every change: `moco validate <file>`; run with `moco run <file> --debug`.
  `#`-suffixed variables are logged to the CLI.
- Scratch values inside one `set` are task-local `_name`; **a value any later task reads must be a
  plain context name** -- a task-local read later is a NameError (hit three times in phase 1:
  `decide`, `query-router` twice). `_name@` is invalid in v2 (`_` task-local, `@` container).
- A state-machine wfspec declares its result in the top-level `output`: it reads the context the
  state callbacks wrote.
- `inline` children get a fresh context and no Temporal child: use them for data and store calls.
  Put `on_error: {catch: true}` on any task whose failure must become data. An activity task
  catches its own failure; no wrapper function is needed.
- Never bind a lambda to a variable: a function value in the workflow context will not survive
  serialisation. Apply it inside the one expression that needs it.
- `now()` is timezone-aware. Strip tzinfo before subtracting a parsed ISO timestamp.
- A `loop` over a `tasks` body collects, per item, the list of each task's result.
- **qsets must sort** the keys of `state` and `questions` before returning. Temporal serialises
  activity input with sorted keys while `--in-memory` keeps authoring order, and System One gives
  different probabilities for the two.
- Every System One question needs `instructions`.
- **The state is the thing being judged** (F44): to judge N items send N requests
  (`decide_many`), never one state with a question per item, which makes every item score alike.
- In a `>-` folded expression, a **more-indented** continuation line keeps its newline, and the
  v2 schema's expression pattern does not match across lines: a typed activity field (e.g.
  `messages`) is then rejected. Build such values in a `set` task and pass the variable.
- A `#` inside a `>-` folded expression is a *Python* comment and silently eats the rest of the
  expression.
- A value is evaluated as one *typed* expression only if it holds exactly one `{{`. A second `{{`
  anywhere, even inside a string literal (`s.count('{{')`), turns it into string interpolation:
  a list comes back as `"[]"`. Build braces with `chr(123) * 2` (see `tool-registry`). `type` is
  not a sandbox builtin either: use `x is None or isinstance(x, str)`.
- `skip_if`, `raise.if` and an assert must evaluate to a real `bool`: `or some_list` is a
  `ConditionTypeError` / a failed assert, not falsy. Wrap with `bool(...)`.
- The sandbox's `uuid4()` returns a **string** (`str(uuid4()).replace('-', '')`), not a UUID.
- `event` is a reserved name: an input key `event` is **dropped silently** (hook-runner takes
  `hook_event`). A key inside data (a hook entry's `event:`) is fine.
- `claude_agent.query`'s `result` is the agent's LAST message, which can be a reply to a
  background command's notice rather than the answer (F57). Ask for `include_transcript` and take
  the last assistant text that has the marker you asked for (see `subagent.builder`).
- An activity's typed nested fields (e.g. claude_agent `capabilities.moco_tools`) cannot each be
  an expression; build the whole mapping in a `set` task and pass `field: "{{ var }}"`.
- A `parallel` loop whose body is an inline child that starts a `sync` grandchild collides on
  the grandchild's workflow id (F52): run it sequentially.
- To evaluate a data template (a manifest's `{{ }}` strings) with a restricted scope, run
  `tool-render` inline: a value's second `#python` pass applies to strings only.
- Port from the old agent where a plan's Reuse section says so. It was removed from the tree
  (commit da0ce1f): read it from history, `git show da0ce1f^:moco-examples-internal/moco-agent/src/<file>`
  (its tests under `.../moco-agent/tests/` are the parity baseline). That code is DSL v1: convert
  it first (`python -m scripts.dsl_convert --to v2 <file>` from the repo root), then edit.
- A literal `workflow.ref` cycle is rejected by the CLI bundler; where the design needs one (the
  job path, F56), name the target by expression and mock the wfspec that holds it.
- A child accepts input keys it does not declare (they are readable, verified 2026-10-16), so a
  caller may pass an extra key to every child of a kind (tool-executor's `binding`).
- `import` (or any Python keyword) cannot be an input name: expressions cannot reference it
  (`tool-provider` takes `import_spec`). And never build wfspec text with Python f-strings: they
  halve `{{ }}` into `{ }`.

## Testing

Develop and test in the default **workflow** mode (Temporal): it is part of the dev environment and
gives history and traceview. `--in-memory` is a runtime for low-latency and desktop deployments,
not a dev shortcut, and it behaves differently: raw pydantic activity outputs, no continue-as-new,
no real `sync` children. If a run times out, fix the cause rather than switching modes.

```bash
scripts/dev-stage.sh harness             # deploy first: a test sees only its own package
cd workflow/<pkg> && moco test            # one package's suites on Temporal (run in the background)
moco test tests/<wfspec>.test.yaml        # one suite
scripts/dev-stage.sh && scripts/dev-stage.sh chat "hello"    # deployed, by name
```

- Assert on **bare variables** — `__OUTPUT__` is never bound, so asserts against it silently
  pass as None.
- Mock `typesafe.system_one` and dynamic children **by `task_name`** (`classify`,
  `run-profile`, `render-prompt`); the mocked raw output is `_`. Only `activity` and `workflow`
  tasks can be mocked, not `emit_event` or `wait_for`. To drive an `on_error` path, give
  the mock a value that fails to evaluate (`_: "{{ 1 / 0 }}"`): that is a real task error. The
  same mock is the sentinel proving a step did NOT run (a run would fail the case).
- **Integration-test `input` is never evaluated**: `"{{ 'x' * 5000 }}"` arrives as that literal
  string (v2 does not evaluate a declared `input`). Write fixtures out literally. Unit-test
  input is evaluated, because the runner wraps it in a `set`: one map, so its keys cannot read
  each other, and a fixture holding `{{ }}` templates needs `name#literal`. The unit runner does
  load the wfspec's `context` and `input` defaults, but you must pass the step's `skip_if` names.
- **No YAML merge keys** (`<<: *anchor`) in test files: the loader passes `<<` through as a
  key (`WorkflowSpecError: context:`). Spell fixtures out.
- **"expect X, but got None" for every output field means the workflow RAISED.** Probe it with
  `expect: {error: {error_type: XXX, error_message: XXX}}`: the mismatch message shows the real
  error (most often a task-local `_name` read by a later task).
- To see an internal value in a **unit** test, expect it: `expect: {output: [{name: X}]}` -- the
  mismatch message prints the real value (an assert only prints True/False).
- Asserts see only the wfspec's **output** keys, never its internal variables. Put a value in
  the output, or unit-test the step that computes it.
- `agent-session` cannot be driven by events in a test: its decisions live in named `set` tasks
  (`classify-message`, `decide-tick`, ...) and are unit-tested.
- Every row-state-machine module tests each legal *and* illegal transition.
- Extension points get a conformance-kit case (plan-03).
- `moco test` and `moco run <file>` report tier `dev` on the local server, so stage-gated
  deploy-DB reads (`package-catalog`, `namespace-admin`) run for real unless mocked.
- `token authentication failure for principal …` from the LLM gateway means the local
  `MY_LLM_TOKEN` is stale — not a wfspec bug.
- One suite file is ONE MCP request (default 300 s, `moco test -t <sec>`): a unit suite that grows
  past ~60 cases of a big wfspec times out as a whole ("MCP error -32001"). Split it by area
  (`agent-session.unit` / `agent-session.jobs.unit`) rather than raising the timeout.
- An **integration** suite sends every `*.yaml` in its package's `src/` with it. A child in
  another package resolves to the version **deployed on the stage**, not your local file:
  publish the changed packages before testing a caller against them, or mock the calling task.
  `413 Request Entity Too Large` is nginx's body limit (F59; now 16m), not the suite.
- After `make gen-catalog && make gen-schema`, run `moco schema update`: the CLI validates
  against a schema cached in `~/.moco`, which otherwise does not know the new activities. The
  running workers and server also need a restart to load them.
- Never edit `src/` while a long `moco test` runs: a suite that reads a half-written file fails
  to load (`while parsing a block mapping`), which looks like a real failure.
