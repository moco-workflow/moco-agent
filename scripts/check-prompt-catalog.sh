#!/usr/bin/env bash
# ==============================================================================
# prompt-render's `catalog` must list exactly the harness prompt.* / qset.*
# wfspecs in workflow/prompts/src/ (plan-01 §6); prompt-render lives in
# workflow/foundation/src/. A wfspec cannot list files, so this
# drift check is a script. Exits non-zero on drift.
#
#   scripts/check-prompt-catalog.sh
# ==============================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 - "$ROOT/workflow/prompts/src" "$ROOT/workflow/foundation/src/prompt-render.yaml" <<'PY'
import pathlib, sys, yaml
src = pathlib.Path(sys.argv[1])
files = {}
for p in src.glob("*.yaml"):
    for prefix, kind in (("prompt.", "chat"), ("qset.", "system_one")):
        if p.stem.startswith(prefix):
            files[p.stem[len(prefix):]] = kind
doc = yaml.safe_load(pathlib.Path(sys.argv[2]).read_text())
catalog = {e["name"]: e["kind"] for e in doc["context"]["catalog"]}
missing = sorted(set(files) - set(catalog))
extra = sorted(set(catalog) - set(files))
wrong = sorted(n for n in set(files) & set(catalog) if files[n] != catalog[n])
for label, names in (("not in catalog", missing), ("no such wfspec", extra), ("wrong kind", wrong)):
    for n in names:
        print(f"prompt catalog drift: {n}: {label}")
if missing or extra or wrong:
    sys.exit(1)
print(f"prompt catalog OK ({len(catalog)} entries)")
PY
