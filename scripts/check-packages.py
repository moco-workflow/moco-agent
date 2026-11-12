#!/usr/bin/env python3
"""Check the agent-harness package split (plan-00 §4, F66). Exits non-zero on drift.

The harness is one package per directory under workflow/ (<dir>/moco.json, <dir>/src).
The engine resolves a bare child name only inside packages already loaded in the
run, and otherwise looks it up as a *package* name. So:

  1. every wfspec name is defined in exactly one package;
  2. every package has a main wfspec named after it;
  3. a literal `ref:` is either a bare name in the caller's own package, or
     `pkg/name` with `name` in `pkg` -- never a bare name from another package,
     and never `pkg/name` for the caller's own package (in `moco test` that would
     resolve to the deployed copy instead of the local file);
  4. `agent-harness`'s `packages` list is exactly the set of package manifests;
  5. every `agent-harness*/<name>` string anywhere (dynamic refs built in
     expressions, schedule targets, agent packages, tests, scripts, the UI)
     names a wfspec that exists in that package. A string ending in `.` is a
     prefix (`agent-harness-prompts/profile.`) and must match at least one.

Refs that are expressions (`{{ }}`), agent packages (`agent-<id>/...`) and
platform workflows (`sys.*`) are skipped by rule 3.

Usage: check-packages.py [moco-agent dir]   (default: this script's parent)
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import yaml

VERSION = re.compile(r"^[\d*]+(\.[\d*]+){0,2}$")
HARNESS_STR = re.compile(r"(?<![\w-])(agent-harness(?:-[a-z]+)?)/([A-Za-z0-9_.\-]+(?:/[A-Za-z0-9_.\-]+)?)")
SCAN_GLOBS = [
    "workflow/*/src/**/*.yaml",
    "workflow/*/tests/**/*.yaml",
    "agents/*/src/**/*.yaml",
    "agents/*/tests/**/*.yaml",
    "eval/*/src/**/*.yaml",
    "scripts/*.sh",
    "ui/src/**/*.ts",
    "ui/src/**/*.tsx",
]


def load_packages(root: Path) -> tuple[dict[str, set[str]], dict[str, str], list[str]]:
    """{package: {wfspec}}, {wfspec: package}, errors."""
    packages: dict[str, set[str]] = {}
    owner: dict[str, str] = {}
    errors: list[str] = []
    for manifest in sorted((root / "workflow").glob("*/moco.json")):
        pkg = json.loads(manifest.read_text())["wfspec_package_name"]
        names: set[str] = set()
        for f in sorted((manifest.parent / "src").glob("**/*.yaml")):
            doc = yaml.safe_load(f.read_text()) or {}
            name = (doc.get("header") or {}).get("workflow_name")
            if not name:
                errors.append(f"{f}: no header.workflow_name")
                continue
            if name in owner:
                errors.append(f"{f}: '{name}' is also defined in package {owner[name]}")
            owner[name] = pkg
            names.add(name)
        if pkg not in names:
            errors.append(f"{manifest.parent}: package '{pkg}' has no main wfspec named after it")
        packages[pkg] = names
    return packages, owner, errors


def iter_refs(node, path=""):
    """Yield every literal workflow/entity_workflow ref string in a wfspec."""
    if isinstance(node, dict):
        for key, value in node.items():
            if key in ("workflow", "entity_workflow") and isinstance(value, dict):
                ref = value.get("ref")
                if isinstance(ref, dict):
                    ref = ref.get("name")
                if isinstance(ref, str):
                    yield ref
            yield from iter_refs(value)
    elif isinstance(node, list):
        for item in node:
            yield from iter_refs(item)


def check_refs(root: Path, packages, owner) -> list[str]:
    errors: list[str] = []
    for manifest in sorted((root / "workflow").glob("*/moco.json")):
        pkg = json.loads(manifest.read_text())["wfspec_package_name"]
        for f in sorted((manifest.parent / "src").glob("**/*.yaml")):
            doc = yaml.safe_load(f.read_text()) or {}
            for ref in iter_refs(doc):
                ref = ref.strip().lstrip("/")
                if "{{" in ref or ref.startswith("sys."):
                    continue
                parts = [p for p in ref.split("/") if not VERSION.match(p)]
                rel = f.relative_to(root)
                if len(parts) == 1:
                    name = parts[0]
                    if owner.get(name) != pkg:
                        where = owner.get(name)
                        hint = f"write '{where}/{name}'" if where else "no such harness wfspec"
                        errors.append(f"{rel}: bare ref '{ref}' is not in {pkg} ({hint})")
                    continue
                ref_pkg, name = parts[0], parts[-1]
                if ref_pkg.startswith("agent-") and ref_pkg not in packages:
                    continue  # an agent package
                if ref_pkg == pkg:
                    errors.append(f"{rel}: ref '{ref}' qualifies the caller's own package; write '{name}'")
                elif name not in packages.get(ref_pkg, set()):
                    errors.append(f"{rel}: ref '{ref}': '{name}' is not in package {ref_pkg}")
    return errors


def check_strings(root: Path, packages) -> list[str]:
    errors: list[str] = []
    for pattern in SCAN_GLOBS:
        for f in sorted(root.glob(pattern)):
            for lineno, line in enumerate(f.read_text().splitlines(), 1):
                for m in HARNESS_STR.finditer(line):
                    pkg, rest = m.group(1), m.group(2).split("/")
                    if pkg == "agent-harness-measure":
                        continue
                    name = rest[-1] if VERSION.match(rest[0]) and len(rest) > 1 else rest[0]
                    if VERSION.match(name):
                        continue
                    rel = f"{f.relative_to(root)}:{lineno}"
                    if pkg not in packages:
                        errors.append(f"{rel}: '{m.group(0)}': no package {pkg}")
                    elif name.endswith("."):
                        if not any(n.startswith(name) for n in packages[pkg]):
                            errors.append(f"{rel}: '{m.group(0)}': no {name}* wfspec in {pkg}")
                    elif name not in packages[pkg]:
                        errors.append(f"{rel}: '{m.group(0)}': '{name}' is not in package {pkg}")
    return errors


def check_package_list(root: Path, packages) -> list[str]:
    doc = yaml.safe_load((root / "workflow/harness/src/agent-harness.yaml").read_text())
    listed = set((doc.get("context") or {}).get("packages") or [])
    if listed == set(packages):
        return []
    return [f"agent-harness.yaml packages: missing {sorted(set(packages) - listed)}, "
            f"unknown {sorted(listed - set(packages))}"]


def main() -> int:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
    packages, owner, errors = load_packages(root)
    errors += check_refs(root, packages, owner)
    errors += check_package_list(root, packages)
    errors += check_strings(root, packages)
    for e in errors:
        print(e)
    total = sum(len(v) for v in packages.values())
    print(f"{len(packages)} packages, {total} wfspecs, {len(errors)} problem(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
