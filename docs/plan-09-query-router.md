# Plan 09 — Query router (`query-router`, `router.<custom>`)

Design: `design.md` §6.7, §7.2, §7.3. Overview: [plan-00](plan-00-overview.md).

## 1. Scope

Turn a user message into a dispatch decision (which profile, with what standalone query, over
which sources) or decide not to dispatch (clarify, pending reply). Also emits `signals`
(negative feedback, states preference, refers to past) for memory and feedback.

v4 has **one built-in pipeline** plus an optional `router.<custom>` wfspec (S2). v3's `rules`,
`fixed` and `llm` strategies are cases of the pipeline or of `decide`'s fallback (design §6.7.2
table).

Out of scope: running the profile (plan-11).

## 2. wfspecs to create

`workflow/src/` (flat, F41). **Built** (2026-10-06): `query-router`, `profile-availability` (and
`access identify`, `decide`'s `probabilities`, which they need). Left: `router.<custom>` (phase 2).

| wfspec | Notes |
| --- | --- |
| `query-router.yaml` | Pure. Fast paths → classify → interpret → conditional rewrite → clarify text; or a custom router. **Re-validates** every result. |
| `profile-availability.yaml` | Helper used by the session: definition profiles − config-disabled − failing `requires`. It lives here because only routing consumes it. |
| `router.example.yaml` (tests only) | conformance fixture for `router.<custom>` |

Owns no storage.

## 3. Dependencies

- Calls: `decide` (plan-02) with `qset.route` (plan-01) and `fallback: llm`; `llm-invoke`
  (decision role) for the rewrite; `router.<custom>` by name when configured.
- Inputs from the session: `message, action?, router_view, profiles (available), sources
  (catalog), pending_action, tag_vocabulary, config`.
- Called by: session `routing` (plan-14).

## 4. Reuse

| From | To |
| --- | --- |
| `query-analyzer.yaml` — System One classification over domains, positional keys, keymap, rewrite | the classify/interpret/rewrite steps + `qset.route`, generalised from domains to profiles + sources |
| slash-command handling in `moco-agent-session.yaml` | fast paths (`router.slash`) |

## 5. Implementation steps

1. **Router result schema** (§6.7.2), `decided_by: fast_path | only_profile | system_one | llm |
   default | <custom>`.
2. **`profile-availability`**: evaluate `requires` (`sources`, `tools`, `worker: agent`,
   `not_guest`, `config: <path>`) against the catalog, the tool-policy result (phase 2), worker
   config, user and config.
3. **Fast paths** (no model): empty message → default; `action` payload → `pending_reply`; a
   slash command in `router.slash` → that profile if available; exactly one available profile →
   it (`only_profile`); `router.classifier: false` → `default_profile`.
4. **Classify**: one `decide(qset.route, fallback: llm)` call; both backends down →
   `default_profile`.
5. **Interpret** (§6.7.3 step 3): route (if available, else default); sources
   (`nouls[source_i] ≥ source_min_p`); a profile requiring sources with none above threshold →
   default; clarify rule; tags = tokens(message) ∩ `tag_vocabulary`; signals from nouls.
6. **Conditional rewrite**: only if `needs_context ≥ threshold` AND `profile.needs_rewrite`;
   `llm-invoke(decision, prompt.rewrite)`, 15s × 1; failure → original.
7. **Clarify text**: always templated from the top-2 route probabilities and their
   `route_description`s (plus source descriptions when they differ only by source). No chat
   model and no `prompt.clarify`.
8. **Custom router** (phase 2): when `router.custom` is set, run it after the fast paths instead
   of steps 4–7.
9. **Re-validation** of the pipeline's and any custom router's output: unavailable profile →
   default; unknown source dropped; pending labels without a pending action ignored.
10. **`tag_vocabulary`**: built by the session at `init` from tool tags and memory tags, capped
    at 500.

## 6. Tests

`workflow/tests/` (flat). **Done**: `query-router.test.yaml` (21: every fast path, interpret,
rewrite gating incl. the deictic backstop, clarify, pending labels, re-validation, backends down,
tags), `profile-availability.test.yaml` (5). Live on local Laya with the real catalog and config: a
retry question → `rag` + `moco-docs` (0.82) with one System One call and no chat-model call; a
greeting → `chat` (0.78); "and what is its default timeout?" → rewritten to "what is the default
timeout for an activity's retry policy?".

- Fast paths: empty, action payload, slash command (available / unavailable), single available
  profile, `classifier: false`.
- Interpretation: label outside the offered set → default; sources below threshold dropped; rag
  with no source → default; clarify only when ambiguous **and** low confidence; pending labels
  ignored without a pending action.
- Rewrite gating: a self-contained follow-up makes **zero** `llm-invoke` calls (design goal 4).
- Classifier down → `llm` fallback produces the same keys → both down → default profile.
- Custom router returning an unavailable profile → re-validated to default.
- `qset.route` rendering tests live in plan-01. **Classifier evaluation** on labelled routing
  sets lives in plan-18 and sets `decisions.route.*`.

## 7. Phase split

- **Phase 1**: availability, fast paths, classify, interpret, rewrite, templated clarify,
  re-validation.
- **Phase 2**: `router.<custom>`, `requires: tools`, signals consumed by memory and feedback.
  **Status (2026-10-12):** done -- router.custom replaces steps 2-5 and is re-validated (failure →
  the pipeline); `requires: tools` via the session's has_tools; states_preference triggers early
  curation, negative_feedback implicit feedback, refers_to_past episode recall. Pending replies:
  approve_session / reply payloads and the ask_user reply fast path.

## 8. Risks & open issues

- **Follow-up detection (F45).** The `needs_context` noul missed every follow-up tried on local Laya
  (follow-ups 0.24–0.39 vs self-contained 0.19–0.31 across three wordings, message alone or with
  history). The router therefore also treats a deictic message with history ("its", "that",
  "the second one", a leading "and") as needing context; 8/8 on the probe set. Cost: a
  self-contained question saying "that" pays one unneeded rewrite (~1 s). Design goal 4 holds
  for messages without such words.
- **Top-1 source fallback.** A sources profile with no source ≥ `source_min_p` takes the top-1
  source asked about (live: the right source scored 0.47 for a follow-up). Defaults
  `decisions.route.*` are provisional until plan-18.
- **Source nouls separate weakly on local Laya** (live `decide(qset.route)`, 2026-10-06): for
  "how do I configure the retry policy for a moco activity?", moco-docs 0.58 vs k8s-runbooks 0.49,
  while the route was clear (`rag`, p 0.74). `source_min_p` must come from the classifier
  evaluation, not a guess; until then prefer the top-1 source when none clears the threshold.

- **Question cap** (design §7.3, M1: ~240 ms per question). `qset.route` asks at most 10
  questions (~3 s): its fixed questions (route + up to 5 others) first, then source nouls in
  the remaining slots. With more sources than slots, the router pre-filters them by keyword
  overlap with the message (catalog `keywords`, description), so it is never split into two
  calls (open question 1, answered for hosted TypeSafe).
- Positional keys make source ordering matter; keep catalog order stable (sort by name).
- The classifier is an attack surface only up to "pick a profile the user could have picked"
  (§11.1). Re-validation is what guarantees that, so it runs for the built-in pipeline too.

## 9. Done when

A first turn or a self-contained follow-up is routed with one System One call and zero
chat-model calls; pronoun follow-ups trigger exactly one rewrite; moco-assistant routing matches
the old `query-analyzer` on its test set.
