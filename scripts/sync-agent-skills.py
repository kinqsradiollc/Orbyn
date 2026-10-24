#!/usr/bin/env python3
"""Maintain Orbyn's skill index and per-host links; default is a read-only check."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
mode = parser.add_mutually_exclusive_group()
mode.add_argument('--write', action='store_true', help='update index and add missing canonical skill links')
mode.add_argument('--check', action='store_true', help='report differences without writing (default)')
args = parser.parse_args()
catalog = json.loads((ROOT / 'skills/catalog.json').read_text())
errors = []
entries = catalog['skills']
names = [entry['name'] for entry in entries]
if len(names) != len(set(names)):
    errors.append('Duplicate catalog skill names')
actual = {path.parent.name for path in (ROOT / 'skills').glob('*/SKILL.md')}
if set(names) != actual:
    errors.append(f'Catalog/discovery mismatch: {sorted(set(names) ^ actual)}')
for entry in entries:
    for dependency in entry.get('related', []):
        if dependency not in actual:
            errors.append(f"Unknown related skill: {entry['name']} -> {dependency}")
    if entry['category'] not in catalog['categories']:
        errors.append(f"Unknown category: {entry['category']}")
# Preflight every path before writing. Never replace noncanonical links or files.
for host in ['.agents', '.claude']:
    base = ROOT / host / 'skills'
    if base.exists():
        for link in base.iterdir():
            if link.name not in actual:
                errors.append(f'Stale/unmanaged discovery entry: {link.relative_to(ROOT)}')
    for name in sorted(actual):
        link = base / name
        if link.exists() or link.is_symlink():
            if not link.is_symlink() or link.resolve() != (ROOT / 'skills' / name).resolve():
                errors.append(f'Refusing to replace discovery path: {link.relative_to(ROOT)}')
        elif not args.write:
            errors.append(f'Missing discovery link: {link.relative_to(ROOT)}')
if errors:
    print('\n'.join(errors), file=sys.stderr)
    sys.exit(1)
text = '''# Orbyn skills

Start with [orbyn-workflow](orbyn-workflow/SKILL.md) and the
[skill system](../docs/agents/skill-system.md). Use
[orbyn-skill-creator](orbyn-skill-creator/SKILL.md) to maintain this catalog,
[orbyn-plan](orbyn-plan/SKILL.md) for planning and
[orbyn-setup](orbyn-setup/SKILL.md) for host configuration.

Canonical folders are linked into Codex and Claude Code. Load only the relevant
skill body and references. Roles, stack boundaries and model/session policy live
in `docs/agents/`. This index is generated from `catalog.json` and frontmatter by
`python3 scripts/sync-agent-skills.py --write`.

'''
for category in catalog['categories']:
    text += f'## {category}\n\n'
    for entry in entries:
        if entry['category'] != category:
            continue
        name = entry['name']
        content = (ROOT / 'skills' / name / 'SKILL.md').read_text()
        description = content.split('description: ', 1)[1].split('\n', 1)[0]
        if description.startswith('"'):
            description = json.loads(description)
        text += f'- [{name}]({name}/SKILL.md) — {description}\n'
    text += '\n'
text += '''## Scope and attribution

These are Orbyn Engineering workflows, usable with a consuming project's own
stack and policies. REA maintenance skills apply only to that optional tooling. See [tooling](../docs/agents/tooling.md) and
[notices](../tools/THIRD_PARTY_NOTICES.md) for complete source and attribution.
Old standalone skill files have been retired; use the canonical folders above.
'''
index = ROOT / 'skills/README.md'
if args.write:
    for host in ['.agents', '.claude']:
        base = ROOT / host / 'skills'
        base.mkdir(parents=True, exist_ok=True)
        for name in sorted(actual):
            link = base / name
            if not link.is_symlink():
                link.symlink_to('../../skills/' + name)
    index.write_text(text)
    print(f'Updated index and discovery links for {len(actual)} skills.')
else:
    if not index.exists() or index.read_text() != text:
        print('Skill index is stale; run sync-agent-skills.py --write', file=sys.stderr)
        sys.exit(1)
    print(f'OK: catalog, related-skill targets, index and both hosts match {len(actual)} skills.')
