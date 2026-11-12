#!/usr/bin/env bash
# ==============================================================================
# Publish the agent-harness packages to a stage and target them to one user
# (design §5.6, plan-00a step 1). Extensions are referenced by name and only
# resolve against DEPLOYED packages (P7), so the walking skeleton runs by name:
#
#   scripts/dev-stage.sh                 # publish + deploy every package
#   scripts/dev-stage.sh harness         # the 11 harness packages (workflow/*/)
#   scripts/dev-stage.sh harness tools memory   # only these harness packages
#   scripts/dev-stage.sh skeleton        # one agent package: skeleton | measure |
#                                        #   moco-assistant | ops-assistant
#   scripts/dev-stage.sh demo-tools      # demo workflow tools (header.metadata.tool)
#   scripts/dev-stage.sh chat "hello"    # one turn on a throwaway session
#   scripts/dev-stage.sh chat "hello" my-session-1
#   scripts/dev-stage.sh seed ops-assistant   # install an agent's tool manifests
#   MOCO_AGENT=ops-assistant scripts/dev-stage.sh chat "list pods"
#
# Env: MOCO_STAGE (default dev), MOCO_USER_ID (default: $USER).
#
# A package version can be published once: bump wfspec_package_version in the
# package's moco.json before publishing again (DSL v2 wfspecs carry no version of
# their own). Re-publishing an unchanged version is a no-op, so `harness` is safe to
# re-run. The harness packages version independently; a live session picks up a
# redeploy when it stops, 10 minutes after going idle (design §4.3).
# ==============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="${MOCO_STAGE:-dev}"
USER_ID="${MOCO_USER_ID:-${USER}}"

# The harness packages (plan-00 §4). Runtime resolution is lazy; `harness` (the
# harness version) goes last so a version check sees the rest deployed.
HARNESS_DIRS=(admin foundation prompts session loop tools knowledge memory jobs ops harness)

declare -A DIRS=(
  [skeleton]="$ROOT/agents/skeleton"
  [measure]="$ROOT/eval/measure"
  [moco-assistant]="$ROOT/agents/moco-assistant"
  [ops-assistant]="$ROOT/agents/ops-assistant"
  [demo-tools]="$ROOT/eval/demo-tools"
)

pkg_id() {  # <dir> -> name:version from moco.json
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1]+"/moco.json")); print(d["wfspec_package_name"]+":"+d["wfspec_package_version"])' "$1"
}

publish_and_deploy() {
  local dir="$1" id
  id="$(pkg_id "$dir")"
  echo "==> publish $id"
  local out
  # Publishing a version that is already deployed fails in its auto-deploy with a
  # duplicate: the package is there, nothing to do.
  if ! out="$(moco publish "$dir" 2>&1)"; then
    if grep -q "Duplicate deployment" <<<"$out"; then
      echo "    already published"
    else
      echo "$out" >&2
      return 1
    fi
  fi
  echo "==> deploy $id to stage '$STAGE' for user '$USER_ID'"
  # On a dev server, publishing may already deploy the package for its owner;
  # the release then reports a duplicate, which means there is nothing to do.
  if ! out="$(moco run sys.deploy.package.release --tier "$STAGE" -i "$(python3 -c '
import json,sys; print(json.dumps({"operator":"deploy","package_id":sys.argv[1],"stage_id":sys.argv[2],"target_user_ids":[sys.argv[3]]}))' "$id" "$STAGE" "$USER_ID")" 2>&1)"; then
    if grep -q "Duplicate deployment" <<<"$out"; then
      echo "    already deployed"
    else
      echo "$out" >&2
      return 1
    fi
  fi
}

publish_harness() {  # [dir...] -> those harness packages, in HARNESS_DIRS order
  local want=" ${*:-${HARNESS_DIRS[*]}} " d
  for d in "${HARNESS_DIRS[@]}"; do
    [[ "$want" == *" $d "* ]] && publish_and_deploy "$ROOT/workflow/$d"
  done
  return 0
}

seed() {  # agent-<id>/tools.<id> and agent-<id>/memory.<id> (harness seed-tools, seed-memory)
  echo "==> seed tools for $1"
  moco run agent-harness-tools/seed-tools --tier "$STAGE" -i "{\"agent_id\": \"$1\"}"
  echo "==> seed memory for $1"
  moco run agent-harness-memory/seed-memory --tier "$STAGE" -i "{\"agent_id\": \"$1\"}"
}

case "${1:-all}" in
  all)
    # The harness first: the agent package references it, not the reverse.
    publish_harness
    for k in skeleton measure moco-assistant ops-assistant; do publish_and_deploy "${DIRS[$k]}"; done
    moco run agent-harness --tier "$STAGE"
    seed ops-assistant
    ;;
  harness)
    shift
    publish_harness "$@"
    ;;
  skeleton|measure|moco-assistant|demo-tools)
    publish_and_deploy "${DIRS[$1]}"
    ;;
  ops-assistant)
    publish_and_deploy "${DIRS[$1]}"
    seed ops-assistant
    ;;
  seed)
    seed "${2:?usage: dev-stage.sh seed <agent_id>}"
    ;;
  chat)
    msg="${2:?usage: dev-stage.sh chat <message> [session_id]}"
    input="$(python3 -c '
import json,sys; d={"message":sys.argv[1]}
if len(sys.argv) > 2 and sys.argv[2]: d["session_id"]=sys.argv[2]
if len(sys.argv) > 3 and sys.argv[3]: d["agent_id"]=sys.argv[3]
print(json.dumps(d))' "$msg" "${3:-}" "${MOCO_AGENT:-}")"
    moco run agent-harness/agent-cli --tier "$STAGE" --debug -i "$input"
    ;;
  *)
    echo "unknown command: $1 (all | harness | skeleton | measure | moco-assistant | ops-assistant | seed | chat)" >&2
    exit 2
    ;;
esac
