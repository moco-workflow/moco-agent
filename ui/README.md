# Harness UI

The web UI for the agent harness: chat with, and administer, any agent deployed alongside
`agent-harness`. A port of `moco-apps/moco-agent-ui` (which still targets the old
`moco-agent` package and is left as it is) onto the harness contract (plan-16 step 9).

```bash
npm install
npm run dev        # http://localhost:3004, /api proxied to localhost:8080
npm run build
```

Deployed at `/apps/moco-agent` behind moco-nginx: it is in the root Makefile's
`NODE_PROJECTS` (`make moco-agent/ui`), and both `docker/Dockerfile.moco-web*` copy its
`dist/` to `/srv/moco/apps/moco-agent`. The production base path comes from
`.env.production` (`VITE_APP_BASE`). It replaced `moco-apps/moco-agent-ui` there.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_HARNESS_PACKAGE` | `agent-harness` | Package the entry points run from (`<pkg>/agent-cli`, `<pkg>/agent-admin`) |
| `VITE_DEFAULT_AGENT_ID` | `moco-assistant` | Agent selected on a first visit; the header picker switches |
| `VITE_API_BASE_URL`, `VITE_APP_BASE`, `VITE_AUTH_*`, `VITE_GUEST_APIKEY`, `VITE_EXECUTE_MODE`, `VITE_ENABLE_OTEL_TRACE` | | As in `moco-agent-ui` (auth and transport are unchanged) |

## How it talks to the harness

Everything goes through `src/lib/agent-api.ts`, over `/api/workflow/execute`:

- **Chat**: `agent-harness/agent-cli` with `{agent_id, session_id, message, message_id}`. The UI
  mints both ids; the session is created by its first message.
- **Everything else**: `agent-harness/agent-admin` with `{op, agent_id, ...}`. Every op answers
  `{ok, data, error}`; `ok: false` is thrown as a `HarnessCallError` carrying `code`
  (`forbidden`, `invalid_input`, `not_found`, `not_available`, ...) and a message meant for
  the user. A server bug raises instead and arrives as HTTP 500.

`src/lib/agent-context.tsx` holds the selected agent, its `get_config` result and the caller's
`role` (admin / user / guest). Guests share one identity, so the UI makes them read-only; the
harness enforces the same rules regardless.

| Page | Ops |
| --- | --- |
| Chat | `agent-cli`; `list_sessions`, `get_session`, `rename_session`, `delete_session` |
| Knowledge | `list_sources`, `get_source`, `register_source`, `reindex_source`, `refresh_source`, `set_source_refresh`, `delete_source`, `check_sitemap`, `list_models` |
| Chat (2) | approval buttons send `agent-cli` an `action` (approve / approve_session / reject); 👍/👎 → `submit_feedback` |
| Memory | `list_memory`, `edit_memory`, `forget_memory`, `resolve_memory` (the caller's own); Proposals tab (admin): `list_proposals`, `approve_proposal`, `reject_proposal`, `run_promotion` |
| Tools | `list_tools`, `list_tool_prefs`, `set_tool_pref`, `clear_tool_pref`; Agent toolsets (admin): `save_config`, `reset_config` (section `toolsets`, scope `agent`); Providers tab (admin): `list_providers`, `preview_provider`, `register_provider`, `sync_provider`, `accept_provider_drift`, `reject_provider_drift`, `disable_provider`, `enable_provider`, `delete_provider` |
| Activity | `list_jobs`, `cancel_job`, `answer_job` (the caller's jobs); `usage_report` |
| Settings | `get_config`, `save_config`, `reset_config`, `list_models` |
| Header | `list_agents` |

**Turn progress** (`src/lib/progress-stream.ts`): per turn the UI mints a trace id, opens
`GET /api/workflow/events/{trace_id}` (fetch, so it can send the bearer token), waits up to 2 s
for its `ready` frame, then posts the turn with that `trace_id` and `debug_mode: true`.
agent-cli logs each `progress` the session relays (routed, running, searching, thinking,
calling), and the typing indicator shows the latest. Needs RabbitMQ on the server and workers;
without it the stream is silent and chat works as before.

**Knowledge refresh**: a ready source gets a Refresh button (re-index in the background while it
keeps answering, then swap) beside Re-index (offline while it runs), a `refreshing` badge, the
last refresh error, and an Auto refresh interval for shared sources (the hourly
knowledge-refresh job; private sources are refreshed by hand).

**Dev note:** Vite's file watcher does not see edits on `/mnt/c` under WSL; restart
`npm run dev` after changing files there.

Settings edits only what agent-config lets a user set (`user_settable`). Each model role
(inference, decision, classifier, embedding) uses one editor at both tiers
(`components/settings/model-role-editor.tsx`): a catalog provider or Custom, every field
editable, Save / reset per role. Admins of the agent also get the agent tier's model roles
and a JSON patch for the other sections.

## Not yet

- Answer feedback (thumbs): `submit_feedback` is phase 2.
- Moving a source between shared and private: `move_source` answers `not_available`.
- Revise with feedback from the chat's approval buttons (type it instead); the Activity page
  has Revise for a job's plan review.
- Editing tool manifests, toolsets and grants (tool-registry ops exist; no screens).
