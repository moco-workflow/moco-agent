# Agent permissions — who may do what

A reader's guide to the harness's permission model. It summarises design §6.13 (the source of
truth) and the code in `workflow/foundation/src/access.yaml`. When the two disagree, design.md wins and
this file is stale.

Every permission decision is made in one place, **`access`** (a Foundation wfspec), by its
`decide-access` task. Every owner's write mode calls it (`agent-config save`, `source-registry`,
...), and so do the router and tool policy for `use_profile` / `call_tool`.

## Roles

A caller has exactly one role, decided from the resolved config's `access` section (defaults in
`agent-harness-defaults`):

| Role | How you get it | Default |
| --- | --- | --- |
| **denied** | `user_id` in `denied_user_ids` | nobody |
| **guest** | `user_id` in `guest_user_ids` | `guest`, `None`, `""` |
| **admin** | `user_id` in `admin_user_ids`, **or** a namespace admin (below) | the namespace admins; the list is empty |
| **user** | everyone else | — |

- **Identity** comes from `__user_info__.user_id` only, never from an input. A missing id becomes
  `"None"`, which is a guest.
- **Deny beats admin.** The order is denied, then guest, then admin. A denied or guest id on
  `admin_user_ids`, or holding `manage_ns`, keeps its lower role.
- **Guests are shared identities.** Every guest signs in as the same `user_id`, so a guest write
  would change every guest's data. That is why guests are read-only.

### Namespace admins (F48)

A user holding **`<ns>:manage_ns`** in the namespace that owns the agent package
(`agent-<agent_id>`) is an admin of that agent. This is the platform's own "namespace admin":
creating a namespace with `sys.deploy.namespace set` creates role `<ns>:admin`, makes the
creator a member, and grants it `manage_ns`. A custom role carrying `manage_ns` counts too.

- **Managing admins.** Use the platform's role tools, not agent config:
  `sys.namespace.role.member {operator: add|remove|list, namespace_id, role_id: '<ns>:admin',
  user_id | group_id}`. Nested groups work. A change applies on the next `agent-admin` call,
  with no redeploy.
- **Opting out.** Set `access.namespace_admins: false` in the agent **definition**. Only the
  definition may set it: if the agent tier could, an agent admin could lock the namespace admins
  out of an agent they own.
- **How it works.** `agent-config resolve` calls `namespace-admin`, which does two deploy-DB
  reads: the package's `namespace_id`, then `check_user_privilege` for the caller. It stamps the
  answer into the resolved config as `access.caller_is_namespace_admin` (plus `namespace_id`).
  No tier, definition or stored row can set those keys; `resolve` overwrites them. Any failure
  means "not a namespace admin", and `admin_user_ids` still applies.
- **Not `wfspec.owner`.** `moco publish` overwrites the owner with whoever published last, so
  it can't be used to decide admins.

## What each role may do

| Action | Resource / scope | denied | guest | user | admin |
| --- | --- | --- | --- | --- | --- |
| `chat` | — | ✗ | ✓ | ✓ | ✓ |
| `read` | any scope | ✗ | ✓ | ✓ | ✓ |
| `use_profile` | profile name | ✗ | only `guest_profiles` | ✓ | ✓ |
| `write` | scope `user` / `session` | ✗ | ✗ | ✓ | ✓ |
| `write` | scope `agent` / `shared` | ✗ | ✗ | ✗ | ✓ |
| `feedback` | — | ✗ | ✗ | ✓ | ✓ |
| `call_tool` | `{side_effects}` | ✗ | only `side_effects: none` | ✓ | ✓ |
| `admin` | — | ✗ | ✗ | ✗ | ✓ |

Refusal reasons: `denied_user`, `guest_read_only`, `guest_no_feedback`, `guest_profile`,
`guest_side_effects`, `not_admin`. A tool that declares no `side_effects` counts as having them.

**Admin vs. user, in short:** an admin can also write at the `agent` and `shared` scopes, and
use the `admin` action. Everything else is the same for both.

Failure rules:
- An unknown action or scope is a caller bug, and `access` raises.
- A `definition_access` missing any of the four lists is `invalid_input` (fail closed).
- `caller_is_namespace_admin` counts only when it is exactly `true`.

## Where the difference shows up today

| Area | Admin only | Any user |
| --- | --- | --- |
| **Config** (`agent-admin save_config` / `reset_config`) | scope `global` (the agent tier) | scope `user`: their own model picks, `persona_text`, disabled profiles |
| **Knowledge sources** (`register_source`, `reindex_source`, ...) | scope `global` (shared sources) | their own private sources |
| **UI** | `get_config` returns `role: admin`, so the UI offers the agent tier and shared sources | `role: user` |
| **Sessions** | — no difference | everyone sees only their own sessions (keys are namespaced by user id) |

What each tier may set (design §6.1.1):

| Tier | May set |
| --- | --- |
| agent definition | everything (including `access.namespace_admins`) |
| agent tier | everything except `agent_id`, `harness`, `access.namespace_admins`; admin only |
| user | per model role: provider, model, `base_url`, secret name (plus `max_tokens` / `temperature` / `embed_dim` where they apply); `persona_text`; `disabled_profiles` |
| session | `models.inference.model`, `models.inference.temperature`, `disabled_profiles` |

`decisions.*`, `guard.*`, `retention` and `limits.*` are agent-tier only, so a user can't lower
a defence such as an injection threshold.

## Planned (not built yet)

- **The `admin` action.** It's defined and tested, but no wfspec calls it yet.
- **Memory (phase 2/3):**
  - Conversations never write the `agent` scope.
  - Promoting a memory into it needs 3 distinct users and an admin. Promotion is opt-in per
    agent (`memory.long_term.promotion`): when it's on, users' active facts and lessons are
    copied to a global pool that every user can read.
  - No admin can read or write another user's own memory, sessions or jobs: moco keeps a
    user's state namespace to that user (F50 closed). Per-user cleanup runs as the user.
  - Admins can edit or retire memory items.
- **Tools (phase 3):**
  - Saving a tool in shared or agent scope and accepting a provider's drift are admin only.
  - Disabling a tool is owner or admin.

## Principles

- **Extensions tighten, never loosen.** Hooks, guard checks and user or agent config can restrict
  permissions but can't grant them. `deny` always wins.
- **Admins select, users disable.** Admins choose among deployed extensions (enable a profile,
  attach a toolset, pin a prompt version). Users can only *disable* profiles for themselves.
- **Freshness.** `agent-admin` resolves config on every call, so a role change applies at once
  there. A live session keeps the access it resolved until it re-resolves. Any future in-session
  admin check must re-resolve or call `namespace-admin` itself.

## See also

- design.md §6.13 (access, namespace admins), §6.1.1 (tiers)
- plan-00 F48, plan-04
- `proposal-namespace-admin.md`: the reasoning and gap analysis behind namespace admins
