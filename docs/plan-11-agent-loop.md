# Plan 11 — Agent loop (`agent-loop`, profile contract, handoff)

Design: `design.md` §6.8, §5.3, §5.4 (`tool.before`), §12. Overview: [plan-00](plan-00-overview.md).

## 1. Scope

Run one profile on one request within `budget_sec` and return a result in the **profile
contract**. `chat`, `rag`, `react` and `memory` are configurations of one state machine. A
profile with `tools` loops; one without runs a single step. There is no `strategy` field (S3).
Also: the contract every `kind: wfspec` profile honours, the grounding rule, and explicit
handoff.

Out of scope: choosing the profile (plan-09); the re-dispatch on handoff and starting jobs
(session, plan-14); persisting pending actions (plan-12); `claude` / `builder` (plan-18).
Removed in v4: implicit handoff (`handoff.on_declined`, S6, F10).

## 2. wfspecs to create

`workflow/src/` (flat, F41). **Built** (2026-10-06): `agent-loop` phase 1 (`start → retrieving? →
thinking → checking → done`). `profile-contract` / `profile-runner` wait for `kind: wfspec`
profiles (phase 2): until then the loop always returns a complete contract itself, and the
session calls it directly as task `run-profile`.

| wfspec | Notes |
| --- | --- |
| `agent-loop.yaml` | Child workflow whose body is a `state_machine` (P5 allows it here). States §6.8.3. |
| `profile-contract.yaml` | Data: input/output schema, used by the conformance kit and by the session's result normaliser. |
| `profile-runner.yaml` | Session-side helper: `kind: loop` → `agent-loop`; `kind: wfspec` → the profile wfspec by name; `sync` with `on_error: {catch: true}` on the task, timeout = `budget_sec`. Task name `run-profile` so tests can mock it (P7). |

Owns no storage (the loop's working memory is `turn_ctx`, returned in `trace`).

## 3. Dependencies

- Calls: `knowledge retrieve` (plan-06), `guard screen_content` / `run_checks` (plan-05),
  `tool-policy` / `tool-selector` / `tool-executor` (plan-10), `llm-invoke` + `prompt-render`
  (plan-01/02), `hook-runner` for `tool.before` (plan-03), `memory` (for the `memory` profile).
- Called by: session `running` / `resuming` (plan-14) through `profile-runner`.
- Returns, never performs: `pending_action`, `job_request`, tool `audit` records (Agent layer
  → the session acts, §4.1).

## 4. Reuse

| From | To |
| --- | --- |
| `rag-qa-agent.yaml` — retrieve, decline on zero passages, answer with citations | a no-tools profile with `retrieval.when: before`, `on_empty: decline` |
| old chat path in `moco-agent-session.yaml` | a no-tools profile, no retrieval |

## 5. Implementation steps

### Phase 0 — one step (plan-00a)

1. `start → thinking → done` with inline messages and `llm-invoke chat`; profile-contract output.

### Phase 1 — no-tools profiles

2. **Profile contract** (§6.8.1) as data (incl. `job_request`); a normaliser that fills defaults
   and turns malformed outputs into `status: error`.
3. **Budget**: `deadline = start + budget_sec`, where the session passes `min(profile.budget_sec,
   turn budget left)`.
4. **`retrieving`**: only if `retrieval.when: before`; sources `from_router | all | [names]`;
   `guard screen_content {source: passage}`; zero passages + `on_empty: decline` → `done
   (declined)` with the templated `decline_message` and **no model call**. The rag decline
   message names `/claude` when the agent has it (replacing v3's implicit handoff).
5. **`thinking`**: `llm-invoke render_and_chat(model_role, prompt.loop | rag.answer, bundle,
   passages)`, `timeout_sec` = time left − margin.
6. **`checking`**: `output_checks` via `guard run_checks`; grounding rule (`passages` →
   `passages > 0 and grounded_p ≥ threshold`; `tool_results` → any tool ok; `none` → false).
   Below threshold: keep the answer, add a note, `grounded: false` (not curated).
7. **Result**: `answer, sources, grounded, grounded_p, used_memory, usage, trace`.
8. `profile.chat` and `profile.rag` run end to end; `profile-runner` for `kind: loop`.

### Phase 2 — tools, HITL, explicit handoff, `kind: wfspec`

9. **`selecting`**: `tool-policy resolve` → `tool-selector` (skipped on resume).
10. **`thinking`** with tools; `tool_calls` → `acting`; none → `checking`; `step = max_steps` or
    time left < 15s → `answering`.
11. **`acting`**: ≤ 4 calls per step, each preceded by the `tool.before` hook (block → `denied`)
    and executed with `tool-executor call`; collect `audit` records. Any `needs_approval`, or
    `ask_user` → `suspended`; `needs_credential` / errors → returned to the model as tool
    results. **If a step has both `ask_user` and an approval-needing call, suspend on
    `ask_user`**; the other call is dropped and the model re-requests it after the reply (F20).
12. **`observing`**: append screened results; `step += 1` → `thinking`.
13. **`answering`**: forced final call, `tool_choice=none`, "stopped after N steps"; **hard
    `timeout_sec` = time left − 2s and `max_tokens` ≤ 800**. On timeout, return the last
    assistant text, or a fixed "ran out of time" message (F14).
14. **`suspended`**: `pending_action {kind: tool_call | user_input, summary, detail: {call,
    call_version, messages ≤ 30k chars (oldest tool results truncated first), step, tools,
    completed_calls}, expires_in_sec}` → `done (needs_approval)`.
15. **Resume**: `resume {pending_action, decision, feedback, approval_token}`; approve /
    approve_session → `acting` with the held call, re-validated against the current manifest
    version; reject / revise → `observing` with a synthetic declined tool result (+ feedback);
    `user_input` → the reply becomes the `ask_user` tool result.
16. **Explicit handoff**: a `kind: wfspec` profile returns `status: handoff {profile, reason}`.
    The loop returns it unchanged; the session re-dispatches once if the target's
    `estimated_sec` fits, and otherwise delivers with a slash-command hint (plan-14).
17. **`kind: wfspec` profiles** through `profile-runner`, with contract validation of their
    output. **`profile.react`, `profile.memory`** (the latter: `qset.memory.command` → memory
    mode → answer describing the change).

### Phase 3

18. `plan_execute` ships as a `kind: wfspec` profile (§5.1), not as a loop change.

## 6. Tests

`workflow/tests/` (flat). **Done**: `agent-loop.test.yaml` (9: chat, a model failure as status error,
rag retrieve→screen→answer→cite, weakly grounded → note, degraded check, zero passages → decline
with no model call, the `/claude` hint, no router sources, a replaced passage never a source).
`sources` are the passages the answer cites as `[n]`; `decisions.guard.grounded_min_p` (0.5,
provisional) gates `grounded` and the "could not verify" note.

- Every transition in §6.8.3: zero-passage decline (zero `llm-invoke` calls); max steps →
  answering; budget < 15s → answering; answering timeout returns the last text (F14).
- `max_steps` forced to 1 when `tools` is null.
- Grounding rule for each `grounding` value and at the threshold boundary.
- Tools: one round trip; 5 calls in a step → only 4 executed; hook block → denied; approval →
  suspended with a well-formed pending action; resume approve / approve_session / reject /
  revise; manifest version changed on resume → stricter permission applies; `ask_user` +
  approval in one step (F20); audit records returned for every executed call.
- Profile contract conformance: `chat`, `rag`, `react`, `memory` against the shared
  `context_bundle` fixtures (conformance kit, plan-03).
- Mock `typesafe.system_one` by task name `classify`, children by `run-profile` and
  `render-prompt` (§18).

## 7. Phase split

- **Phase 0**: step 1.
- **Phase 1**: steps 2–8.
- **Phase 2**: steps 9–17. **Status (2026-10-12):** steps 9–15 implemented
  (`agent-loop.tools.test.yaml`, 14 cases: round trip, max steps → answering, time short,
  four-call cap, unknown tool, suspend with a well-formed pending action, `ask_user` wins (F20),
  resume approve / reject / re-suspend / tool gone / reply). `stepping` is one state with a step
  loop (P17). Verified live on ops-assistant. Open: 16 (handoff), 17 (`kind: wfspec` profiles,
  `profile.memory`).
- **Phase 3**: step 18.

## 8. Risks & open issues

- **F70 (resolved, 0.14.0)**: both model call sites catch `llm-invoke`'s raise as `trace.error.code: unconfigured`; when every searched source FAILED, rag declines with `loop.unavailable_message` ("couldn't search") and records `retrieval_failed` with the error text.
- Phase 0 (done): the body is the state machine, and the contract is the top-level `output`,
  read from the context the states wrote. (In DSL v1 it had to be assembled in the terminal
  `done` state and exposed with `output_name`, F41.)
- **F38**: the session bounds the loop with its `sync` run timeout, and catches on the calling
  task (`on_error`) so the timeout cannot fail the entity. Inside the loop there is no per-call bound yet.
- **F37 (open, platform)**: the `answering` state's hard `timeout_sec = time left − 2s` and the
  phase-2 `tool_choice=none` forced call both need what the platform does not offer (literal
  activity timeouts, literal `tool_choice`). Plan for literal variants, or ask for the platform
  change before phase 2.
- **P18**: the loop runs as a `sync` child, so it is resolved afresh on every turn. A live
  session that has not yet upgraded may call a newer loop: keep the profile contract backward
  compatible within a major.

- The 30k-char `messages` cap in `detail`: long tool results must already be artifacts, or the
  resume loses context. Oldest tool results are truncated first.
- `estimated_sec` values come from phase-0 M4/M5 and from production `usage.elapsed_ms`; review
  them after phase 1.

## 9. Done when

Phase 1: chat and rag pass the contract suite and reach rag parity on the answer evaluation set.
Phase 2: a tool-calling turn can call tools, suspend for approval, resume after a session retire,
and finish.
