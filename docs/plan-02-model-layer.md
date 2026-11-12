# Plan 02 — Model layer (`llm-invoke`, `decide`)

Design: `design.md` §6.2, §7.3, §3 P1/P11/P12. Overview: [plan-00](plan-00-overview.md).

## 1. Scope

- **`llm-invoke`**: the only caller of `openai.chat.completions`. Role → model resolution,
  schema-validated JSON with one repair call, fallback model, error taxonomy, `usage#`.
- **`decide`**: the only caller of `typesafe.system_one`. Runs a question set, maps keys through
  the keymap, computes confidence, owns the fallback (`llm | default | none`).

Out of scope: prompt text (plan-01), the model catalog and role config (plan-04), `claude_agent`
(plan-18), embeddings (plan-06, via `llama_index.*`).

## 2. wfspecs to create

`workflow/src/` (flat, F41). **Built** (2026-10-06): all of `llm-invoke` (`chat`, `render_and_chat`,
schema + one repair, `fallback_model`) and all of `decide` (`decide`, `decide_many`).

| wfspec | Modes | Notes |
| --- | --- | --- |
| `llm-invoke.yaml` | `chat {role, models, messages, tools?, tool_choice?, response_format?, schema?, max_tokens?, timeout_sec?}`, `render_and_chat {role, models, prompt, variables, resolved_refs, ...}` | Out: `{content, parsed, tool_calls, finish_reason, model, usage, elapsed_ms, repaired, fallback_used, prompt_version}`. Three named requests (`call-model`, `call-fallback-model`, `repair-model`) sharing the functions `classify-call` (error taxonomy) and `parse-json` (parse + schema subset). |
| `decide.yaml` | `decide {qset, variables, resolved_refs, models, fallback, default?, timeout_sec?, attempts?}`, `decide_many {qset, items, ...}` | Out: `{choices, nouls, scores, confidence, keymap, decided_by, model, usage, elapsed_ms, replaced}`. Takes the whole `models` block (classifier config + the decision role for the fallback) rather than a separate `classifier_config`. `default` is keyed by **mapped** names. |

Owns no storage.

## 3. Dependencies

- Calls: `prompt-render` (plan-01); activities `openai.chat.completions`, `typesafe.system_one`.
- Called by: router, loop, memory curator/compactor, guard, tool-selector, session (title).
- Needs from plan-04: the shape of `models.<role>` = `{provider, model, base_url,
  apikey_secret_key, max_tokens, temperature, fallback_model?}`. Until plan-04 exists, tests pass
  a literal `models` dict.
- **`decision` is an optional alias** (§6.2.1, S13): when `models.decision` is null, role
  `decision` resolves to `models.inference` with `max_tokens: 600` (configurable as
  `models.decision_default_max_tokens`).

## 4. Reuse

- `moco-agent-session.yaml` / `rag-qa-agent.yaml`: the existing `openai.chat.completions` call
  blocks (secret key handling, gateway `base_url`) → `llm-invoke chat`.
- `query-analyzer.yaml`: the `typesafe.system_one` call, response parsing and keymap handling →
  `decide`.

## 5. Implementation steps

### `llm-invoke`

1. `chat` happy path (**phase 0**, plan-00a): resolve role, including the `decision` → `inference`
   alias; only `max_tokens` and `timeout_sec` overridable by the call; `apikey_secret_key`
   passed through (P11 — never resolve or cache the secret).
2. Error taxonomy: map activity failures to `timeout | provider_error | auth | invalid_json |
   context_overflow`; `auth` also logs `misconfig#` loudly. Return `ok: false`, never raise for
   these.
3. `schema` path: parse → validate → on failure **one** repair call ("return valid JSON matching
   this schema", with the parse error) → still invalid → `invalid_json`. `parsed` is `null`
   unless validated. Implement validation as an expression-level check of required keys and
   primitive types (no JSON-Schema activity exists); keep the subset documented.
4. `fallback_model`: provider error or timeout → retry once on it; record `model` actually used.
5. `render_and_chat`: `prompt-render render` → `chat` with the prompt's `schema` /
   `response_format`; add `prompt_version`.
6. Emit `usage#: {role, model, tokens_in, tokens_out, elapsed_ms}`.

### `decide`

7. `decide` happy path: `prompt-render render` (qset) → `typesafe.system_one` with
   `classifier_config.timeout_sec` (default 10) × 1 attempt; map positional keys through
   `keymap`; compute `confidence` per §6.2.3 (choice: chosen label's p; noul: `abs(p-0.5)*2`;
   score: modal level's p).
8. Re-validate: an answer outside the offered labels → that question takes its default.
9. Fallback matrix (§6.2.3 table): `classifier.enabled: false` or timeout/5xx → `llm` renders
   `prompt.decide.fallback` and calls `llm-invoke chat` with role `decision` and the generated
   schema; `default` returns `default`; `none` returns `ok: false`. **4xx always raises** (a
   malformed qset is a bug).
10. `decide_many`: a parallel `loop` over items (`execute_mode: parallel`), same options.
11. Offline callers pass `timeout_sec: 30, attempts: 2`; expose `attempts` in `classifier_config`.
12. Log `decision#: {qset, choices, nouls, scores, decided_by, elapsed_ms}`.

## 6. Tests

`workflow/tests/` (flat). **Done**: `llm-invoke.test.yaml` (27), `decide.test.yaml` (15). Live on the
dev stage: `decide(qset.route)` against local Laya (route `rag`, p 0.74; 1.6 s warm for 4
questions) and the `llm` fallback against the gateway model (schema-valid on the first request).

- `llm-invoke`: mock the activity by `task_name` (`call-model`; the mock is the assistant message). Cases: plain chat; `decision` role with
  `models.decision: null` → inference model with the low `max_tokens`; tool_calls pass-through;
  schema valid first time; schema invalid → repair ok; repair fails → `invalid_json`; timeout →
  fallback model; auth error → `ok: false, code: auth` and `misconfig#` set; caller cannot
  override `model`/`temperature`.
- `decide`: every row of the fallback table × each `fallback` value; 4xx raises; out-of-set label
  → default; confidence formulas for each question type; keymap mapping; `decide_many` order
  preserved.

## 7. Phase split

- **Phase 0**: `llm-invoke chat` (steps 1, 2, 6).
- **Phase 1**: the rest of `llm-invoke`, all of `decide`.

Streaming is a non-goal (P1).

## 8. Risks & open issues

- **F70 (resolved, 0.14.0)**: `decide` calls System One only with `models.classifier.base_url` or `worker_default: true` (never the hosted fallback); `llm-invoke`'s `auth` / no-key raise now reaches the user as the session's setup answer (design §6.2.4).
- **F36 (open, platform)**: `openai.chat.completions` returns only the message, with no `usage`
  and no `finish_reason`. Phase 0 estimates tokens (chars / 4, `usage.estimated: true`) and
  leaves `finish_reason` null. Phase 2 cost caps need real counts.
- **F37 (timeout half resolved 2026-10-16)**: activity timeouts DO take expressions; the call's
  `timeout_sec` (else `models.<role>.timeout_sec`, else 100 s) now bounds each request, and
  `decide` takes its budget from `models.classifier`. Still open: `tool_choice` cannot be
  templated (the schema takes a literal only), so a non-null `tool_choice` is refused. The
  activity's temperature field is spelled `temporature`.
- Failures are caught by `on_error: {catch: true}` on the activity task itself; a
  missing secret or `MOCO_LLM_DEFAULT_*` variable maps to `auth` (misconfiguration).

- No JSON-Schema validator activity: `schema` validation is a documented subset. If profiles need
  more, add a small `schema-validate` expression helper rather than widening per call site.
- System One latency per question count was measured in phase 0 (M1: ~240 ms per question on
  hosted TypeSafe; 10 questions ≈ 2.9 s). `classifier.timeout_sec: 10` covers the synchronous
  cap of 10 questions; offline callers keep 30 s × 2. Local Laya measured 2026-10-06: 10
  questions ≈ 2.5 s p50 (`typed-decisions`), the same as hosted TypeSafe. `decide` also logs `elapsed_ms` + question count in production.
- **Error classification reads the message.** Every activity failure reaches `on_error` as
  `WorkflowRuntimeError`; the HTTP status is only in the text ("…: 422 question 'q': …"). `decide`
  treats a 4xx other than 408/409/429, or a pydantic "validation error", as a malformed qset
  (raise); anything else as unavailable (fallback). A wording change in the provider would
  silently move errors between the two.
- The LLM fallback gives near-binary probabilities (0/1 from the gateway model), so noul
  thresholds tuned on System One will behave differently under it; that is accepted
  (§6.2.3), and `decided_by` tells the router which backend answered.
- The `llm` fallback is also the whole of v3's `llm` router strategy (S2): `decide(qset.route,
  fallback: llm)` must produce the same keys the classifier would, so test it on `qset.route`
  specifically.

## 9. Done when

Both wfspecs pass their test suites; the router (plan-09) and guard (plan-05) call only these two
wfspecs for model access; a grep shows no other wfspec references `openai.chat.completions` or
`typesafe.system_one` (except `claude_agent` users).
