# Plan 10 — Tools manager (`tool-registry`, `tool-policy`, `tool-selector`, `tool-executor`; phase 3: `tool-provider`)

Design: `design.md` §6.9 (all), §10, §6.16 (stats rollup, seed-tools). Overview:
[plan-00](plan-00-overview.md).

## 1. Scope

The life of a tool: its manifest and versions, toolsets, who may use it and with which
credential, selection for a request, execution (validate → authorise → dispatch → shape → screen
→ return an audit record), artifacts for large results, approvals and session grants, and the
bridge to `claude_agent`.

Trimmed in v4 (S7):

- **No circuit breaker and no per-call `tool_stats` writes.** Stats come from an offline rollup
  of the audit rows (plan-17, F17).
- **Tool providers are phase 3.** The platform side exists (`mcp.list_tools`, P14/F1). Until the
  service ships, an MCP tool is an authored manifest with an `mcp` binding.
- **The v1 policy has four layers**: manifest, agent override, session grant, guest rule.
  Per-user preferences are phase 3.
- **Async tools move to phase 3**, and return a `job_request` rather than starting a job (F6, F9).

Out of scope: the loop that decides to call tools (plan-11); pending-action storage (plan-12);
jobs (plan-13); writing the audit rows (the session does it in `commit_turn`, F33).

## 2. wfspecs to create

`workflow/src/` (flat, F41)

| wfspec | Modes | Owns |
| --- | --- | --- |
| `tool-registry.yaml` | `list`, `get`, `save`, `validate`, `enable`, `disable`, `deprecate`, `delete`, `list_toolsets`, `save_toolset`, `members {toolsets}` | `tool:*`, `toolset:*` (shared and agent scopes; user scope in phase 3) |
| `tool-policy.yaml` | `resolve`, `grant`, `revoke` (phase 3: `set_pref`) | `tool_grant:*` (phase 3: `tool_pref:*`) |
| `tool-selector.yaml` | select (pure) | — |
| `tool-executor.yaml` | `call`, `dry_run`, `read_artifact` | `session:<sid>:artifact:*` |
| `tool-catalog.yaml` | data: harness built-in manifests + the `harness-builtin` toolset | — |
| `tool.<name>.yaml` | tool wfspecs (e.g. plan-18's `moco-builtin`) | — |
| `tool-provider.yaml` | phase 3: `register`, `sync`, `accept_drift`, `reject_drift`, `disable`, `list`, `get` | `tool_provider:*` |

## 3. Dependencies

- Calls: `access` (plan-04); `guard check_tool_call` / `screen_content` (plan-05); `decide`
  (plan-02) with `qset.tools`; `mcp.call_tool`; allowlisted activities; `builtin.secret.list`
  (names only — verified, F4); built-in bindings → `knowledge`, `memory`, `builtin.now`.
- **No Orchestration calls**: audit records, `pending` and `job_request` are returned, and the
  session acts on them.
- Called by: loop `selecting` / `acting` (plan-11); `subagent.claude` bridge (plan-18);
  `agent-admin` tools area (plan-16); `seed-tools` and `tool-stats-rollup` (plan-17).

## 4. Reuse

None from the old agent (it had no tools). `mcp.call_tool` usage patterns from the
`moco-examples-internal` activity examples.

## 5. Implementation steps

1. **Manifest schema + `tool-registry save/get/list`** (§6.9.3): `schema_version`, name regex,
   `version` bump on every save, scopes, origin, status (`draft | enabled | disabled |
   deprecated | retired`). Admin required for shared/agent scope (`access`).
2. **`validate` (draft → enabled)**: `parameters` is a well-formed JSON Schema subset; exactly one
   binding; the **activity allowlist literal** (`http.`, `sql.`, `gdrive.`, `llama_index.`,
   `typesafe.`, `k8s.get`, `k8s.list`); templates compile with only `args, result, config,
   user_id` in scope; the referenced wfspec exists; the secret name is well-formed.
3. **Lifecycle** (§6.9.5): enable / disable / deprecate / retire, with guards; illegal →
   `invalid_state`.
4. **Toolsets**: membership = `toolset.tools` ∪ manifests' `toolsets`; `always_offer`; a
   profile narrows to a subset of the agent's toolsets.
5. **`tool-policy resolve`**: most restrictive of manifest → agent override → session grant →
   guest rule; `deny` wins; `needs_credential` via `builtin.secret.list`; output `{offerable,
   needs_credential, hidden}`. `grant` (only from an approval decision), `revoke`.
6. **`tool-selector`**: pinned → lexical pre-filter (top 10, the synchronous cap of design §7.3;
   boost for tools used successfully earlier in the session) → `decide(qset.tools)` only if
   more than `max_selected` remain → threshold → fallback top 2 → emit `openai_tools`.
7. **`tool-executor call`** — the tool-call state machine (§6.9.9): validate args (required,
   primitive types, enums) → authorise (effective permission, `check_tool_call`, `tool.before`
   hook via the loop, approval token = pending id **and** `args_hash`) → dispatch by binding
   (`wfspec` sync child with `on_error: {catch: true}`; `activity` with rendered `input_template`;
   `mcp.call_tool`, credential-free: a credentialed http/MCP tool binds a `tool.*` wfspec, F49; `builtin` module mode), timeout = min(tool,
   budget left) → retry only if idempotent, on transient errors → shape (`result.shape`,
   `result.sources`) → artifact if over `max_chars` → `screen_content {source: tool}` → return
   the result with its `audit` record. Limits `per_turn` / `per_session` → `limit_exceeded`.
8. **Approval payload**: `pending.summary` from `approval_template` (fallback text) and
   `offer_session_grant`. A session-grant approval makes the session call `tool-policy grant`,
   then resume as an approve.
9. **Artifacts + `read_artifact`**: `session:<sid>:artifact:<id>`, deleted with the session;
   paging.
10. **`dry_run`**: render the binding and report `would_require`.
11. **Built-in tools** (§6.9.10) in `tool-catalog`: `knowledge_search`, `memory_recall`,
    `memory_remember`, `read_artifact`, `ask_user` (returns a status the loop turns into a
    `user_input` pending action), `current_time`.
12. **Claude bridge** (§6.9.12): `claude-capabilities {offerable}` → only `auto`,
    non-user-credential, `activity`/`mcp` tools → `moco_tools` / `mcp_servers`, plus a trace
    record.
13. **Versioning on resume**: the held call records `version`; on resume, re-validate against
    the current manifest and apply the stricter permission.
14. **Phase 3**: async tools (`async_started` + `job_request`) -- **done** (harness 0.6.2,
    2026-10-14): `execution.mode: async` in the registry (timeout ≤ 3600), tool-executor's async
    verdict after authorise (`allow_async`, `run_now`), the job body `tool-job`, the loop's
    `loop.async_tools` flag and one job per turn; verified live (a `tool-job` dispatching
    `http.request` inside a job, its result relayed as a turn). `tool_pref` / `set_pref`;
    user-installed tools; `tool-provider` on `mcp.list_tools` (import
    allowlist, name prefixing, snapshot hash drift → `drifted` + tools disabled).

## 6. Tests

`workflow/tests/` (flat, F41)

- Registry: each `validate` failure reason; non-allowlisted activity rejected (incl. `shell`,
  `builtin.state`, `claude_agent`, `builtin.deploy`, `graphql.*`); every lifecycle transition
  and the illegal ones.
- Policy lattice: every row of the v1 table, including the "cannot loosen" cases (agent override
  `auto` on an external tool; a grant without `allow_session_grant`; guest on a read tool).
- Credential readiness: missing user secret → `needs_credential`, not offered.
- Selector: pinned tools count toward the max; at or under max after the pre-filter → no System
  One call; nothing above threshold → top 2.
- Executor: invalid args returned as a tool result; approval-token replay with changed args →
  `needs_approval`; retry only when idempotent; artifact creation + paging; limit exceeded;
  deprecated tool warns; the `audit` record is always returned; **no `builtin.state` write to any
  session row except artifacts**.
- `dry_run` renders each `activity` binding against its manifest `examples` (CI, every manifest).
- Claude bridge excludes `approve` and user-credential tools.

## 7. Phase split

- **Phase 2**: steps 1–13.
- **Phase 3**: step 14. **Status (2026-10-16, harness 0.9.0):** done.
  Preferences: `tool-policy set_pref / clear_pref / list_prefs`, `tool_pref:<name>` in
  `<uid>:agent.<id>`, applied between the agent override and the session grant (tighten anything;
  `auto` only for a read-only tool whose manifest asks approve and allows session grants, with no
  agent override); `pref_used` in resolve; admin `set_tool_pref`, `clear_tool_pref`,
  `list_tool_prefs`; tests split into `tool-policy.prefs` (9). Providers: `tool-provider`
  (§6.9.4 lifecycle, `import_spec`, allowlist required, prefixed names, origin
  `provider:<name>`), `tool.mcp-call` for credentialed providers (tool-executor now passes
  `binding.wfspec` to wfspec tools), `tool-registry` keeps a `provider:` origin,
  `tool-provider-sync` (hourly), nine admin ops. Tests: tool-provider (19), tool.mcp-call (4),
  tool-provider-sync (2). Verified live against a local MCP server: preview, register (the
  non-allowlisted tool left out), a real call, a no-op sync, drift disabling only the changed
  tool, accept (version 2, enabled), disable. User-installed tools and providers (open
  question 11) stay open.

**Status (2026-10-12):** steps 1–11 and 13 implemented and deployed (harness 0.4.x):
`tool-registry` (+ `tool-catalog` merged into reads), `tool-policy`, `tool-selector` +
`qset.tools`, `tool-render`, `tool-dispatch`, `tool-executor` (call / dry_run / read_artifact),
`guard check_tool_call` + `qset.guard.tool`, `seed-tools`. Verified live: seeding ops-assistant's
five k8s manifests (idempotent on redeploy), a call suspending for approval and resuming after a
session retire, audit rows persisted. Open: step 12 (claude bridge, with plan-18 step 5); the
`dry_run`-every-manifest CI check runs through `seed-tools`' validate today. F49: the harness does not fetch
secrets at dispatch, so credentialed http/mcp tools are `tool.*` wfspecs (both take an encrypted secret
via `encrypted_auth_token`).

## 8. Risks & open issues

- **F1 / P14** is resolved (`mcp.list_tools`); live providers wait only on phase-3 scheduling,
  and the authored-manifest path covers MCP tools meanwhile.
- **Provider kinds `activity` and `workflow`** (0.12, F67): moco activities and deployed
  workflows (`header.metadata.tool`) import through the same provider pipeline (design §6.9.4).
  An activity tool's admin-fixed input is not bridged to claude runs; workflow tools have no
  claude form. Activity tools are held to a per-type minimum side effect (F68).
- No automatic disable of a failing tool in v1. The rollup (plan-17) flags it and an admin acts.
- Open questions 11 (user-installed providers), 12 (per-user credentials for claude) and 13
  (agents as MCP tools) don't change phase-2 scope.
- JSON Schema validation is a subset: `required`, primitive `type` and `enum` are enforced
  (tool-executor); other keywords are passed to the model only. Documented in the
  `tool-registry` header.
- `validate` cannot compile a template (the sandbox has no `eval`); it checks balance and
  dunders, and the full check is `dry_run` rendering each manifest's `examples` (step 10).
  Rendering in the executor uses an inline child with only `args, result, config, user_id` in
  its context and a `#python#python` second pass, which applies to strings only, so an
  `input_template` mapping is rendered leaf by leaf.

## 9. Done when

Phase 2 exit (§19): ops-assistant runs read-only k8s tools defined only as manifests
(`activity` bindings over `k8s.get` / `k8s.list`, service credential); a write tool requires
approval; approve-and-resume works; every manifest passes `validate` and `dry_run` in CI.
