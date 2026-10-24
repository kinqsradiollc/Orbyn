#!/usr/bin/env python3
"""Maintain Orbyn's skill index and per-host links; default is a read-only check."""
import argparse
import json
import runpy
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
# Shared catalog and consumer-owned skills have separate sources and one host namespace.
project_tools = runpy.run_path(str(ROOT / 'skills/orbyn-setup/scripts/project_skills.py'))
local = {}
pending = []
try:
    local = project_tools['inventory'](ROOT, actual)
    sources = {name: ROOT / 'skills' / name for name in actual}
    sources.update(local)
    pending = project_tools['plan_links'](ROOT, sources, ['.agents', '.claude'], not args.write)
    for host in ['.agents', '.claude']:
        base = ROOT / host / 'skills'
        if base.exists():
            for link in base.iterdir():
                if link.name not in sources:
                    errors.append(f'Unmanaged discovery entry; classify ownership before moving: {link.relative_to(ROOT)}')
except (OSError, ValueError) as error:
    errors.append(str(error))
if errors:
    print('\n'.join(errors), file=sys.stderr)
    sys.exit(1)
text = '''# Orbyn skills

Start with [orbyn-workflow](orbyn-workflow/SKILL.md) and the
[skill system](../docs/agents/skill-system.md). Use
[orbyn-skill-creator](orbyn-skill-creator/SKILL.md) to maintain this catalog,
[orbyn-plan](orbyn-plan/SKILL.md) for planning and
[orbyn-setup](orbyn-setup/SKILL.md) for host configuration.

Shared folders are linked into Codex and Claude Code. Consumer-owned skills live
separately under `project-skills/<company-or-repo>/<namespaced-skill>/`; follow the
[ownership guide](orbyn-setup/references/project-skills.md). They are discovered
by both hosts but excluded from this shared catalog and public sync.
Load only the relevant
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
    project_tools['write_links'](pending)
    index.write_text(text)
    print(f'Updated shared index and discovery links: {len(actual)} shared, {len(local)} project skills.')
else:
    if not index.exists() or index.read_text() != text:
        print('Skill index is stale; run sync-agent-skills.py --write', file=sys.stderr)
        sys.exit(1)
    print(f'OK: shared catalog/index and both hosts match {len(actual)} shared + {len(local)} project skills.')
