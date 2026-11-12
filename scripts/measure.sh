#!/usr/bin/env bash
# ==============================================================================
# Run the phase-0 measurements M1-M6 on a stage (plan-00a step 8). Needs the
# agent-harness-measure package deployed (scripts/dev-stage.sh measure), and for
# M4 the harness + skeleton and a working model key.
#
#   scripts/measure.sh            # M1, M3, M5, M6 via the runner, then M2 and M4
#   scripts/measure.sh m2         # only M2 (wall-clock per variant)
#   scripts/measure.sh m4 [turns] # only M4
#
# Results are printed as JSON; copy them into plan-00a's results tables.
# ==============================================================================
set -euo pipefail

STAGE="${MOCO_STAGE:-dev}"
OUT="${MEASURE_OUT:-/tmp/agent-harness-measure}"
mkdir -p "$OUT"

run() {  # <name> <input-json> <outfile>
  moco run "agent-harness-measure/$1" --tier "$STAGE" -i "$2" -o "$3"
}

m2() {
  # transform/inline cost is invisible to workflow time (it only advances at
  # workflow-task boundaries), so each variant is timed from the outside.
  local n="${M2_ITERATIONS:-100}"
  for v in transform inline sync; do
    local t0 t1
    t0=$(date +%s%N)
    run measure-m2-child-overhead "{\"variants\": [\"$v\"], \"iterations\": $n}" "$OUT/m2-$v.json" >/dev/null
    t1=$(date +%s%N)
    echo "M2 $v: iterations=$n wall_ms=$(( (t1 - t0) / 1000000 ))"
  done
  # The fixed cost of one run (client, MCP, workflow start) is the baseline to
  # subtract: the same run with a single iteration.
  local t0 t1
  t0=$(date +%s%N)
  run measure-m2-child-overhead '{"variants": ["transform"], "iterations": 1}' "$OUT/m2-baseline.json" >/dev/null
  t1=$(date +%s%N)
  echo "M2 baseline (1 iteration): wall_ms=$(( (t1 - t0) / 1000000 ))"
}

m4() {
  run measure-m4-turns "{\"turns\": ${1:-50}}" "$OUT/m4.json"
}

case "${1:-all}" in
  all)
    moco run agent-harness-measure --tier "$STAGE" -i '{"only": ["M1", "M3", "M5", "M6"]}' -o "$OUT/m1-m3-m5-m6.json"
    # The runner ran M6 in `burst` mode (no loss while buffered); `spaced` proves state
    # survives real continue-as-news.
    run measure-m6-driver '{"mode": "spaced"}' "$OUT/m6-spaced.json"
    m2
    m4 50
    ;;
  m2) m2 ;;
  m4) m4 "${2:-50}" ;;
  *) echo "unknown: $1 (all | m2 | m4)" >&2; exit 2 ;;
esac
echo "results in $OUT"
