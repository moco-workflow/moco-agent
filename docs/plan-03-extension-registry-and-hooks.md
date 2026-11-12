# Plan 03 — Extension registry, profile library & hooks (`agent-registry`, `profile.*`, `hook-runner`)

Design: `design.md` §5 (all), §6.3.3 (`resolved_refs`), §6.8.2 (profile definition), §17, §18
(conformance kit). Overview: [plan-00](plan-00-overview.md).

## 1. Scope

- **`agent-registry`**: load, list and validate agent definitions; resolve library profiles;
  check harness compatibility and that every referenced extension exists; produce
  `resolved_refs` (logical prompt/qset name → concrete wfspec + version, F29).
- **Profile library**: `profile.chat`, `profile.rag`, `profile.react`, `profile.memory` data
  wfspecs.
- **`hook-runner`**: run hooks for the three v1 events (`turn.received`, `tool.before`,
  `answer.ready`), apply allowlisted patches, handle sync/async, timeouts and blocks.
- **Conformance kit**: shared fixtures and a runner for each extension point's contract test.

Out of scope: the loop that *runs* profiles (plan-11); config tier merging (plan-04). Dropped in
v4: generated dispatch tables and `gen-dispatch.py` (S14), contract versioning (S12), the five
deferred hook events (S11).

## 2. wfspecs to create

`workflow/src/` (flat, F41). **Built** (2026-10-06): `agent-registry` (`load`, `validate`, `list`),
`package-catalog`, the four library profiles. Left: `hook-runner` and the conformance kit (phase 2).

| wfspec | Modes | Notes |
| --- | --- | --- |
| `agent-registry.yaml` | `load {agent_id}`, `list`, `validate {definition}` | Out of `load`: `{definition, profiles: {name: profile}, profile_refs, resolved_refs, versions: {agent, harness}}`. `list`: `{agents: [{agent_id, package, display_name, version}]}`. |
| `package-catalog.yaml` | `{package_name}` → `{package, version, wfspecs}` | The existence check: the targeted version of a package and the wfspec names in it (each file's `workflow_name`, recorded at publish from its header, not its filename). Reads `get_targeted_wfspec_version` with `exclude_files` and `package.list_files`, so no file content is fetched. Run as a **`sync` child** so the file list stays out of the caller's history. |
| `profile.chat.yaml`, `profile.rag.yaml`, `profile.react.yaml`, `profile.memory.yaml` | — (data) | §5.3 / §6.8.2 shape, no `strategy` field. `rag` ported from `rag-qa-agent.yaml` behaviour. |
| `hook-runner.yaml` | `run {event, payload, hooks, agent_id, session_id}` | Out: `{action: continue\|block, payload, reason?, outcomes: [...]}`. |

`workflow/tests/conformance/` — kit fixtures (`context_bundle` set, router inputs, hook payloads)
and one runner wfspec per extension point.

Owns no storage (definitions are deployed wfspecs).

## 3. Dependencies

- Calls: `package-catalog` ×2 (agent and harness package; `get_targeted_wfspec_version`
  with `exclude_files` + `package.list_files`), `prompt-render list` and `resolve_names` (plan-01, pure over the two
  catalogs); later `tool-registry list_toolsets` (plan-10) and `source-registry list` (plan-06).
  `list` uses `builtin.deploy.wfspec.list` (whose rows are packages, field `name`).
- Called by: `agent-config resolve/validate` (plan-04), `agent-admin` agents area (plan-16), CI.
- `hook-runner` is called by the session (`turn.received`, `answer.ready`, plan-14) and by the
  loop (`tool.before`, plan-11).

## 4. Reuse

Nothing directly: the old agent had one hard-coded definition. `moco-agent.yaml`'s
`reload_config` fan-out is dropped (replaced by `config_version`, plan-04).

## 5. Implementation steps

1. **Definition schema.** Write the §5.2 definition as a validation expression: required keys,
   `agent_id` regex, enums, `harness` semver range, `router.slash` / `classifier` /
   `default_profile` / `custom`, `limits` incl. `cost` and `retire_throwaway_after_idle_sec`,
   `retention`. `validate` returns `{valid, errors: [{path, message}]}`.
2. **`load`**: fetch `agent.<agent_id>` by name (dev stage locally, §5.6); check `harness`
   range against the harness package version constant; resolve each profile: library name →
   `profile.<name>` merged field-by-field with the definition's overrides; agent-local id →
   `profile.<agent_id>.<name>`.
3. **Profile validation** (§6.8.2): `max_steps > 1` needs `tools`; `retrieval.when: before`
   needs sources; `kind: wfspec` names its wfspec (`wfspec.name`, used as the child's `workflow.ref`); `mode: async` only for `kind: wfspec`;
   `estimated_sec ≤ budget_sec`; declared `loop.model_role` exists in config (checked in plan-04
   against the resolved config).
4. **`resolved_refs`**: collect every logical prompt/qset name used by the definition and its
   profiles (persona, `loop.prompt`, output checks' qsets, harness catalog) → `prompt-render
   resolve_names`. The session caches the result with the definition.
5. **Existence checks**: profile wfspecs, custom context providers, guard checks, hooks, custom
   router (phase 2: toolsets and sources). Missing → `load` **raises** (§5.2).
6. **`list`**: `builtin.deploy.wfspec.list` filtered by the `agent.` prefix, returning
   `{agent_id, display_name, version}`.
7. **Profile library**: four data wfspecs. `memory` ships in phase 1 with `requires: {config:
   memory.long_term.enabled}`, so it is never offered before long-term memory exists (phase 2).
8. **`hook-runner`** (phase 2): per event, run hooks in declaration order; `mode: sync` as a
   `sync` child with `timeout_sec` (default 5) and `on_error: {catch: true}` → on error/timeout
   `continue` + `hook_failure#`; `mode: async` as detached, observe-only. The patch allowlist is
   a literal table with three rows (`turn.received: message`, `answer.ready: answer, sources`,
   `tool.before: —`); other fields are dropped with a warning. `block` is honoured for
   `turn.received` and `tool.before` only. The patched payload feeds the next hook. A hook
   configured for an event not in the table fails `validate`.
9. **Conformance kit**: a runner that feeds shared fixtures to an extension and asserts output
   shape, timeout behaviour and "cannot loosen" cases. CI runs it for every agent package's
   extensions, together with `agent-registry validate`.

## 6. Tests

`workflow/tests/` (flat). **Done**: `agent-registry.test.yaml` (13: load, agent-local wins, version
pin, every loud failure, validate). Live on the dev stage: `load skeleton` resolves all harness
prompts and the library `chat` profile from the real catalogs; `list` finds the skeleton;
`decide(route)` and `render_and_chat(rewrite)` run with the registry's `resolved_refs`.

- `validate`: good definition; each required-field error; bad `agent_id`; bad semver range; a
  hook on a deferred event → error.
- `load`: library profile override merge; agent-local profile; missing prompt → raises;
  incompatible `harness` → raises; `resolved_refs` prefers the agent-local prompt.
- Profile validation cases from step 3.
- `hook-runner`: continue; patch within allowlist; patch outside allowlist dropped; block on
  `turn.received`; block on `answer.ready` ignored; timeout → continue; chained patches; async
  hook cannot patch.

## 7. Phase split

- **Phase 1**: `agent-registry` (incl. `resolved_refs`), profile library (`chat`, `rag`;
  `react` and `memory` present but gated), conformance kit for profiles.
- **Phase 2**: `hook-runner` (three events), toolset/source existence checks, kit for tools,
  sources, hooks, guards, context providers and routers.
  **Status (2026-10-12):** `hook-runner` (9 cases; the input key is `hook_event`, since `event` is
  reserved in DSL v2) wired at `turn.received`, `tool.before`, `answer.ready`; `conformance-kit`
  (profiles, sources, hooks, guards, providers, routers; 6 cases). Toolset existence is NOT checked
  at load: toolsets are seeded after deploy, and tool-policy offers nothing for a missing one.
- **Phase 3**: deferred hook events (`route.decided`, `context.assembled`, `tool.after`,
  `turn.committed`, `session.retired`) when an extension needs them; contract versioning when
  the first extension is maintained outside this repository.
  **Status (2026-10-16, harness 0.9.0):** the five deferred events are in -- `hook-runner`'s
  allowlist (`route.decided` patches `sources`, `tool.after` patches `content`, the other three
  observe; none blocks), `agent-registry`'s `hook_events`, and the call sites in agent-session
  (routing, assembling, delivering, retiring) and agent-loop (after an ok call). hook-runner
  +3 cases. **Verified live (2026-10-27)**: moco-assistant 1.6.1 declares `hook.moco.trace`
  (observe-only, `mode: async`) on all five, and each fired. The first run found F69: the agent
  loop could not resolve a bare hook name, so `tool.before` / `tool.after` hooks never ran;
  hook-runner now runs `agent-<agent_id>/<name>` (foundation 0.13.1). Contract versioning
  stays deferred.

## 8. Risks & open issues

- From phase 0 (F40, P21): a bare wfspec name outside the caller's own package is looked up as a
  package name, and agent packages are `agent-<agent_id>`. `resolved_refs` therefore records
  agent-local extensions package-qualified (`agent-moco-assistant/prompt.persona.moco`), and
  `load` checks existence in that form. The phase-0 `profile_library` in
  `agent-harness-defaults` moves into `profile.<name>` data wfspecs here. `harness`
  compatibility is checked against the `agent-harness` main wfspec's `harness_version`.

- Existence checks and `list` depend on `builtin.deploy.*` reads being cheap enough for every
  `load`. The session caches `load`'s result and re-runs it only when `config_version` changes.
- **Profile text uses `{name}` placeholders, not `{{ }}`.** A data wfspec evaluates its
  `context`, so `route_description: "... {{ sources }}"` (as §6.8.2 first sketched it) would be
  evaluated at load time and fail. The router/loop fill `{name}` themselves.
- A version pin (`prompts.overrides[n].version`) is not checked for existence: it becomes the
  ref `<package>/<version>/<wfspec>`, and an undeployed pin fails on first render.
- Until plan-04 makes `agent-config resolve` call `load`, the phase-0 `profile_library` in
  `agent-harness-defaults` duplicates `profile.chat`. Plan-04 deletes it.
- §20 Q3 (runtime-defined agents as state rows) would make `load` read `builtin.state` as a
  fallback; keep `load`'s fetch behind one statement so that is additive.
- Loop strategies are not an extension point (§5.1); do not add a registry kind for them.

## 9. Done when

`agent-registry load moco-assistant` and `load ops-assistant` succeed with complete
`resolved_refs`, a definition with a typo'd prompt fails loudly, and (phase 2) hooks can observe,
patch and block for the three v1 events.
