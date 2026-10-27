#!/usr/bin/env python3
"""Check source-layer ownership and literal TypeScript imports without building."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOTS = (
    "backend/src", "desktop/src", "mobile/src",
    "packages/core/src", "packages/api-client/src",
)
RETIRED = (
    "mobile/src/screens", "desktop/src/features/docs",
    "desktop/src/features/task", "desktop/src/features/assist",
    "backend/src/modules/docs", "backend/src/modules/publish",
    "backend/src/modules/publishing",
)
IMPORT = re.compile(r'''(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])([^"'\n]+)\1''')


def owner(path: str) -> str | None:
    return next((root for root in SOURCE_ROOTS if path.startswith(root + "/")), None)


def resolve(root: Path, file: Path, specifier: str) -> Path | None:
    target = file.parent / specifier
    candidates = [target]
    if target.suffix == ".js":
        candidates += [target.with_suffix(".ts"), target.with_suffix(".tsx")]
    if not target.suffix:
        candidates += [Path(str(target) + suffix) for suffix in (".ts", ".tsx", ".js", ".json")]
        candidates += [target / "index.ts", target / "index.tsx"]
    return next((p.resolve() for p in candidates if p.is_file()), None)


def check(root: Path) -> list[str]:
    root = root.resolve()
    errors = [f"Retired source directory remains: {name}" for name in RETIRED if (root / name).exists()]
    for source_root in SOURCE_ROOTS:
        for file in sorted((root / source_root).rglob("*")):
            if file.suffix not in (".ts", ".tsx"):
                continue
            relative = file.relative_to(root).as_posix()
            # Comments do not declare dependencies. Preserve strings containing URLs.
            source = re.sub(r"/\*.*?\*/", "", file.read_text(), flags=re.S)
            source = re.sub(r"^\s*//.*$", "", source, flags=re.M)
            for match in IMPORT.finditer(source):
                specifier = match[2]
                dependency = None
                if specifier.startswith("."):
                    target = resolve(root, file, specifier)
                    if target is None:
                        errors.append(f"Unresolved literal import: {relative} -> {specifier}")
                        continue
                    try:
                        dependency = owner(target.relative_to(root).as_posix())
                    except ValueError:
                        errors.append(f"Import escapes repository: {relative} -> {specifier}")
                        continue
                elif specifier.startswith("@orbyn/core"):
                    dependency = "packages/core/src"
                elif specifier.startswith("@orbyn/api-client"):
                    dependency = "packages/api-client/src"
                else:
                    continue
                allowed = {source_root, "packages/core/src", "packages/api-client/src"}
                if source_root == "packages/core/src":
                    allowed = {source_root}
                elif source_root == "packages/api-client/src":
                    allowed = {source_root, "packages/core/src"}
                if dependency is not None and dependency not in allowed:
                    errors.append(f"Cross-layer import: {relative} -> {specifier}")
    return errors


if __name__ == "__main__":
    problems = check(ROOT)
    if problems:
        print("\n".join(problems), file=sys.stderr)
        raise SystemExit(1)
    print("OK: source ownership and literal relative imports. Dynamic runtime paths and native behavior are not qualified.")
