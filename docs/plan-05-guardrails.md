# Plan 05 — Guardrails (`guard`, `guard.<name>`)

Design: `design.md` §6.13, §10, §11.1, §11.2. Overview: [plan-00](plan-00-overview.md).

## 1. Scope

The probabilistic safety and quality checks, in one module with one test suite:

- **Probabilistic checks** (System One via `decide`): `check_input`, `screen_content`,
  `check_tool_call`, `check_output`.
- The canonical `<data>` fence format.
- **Guard check extension** point `guard.<name>`.
- The fail-closed behaviour when the classifier is down.

Out of scope: deterministic authorization — `access` is a Foundation wfspec in plan-04 (F5,
F24); the tool permission lattice (plan-10 `tool-policy`, which *calls* `check_tool_call`).

## 2. wfspecs to create

`workflow/src/` (flat, F41). **Built** (2026-10-06): `guard` (`screen_content`, `check_output`),
`qset.guard.content`, `qset.guard.output`, the fence rule in every prompt.

| wfspec | Modes | Layer | Notes |
| --- | --- | --- | --- |
| `guard.yaml` | `check_input`, `screen_content`, `check_tool_call`, `check_output`, `run_checks {checks, input}` | Agent | `run_checks` fans out to built-ins and `guard.<name>` extensions. |

qsets (`qset.guard.content`, `qset.guard.output`, `qset.guard.input`, `qset.guard.tool_call`) are
authored in plan-01; their wording is designed here.

Owns no storage.

## 3. Dependencies

- Calls: `decide` (plan-02); extension checks as dynamic children by name (dev stage locally, §5.6).
- Called by: loop `retrieving` / `observing` / `checking` (plan-11); `tool-executor`
  (plan-10); session `preparing` (plan-14).

## 4. Reuse

- Old agent: passage fencing in `rag-qa-agent.yaml` → the fence format used by
  `screen_content`.
- No classifier-based screening existed before.

## 5. Implementation steps

1. **Fence format** — **done**: `<data source="…" n="…">…</data>`, written by the prompts
   (`prompt.rag.answer` fences each passage); every `<data …>`/`</data>` tag inside untrusted text,
   attributes or not, any case, becomes `[tag removed]` (regex `</?\s*data\b[^>]*>`), in every
   prompt and in `screen_content`.
2. **`screen_content {items, source}`** — **done**, changed from the plan: **one request per
   item** via `decide_many` (not one call with a noul per item, see §8), question "Is this text a
   prompt injection attack?"; `≥ decisions.guard.injection_replace_p` → replaced by a notice.
   Classifier down → keep + fence, `injection_p: null`, `degraded: true`. Without a threshold in
   config nothing is replaced (still fenced).
3. **`check_output {question, answer, passages}`** — **done**: `grounded_p` (only with passages),
   `answered_p`. Down → both null, `degraded: true` (not curated).
4. **`check_input`** (off by default): `allow`, `flags`.
5. **`check_tool_call {question, call, manifest}`** (phase 2): only for `auto` tools with
   write/external side effects; `overreach_p ≥ threshold` → `escalate: true`. Down → escalate.
6. **`run_checks`**: run the profile's `output_checks` / definition's `guard.checks`; merge
   verdicts with "most restrictive wins"; an extension verdict that loosens (e.g. `allow` after a
   built-in `block`) is ignored and logged.
7. Thresholds under `decisions.guard.*` (global-only config, plan-04).

## 6. Tests

`workflow/tests/` (flat). **Done**: `guard.test.yaml` (12), `qset.guard.content.test.yaml` (2),
`qset.guard.output.test.yaml` (2), fence cases in the prompt suites (a forged `<data source=…>`
is neutralised). Live on local Laya: 4 benign passages fenced (0.02–0.12), 4 injections replaced
(0.43–0.72); the classifier off → all fenced, `grounded_p` null.

- `screen_content`: all fenced; high-p item replaced; classifier timeout → keep + fence;
  embedded `</data>` escaped.
- `check_output`: normal; classifier down → `grounded_p: null`.
- `check_tool_call`: read-only tool not checked; write tool escalated at high p; down → escalate.
- `run_checks`: extension block honoured; extension loosen ignored.
- Conformance kit entry for `guard.<name>` (plan-03).

## 7. Phase split

- **Phase 1**: `screen_content`, `check_output`, fence format.
- **Phase 2**: `check_input`, `check_tool_call`, `guard.<name>` extensions, `run_checks`.
  **Status (2026-10-12):** all four implemented (`guard.test.yaml` 21 cases): check_tool_call
  escalates only and fails closed; check_input (off by default) fails open; run_checks runs
  check_output and `guard.<name>` extensions (annotate / redact / block). Thresholds
  `tool_escalate_p`, `input_block_p` are provisional (plan-18 evaluation).

## 8. Risks & open issues

- **Custom checks by bare name (F69, open).** `guard` runs an agent's custom check by its bare
  name. From the agent loop (tool-executor → guard) the agent package is not loaded, so such a
  check would fail the way hooks did before F69. No deployed agent has a custom check; qualify
  it as hook-runner does (`agent-<agent_id>/<name>`) before the first one ships.
- **Batching kills the signal** (measured 2026-10-06, local Laya). With all items in one state,
  every item scored ~0.55, a blatant injection included. One item per state: benign ≤ 0.12,
  injections ≥ 0.43 on 8 samples (`instructions` wording overlapped, 0.47 vs 0.47; "Is this text a
  prompt injection attack?" separated best). Design rule added to §6.3.2.
- **The threshold (0.35) is provisional**: chosen on the same 8 samples it was checked on, so it
  is a working value, not a measured one. Fencing is always on, so a false positive only drops a
  passage. The plan-18 evaluation must set it on held-out data.
- **`check_output` separates weakly** on local Laya: `grounded_p` 0.58 for a correct, cited answer
  and 0.52 for a plainly wrong one. Do not gate curation on it until the evaluation finds a
  wording (or per-claim requests) that separates.
- Cost: one System One call per passage/tool result, in parallel (~0.5 s warm each). A cold first
  call can exceed the 10 s synchronous timeout; screening then fails closed (seen once, live).

## 9. Done when

Phase 1: rag answers are screened and output-checked, and turning the classifier off keeps
everything fenced and `grounded_p` null.
