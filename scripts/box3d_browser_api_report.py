#!/usr/bin/env python3
"""Emit a machine-readable strict browser-wrapper inventory for the Box3D build.

A public B3_API symbol only counts as represented when it has an explicit
JS-facing binding/facade implementation. Raw WASM exports are deliberately not
counted. The report also snapshots the exact patched binding/facade sources and
headers used by CI so wrapper work can be reviewed against the build, not a
stale checkout.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def strip_comments_and_directives(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", " ", src, flags=re.S)
    src = re.sub(r"//[^\n]*", " ", src)
    # Macro definitions contain the token B3_API itself and must never be
    # mistaken for exported functions (this previously invented b3AllocFcn).
    src = re.sub(r"^[ \t]*#.*(?:\\\n.*)*$", " ", src, flags=re.M)
    return src


def collect_api(root: Path) -> dict[str, str]:
    include = root / "vendor" / "box3d" / "include" / "box3d"
    declarations: dict[str, str] = {}
    for header in sorted(include.glob("*.h")):
        src = strip_comments_and_directives(header.read_text(encoding="utf-8", errors="ignore"))
        for match in re.finditer(r"\bB3_API\s+(.*?;)", src, flags=re.S):
            decl = " ".join(match.group(1).split())
            name_match = re.search(r"\b(b3[A-Za-z0-9_]+)\s*\(", decl)
            if not name_match:
                continue
            name = name_match.group(1)
            declarations[name] = decl[:-1].strip() if decl.endswith(";") else decl
    return declarations


def collect_explicit_wrappers(root: Path) -> set[str]:
    bindings = (root / "src" / "bindings.cpp").read_text(encoding="utf-8", errors="ignore")
    facade_path = root / "src" / "facade.js"
    facade = facade_path.read_text(encoding="utf-8", errors="ignore") if facade_path.exists() else ""

    names: set[str] = set()
    # Every real embind registration in this project embeds the canonical b3
    # name in a signature string, including out_function/ret_function metadata.
    names.update(re.findall(r'["\'](b3[A-Za-z0-9_]+)\s*\(', bindings))
    names.update(re.findall(r"\bfunction\s+(b3[A-Za-z0-9_]+)\s*\(", facade))
    names.update(re.findall(r"\bModule\.(b3[A-Za-z0-9_]+)\s*=", facade))
    return names


def signature_parts(name: str, decl: str) -> tuple[str, str]:
    m = re.match(rf"(.*?)\b{re.escape(name)}\s*\((.*)\)\s*$", decl, flags=re.S)
    if not m:
        return "", ""
    return m.group(1).strip(), m.group(2).strip()


def classify_params(params: str) -> list[str]:
    if not params or params == "void":
        return []
    tags: set[str] = set()
    if "(*" in params or re.search(r"\bb3[A-Za-z0-9_]*(?:Callback|Fcn)\b", params):
        tags.add("callback")
    compact = params.replace(" ", "")
    if "char*" in compact or "const char" in params:
        tags.add("string")
    if "void*" in compact:
        tags.add("userdata")
    if "*" in params:
        tags.add("pointer")
    if re.search(r"\b(?:int|uint\w*|size_t)\s+\w*(?:Count|Capacity|count|capacity)\b", params):
        tags.add("counted-array")
    return sorted(tags)


def source_snapshot(root: Path) -> dict[str, object]:
    include = root / "vendor" / "box3d" / "include" / "box3d"
    return {
        "bindings_cpp": (root / "src" / "bindings.cpp").read_text(encoding="utf-8", errors="ignore"),
        "facade_js": (root / "src" / "facade.js").read_text(encoding="utf-8", errors="ignore"),
        "headers": {
            p.name: p.read_text(encoding="utf-8", errors="ignore")
            for p in sorted(include.glob("*.h"))
        },
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("root", type=Path)
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()

    declarations = collect_api(args.root)
    wrapped = collect_explicit_wrappers(args.root)
    official = set(declarations)
    strict = sorted(official & wrapped)
    raw_only = sorted(official - wrapped)
    extras = sorted(wrapped - official)

    rows = []
    for name in sorted(official):
        decl = declarations[name]
        ret, params = signature_parts(name, decl)
        rows.append({
            "name": name,
            "declaration": decl,
            "return": ret,
            "params": params,
            "traits": classify_params(params),
            "status": "wrapped" if name in wrapped else "raw-only",
        })

    report = {
        "official_count": len(official),
        "wrapped_count": len(strict),
        "raw_only_count": len(raw_only),
        "strict_complete": len(raw_only) == 0,
        "wrapped": strict,
        "raw_only": raw_only,
        "browser_only_extras": extras,
        "functions": rows,
        "source_snapshot": source_snapshot(args.root),
    }
    text = json.dumps(report, indent=2, sort_keys=False) + "\n"
    if args.out:
        args.out.write_text(text, encoding="utf-8")
    print(f"STRICT_BROWSER_WRAPPERS={len(strict)}/{len(official)} RAW_ONLY={len(raw_only)}")
    if raw_only:
        print("RAW_ONLY_NAMES=" + " ".join(raw_only))
    if args.out:
        print("REPORT=" + str(args.out))


if __name__ == "__main__":
    main()
