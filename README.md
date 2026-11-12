# moco-agent

An agent harness built entirely from moco wfspecs. It provides what every conversational agent
needs: config, models, prompts, memory, knowledge, context, routing, the agent loop, tools,
human-in-the-loop approval, background jobs and guardrails. An **agent** is a declarative
definition (`agent.<agent_id>`) plus a few extensions on top of the harness.

Reference agents:

| Agent | Package | What it shows |
| --- | --- | --- |
| `moco-assistant` | `agents/moco-assistant` | The full harness: chat, RAG over the moco docs, tools, memory, claude, builder jobs, hooks |
| `ops-assistant` | `agents/ops-assistant` | A minimal second agent with no logic wfspecs: chat + react over read-only Kubernetes tools |
| `skeleton` | `agents/skeleton` | The phase-0 walking skeleton |

## Layout

```
moco-agent/
├── workflow/<module>/   # the harness: one agent-harness* package per module
├── agents/<id>/         # agent packages (agent-<id>), deployed beside the harness
├── ui/                  # harness UI (React/Vite): chat and admin for any agent
├── eval/                # answer set, demo workflow tools, phase-0 measurements
├── scripts/             # dev-stage.sh, check-packages.py, answer-eval.sh, ...
└── docs/                # design.md (source of truth), plan-00 (status, findings), plans 01-18
```

## Local development runtime: moco-dev-server

The harness runs on a moco platform, and extensions resolve by name only against **deployed**
packages. A local `moco run <file>` is therefore not enough. Develop against a dev stage:
publish the harness and agent packages, then run the entry points by name.

The local runtime for this is **[moco-dev-server](../moco-dev-server/README.md)**: a complete
moco platform (UI, API server, worker, Postgres with pgvector, Temporal, RabbitMQ, Langfuse)
from one compose file.

```bash
cd ../moco-dev-server
docker compose up -d                       # the platform on http://localhost:8080
```

The harness needs two model backends, set in `moco-dev-server/.env` (see its README):

- **A chat model** for `openai.*` and `llama_index.*`: any OpenAI-compatible endpoint
  (`MOCO_LLM_DEFAULT_*`). Hosted, or Ollama via `docker compose --profile ollama`.
- **TypeSafe System One** for every classifier decision (routing, screening, memory). Use the
  self-hosted [moco-systemone](../moco-systemone) on your machine:
  `TYPESAFE_DEFAULT_BASE_URL=http://host.docker.internal:8002`. Don't point it at the hosted
  TypeSafe model. When every decision degrades, check that moco-systemone is up first.

moco-dev-server runs only the base worker. The `claude` and `builder` profiles need the agent
worker (`claude_agent.*`, [moco-agent-worker](../moco-agent-worker)), so on moco-dev-server
they stay unavailable. Everything else runs.

### Sign in as a real user

The seeded guest API key (the CLI's `local` profile and the UIs' default) signs in as
`guest`, and the harness makes guests read-only. To publish, chat and administer, sign in as
yourself:

```bash
moco profile create dev --endpoint http://localhost:8080/mcp --auth oauth --use
moco login
moco secret upload MY_LLM_TOKEN <key>      # the secret NAME the agent definitions use
```

### First run: what the agent needs

Open the UI's chat. Until the agent's models are set up, the welcome screen shows a setup
checklist (also at the top of Settings), from `agent-admin get_readiness`:

- **Answer model** (`models.inference`): needs a model, an endpoint and an API key secret.
  The reference agents use the worker's default model (`MOCO_LLM_DEFAULT_*`) with the key
  `MY_LLM_TOKEN`. A name without `global/` is each user's own secret; "Set key" stores it in
  place. An admin can point the agent at one shared `global/<NAME>` instead.
- **Classifier** (`models.classifier`): off until an endpoint is stated. Set its `base_url`
  to your moco-systemone, or tick "Use the worker's TYPESAFE_DEFAULT_BASE_URL" in
  Settings → Agent defaults. Without it, routing and checks use simpler fallbacks, and the
  hosted TypeSafe API is never called.
- **Embedding model** (`models.embedding`): checked only for agents that search knowledge.

The check is static: it sees secret names and config, not the worker's environment, so a
role on the worker's default shows as "not verified". If a question then fails because a
model isn't set up, the agent answers with what to fix and offers "Ask again".

## Deploy and chat

```bash
scripts/dev-stage.sh                       # publish + deploy the harness and every agent
scripts/dev-stage.sh harness               # only the harness packages
scripts/dev-stage.sh moco-assistant        # one agent package
scripts/dev-stage.sh seed moco-assistant   # install an agent's tool manifests and seed memory
MOCO_AGENT=moco-assistant scripts/dev-stage.sh chat "how do retries work?"
```

`dev-stage.sh` deploys to stage `dev` (`MOCO_STAGE`) and targets the user `MOCO_USER_ID`
(default `$USER`). On moco-dev-server, set that variable to your signed-in id (your email).

A package version can be published only once: bump `wfspec_package_version` in the changed
package's `moco.json` first. After adding a wfspec or a cross-package ref, run
`scripts/check-packages.py`.

## Test

```bash
cd workflow/<module> && moco test          # one package's suites, on Temporal
moco test tests/<wfspec>.test.yaml         # one suite
```

A test sees only its own package. Children in other packages resolve to the copy **deployed**
on the stage, so publish changed packages before testing a caller against them.

## UI

```bash
cd ui && npm install && npm run dev        # http://localhost:3004, /api proxied to :8080
```

moco-dev-server also serves the built UI at http://localhost:8080/apps/moco-agent. See
[ui/README.md](ui/README.md).

## Further reading

- [CLAUDE.md](CLAUDE.md): status, invariants, and wfspec and testing rules
- [docs/design.md](docs/design.md): the design, source of truth for behaviour and contracts
- [docs/plan-00-overview.md](docs/plan-00-overview.md): build order, status, and findings F1-F69
- [docs/agent-tools.md](docs/agent-tools.md), [docs/agent-permission.md](docs/agent-permission.md): reader's guides
