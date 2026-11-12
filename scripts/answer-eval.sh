#!/usr/bin/env bash
# ==============================================================================
# Answer evaluation and parity (plan-18 step 3): run eval/answers/answer-set.yaml
# through one or more agents' chat entry points on a stage, score each answer, and
# print a per-agent summary. Each case runs on a fresh throwaway session.
#
#   scripts/answer-eval.sh                       # moco-assistant vs the old agent
#   scripts/answer-eval.sh moco-assistant        # one target
#   targets: moco-assistant | skeleton | ops-assistant | old (moco-agent 5.x)
#
# Env: MOCO_STAGE (default dev); CASE_PAUSE_SEC (default 20): a pause between cases so
# each case's detached jobs (title, compaction) finish first -- back-to-back cases on
# the single local dev worker starved workflow tasks into timeouts (plan-00 F47).
# Writes eval/answers/results-<target>.json.
# ==============================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="${MOCO_STAGE:-dev}"
TARGETS=("$@"); [ ${#TARGETS[@]} -eq 0 ] && TARGETS=(moco-assistant old)
PY="${PYTHON:-$(command -v python3)}"
for t in "${TARGETS[@]}"; do
  "$PY" - "$ROOT" "$STAGE" "$t" <<'PY'
import json, re, subprocess, sys, tempfile, time, os, yaml
PAUSE = float(os.environ.get("CASE_PAUSE_SEC", "20"))
root, stage, target = sys.argv[1:4]
cases = yaml.safe_load(open(f"{root}/eval/answers/answer-set.yaml"))["cases"]
DECLINE = re.compile(r"could(n't| not) find|(do|does) not (state|contain|mention|cover|specify|include|describe)|"
                     r"not (in|covered by|found in|mentioned in|available in) the (provided )?(sources|documentation|docs)|"
                     r"no (information|mention)|i (don't|do not) (know|have)|isn't (in|covered)|unable to find", re.I)
def run(q):
    if target == "old":
        wf, inp = "moco-agent/moco-agent-cli", {"question": q}
    else:
        wf, inp = "agent-harness/agent-cli", {"agent_id": target, "message": q}
    out = tempfile.mktemp(suffix=".json")
    t0 = time.time()
    subprocess.run(["moco", "run", wf, "--tier", stage, "-i", json.dumps(inp), "-o", out],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=200)
    d = json.load(open(out)); d = d.get("result", d)
    os.unlink(out)
    srcs = d.get("sources_urls") or [s.get("url") if isinstance(s, dict) else s for s in (d.get("sources") or [])]
    return {"answer": d.get("answer") or "", "status": d.get("status"), "route": d.get("route"),
            "sources": [s for s in srcs if s], "secs": round(time.time() - t0, 1)}
rows = []
for c in cases:
    r = run(c["q"]); a = r["answer"].lower()
    if c["kind"] == "answer":
        kw = [k for k in c.get("keywords", []) if k.lower() in a]
        r.update(cited=bool(r["sources"]), keyword_coverage=round(len(kw) / max(1, len(c.get("keywords", []))), 2),
                 ok=bool(r["sources"]) and len(kw) * 2 >= len(c.get("keywords", [])))
    elif c["kind"] == "decline":
        r.update(ok=r["status"] == "declined" or bool(DECLINE.search(r["answer"])))
    else:
        r.update(ok=not r["sources"])
    rows.append(dict(id=c["id"], kind=c["kind"], **r))
    time.sleep(PAUSE)
    print(f"  {target:15} {c['id']:15} {c['kind']:8} ok={r['ok']!s:5} route={r['route']} {r['secs']}s src={len(r['sources'])}", flush=True)
def rate(kind, key="ok"):
    xs = [x for x in rows if x["kind"] == kind]
    return round(sum(1 for x in xs if x[key]) / len(xs), 2) if xs else None
ans = [x for x in rows if x["kind"] == "answer"]
summary = {"target": target, "cases": len(rows), "answer_ok": rate("answer"), "cited": rate("answer", "cited"),
           "keyword_coverage": round(sum(x["keyword_coverage"] for x in ans) / len(ans), 2) if ans else None,
           "decline_ok": rate("decline"), "chat_ok": rate("chat"),
           "mean_secs": round(sum(x["secs"] for x in rows) / len(rows), 1)}
json.dump({"summary": summary, "rows": rows}, open(f"{root}/eval/answers/results-{target}.json", "w"), indent=1)
print("SUMMARY", json.dumps(summary))
PY
done
