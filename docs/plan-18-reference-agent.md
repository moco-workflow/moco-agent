# Plan 18 — Reference agent `moco-assistant` (+ minimal second agent `ops-assistant`)

Design: `design.md` Part II (§13–16), §17, §18 (E2E, classifier evaluation), §19 exit criteria.
Overview: [plan-00](plan-00-overview.md).

## 1. Scope

Rebuild the old `moco-agent` as the first agent on the harness, and build a minimal second agent
to prove nothing reference-specific leaked into the harness:

- `moco-assistant`: definition, persona, library profiles with overrides, `claude` and `builder`
  custom profiles, `moco-builtin` toolset, `moco-docs` source, `link-check` hook, seed memory.
- `ops-assistant`: definition + persona + `k8s-readonly` toolset, **no logic wfspecs**.
- The classifier and **answer** evaluation sets (F31) and the E2E suite.
- The phase-0 skeleton agent definition (plan-00a).

Out of scope: harness modules (plans 01–17).

## 2. wfspecs to create

**Built** (2026-10-06): `agent-moco-assistant` 1.0.0 (definition, `prompt.persona.moco`,
`seed-knowledge`; the rag decline message through `profile_overrides`, no profile file),
`agent-ops-assistant` 0.1.0 (phase-1 variant), `eval/answers/answer-set.yaml` +
`scripts/answer-eval.sh` (parity against the old agent). Both agents load and answer live.

**Parity run (2026-10-06, dev stage, local Laya + gateway model, 12 cases, paced):**

| target | answer ok | cited | keyword coverage | declines ok | chat ok | mean |
| --- | --- | --- | --- | --- | --- | --- |
| moco-assistant 1.0.0 | 8/8 | 8/8 | 0.94 | 2/2 | 2/2 | 33 s |
| old moco-agent 5.8.0 | 0/8 | 0/8 | 0.06 | 0/2 | 2/2 | 8 s |

The old agent answered every question with its route-`none` line ("I can answer questions
about: moco-docs…"): its query-analyzer's System One call picks `none` (confidence 0.03) on the
worker's current backend, local Laya, although it scores moco-docs 0.53. It was presumably tuned
on hosted TypeSafe. So this is parity *on today's deployment* -- the harness's `qset.route`
routes where the old one does not -- not a head-to-head under the old agent's original backend.
Results are in `eval/answers/results-*.json`.

`moco-agent/agents/moco-assistant/` (package `agent-moco-assistant` — agent packages are
`agent-<agent_id>`, hold a main `agent-<agent_id>` wfspec, and are loaded package-qualified;
F40, design §17)

| Item | Kind | Phase |
| --- | --- | --- |
| `agent.moco-assistant.yaml` | definition (§5.2) | 1 |
| `prompt.persona.moco.yaml` | prompt | 1 |
| `profile.moco-assistant.rag.yaml` (override: `decline_message` naming `/claude`) | profile override | 1 |
| `seed-knowledge.yaml` | registers + indexes `moco-docs` via `knowledge register` | 1 |
| `profile.moco-assistant.claude.yaml` + `subagent.claude.yaml` + `prompt.claude.task.yaml` | `kind: wfspec`, sync | 2 |
| toolset `moco-builtin` + `tool.moco-wfspec-search.yaml`, `tool.moco-run-status.yaml` | tools | 2 |
| `hook.moco.link-check.yaml` | hook, `answer.ready` | 2 |
| `seed-memory` data (curated moco pitfalls, `kind: lesson`, `pinned: true`) | memory seed | 2 |
| `profile.moco-assistant.builder.yaml` + `subagent.builder.yaml` | `kind: wfspec`, async | 3 |

`moco-agent/agents/ops-assistant/` (package `agent-ops-assistant`): `agent.ops-assistant.yaml`,
`prompt.persona.ops.yaml`, toolset `k8s-readonly` with `activity`-bound manifests over `k8s.get`
/ `k8s.list` (`credential.mode: service`). Phase 1 variant: a single `chat` profile (the router
skips classification when only one profile is available), to satisfy "a minimal second agent
runs with no harness change"; phase 2 adds `react` + tools and the classifier.

`moco-agent/agents/skeleton/` (phase 0, **done**): package `agent-skeleton` with
`agent.skeleton.yaml` (one `chat` profile, inline `persona_text` until the prompt manager
exists) and the main `agent-skeleton.yaml`; used by plan-00a.

`moco-agent/eval/`: labelled classifier sets (routing, tool selection, memory gate and match)
and the **answer evaluation set** (questions, reference answers, expected sources, expected
declines), plus a runner that scores groundedness, citation correctness and correct declines.
`moco-examples-internal/moco-agent-evaluation/` may already hold usable material; check it
before writing sets from scratch.

## 3. Dependencies

All harness plans. Phase 1 needs 01–09, 11, 14, 16. Claude needs the agent worker configured
(P9, `requires: {worker: agent}`).

## 4. Reuse (§15)

| Old file | Fate |
| --- | --- |
| `moco-agent-session.yaml` | rewritten as harness `agent-session` (plan-14) |
| `moco-agent-cli.yaml` | harness `agent-cli` (plan-16) |
| `moco-agent.yaml` | dropped (plan-17 janitor, plan-04 `config_version`) |
| `agent-admin.yaml` | split into harness admin areas (plan-16) |
| `agent-config.yaml` | harness `agent-config` (plan-04) |
| `agent-providers.yaml` | the `models:` catalog in harness `agent-harness-defaults` (plan-04) |
| `query-analyzer.yaml` | harness router + `qset.route` (plan-09, plan-01) |
| `rag-qa-agent.yaml`, `rag-domain-query.yaml` | harness `rag` profile + `source.pgvector` (plan-11, plan-06) |
| `knowledge-indexer.yaml`, `knowledge-index-run.yaml`, `sitemap-probe.yaml` | harness knowledge (plan-06) |
| `session-store.yaml` | harness `session-store` (plan-14) |
| `seed-knowledge.yaml` | split: config part dropped (definition is the defaults tier); notes → `seed-memory`; domain indexing → this package's `seed-knowledge` |
| `web-qa-agent.yaml` | `subagent.claude` (this plan) |
| `workflow-builder.yaml`, `build-store.yaml` | `subagent.builder` (this plan) + harness `job-store` (plan-13) |

Tests in `moco-examples-internal/moco-agent/tests/` are the parity baseline: port their
scenarios as fixtures.

## 5. Implementation steps

0. **Skeleton definition** (phase 0): `agent.skeleton`, one `chat` profile, for plan-00a.
1. **Definition + persona** (phase 1): §5.2 example trimmed to phase-1 features (profiles `chat`,
   `rag`; no toolsets/hooks yet; long-term memory disabled); `agent-registry validate` passes.
2. **`moco-docs`** source registered and indexed; `rag` override with the moco decline message.
3. **Answer evaluation set + parity run**: build the set from the old agent's rag test
   scenarios; run the old agent and moco-assistant through it; parity = moco-assistant scores
   at least as well on groundedness, citations and declines.
4. **ops-assistant phase-1 variant** — runs with no harness change (phase-1 exit).
5. **`subagent.claude`** (phase 2): `claude_agent.query` with `prompt.claude.task(context_bundle,
   query)`; capabilities `builtin_tools: [WebSearch, WebFetch]` + bridged `auto` tools (plan-10
   step 12). Timeouts derive from `budget_sec` (agent = budget − 10s, activity = budget − 5s);
   a partial result on timeout is `ok` with a note; `grounded = sources non-empty`;
   `estimated_sec: 80`. It is reached by routing or `/claude`, not by handoff from rag (F10).
6. **`moco-builtin` toolset**, **link-check hook**, **seed memory** (phase 2).
7. **ops-assistant phase-2**: `k8s-readonly` manifests, `react` profile — phase-2 exit
   ("built with no new logic wfspecs").
8. **`subagent.builder`** (phase 3): returns `async_started`; runs as a job; plan review as a
   `pending_action {kind: plan_review}` relayed via `subagent_event`; drops the old `build_*`
   routes. **Done** (moco-assistant 1.5.0, `/build`): `subagent.builder` is the profile AND the
   job body -- without a `job_id` it returns `async_started`; as the job it plans (read-only
   tools), returns the plan_review, and on resume implements (approve) or re-plans with the
   feedback (revise, at most `max_plan_revisions`). Its own state machine and `build-store` are
   gone: job-entity waits for the review. Files come back through the old `===MOCO-ARTIFACT===`
   envelope into `result.artifacts`.
9. **Classifier evaluation**: labelled sets; output sets `decisions.*` in harness defaults;
   re-run when the classifier changes.
10. **E2E** (deployed, real Temporal), for moco-assistant **and** ops-assistant: rag → follow-up
    pronoun → tool approval → resume → retire → resume → episode recall → async job completion
    after retire. Assert on persisted rows, not transcripts.

## 6. Tests

`moco-agent/agents/*/tests/`

- Definition validates (CI, against the harness version it deploys with).
- Profile integration against the shared `context_bundle` fixtures (mocked activities).
- `subagent.claude`: timeout → partial ok; excluded tools not passed; trace lists bridged tools.
- `link-check`: flags a link to a non-existent doc page.
- Builder: plan-review pending action round trip (mocked `claude_agent.query`).
- `agent-cli` contract incl. compatibility fields against the old UI's expectations.
- E2E suite (step 10).

## 7. Phase split

- **Phase 0**: step 0.
- **Phase 1**: steps 1–4.
- **Phase 2**: steps 5–7, 9. **Status (2026-10-12):** step 7 done -- ops-assistant 1.4.x runs
  `chat` + `react` over five k8s manifests (`tools.ops-assistant`, data) with no logic wfspecs;
  `k8s_get_secret` needs approval. Since then: 5 (`subagent.claude` + the claude bridge,
  `claude-capabilities`), 6 (moco-assistant 1.4.0: react over harness-builtin, memory, claude,
  the link-check hook; seed memory via `memory.<agent_id>` data). Not verified live: claude and
  the memory profile need a working chat-model token. Open: 9 (classifier evaluation).
- **Phase 3**: step 8, full E2E (10).

## 8. Risks & open issues

- claude's `estimated_sec` must stay honest: if production runs exceed it, routing still works
  but explicit handoffs to claude will be skipped more often than expected.
- P9: claude has no session resumption — context is re-passed in the prompt; watch prompt size.
- §20 Q4 (agent-to-agent, e.g. delegate to ops-assistant) — out of scope for v1.
- §20 Q10 (UI) determines how long compatibility fields stay.
- Parity is judged on the old test scenarios; any intentional behaviour change (e.g. gated
  memory instead of per-turn notes) must be listed in the package README.

## 9. Done when

§14's claims hold: library profiles need no code; `claude` and `builder` plug in via the
contract; persona and `rag.decline_message` overridden per agent; the hook works; the old UI
works; and ops-assistant runs with no harness change (phase 1) and no new logic wfspecs
(phase 2).
