# Plan 07 — Memory manager (`memory`, `memory-store`, `memory-curator`)

Design: `design.md` §6.4 (all), §6.16 (promote), §7.1, §8. Overview: [plan-00](plan-00-overview.md).

## 1. Scope

Long-term memory: profile, fact, lesson and episode items; support and decay; recall; curation
from a conversation into long-term memory; explicit remember/forget; tombstones; feedback
adjustments; promotion to agent scope (phase 3).

Out of scope, changed in v4:

- **Conversation memory** (recent exchanges, rolling summary) and the **compactor** moved to the
  session runtime (plan-14), because `session-store` owns that row (F22, F34).
- **Session facts** (the session scope) are dropped (S4): the rolling summary and `recent`
  already carry what was said in this conversation.

## 2. wfspecs to create

`workflow/src/memory/`

| wfspec | Modes | Owns |
| --- | --- | --- |
| `memory.yaml` | `recall`, `record`, `remember`, `forget`, `record_episode`, `feedback`, `retire_by_session`, `list`, `edit`, `retire`, `resolve_conflict` | facade |
| `memory-store.yaml` | `get`, `list {scope, kinds, status, limit}`, `save`, `add_evidence`, `touch {keys}`, `retire`, `tombstone`, `list_tombstones`, `agent_scope_snapshot` | `mem:<kind>:<slug>`, `mem-tombstone:<hash>` in `<uid>:agent.<id>` and `agent.<id>`; `mem-version` in `agent.<id>` |
| `memory-curator.yaml` | `curate {session_id, exchanges, grounding, trigger}` | detached; 5-step pipeline |
| `memory-episode.yaml` | — (input `key, title, summary, exchanges, upto_turn`) | phase 3; detached; digest → one `episode` item |
| `memory-promote.yaml` | `run`, `list`, `approve`, `reject` | phase 3; owns `proposal:<slug>` in `agent.<id>`; admin only. `memory-promote-all` runs it daily for every agent with long-term memory (schedule `agent-harness.memory_promote`, plan-17) |

## 3. Dependencies

- Calls: `decide` + `llm-invoke` (plan-02); qsets/prompts (plan-01); `access` (plan-04);
  `builtin.state` (store only). **No calls into the Orchestration layer**: the curator receives
  its exchanges as input, and the session records `last_curated_turn` itself.
- Called by: session `init` (`agent_scope_snapshot`), `assembling` (`recall`), `delivering`
  (`touch`, `record`), `retiring` (`record`, `record_episode`) (plan-14); `session-store delete`
  (`retire_by_session`); `session-store submit_feedback` (`feedback`); `memory` profile
  (plan-11); `memory_recall` / `memory_remember` tools (plan-10); `agent-admin` memory area
  (plan-16); janitor (plan-17).

## 4. Reuse

| From | To |
| --- | --- |
| `agent-config.yaml` curated "remembered notes" overlay | `memory-store` (new item schema: kinds, scope, support, evidence) |
| `seed-knowledge.yaml` curated notes | agent-scope seed (`seed-memory`, plan-17), `pinned: true` |
| per-turn `storing_memory` in the old session | **dropped** → gated, batched curator |

## 5. Implementation steps

All phase 2 unless marked.

1. **Item schema + `memory-store`** (§6.4.3): `schema_version`, kinds `profile | fact | lesson |
   episode | <agent-defined>`, scopes `user | agent`, `pinned`, slug sanitising
   (`^[a-z0-9-]{1,48}$`), clamps (title 120, text 600/1500, tags ≤ 8, evidence ≤ 10, oldest
   dropped), deterministic keys, row lifecycle (`active ⇄ conflicted`, `→ retired`, never
   deleted), per-scope caps evicting the lowest effective weight among unpinned items, slug
   collision → user scope wins on read. Every agent-scope write bumps `mem-version`.
2. **Support & decay** (§6.4.4) as one expression helper: `support = distinct evidence sessions
   + 2·pinned − negative feedback (floor 0)`; `effective_weight = support · 0.5^(age/120d)`;
   lazy-retire rule for the janitor.
3. **`recall`** (§6.4.5): first measure **M3b** (a parallel `get_state` fan-out over 50 and 200
   rows, an `eval/measure` driver beside M3), because `list_states` returns keys only and
   scoring reads every value. Then per kind `list(key_pattern "mem:<kind>:*", limit 50)` on the user
   scope; agent-scope items come from the session's cached `agent_scope_snapshot` (re-fetched
   when `mem-version` changes); score and cut; always-on profile (≤ 10); episodes gated on
   `refers_to_past`. No model call.
4. **`memory-curator`** (§6.4.6): gate (one System One call over the batch) → extract
   (`prompt.memory.extract`, ≤ 5, user scope, drop tombstoned) → match (≤ 10 candidates,
   `qset.memory.match` via `decide_many`, nouls `same_<i>`, `conflict_<i>`) → verdict
   (duplicate → `add_evidence`; conflict → create conflicted; else new) → save (idempotent keys).
5. **`remember`** (sync, skips the gate, `pinned: true`, user scope), **`forget`** (retire +
   tombstone), **`feedback {used_memory, rating, strength}`** (negative feedback lowers support),
   `list` / `edit` / `retire` / `resolve_conflict`.
6. **`retire_by_session`**: retire user-scope items that session is evidence for and no
   session in `live_session_ids` is (session-store passes the remaining ones, F65); without the
   list, items whose *only* evidence is that session.
7. Guards (§6.4.8): only the user scope is writable from a conversation; guests never recorded;
   model output reaching keys is sanitised.
8. **Phase 3**: `record_episode` (`prompt.episode.digest` on retire; the session passes summary
   and turns); `memory-promote` (≥ 3 distinct users by normalised title+tags →
   `qset.memory.match` → `prompt.memory.merge` → `proposal:<slug>`; `approve_proposal` writes a
   pinned agent-scope item with `evidence.source: promoted`); vector recall once an embeddings
   activity exists (P2).

## 6. Tests

`workflow/tests/memory/`

- Item lifecycle: legal and illegal transitions; cap eviction skips pinned items; slug
  sanitising; reading a row without `schema_version`.
- Support/decay at fixed timestamps: many evidence rows from one session count once; pinned +2;
  negative feedback floors at 0.
- Recall: fixtures with known lexical/support/recency → expected order and cutoff; conflicted
  penalty; profile always included; episodes gated; agent scope read from the snapshot (assert no
  agent-namespace `list_states` call).
- Curator: every probability combination at the gate (stop with no chat call); each verdict;
  tombstoned candidate dropped; re-run idempotent. **Exit check**: a repeated lesson dedups with
  no `llm-invoke` call.
- `forget` then curator on the same statement → not relearned.
- Guest → `record` is a no-op.
- `retire_by_session` leaves items with evidence from other live sessions active, and retires
  those whose other evidence sessions were deleted earlier (F65).

## 7. Phase split

- **Phase 1**: nothing. The memory providers in plan-08 return no block, and `profile.memory`
  is gated off.
- **Phase 2**: steps 1–7. **Status (2026-10-12):** done -- memory-store, memory, memory-curator,
  qset.memory.{gate,match,command}, prompt.memory.extract (53 cases), wired into the session
  (snapshot, recall, touch, curation, retire), tool-executor (memory_recall / memory_remember),
  session delete (retire_by_session), profile-memory and admin.memory. **Exit check verified
  live**: a repeated lesson deduped by the curator with 2 System One calls and no chat-model call.
  Curator order changed to gate → pre-match → extract (design §6.4.6). Open: the janitor's caps /
  lazy decay (needs memory-store's owner override); M3b.
- **Phase 3**: step 8. **Status (2026-10-16):** episodes built -- `memory record_episode`
  (gate: role, `long_term.episodes.{enabled, min_turns}`, key `mem:episode:s-<hash of the
  session id>`), the detached `memory-episode` (digest, fallback to title + summary),
  `prompt.episode.digest`, the session's `plan-episode` / `record-episode` in `retiring`
  (`meta.episode_upto_turn` skips a repeat digest), and the router offering
  `refers_to_past` when episodes are on. Recall's episode branch and the `episodes` context
  block already existed. Tests: memory (+7), memory-episode (6), prompt.episode.digest (2),
  agent-session.memory.unit (6). Verified live (0.7.1): episode written on retire, recalled
  by a new session that referred back, retired with its session. A janitor-reaped
  session gets no episode (its conversation state died with the entity).
  **Promotion (2026-10-16, harness 0.8.0):** `memory-store` takes an admin-only
  `owner_user_id` (get, list, retire, enforce_caps; F50), `session-store list_users` reads
  the F51 index (**both removed 2026-11-09, memory 0.13.0**: F50 closed. Promotion reads the
  opt-in global pool, `memory-store list_pool`, which memory-store mirrors when
  `memory.long_term.promotion` is on; caps and decay run as the user in `session-housekeep`), `qset.memory.match` judges a `note` as well as an exchange,
  `prompt.memory.merge`, `memory-promote` (run / list / approve / reject; expiry in run),
  `memory-promote-all`, admin ops `list_proposals`, `approve_proposal`, `reject_proposal`,
  `run_promotion`. Grouping is linear (one sort of kind:term pairs) because it runs in
  workflow code. Tests: memory-promote (14), memory-promote-all (2), memory-store (+4),
  session-store (+1), qset.memory.match (+1), prompt.memory.merge (1).
  **Vector recall (2026-10-16, harness 0.9.0–0.9.1):** `memory-vector` (upsert / delete /
  search over `mem_<agent_id>`, filtered on the caller) on moco-core's new
  `llama_index.index_texts` / `delete_docs`; recall blends it in, the writers keep it current;
  off by default (`memory.long_term.vector`). Tests: memory-vector (5), memory (+2). Verified
  live: upsert, search, delete. `min_score` 0.45 is provisional (dev model: relevant 0.48,
  unrelated 0.39); tune it on the evaluation set before turning vectors on for an agent.

## 8. Risks & open issues

- **Lost updates (P15)**: the curator (detached) and `remember` (in turn) can write the same
  item. Deterministic keys and additive evidence make the race benign: at worst one evidence
  entry is lost.
- **Recall cost**: listing is cheap (M3: 1000 rows in ~40 ms) but each scored row is a
  `get_state`. The per-kind limit is 50 until M3b says a larger fetch fits the `assembling`
  budget (§12: 5 s cap); `order_by: last_update_time` keeps the 50 the most recent.
- Open question 2 (cross-agent profile): keep `profile` in its own list call so it can move
  namespaces later.
- Open question 8 (implicit feedback): `feedback` takes `strength`; the session decides whether
  to call it for implicit signals.

## 9. Done when

Phase 2 exit (§19): the curator dedups a repeated lesson with no chat-model call, users can
remember, list and forget, and recall stays within the M3 budget at cap.
