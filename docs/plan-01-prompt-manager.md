# Plan 01 — Prompt manager (`prompt-render`, `prompt.<name>`, `qset.<name>`)

Design: `design.md` §6.3, §7.2 (route questions), §3 P12. Overview: [plan-00](plan-00-overview.md).

## 1. Scope

Own every piece of text that goes to a model:

- **Chat prompts** `prompt.<name>` → `{kind: chat, messages, response_format, schema, version}`.
- **Question sets** `qset.<name>` → `{kind: system_one, state, questions, keymap, version}`.
- **`prompt-render`**: dispatch by logical name through `resolved_refs`. Name resolution itself
  (agent-local over harness, version pinning) runs once, in `agent-registry load` (plan-03, F29).
- System prompt composition (`system.base` + persona + `persona_text`), never replaceable.

Out of scope: calling models (plan-02), deciding thresholds (config, plan-04), agent-specific
persona prompts (plan-18).

## 2. wfspecs to create

`workflow/src/` (flat, F41). **Built** (2026-10-05/06): `prompt-render` (`render`, `list`),
`prompt.system.base`, `qset.route`, and the chat prompts `loop`, `rag.answer`, `rewrite`,
`summarize`, `session.title`, `decide.fallback`, and `resolve_names` (2026-10-06, pure over the
package catalogs agent-registry passes in). Left for phase 1: `qset.guard.{content,output}` (with
plan-05).

| wfspec | Modes | Notes |
| --- | --- | --- |
| `prompt-render.yaml` | `render {name, variables, resolved_refs}`, `list`, `resolve_names {agent_id, names, overrides}` | `render` looks `name` up in `resolved_refs` and runs the concrete wfspec as an **`inline`** child (design §4.3: no timeout or isolation needed, ~3 ms vs ~0.2 s); stamps `name` and `version`. A name missing from `resolved_refs` raises. `resolve_names` is the resolution logic, called only by `agent-registry load`. |
| `prompt.system.base.yaml` | — | Harness rules: citation discipline, refusal policy, tool etiquette, `<data>` fence rule, memory is background. Takes `persona_messages`, `persona_text` (clamped to 2000). |
| `prompt.rewrite.yaml` | — | decision role; `schema` for JSON output. |
| `prompt.loop.yaml` | — | Render `context_bundle.blocks` + loop `messages` into chat messages; memory blocks under "background, not a source". Variables `context_bundle, passages, messages, tools_offered, forced_final`, shared with `rag.answer` because the loop renders whichever prompt the profile names. **Its header defines the block contract** context-builder must produce (plan-08). Tool etiquette lives in `system.base` (`tools_offered`). |
| `prompt.rag.answer.yaml` | — | Runs `prompt.loop` inline, then adds the rag rules and the passages (numbered by their `n`, attributed, clamped, fenced) to the system message. `answer_schema` is null: the answer is markdown with `[n]`. Port from `rag-qa-agent.yaml`. |
| `prompt.summarize.yaml`, `prompt.session.title.yaml` | — | decision role. |
| `prompt.memory.extract.yaml` (phase 2), `prompt.memory.merge.yaml` (phase 3, promotion only), `prompt.episode.digest.yaml` (phase 3) | — | schema-typed output. |
| `prompt.decide.fallback.yaml` | — | Turns any qset into a JSON schema with the `{nouls, choices, scores}` shape (used by plan-02). |
| `qset.route.yaml` | — | §7.2 table; conditional questions. Port and generalise `query-analyzer.yaml`. Variables: `message, history, profiles, sources, offer_sources, pending_action, previous_answer, is_guest, long_term_memory, episodes, max_questions (10)`; returns `trace: {question_count, dropped_sources}` beside the request. Route labels are positional `profile_<i>` (+ `pending_*`), all in `keymap`. |
| `qset.tools.yaml` | — | phase 2 (plan-10). |
| `qset.memory.gate.yaml`, `qset.memory.match.yaml`, `qset.memory.command.yaml` | — | phase 2 (plan-07). |
| `qset.guard.content.yaml`, `qset.guard.output.yaml`, `qset.guard.input.yaml`, `qset.guard.tool_call.yaml` | — | plan-05. |

Owns no storage.

## 3. Dependencies

- Calls: nothing but its own children.
- Called by: `llm-invoke render_and_chat`, `decide` (plan-02), `agent-registry load`
  (`resolve_names`, plan-03), `context-builder` `system` provider (plan-08).

## 4. Reuse

| From `moco-examples-internal/moco-agent/src/` | To |
| --- | --- |
| `query-analyzer.yaml` question wording, positional keys, keymap | `qset.route` |
| `rag-qa-agent.yaml` answer prompt + citation formatting | `prompt.rag.answer` |
| `web-qa-agent.yaml` prompt text | `prompt.claude.task` (lives in plan-18) |
| `moco-agent-session.yaml` rewrite / summary prompts (inline) | `prompt.rewrite`, `prompt.summarize` |

## 5. Implementation steps

1. **Contract + skeleton.** Define the two output shapes as a JSON schema fragment in a shared
   `context` block copied into each prompt (or a `prompt-contract` data wfspec referenced by
   tests). `prompt-render render` for harness-only names, `list` from a literal catalog.
2. **Resolution.** `resolve_names`: for each logical name, prefer `prompt.<agent_id>.<name>`
   over `prompt.<name>` and apply `overrides[name].version`; existence via
   `builtin.deploy.wfspec.get` (or the package file list). Missing → `not_found`, which
   `agent-registry load` turns into a loud failure. `render` then dispatches through
   `workflow.ref: "{{ resolved_refs[name].wfspec }}"` with no lookup. Dynamic names
   resolve only against deployed packages (P7); develop on the dev stage (§5.6).
3. **System prompt.** `prompt.system.base` + composition helper used by the `system` provider.
   Test that `persona_text` cannot remove the base rules (it is appended, clamped, fenced).
4. **Phase-1 chat prompts**: `rewrite`, `loop`, `rag.answer`, `summarize`, `session.title`,
   `decide.fallback`. (Phase 0 uses inline messages in the loop; `prompt.loop` replaces them.)
5. **qset conventions** as a checklist baked into each qset and a shared test: every question
   has `instructions`; positional keys + `keymap`; labels only when legal; **keys of `state`
   and `questions` sorted** before returning (§6.3.2); **at most 10 questions** for a synchronous
   qset, 20 for an offline one (design §7.3, M1), asserted by the shared test.
6. **Phase-1 qsets**: `route` (plan-09 owns the interpretation; fixed questions first, source
   nouls in the remaining slots up to 10), `guard.content`,
   `guard.output`.
7. **Phase 2/3 prompts and qsets** as the owning plans reach them.

## 6. Tests

`workflow/tests/` (flat). **Done**: `prompt-render.test.yaml` (9, incl. `resolve_names`), `prompt.system.base.test.yaml` (7),
`qset.route.test.yaml` (14), `prompt.loop.test.yaml` (9), `prompt.rag.answer.test.yaml` (5),
`prompt.rewrite.test.yaml` (2), `prompt.summarize.test.yaml` (2), `prompt.session.title.test.yaml`
(2), `prompt.decide.fallback.test.yaml` (3). Every prompt has a case proving untrusted text cannot
close its `<data>` fence.

- One `*.test.yaml` per prompt: render with fixture variables; assert role order, fenced data,
  clamping of long inputs, conditional sections (e.g. no history → no history block).
- One per qset: conditional questions appear only when offered (e.g. `pending_*` labels only with
  a pending action; `source_<i>` only when a profile requires sources); `instructions` present on
  every question; keys sorted; `keymap` round-trips.
- `resolve_names`: agent-local override wins; version pin respected; unknown name → `not_found`.
- `render`: uses `resolved_refs` without any existence lookup (assert no `builtin.deploy` call).
- A catalog test asserts `list` matches the prompt and qset files in `src/` (guards against
  drift). A wfspec cannot list files, so it is `scripts/check-prompt-catalog.sh` (exits non-zero
  on drift).

## 7. Phase split

- **Phase 1**: render, resolve_names, system.base, rewrite, loop, rag.answer, summarize,
  session.title, decide.fallback, `qset.route`, `qset.guard.{content,output}`.
- **Phase 2**: memory.extract, `qset.tools`, `qset.guard.{input,tool_call}`, `qset.memory.*`.
- **Phase 3**: memory.merge (promotion), episode.digest.

Removed in v4: `prompt.clarify` (templated), `prompt.route` (the `llm` strategy is `decide`'s
fallback), `loop.single`/`loop.react` → `loop`, `qset.memory.rerank`, `qset.compact.salience`.

## 8. Risks & open issues

- Dynamic child names only resolve against deployed packages (P7): unit tests mock `render`'s
  child by `task_name` (`render-prompt`); integration runs on the dev stage.
- `qset.route`'s source pre-filter is plain word overlap (name, description, keywords). Good
  enough to keep the right source in the 4+ slots for small catalogs; revisit with the
  classifier evaluation if catalogs grow past ~10 sources.
- System One order sensitivity: sorting keys is mandatory; a qset that forgets it produces
  thresholds that differ between `--in-memory` and Temporal.
- Keep the model role out of the prompt files and pass it from the caller: `decision` is an
  optional alias of `inference` (§6.2.1).

## 9. Done when

All phase-1 prompts and qsets render under `moco test`, `resolve_names` produces
`resolved_refs` for moco-assistant, and plan-02 can call `render_and_chat` / `decide` with them.
