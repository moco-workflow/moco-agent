# Plan 04 — Access + config manager (`access`, `agent-config`, `agent-harness-defaults`)

Design: `design.md` §6.1, §6.13 (`access`), §6.2.1 (roles), §3 P11. Overview:
[plan-00](plan-00-overview.md).

## 1. Scope

- **`access`** (Foundation, built first): deterministic authorization — access lists, guest
  rules, admin list. Every owner's write modes call it. It moved here from plan-05 so that
  Foundation owners don't call upward and the build order has no cycle (F5, F24).
- **Config**: resolve the effective configuration for agent × user × session; validate changes
  against the model catalog, tier allowlists and extension registry; be the only reader/writer of
  `config:*` rows.
- **`agent-harness-defaults`**: the harness defaults tier *and* the model catalog in one data
  wfspec (S10, replaces v3's separate `agent-models`).

Out of scope: definition loading (plan-03); secrets (only names are stored, P11); the
probabilistic checks (plan-05).

## 2. wfspecs to create

`workflow/src/` (flat, F41)

| wfspec | Modes | Owns |
| --- | --- | --- |
| `access.yaml` | `authorize {action, resource, scope, definition_access}` → `{allow, reason}` (**built**) | — (pure) |
| `namespace-admin.yaml` | `{package_name, exclude_user_ids}` → `{namespace_id, is_admin}` for the caller (**built**, 2026-10-09, F48) | — (pure: two deploy-DB reads) |
| `agent-harness-defaults.yaml` | — (data) | Every section's defaults incl. `decisions.*`, `guard.*`, `limits` (incl. `cost`, `retire_throwaway_after_idle_sec`), `retention`, `memory`, `context`, `classifier`; plus `models:` catalog (endpoint, models, capabilities `tools`, `json_mode`, context window). |
| `agent-config.yaml` | `resolve {session_overrides?}`, `validate {partial, scope}`, `save {scope, patch}`, `reset {scope, section?}`, `list_models` (**all built**, 2026-10-06) | One `config` row per tier: `agent.<id>` (agent tier, `in_global_ns: true`) and `<uid>:agent.<id>` (user tier). Row `{schema_version: 1, version, sections, updated_at, updated_by}` |

## 3. Dependencies

- `access`: none.
- `agent-config`: `agent-registry load/validate` (plan-03, phase 1); `builtin.state` for its own
  rows; `access` for `save scope: agent`.
- Called by: session `init` and the per-turn version check (plan-14), `agent-admin` config area
  (plan-16), `tool-policy` (plan-10) for `tools.overrides`, every owner's write modes (`access`).

## 4. Reuse

| From | To |
| --- | --- |
| `agent-config.yaml` — the global → user overlay (the "single implementation of that overlay") | tier merge core; extended with definition and session tiers |
| `agent-providers.yaml` | the `models:` catalog in `agent-harness-defaults` (add capability fields) |
| old guest denial list and admin checks | `access` |
| `seed-knowledge.yaml` config materialisation | dropped: the definition *is* the defaults tier |

## 5. Implementation steps

0. **Phase 0 subset** (plan-00a): `agent-harness-defaults` and `resolve` = defaults ⊕ definition,
   with no stored tiers and no registry (the skeleton reads `agent.<id>` directly).
1. **`access authorize`** — **done** (2026-10-05): the action table of design §6.13, over the
   resolved config's `access` section (defaults in `agent-harness-defaults`: `guest_user_ids
   ["guest", "None", ""]`, `denied_user_ids []`, `admin_user_ids []`, `guest_profiles [chat]`).
   Reason codes `ok | denied_user | guest_read_only | guest_no_feedback | guest_profile |
   guest_side_effects | not_admin`. The decision is the named task `decide-access` over `uid`.
   **Namespace admins** — **done** (2026-10-09, F48, design §6.13): `access` also counts
   `definition_access.caller_is_namespace_admin is True` as admin (deny, then guest, still win).
2. **Merge** — **done**: `harness defaults < definition < agent tier < user tier < session`, dict
   values merged field by field (the self-applied lambda, in `resolve-config`). Session overrides
   keep only their allowlist; the rest is reported as `session_dropped#`.
3. **`resolve`** — **done**: `agent-registry load` → read the two stored tiers → merge → apply
   `session_overrides`. `config_version` = the phase-0 token `d<harness package version>+a<agent
   package version>` with the agent-row and user-row versions appended, so a **redeploy also
   bumps it** (F21; package versions since DSL v2, and F43 must hold across continue-as-new). Returns `resolved_refs` from `load`
   alongside the config so the session caches both. Then (F48), with
   `access.namespace_admins` (default true, definition-only), `resolve-namespace-admin` calls
   `namespace-admin` for `agent-<id>`, guests and denied ids excluded, and `stamp-access` writes
   `access.caller_is_namespace_admin` / `access.namespace_id` over whatever the tiers held.
4. **Tier allowlists** — **done**: a literal map (`allowed_paths.user/session`, `agent_forbidden`);
   anything not listed is agent-tier only, so `decisions.*`, `guard.*`, `retention` and `limits.*`
   are by construction. `agent_forbidden` holds dotted paths (F48: `access.namespace_admins`
   and the two computed keys); a patch may neither set one nor replace one of its ancestors.
5. **`validate`** — **done** except extension references and `config_schema` (phase 2): allowlist per scope; capability rules — the `decision` role, or `inference`
   when `decision` is null, needs `json_mode`; `inference` needs `tools` if any enabled profile
   has `tools`; extension references via `agent-registry validate`; each `extensions.<name>`
   section against its `config_schema`; `persona_text` ≤ 2000.
6. **`save`** — **done**: `access authorize` (write, scope) first, then validate, then merge the
   patch into the tier's row and bump its version; return `config_version`. **`reset`** — **done**:
   empties the row or drops one section, with `version + 1` (never a delete: the version must not
   repeat).
7. **`list_models`** — **done**, from the catalog.
8. Extension config isolation: an extension receives only `extensions.<name>` (enforced by its
   caller — loop, executor — documented in plans 10/11).

## 6. Tests

`workflow/tests/` (flat). **Done**: `agent-config.test.yaml` (19: the tiers, session allowlist,
default-profile rule, newer-schema row, user/session/agent allowlists, catalog and capability
rules, save, forbidden, invalid save writes nothing, reset), `agent-config.unit.test.yaml` (4: the
row a save/reset writes). Live on the dev stage: resolve, a user save of `persona_text` reached the
model in a new session, agent-tier save refused, non-catalog model refused, reset → `u2`.

- `access` (**done**: `access.unit.test.yaml` 23 cases, each rule × guest / user / admin / denied,
  incl. `"None"` and `""`; `access.test.yaml` 9 cases: guards, fail-closed input, and a caller
  that passes `uid: root` is still not an admin).
- Merge: field-by-field dict merge; list replacement; each tier overriding the one below.
- Allowlists: user sets a catalog model (ok) / non-catalog model (error) / `guard.*` (error) /
  `limits.cost` (error); session sets temperature (ok) / toolsets (error); agent tier cannot set
  `agent_id`, `harness`.
- Capabilities: `decision: null` + inference without `json_mode` rejected; a tools profile with
  a non-tools inference model rejected.
- `save scope: agent` by non-admin → `ok: false, code: forbidden`.
- Namespace admins (**done**, F48): `agent-config.ns-admin.test.yaml` (11: flag stamped from
  the lookup, off means no lookup, a stored row's computed keys overwritten, a failing lookup is
  not an admin, a flagged caller saves the agent tier through the real `access` and an unflagged
  one does not, the agent tier cannot set `namespace_admins` / the computed keys / `access: null`,
  a user cannot forge the flag); `namespace-admin.unit.test.yaml` (11) and
  `namespace-admin.test.yaml` (2); `access.unit` +8; `agent-registry` +2 (definition keys).
  Verified live 2026-10-09: on the dev stage `namespace-admin` reports namespace `tjin4` and
  `is_admin: true` for its creator, for all three packages.
- `config_version` changes on a row save **and** on a definition version change.
- `reset` of one section leaves the rest.

## 7. Phase split

- **Phase 0**: defaults + `resolve` (defaults ⊕ definition).
- **Phase 1**: `access`, stored tiers, `validate`, `save`, `reset`, `list_models`.
- `extensions.<name>` schema checks become meaningful once extensions declare `config_schema`
  (phase 2).

## 8. Risks & open issues

- **F70 (resolved, 0.14.0)**: `model-readiness` (Foundation) + `agent-admin get_readiness` report per role whether it is set up, statically (secret names, null fields; the worker's environment stays `unknown`). `models.classifier.worker_default` is agent-tier only.
- Phase 0 (done): `config_version` is a joined token, `d<defaults version>+a<definition
  version>`, because the expression sandbox has no hash function. Phase 1 appends the stored
  rows' versions. The definition is loaded as `agent-<agent_id>/agent.<agent_id>` (F40).
  Library profiles come from `agent-harness-defaults.profile_library`, a stand-in until plan-03
  ships `profile.<name>`. The merge is one recursive expression, applied in place and never
  bound to a variable, because a function value in the workflow context would not survive
  serialisation.

- **Cost of `resolve`**: it runs `agent-registry load`, which makes two `sync` `package-catalog`
  calls (~0.2 s each). Fine at session `init`; too much for the per-turn check plan-14 wants. That
  check should read only the two tier rows' `version`s (and rely on upgrade-on-idle for package
  changes) and call `resolve` only when they moved.
- No CAS (P15): concurrent admin saves are last-write-wins. Acceptable for config; the admin UI
  shows `config_version` so a stale edit is visible.
- Cost-limit and retention defaults are placeholders (open questions 14, 15).
- **Namespace admins (F48)**: two deploy-DB reads per `resolve` (session init, each
  `agent-admin` config/knowledge call), never per turn. A live session keeps the flag it
  resolved; harmless while every admin-gated write goes through `agent-admin`. A namespace
  created outside `sys.deploy.namespace set` has no `<ns>:manage_ns`, so nobody qualifies and
  only `admin_user_ids` applies; `sys.deploy.namespace.authorization {operator: init}` repairs it.

## 9. Done when

Phase 1: a session resolves moco-assistant's config for a user with partial overrides; an admin
change is picked up on the next turn through `config_version`; invalid saves are rejected with
paths; every owner's write mode calls `access`.
