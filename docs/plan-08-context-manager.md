# Plan 08 — Context manager (`context-builder`, `context.<custom>`)

Design: `design.md` §6.6. Overview: [plan-00](plan-00-overview.md).

## 1. Scope

Decide exactly what the model sees each turn, within a token budget: the `conversation` phase
(`router_view` for the router) and the `assemble` phase (the `context_bundle`), built from nine
built-in providers plus custom `context.<name>` providers.

Out of scope: rendering blocks into messages (prompts, plan-01); fetching memory, pending
actions, jobs or the conversation row. All of these arrive as input from the session (F8).

## 2. wfspecs to create

`workflow/src/` (flat, F41). **Built** (2026-10-06): `context-builder` (`conversation`, `assemble`
with all nine built-ins and the budget allocator). Custom providers and `tool_notices` are phase 2.

| wfspec | Modes | Notes |
| --- | --- | --- |
| `context-builder.yaml` | `conversation {conversation}`, `assemble {...}` | The nine built-in providers are **`set` tasks inside this wfspec** (S8), not child workflows. |
| `context.example.yaml` (tests only) | provider contract | conformance fixture for custom providers |

Owns no storage.

## 3. Dependencies

- Calls: `prompt-render` (the `system` block); custom `context.<name>` children only.
- Inputs from the session: `conversation` (from `session-store`), `memory_recall`,
  `pending_action`, `jobs`, `router_result`, `config`, `resolved_refs`.
- Called by: session `preparing` and `assembling` (plan-14).

## 4. Reuse

- `moco-agent-session.yaml`: history clamping (last N exchanges, per-exchange char limits) and
  prompt assembly → the `recent` built-in and the budget allocator.

## 5. Implementation steps

1. **`conversation`**: `router_view` = last 4 exchanges, 300 chars each, from the conversation
   row the session passes in.
2. **Provider contract** (§6.6.2): input `{session_id, question, router_result, memory_recall,
   conversation, pending_action, jobs, turn_ctx_view, config}`; output `{block: {id, title,
   content, priority, required, droppable_unit, items?}}`.
3. **Built-ins as `set` tasks**: `system` (rendered `prompt.system.base` + persona +
   `persona_text`), `pending` (required when present), `jobs`, `profile_memory`, `question`
   (required), `recent` (items ≤ 1500 chars, newest first), `recalled_memory`, `episodes`,
   `summary`. Memory blocks use the "background, not a source" title. A built-in with no data
   returns no block, so phase-1 definitions can list `profile_memory`, `recalled_memory`,
   `episodes` and `jobs` before their data exists (F9).
4. **Custom providers** (phase 2): the definition's `context.providers` list gives the order;
   custom entries are dispatched by name in parallel (`props.execute_mode: parallel`), 3s timeout,
   `on_error: {catch: true}` →
   skipped and logged.
5. **Budget allocator** (§6.6.3): estimate `chars / 4`; admit by priority; required always
   admitted; if required blocks alone overflow, clamp `recent` harder and log the overflow;
   droppable blocks dropped whole or item by item; record `budget.dropped`.
6. **Bundle**: `{blocks, question, pending_action, used_memory, budget}`; `used_memory` = keys
   of admitted memory items.
7. **Credential notices** (phase 2): `tool-policy resolve`'s `needs_credential` entries, passed
   in by the loop's caller, become a one-line `tool_notices` block (§6.9.7).

## 6. Tests

`workflow/tests/` (flat). **Done**: `context-builder.test.yaml` (9: router view, block order,
item-prefix budget keeping the newest exchanges, required overflow, provider order as priority,
providers without data, pending, unlisted providers, unresolved config). The system block is
`prompt.system.base` with the rendered persona prompt and `persona_text`; defaults
`context.{max_context_tokens: 12000, providers, recent_item_chars: 1500}`.

- Budget: all fit; droppable blocks dropped in reverse priority; item-level drop of `recent`;
  required overflow → recent clamped + overflow logged; `dropped` counts correct.
- Provider order follows the definition; a custom provider placed mid-list gets that priority; a
  timing-out custom provider is skipped.
- Built-ins with no data produce no block and no error.
- `used_memory` only contains admitted items.
- `router_view` truncation.
- No child workflow is started when the definition has no custom providers.
- Conformance kit entry for `context.<name>`.

## 7. Phase split

- **Phase 1**: both phases, all nine built-ins, budget allocator.
- **Phase 2**: custom providers, `tool_notices`. **Status (2026-10-12):** custom `context.<name>`
  providers done (sync, 3 s, priority by position, failures skipped). tool_notices need no
  provider: the loop tells the model which tools need setup (tool-policy needs_credential).

## 8. Risks & open issues

- **The block contract is fixed by `prompt.loop`** (plan-01, built): block ids `system`,
  `pending`, `jobs`, `summary`, custom → fenced system sections; `profile_memory`,
  `recalled_memory`, `episodes` → one "Background, not a source" section; `recent` items
  `[{role, content}]` newest first; `question` as `content` or `items: [{original, rewritten}]`.
  Memory items render `title` + `text`. Change both together.

- chars/4 is a rough estimate; clamp generously below the model's real window.
- Phase-0 M2 confirms the choice of inline built-ins. If child overhead turns out negligible,
  nothing needs to change: the contract is the same either way.

## 9. Done when

Every profile receives a bundle within `max_context_tokens`, with the same block rules; the
minimal second agent (plan-18) runs with a shorter provider list and no code change.
