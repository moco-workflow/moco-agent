# Plan 06 — Knowledge manager (`knowledge`, `source-registry`, `source.<kind>`, `knowledge-indexer`)

Design: `design.md` §6.5, §8, §6.16 (indexer, refresh), §3 P2. Overview: [plan-00](plan-00-overview.md).

## 1. Scope

Retrieve authoritative, citable passages from the sources an agent may search; manage the source
registry and its row lifecycle; index pgvector sources off the chat path. Never written to by
conversations.

Out of scope: memory (plan-07), scheduled refresh orchestration (plan-17 calls into this module).

## 2. wfspecs to create

`workflow/src/` (flat, F41). **Built** (2026-10-06): `source-registry` (get, list, register,
transition), `source.pgvector`, `knowledge` (catalog, retrieve, register, reindex, delete),
`knowledge-indexer`, `knowledge-index-run` (converted from the old agent). Left: `move` and
`sitemap-probe` (with agent-admin, plan-16), kind: wfspec sources (phase 2).

| wfspec | Modes | Owns |
| --- | --- | --- |
| `knowledge.yaml` | `catalog`, `retrieve {sources, query, top_k_per_source, max_chunks, budget_sec}`, `register`, `reindex`, `refresh`, `set_refresh`, `delete`, `move` | facade |
| `source-registry.yaml` | `get`, `list {scope: shared\|private\|both, status?}`, `register`, `transition {name, scope, to, patch?}` (to `removed` deletes the row), `patch {name, scope, patch, if_refreshing?}` (no transition, phase 3) | `source:<name>` in `agent-harness` / `<uid>:agent-harness`, topic `source`. Writes call `access` (shared → admin). |
| `source.pgvector.yaml` | retriever contract | built-in retriever over `llama_index.query` |
| `knowledge-indexer.yaml` | `index {source}`, `refresh: true` | detached; drives `indexing → ready/failed`, or builds and swaps the shadow table of a `ready` source |
| `knowledge-index-run.yaml` | — | indexes a heterogeneous source list into one table |
| `sitemap-probe.yaml` | — | used by `agent-admin check_sitemap` |
| `source.example.yaml` (tests only) | retriever contract | conformance fixture for `kind: wfspec` |

## 3. Dependencies

- Calls: `llama_index.index_*`, `llama_index.query`; `builtin.state` (registry only);
  `access` (plan-04) for shared-scope writes; `guard screen_content` is applied by the *loop*,
  not here.
- Called by: session `preparing` (`catalog`), router (catalog as input), loop `retrieving`,
  `knowledge_search` built-in tool (plan-10), `agent-admin` knowledge area, `knowledge-refresh`
  (phase 3, a schedule installed by `agent-schedules`, plan-17).

## 4. Reuse

| From | To |
| --- | --- |
| `knowledge-indexer.yaml` | `knowledge-indexer` (records progress and failure on the row — keep) |
| `knowledge-index-run.yaml` | as is, light edits |
| `sitemap-probe.yaml` | as is |
| `rag-domain-query.yaml` | `source.pgvector` (stamps source name on each node) |
| `rag-qa-agent.yaml` parallel fan-out + round-robin interleave | `knowledge retrieve` |
| "domain" registry rows in `agent-config.yaml` | `source-registry` rows (new shape) |

## 5. Implementation steps

1. **Row shape + `source-registry`** — **done** (§6.5.2): `schema_version, name, kind, description, keywords, scope,
   status`, kind-specific fields. `transition` enforces the lifecycle
   (`register → indexing → ready|failed`, `failed → indexing`, `ready → indexing` on
   refresh/reindex, `ready|failed → deleting → removed`, `ready → indexing` on move). Illegal →
   `invalid_state`.
2. **Table naming** — **done**: shared `kb_<slug>`, private `kb_u_<h>_<slug>` with `<h>` an 8-hex
   31-polynomial checksum of the user id (the sandbox has no hash function); it keeps the user id
   out of the name and fixes the old cross-user collision. Existing old tables: document a one-off migration (phase 3, §19).
3. **`source.pgvector`** — **done** — retriever contract `{query, top_k, config, budget_sec}` →
   `{passages, error?}`.
4. **`knowledge catalog`** — **done** (a shared source shadows a private one of the same name): definition's `knowledge.sources` that are `ready`, plus the user's
   private `ready` sources when `allow_user_sources`.
5. **`knowledge retrieve`** — **done** (each source a `sync` child; `failed` and `dropped` reported): validate requested sources ⊆ catalog; a parallel `loop` per source with
   per-source timeout = `min(10 s, budget_sec)` (M5), `on_error: {catch: true}`; round-robin interleave; number passages
   `n`; clamp to `max_chunks`; `empty` flag; `searched` list for decline messages.
6. **Management modes** — **done** except `move`: `register` (row `indexing` with
   `refresh.sources`, then the detached `knowledge-indexer`), `reindex` (→ `indexing`, the indexer
   with the stored sources), `delete` (→ `deleting`, drop `data_<table_name>` via `llama_index.drop_table`
   (it shares the `MOCO_PGVECTOR_CONN` fallback) after a naming-pattern check, → `removed`; a failed drop stays `deleting` and is
   retried by the next delete). `knowledge-indexer` reads the row, runs `knowledge-index-run` as a
   `sync` child with `on_error`, and records `ready | failed` through `source-registry` (0 chunks
   is `failed`). `move` lands with agent-admin.
7. **`kind: wfspec` sources** (phase 2): dispatch to `source.<name>` by name (dev stage
   locally); probe call on register → straight to `ready` on success.
8. **Refresh** (phase 3, design §6.5.2; F58): `knowledge refresh` keeps the row `ready` and
   records `refreshing: {table_name, started_at}` through `source-registry patch`; the
   detached indexer (`refresh: true`) builds the other table of the pair (`kb_<x>` ⇄
   `kbr_<x>`), swaps `table_name` with a guarded patch (`if_refreshing`) and drops the old
   table, or drops the new one and records `refresh_error` / `refresh_failed_at`. A
   transition to `indexing`/`deleting` clears `refreshing`, so a refresh overtaken by a
   reindex or delete is refused at the swap and discards its table. `set_refresh` sets
   `refresh.every_hours`; `register` takes it too. agent-admin `refresh_source`,
   `set_source_refresh`.

## 6. Tests

`workflow/tests/` (flat). **Done**: `source-registry.test.yaml` (15: every legal and illegal
transition, table names, forbidden, list), `knowledge.test.yaml` (16: catalog filtering and
shadowing, round-robin interleave, a failing source, dropped sources, register/reindex/delete
incl. a failed drop and an unsafe table name), `knowledge-indexer.test.yaml` (5). A full
private-source lifecycle ran live: register → detached indexing → `ready` (3 chunks, ~30 s) →
retrieve → delete, and the table was gone from the database afterwards. Live on the dev stage:
`moco-docs` registered over the existing `kb_moco_docs` table (name matched), moved to `ready`,
listed by `catalog`, and `retrieve` returned 4 numbered passages from it.

- Registry: every legal transition; illegal transitions → `invalid_state`; private vs shared
  namespaces.
- `retrieve`: two sources interleaved round-robin; one source times out → other results kept;
  unknown source dropped; zero results → `empty: true`.
- `catalog`: non-ready sources hidden; user private sources only with `allow_user_sources`.
- Port the old `knowledge-indexer`, `knowledge-index-run`, `sitemap-probe` tests.
- Conformance kit for the retriever contract (plan-03).

## 7. Phase split

- **Phase 1**: registry, pgvector sources, indexer, catalog, retrieve, admin modes.
- **Phase 2**: `kind: wfspec` retrievers. **Status (2026-10-12):** done -- registry rows name a
  `source.*` retriever and its config; register probes it and goes straight to ready/failed;
  retrieve dispatches by kind; agent-admin register_source passes kind/wfspec_name/source_config.
- **Phase 3**: scheduled refresh (plan-17), private-table naming migration for old data.
  **Status (2026-10-16):** refresh built (step 8): `source-registry patch`, `knowledge
  refresh / set_refresh`, the indexer's shadow-table path, the admin ops, and the hourly
  `knowledge-refresh` job (plan-17). Tests: source-registry (+9), knowledge (+11),
  knowledge-indexer (+5). Verified live (0.7.1): swap, failed refresh, scheduled refresh.
  Left: the private-table naming migration; a UI control for `every_hours`.
  **Migration (2026-10-16):** `knowledge-migrate-legacy` re-registers the old agent's
  `domain:<name>` rows (`moco-agent` / `<uid>:moco-agent`) through `knowledge register`, so each
  is re-indexed into the harness table name (private `kb_u_<h>_<slug>`); dry run by default, old
  rows and tables untouched and listed. The dev stage has no legacy rows left (checked), so it
  ran only in tests (3 cases). Left: a UI control for `every_hours`.

## 8. Risks & open issues

- §20 Q9: private table naming makes `move` a re-index — accepted in this plan.
- Retrieval is a small part of rag's 20–40s (M5: ~0.3 s warm per source, ~2 s for the first
  call), which is dominated by the model call, so the per-source timeout is 10 s. The loop
  passes a reduced budget so the answer call has room.
- Scores across sources aren't comparable — round-robin is intentional; don't sort globally.
- **Refresh swap vs in-flight queries**: a retrieve that read the row just before the swap
  queries the old table after it is dropped and fails for that call (the loop reports the
  source as failed); the next turn reads the new table. A failed drop leaves an orphan table
  that the next refresh into that name overwrites.
- **`list` costs a read per row**: `list_states` returns keys only and there is no batch read,
  so `catalog` (and every `retrieve`) reads each source row. Fine for a handful of sources; the
  session should cache the catalog per turn (plan-14) rather than call it per step.
- **Detached children carry the caller's identity** (verified live): the detached indexer's
  `source-registry transition` passed `access` as the user who registered the source. So the
  indexer needs no special write path.
- The dev skeleton agent names its developer as admin and allows `moco-docs`, so shared sources
  can be registered on the dev stage (agents/skeleton, never published beyond dev).

## 9. Done when

The rag profile retrieves from `moco-docs` with citations at parity with the old agent, and
admins can register/reindex/delete sources through `agent-admin`.
