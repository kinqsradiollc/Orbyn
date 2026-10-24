#!/usr/bin/env python3
"""Read-only integrity and discovery checks for Orbyn's agent assets (Python 3.11+)."""
import configparser
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import subprocess
import sys
import tomllib

ROOT = Path(__file__).resolve().parents[1]
errors = []
if subprocess.check_output(['git', 'ls-files', '--', 'openSrc/'], cwd=ROOT, text=True).strip():
    errors.append('openSrc is local research material and must not be tracked')

def check(ok, message):
    if not ok:
        errors.append(message)

def relative(path):
    return str(path.relative_to(ROOT))

def contained(path):
    return path.resolve().is_relative_to(ROOT)

manifest = json.loads((ROOT / 'tools/upstream-manifest.json').read_text())
modules = configparser.ConfigParser()
modules.read(ROOT / '.gitmodules')
index = {}
for line in subprocess.check_output(['git', 'ls-files', '--stage'], cwd=ROOT, text=True).splitlines():
    metadata, path = line.split('\t', 1)
    mode, revision, stage = metadata.split()
    if stage == '0':
        index[path] = (mode, revision)
count = 0
pins = 0
for source in manifest['imports']:
    base = ROOT / source['destination']
    for entry in source['files']:
        path = base / entry['path']
        label = relative(path)
        check(label in index, f'Imported file is not tracked: {label}')
        check(path.exists(), f'Missing imported file: {label}')
        if not path.exists():
            continue
        check(contained(path), f'External source target: {label}')
        is_link = path.is_symlink()
        check(is_link == (entry['kind'] == 'symlink'), f'Changed file kind: {label}')
        data = os.readlink(path).encode() if is_link else path.read_bytes()
        check(hashlib.sha256(data).hexdigest() == entry['sha256'], f'Changed upstream bytes: {label}')
        if not is_link:
            check(bool(path.stat().st_mode & 0o111) == entry['executable'], f'Changed executable bit: {label}')
        count += 1
    for module in source['submodules']:
        path = relative(base / module['path'])
        section = f'submodule "{path}"'
        check(index.get(path) == ('160000', module['revision']), f'Wrong/missing gitlink: {path}')
        check(modules.get(section, 'path', fallback='') == path, f'Wrong module path: {path}')
        check(modules.get(section, 'url', fallback='') == module['repository'], f'Wrong module URL: {path}')
        pins += 1

snapshot_tools = runpy.run_path(str(ROOT/'skills/orbyn-skill-creator/scripts/check_sources.py'))
snapshots = snapshot_tools['check'](ROOT)
project_tools = runpy.run_path(str(ROOT/'skills/orbyn-setup/scripts/project_skills.py'))
local_skills = project_tools['inventory'](ROOT)
project_tools['plan_links'](ROOT, local_skills, ['.agents', '.claude'], True)

skills = sorted((ROOT / 'skills').glob('*/SKILL.md'))
for skill in skills:
    name = skill.parent.name
    text = skill.read_text()
    check(text.startswith('---\n'), f'Missing frontmatter: {relative(skill)}')
    check(f'\nname: {name}\n' in text, f'Wrong skill name: {name}')
    check(bool(re.search(r'^description: \S', text, re.M)), f'Missing description: {name}')
    for host in ['.agents', '.claude']:
        link = ROOT / host / 'skills' / name
        check(link.is_symlink() and link.resolve() == skill.parent.resolve(), f'Broken discovery link: {relative(link)}')
        check(contained(link), f'External discovery link: {relative(link)}')
adaptations = json.loads((ROOT / 'tools/skill-adaptations.json').read_text())
for group, directory in [('engineering', 'tools/pstack/skills'), ('rea', 'tools/rea/.agents/skills')]:
    mapping = adaptations[group]
    sources = {p.parent.name for p in (ROOT / directory).glob('*/SKILL.md')}
    check(set(mapping) == sources, f'Incomplete source provenance: {group}')
    for local_name in mapping.values():
        check((ROOT / 'skills' / local_name / 'SKILL.md').exists(), f'Missing skill: {local_name}')
for host in ['.agents', '.claude']:
    discovered = {p.name for p in (ROOT / host / 'skills').iterdir()}
    check(discovered == ({p.parent.name for p in skills} | set(local_skills)), f'Stale/extra discovery entries: {host}')

# Check authored Markdown links only, not historical upstream references.
docs = [ROOT / p for p in ['AGENTS.md', 'AGENT.md', 'CLAUDE.md', 'README.md',
    'tools/THIRD_PARTY_NOTICES.md']]
docs += list((ROOT / 'docs').rglob('*.md'))
docs += list((ROOT / 'tools/research').glob('*.md'))
docs += list((ROOT / 'skills').rglob('*.md'))
for doc in docs:
    if doc in snapshots:
        continue  # Immutable upstream references are checked by source hashes.
    body = re.sub(r'```.*?```', '', doc.read_text(), flags=re.S)
    for target in re.findall(r'\[[^\]]*\]\(([^)]+)\)', body):
        target = target.split('#', 1)[0].strip('<>')
        if not target or target.startswith('/') or re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', target):
            continue
        check('openSrc/' not in target, f'Active openSrc link: {relative(doc)} -> {target}')
        check((doc.parent / target).exists(), f'Broken link: {relative(doc)} -> {target}')

for host, suffix in [('.codex', '*.toml'), ('.claude', '*.md')]:
    actual = {p.stem for p in (ROOT / host / 'agents').glob(suffix)}
    check(actual == {'orbyn-agent', 'orbyn-light'}, f'{host} must expose the two routine Orbyn tiers: {actual}')
# Imported source names are preserved in provenance only, not active agent identity.
active = [ROOT / p for p in ['AGENTS.md', 'AGENT.md', 'CLAUDE.md']]
active += list((ROOT / 'skills').rglob('*.md'))
active += [p for p in (ROOT / 'docs/agents').glob('*.md') if p.name != 'tooling.md']
active += list((ROOT / '.codex').rglob('*.toml')) + list((ROOT / '.claude/agents').glob('*.md'))
for path in active:
    if path in snapshots:
        continue  # Source credits/identities are data, not active agent roles.
    check(not re.search(r'poteto|pstack', path.read_text(), re.I), f'Inherited active branding: {relative(path)}')

model_check = subprocess.run([sys.executable, str(ROOT / 'scripts/sync-agent-models.py'), '--check'], cwd=ROOT, capture_output=True, text=True)
check(model_check.returncode == 0, model_check.stderr.strip() or 'Model registry drift')
config = tomllib.loads((ROOT / '.codex/config.toml').read_text())
check(config.get('agents', {}).get('max_threads') == 2, 'Codex child limit must be two')
for path in (ROOT / '.codex/agents').glob('*.toml'):
    role = tomllib.loads(path.read_text())
    check(bool(role.get('developer_instructions')), f'Missing role instructions: {relative(path)}')
for path in (ROOT / '.claude/agents').glob('*.md'):
    text = path.read_text().split('---')[1]
    check('\ndisallowedTools: Agent, Task\n' in text, f'Child delegation must remain disabled: {relative(path)}')

if errors:
    print('\n'.join(errors), file=sys.stderr)
    sys.exit(1)
print(f'OK: {count} imported files, {pins} gitlink pins, {len(skills)} portable skills, {len(docs)} authored documents and host defaults.')
print('Static integrity only; no provider, native-engine, model execution or application qualification.')
