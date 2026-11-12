# Proposal — namespace admins are agent admins by default

**Status: implemented and folded in (2026-10-09)**: design §6.13 / §6.1.1, plan-00 F48, plan-04.
Those are now the source of truth; this file keeps the reasoning and the gap analysis.
Deviations from the plan below: step 6 (`access_source` in `get_config`) was not built -- the UI
already gets `role: admin` from `identify`; the agent-config cases live in their own suite
(`agent-config.ns-admin.test.yaml`) because `agent-config.test.yaml` is at the YAML parser's
alias limit; and `moco test` runs on the dev stage (tier `dev`), so the lookup is live in tests
unless mocked.

---

## 1. Scope

Today an agent's admins are the `access.admin_user_ids` list, set in the definition
(`agent.<id>`) or at the agent tier. The default is empty, so the first admin must be hand-written
into a deployed wfspec, and every change after that is a config save or a redeploy.

Proposed: **a user who holds `manage_ns` in the namespace that owns the agent package is an admin
of that agent**, on top of `admin_user_ids`. Membership is managed with the platform's existing
RBAC (`sys.namespace.role.member`, groups included), not in agent config.

What "namespace admin" means on the platform (verified in code):

- `sys.deploy.namespace set` → `sys.deploy.namespace.authorization init` creates role
  `<ns>:admin`, adds the **creator** as a member, and grants it privileges `<ns>:manage_ns`,
  `view_ns`, `list_wfspec`, `view_wfspec_source`, `deploy_wfspec`, `share_wfspec`.
- `sys.deploy.assert_privilege {namespace_id, privilege: manage_ns}` is how the platform itself
  checks it: `builtin.deploy.auth.check_user_privilege {user_id, privilege_id: '<ns>:manage_ns'}`,
  which calls `moco.is_user_privileged` (direct grants, nested groups, and `'*'`).

So "namespace admin" = `is_user_privileged(uid, '<ns>:manage_ns')`. We test the **privilege**,
not the role name, so a custom role carrying `manage_ns` counts too, exactly as for the
platform's own checks.

Out of scope: per-agent roles (`agent-admin:<id>`) and delegating other `access` lists (guest,
denied) to RBAC. Both fit the same mechanism later.

**Why not `wfspec.owner`.** `moco publish` upserts the wfspec row with
`owner: session.user_id` on every publish (`moco-cli/src/commands/publish.ts:225`, and
`builtin.deploy.wfspec.set` overwrites on update). It means "last publisher": a CI account or a
colleague's hotfix silently becomes the only admin. And it is one person, not a group.

## 2. wfspecs to create

| wfspec | Layer | Does |
| --- | --- | --- |
| `namespace-admin` | Foundation | `{package_name}` → `{namespace_id, is_admin}` for the **caller**: `builtin.deploy.wfspec.get` (the package's wfspec row carries `namespace_id`), then `builtin.deploy.auth.check_user_privilege` for `<ns>:manage_ns`. Pure read, no storage, owns nothing. Fails closed: any error, no stage (file run, tests), or a guest/missing uid → `is_admin: false`. |

Changed: `access` (honours the flag), `agent-config` (computes it in `resolve`, protects it in
`validate`), `agent-harness-defaults` (new default), `admin.config` (reports the source in
`get_config`, optional, for the UI).

## 3. Dependencies

- moco-core `builtin.deploy.wfspec.get` and `builtin.deploy.auth.check_user_privilege`: both
  exist and are in the catalog. **No moco-core or moco-db change is required.**
- Deploy DB reachable from the worker (already true: `package-catalog`
  uses `builtin.deploy.query.*`).
- The owning namespace was created through `sys.deploy.namespace set`, so `<ns>:manage_ns`
  exists. See gap G2.

## 4. Reuse

- The identity/stage guard of `package-catalog` (`read-identity`: `__sys_info__.tier`,
  `__user_info__.user_id`; skip when either is absent).
- The privilege-id convention and check of `sys.deploy.assert_privilege` (`'<ns>:' + privilege`).
  We call the activity directly and do not inline that wfspec, because it **raises** on deny and
  we need a boolean.

## 5. Implementation steps

0. **Verify on the dev stage** (no code): the agent packages' namespace has `<ns>:manage_ns`
   and the dev user holds it (`moco run` a two-task probe calling `builtin.deploy.wfspec.get`
   and `check_user_privilege`). If the namespace predates `authorization init`, run
   `sys.deploy.namespace.authorization {operator: init}` for it once (G2).

1. **Config shape** (`agent-harness-defaults`, design §6.1.1):
   ```yaml
   access:
     denied_user_ids: []
     guest_user_ids: ["guest", "None", ""]
     admin_user_ids: []
     guest_profiles: [chat]
     namespace_admins: true        # new: holders of <ns>:manage_ns are agent admins
   ```
   `namespace_admins` is **definition-only**: add `access.namespace_admins` to `agent_forbidden`
   for the agent tier (it is already outside the user/session `allowed_paths`). Otherwise an agent
   admin could set it false at the agent tier and lock the namespace admins out of an agent they
   own, and only a redeploy of a definition could undo it. Setting it false in the definition is
   the opt-out, and that needs publish rights in the namespace anyway.

2. **`namespace-admin` wfspec** (§2). Tasks: `read-identity` → `read-owning-namespace`
   (`wfspec.get {wfspec_name: package_name}`, `on_error: {catch: true}`) →
   `check-namespace-admin` (`check_user_privilege`, `on_error: {catch: true}`). Both activities
   use literal `retry_policy {timeout_sec: 20, max_attempts: 2}` (P20). Run **inline**: the
   payloads are tiny, unlike `get_files`.

3. **`agent-config resolve`**: after `merge-config`, when `access.namespace_admins` is true and
   the caller is neither guest nor denied by the merged lists, call `namespace-admin` with
   `package_name: 'agent-' + agent_id`. Write the result into two **computed** keys, set after all
   tiers are merged, so no tier can supply them:
   - `access.caller_is_namespace_admin: bool`
   - `access.namespace_id: string | null` (display / diagnostics only)

   **Why a per-caller flag and not "append uid to `admin_user_ids`".** The resolved config is
   already per user. But `get_config` shows `admin_user_ids`, and the UI saves lists by
   replacement: an injected uid would be written back into the agent tier and become permanent.
   A separate computed key cannot round-trip. **Why not enumerate the namespace admins into
   the list.** Membership goes through nested groups and `'*'`. Expanding it is a recursive
   query per resolve, and it would put every admin's id into every user's config.

4. **`agent-config validate`**: reject any patch at any tier that contains
   `access.caller_is_namespace_admin` or `access.namespace_id` (`code: invalid_input`, path in
   `errors`), and `access.namespace_admins` at the agent tier (step 1).

5. **`access`** (`identify-role`, `decide-access`): admin is
   `uid in admin_user_ids or definition_access.get('caller_is_namespace_admin') is True`. Use
   `is True`, so absent, null or a string fails closed. The order is unchanged: denied, then
   guest, then admin, so a guest or denied id with `manage_ns` stays guest or denied.
   `required_lists` is unchanged: the flag is optional, so a config resolved by an older harness
   still authorises, with no namespace admins.

6. **`admin.config get_config`**: add `data.access_source: list | namespace | null` beside the
   role from `identify`, so the UI can say why someone is an admin. Optional, and cheap because
   the flag is already in the resolved config.

7. **Docs**: design §6.13 (new authority source, table row, policy paragraph), §6.1.1 (the
   two computed keys and the definition-only field), plan-00 F48, plan-04 steps/tests,
   `CLAUDE.md` rule *"Authority comes from `__user_info__.user_id`"* (unchanged: the lookup
   is keyed by it), and the moco-doc agent admin page if one exists.

## 6. Tests

- `access.unit`: admin via flag; flag + `admin_user_ids` both; guest + flag → guest rules;
  denied + flag → `denied_user`; flag `"true"` / `1` / absent → not admin; `identify` returns
  `admin` for the flag.
- `namespace-admin.unit`: mock `read-owning-namespace` / `check-namespace-admin` by `task_name`.
  Cases: granted; not granted; wfspec missing (null) → false; each activity failing
  (`_: "{{ 1 / 0 }}"`) → false; no stage → both mocks unused (sentinel).
- `agent-config` resolve: flag set from the mocked child; `namespace_admins: false` skips the
  child (sentinel); a guest caller skips it; the computed keys overwrite a stored agent-tier row
  that contains them (a row written before validate rejected them).
- `agent-config` validate/save: computed keys rejected at user/agent/session; `namespace_admins`
  rejected at agent tier; `save_config scope: agent` succeeds for a flagged caller with an empty
  `admin_user_ids`.
- Live, dev stage: a user holding `<ns>:manage_ns` and not in `admin_user_ids` can
  `save_config global`. `sys.namespace.role.member remove` → the next `save_config` is
  `not_admin`, with no redeploy. Add back via a **group** → admin again.

## 7. Phase split

All phase 1 (it changes the existing access path). No dependency on phase 2/3. The phase-2/3
admin actions (memory promotion, tool drift, `revoke_grant`) inherit it by calling `access`.

## 8. Risks & open issues

Implementation gaps found while checking the approach, and how each is handled:

| # | Gap | Impact | Handling |
| --- | --- | --- | --- |
| G1 | `__sys_info__` has no namespace (`SysInfo`: `wfspec_name`, `wfspec_version`, `tier`, ...). | One extra DB read per resolve. | Look it up with `builtin.deploy.wfspec.get` by package name. Optional moco-core follow-up: add `namespace_id` to `SysInfo`, since the deploy resolver already has the wfspec row. Not required. |
| G2 | The `<ns>:admin` role and `manage_ns` privilege exist only for namespaces created through `sys.deploy.namespace set`. Seeded or older namespaces may have none. | Nobody qualifies, so the agent falls back to `admin_user_ids`. Safe, but surprising. | Step 0 checks; `authorization init` repairs it. |
| G3 | `builtin.deploy.*` read activities do no authorization: any wfspec can ask `check_user_privilege` about any user. | Not a harness hole (we ask only about the caller), but platform-wide privilege enumeration. | Out of scope; raise as a moco-core finding. |
| G4 | `wfspec.set` on an existing wfspec updates `namespace_id`. Whoever can republish `agent-<id>` into another namespace moves its admin set there. | Agent admin ≡ control of the package's namespace. That is no more than package-publish rights, which can replace the definition anyway. | Accept. Verify that `sys.deploy.wfspec set` checks privilege on the **current** namespace, not only the target; if it doesn't, that is a platform bug worth its own finding. |
| G5 | `is_user_privileged` honours `'*'` membership. | Granting `<ns>:admin` to `'*'` makes everyone an agent admin. | Same semantics as the platform's own `manage_ns`. Document; no special case. |
| G6 | A session resolves config in `init` and re-resolves only when tier row versions move. A membership change does not bump them. | Inside a live session the flag is stale until the session restarts. | Today every admin-gated write goes through `agent-admin`, which resolves fresh per call, so this is harmless. Note for phase 2/3: any in-session admin check must re-resolve or call `namespace-admin` directly. |
| G7 | Two DB reads per resolve (`agent-admin` config/knowledge calls, session init). | Tens of ms; nothing per turn. | Skipped when the flag is off or the caller is guest/denied. Folding the namespace into `package-catalog`'s output (it already runs per resolve via `agent-registry load`) would save one read; do it only if measured. |

Design-rule check:
- *Authority from `__user_info__`*: kept; the uid passed to `check_user_privilege` is read inside
  `namespace-admin`, never from input.
- *Extensions tighten, never loosen*: the new source is platform RBAC chosen by the deployment,
  not an extension. The only agent-side knob, `namespace_admins`, can only remove it.
- *Deny always wins*: kept (step 5 ordering).
- *Layering*: `namespace-admin` is Foundation, called by `agent-config` (Foundation).

Open question for review: should `namespace_admins` default to `true` for **existing** agents
too? With true, every holder of `manage_ns` in the dev namespace gains admin on deploy. That is
the intent, but it is a permission widening for already-deployed agents and should be said in the
release note.

## 9. Done when

- A namespace admin who is not in `admin_user_ids` can `save_config global` and register a
  shared source. Removing their `manage_ns` (directly or via a group) revokes it on the next
  `agent-admin` call, with no redeploy.
- Guest/denied precedence and fail-closed paths are covered by unit tests; the full suite passes
  on Temporal.
- design §6.13/§6.1.1, plan-00 F48 and plan-04 updated; this proposal marked folded in.
