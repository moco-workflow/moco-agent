# Agent tools — what they are, what ships, how to enable and control them

A reader's guide to the harness's tools module (harness 0.12). It summarises design §6.9 (the
source of truth) and the code in `workflow/tools/src/`. When the two disagree, design.md wins and
this file is stale.

A tool is a manifest row stored by `tool-registry`. Agents never call activities or MCP servers
directly; every call goes through the tools module.

## What a tool is

A manifest (`tool:<name>`, design §6.9.3) has:

- a **name**, a description and a JSON-Schema `parameters`;
- a **binding** that says how it runs:
  - `wfspec`: a `tool.*` wfspec, the preferred kind (most testable; can hold auth, paging and
    shaping);
  - `activity`: a template over an allowlisted activity (`http.`, `sql.`, `gdrive.`,
    `llama_index.`, `typesafe.`, `k8s.get`, `k8s.list`). `shell`, `claude_agent`,
    `builtin.state`, `builtin.secret` and `builtin.deploy` are never allowed;
  - `mcp`: a tool on an MCP server;
  - `builtin`: a harness module (data in `tool-catalog`, never a row);
- a **policy**:
  - `side_effects` (none / read / write / external) is required;
  - `permission` is auto, approve or deny. The default is auto for none/read and approve
    otherwise;
  - limits per turn and per session;
  - `allow_session_grant`;
- an optional **credential**: none, `service` (one shared secret) or `user` (each user's own
  secret). Secret *names* only, never values.

A tool's status is draft → enabled → disabled / deprecated → retired (§6.9.5), and only
`enabled` tools are offered. Every save bumps the version and puts the tool back in `draft` until
it passes validation again.

Tools are grouped into **toolsets** (§6.9.6). Agents reference toolsets, never individual tools.

## What's available today

| Toolset | Tools | Who uses it |
| --- | --- | --- |
| `harness-builtin` | `knowledge_search`, `memory_recall`, `read_artifact`, `ask_user`, `current_time` (all auto); `memory_remember` (write, asks for approval) | moco-assistant |
| `k8s-readonly` | `k8s_list_pods`, `k8s_get_deployment`, `k8s_list_deployments`, `k8s_list_events` (auto); `k8s_get_secret` (asks for approval) | ops-assistant. Its cluster connection is in `tools.config['*']` and holds secret names only (`global/K8S_TOKEN`) |
| MCP providers | whatever an admin imports from a server, named as the server names them | any agent whose toolsets include them |
| Activity providers | moco activities an admin imports (`http.request`, `sql.query`, ...: only those on the registry allowlist), named `<type>` with `.` as `_` (`sql_query`) | any agent whose toolsets include them (suggested toolset `moco-activities`) |
| Workflow providers | deployed workflows that declare `header.metadata.tool`, named by their declared tool name | any agent whose toolsets include them (suggested toolset `moco-workflows`) |

The built-in tools live in `workflow/tools/src/tool-catalog.yaml` and are not stored as rows.
The ops-assistant tools come from `agents/ops-assistant/src/tools.ops-assistant.yaml`, which
`scripts/dev-stage.sh seed ops-assistant` installs.

## How a turn uses tools

1. **Route.** The `react` profile is the one that uses tools. It is offered only if the agent has
   at least one enabled tool (`requires: {tools: true}`). You can force it with `/tools`;
   otherwise the router picks it.
2. **Policy.** `tool-policy resolve` (§6.9.7) works out which tools this user may be offered in
   this session, and how each may run. Tools that need a user credential the user hasn't stored
   are not offered. Instead the agent is told to say which secret to store.
3. **Selection.** `tool-selector` (§6.9.8) picks at most 6 tools (`max_selected` in
   `profile.react`):
   - `always_offer` tools go in first;
   - the rest are ranked by word overlap with the request, keeping the top 10;
   - System One then judges each one, keeping those with probability ≥
     `decisions.tools.select_min_p` (0.5).
4. **Execution.** `tool-executor` (§6.9.9) handles each call: validate arguments → authorise →
   run → shape the result → screen it for injection → write an audit record.
   - A result over `max_chars` is stored as an artifact, and the model reads the rest with
     `read_artifact`.
   - Async tools (`execution.mode: async`, on a profile with `loop.async_tools: true`) run as a
     background job (`tool-job`) and report back in a later turn.
5. **Approval.** A tool that needs approval suspends the loop. The chat shows Approve, Approve
   for this session (only if the tool allows it), Reject and Change. The approval is tied to
   those exact arguments (`approval_token` = pending id + `args_hash`).
6. **Claude profiles** (`claude`, `builder`) run their own tool loop (§6.9.12). They get only
   tools that are auto, don't need a user credential, and bind `activity` or `mcp`.

## How to enable a tool for an agent

1. **Make the tool exist:**
   - write a manifest and install it with a seed step (as ops-assistant does), or
     `tool-registry save` then `validate`; or
   - import it from a provider (§6.9.4): UI **Tools → Providers → Add provider**. Admins only.
     Pick the source, list what it offers, tick the tools to import, and choose side effects,
     a default permission and toolsets.
     - **MCP server**: side effects required. A credentialed provider's tools bind
       `tool.mcp-call`, which fetches the encrypted secret (F49).
     - **moco activities**: only allowlisted activities are listed, each with its minimum side
       effects ("at least write"); the provider's side effects (optional) apply only where they
       are stricter. For
       each ticked activity you can fix part of its input (connection secret *names*, a base
       URL): fixed keys are hidden from the model and override its arguments. Parameters
       without a plain JSON type are dropped; a required one must be fixed, or the activity is
       not importable. Fix the knobs a model should not turn: for `http.request` that is
       `skip_cert_verify: false` and `proxy` (seen live: after a certificate error the model
       offered to retry with `skip_cert_verify`), and a base `url` where only one host is meant.
     - **Deployed workflows**: lists the workflows deployed to you on this stage that declare
       `header.metadata.tool` (see the moco-docs guide "Workflows as Agent Tools"). Side effects
       come from the declaration; the provider can only make them stricter. A workflow tool
       runs as the calling user.
2. **Opt the agent in:** list its toolsets in `toolsets: [...]`, and include `react` (or another
   tool-using profile) in `profiles`. The definition sets the default; an admin can change it
   with no republish in UI **Tools → Agent toolsets**, which saves the agent tier
   (`save_config`, scope `agent`). Lists replace on merge, so the saved list is the whole list.
   Every provider's tools go into at least one toolset (the Toolsets field, prefilled per
   source). Tool names are not prefixed with the provider, so a name already taken by another
   provider or an authored tool is refused at import (an import error), not overwritten.
3. **Optionally,** a profile can narrow the toolsets (`loop.tools.toolsets`), and
   `profile_overrides` can change `max_selected` or turn on `async_tools`.

## How to control tools

A tool's effective permission is the strictest of these layers, and `deny` always wins:

| Layer | Who sets it | How |
| --- | --- | --- |
| Activity type's minimum side effects | `tool-registry` (`activity_min_side_effects`) | an activity tool is never below it: `validate` refuses less, and reads raise an older row to it (auto becomes approve for write/external) |
| Manifest `policy.permission` | the tool's author | the baseline |
| `tools.overrides.<name>` | admin, in the agent config | can tighten. It can relax only as far as the manifest's own default, and a write/external tool can never become auto |
| Per-user preference (`tool_pref:<name>`) | each user, in UI **Tools → Preferences** | tighten anything to approve or deny. Loosening to auto works only for a read-only tool whose manifest asks for approval and sets `allow_session_grant: true`, and that has no agent override |
| Session grant (`tool_grant:<sid>:<name>`) | the user, via "Approve for this session" | only if `allow_session_grant: true` |
| Guest rule | built in | guests get only tools with no side effects |
| `guard check_tool_call` and `tool.before` hook | admin (agent config) or an extension | per call: escalate to approval, or block |

Other controls:

- **Limits:** a manifest's `per_turn` / `per_session` limits; going over returns
  `limit_exceeded` to the model.
- **Turning tools off:** `tool-registry disable` for one tool, or disable (or delete, which also
  removes its tools) a whole provider in the UI. When an MCP server changes a tool's description or schema, that tool is disabled until an
  admin accepts the change. The `tool-provider-sync` schedule checks hourly.
- **Monitoring:** `tool-stats-rollup` (§6.9.11) rolls up calls, errors, latency and approvals,
  shown on UI **Activity → Usage**. There is no automatic circuit breaker: an admin disables a
  tool that keeps failing.

## Where the code is

| wfspec (`workflow/tools/src/`) | Role |
| --- | --- |
| `tool-registry` | owns `tool:*` and `toolset:*`: manifests, toolsets, lifecycle |
| `tool-catalog` | the built-in tools and the `harness-builtin` toolset |
| `tool-provider`, `tool-provider-sync` | providers (MCP, activities, workflows): preview, register, update, sync, drift |
| `tool-policy` | effective permission, credential readiness, grants, per-user preferences |
| `tool-selector` | picks the tools for one loop step |
| `tool-executor`, `tool-dispatch`, `tool-render` | runs one call: validate, authorise, dispatch, shape, screen, audit |
| `tool-job` | the body of an async tool's job |
| `tool.mcp-call` | the binding for a credentialed MCP tool |
| `tool.run-workflow` | the binding for a workflow provider's tools: runs the deployed workflow as the caller |
| `tool-stats-rollup` | offline per-tool stats |
| `seed-tools` | installs an agent's manifests and the platform schedules at deploy |
