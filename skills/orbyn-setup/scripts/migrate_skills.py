#!/usr/bin/env python3
"""Explicit host-skill migration used by install.py; no discovery-based ownership guesses."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile

NAME = re.compile(r'[a-z0-9]+(?:-[a-z0-9]+)*')


def fingerprint(source):
    files = {}
    for path in sorted(source.rglob('*')):
        if path.is_symlink():
            target = os.readlink(path)
            if os.path.isabs(target) or not path.resolve().is_relative_to(source.resolve()):
                raise ValueError(f'Migration needs manual handling of external/absolute resource links: {path}')
            files[path.relative_to(source).as_posix()] = 'link:' + target
        elif path.is_file():
            files[path.relative_to(source).as_posix()] = f'{path.stat().st_mode & 0o777:o}:' + hashlib.sha256(path.read_bytes()).hexdigest()
        elif not path.is_dir():
            raise ValueError(f'Unsupported migration source: {path}')
    return files


def plan(project, selected, namespace, reserved, hosts=('.agents', '.claude')):
    if not selected:
        if namespace:
            raise ValueError('--namespace requires explicit --migrate-skill names')
        return []
    if not namespace or not NAME.fullmatch(namespace):
        raise ValueError('Migration requires a lowercase --namespace company-or-repo')
    migrations = []
    destinations = set()
    for old in sorted(set(selected)):
        if not NAME.fullmatch(old) or len(old) >= 64:
            raise ValueError(f'Invalid migration skill name: {old}')
        name = old if old.startswith(namespace + '-') else namespace + '-' + old
        target = project/'project-skills'/namespace/name
        if len(name) >= 64 or name in reserved or target.exists() or target.is_symlink() or target in destinations:
            raise ValueError(f'Migration destination/name collision: {name}')
        destinations.add(target)
        for parent in [project/'project-skills', target.parent]:
            if parent.is_symlink() or (parent.exists() and not parent.is_dir()):
                raise ValueError(f'Unsafe migration destination: {parent}')
        cursor = project/'.cursor/skills'/old
        if '.cursor' not in hosts and (cursor.exists() or cursor.is_symlink()):
            raise ValueError('Selected skill also exists in Cursor; reconcile with --host all')
        legacy = [project/host/'skills'/old for host in hosts]
        legacy = [path for path in legacy if path.exists() or path.is_symlink()]
        if not legacy:
            raise ValueError(f'No existing host skill to migrate: {old}')
        signatures = []
        sources = []
        for path in legacy:
            if any(parent.is_symlink() or (parent.exists() and not parent.is_dir())
                   for parent in [path.parent, path.parent.parent]):
                raise ValueError(f'Unsafe migration host parent: {path}')
            source = path.resolve(strict=True)
            if not source.is_dir() or not (source/'SKILL.md').is_file() or (source/'SKILL.md').is_symlink():
                raise ValueError(f'Existing skill needs a regular SKILL.md: {path}')
            if source == project or source in project.parents or source == target or source in target.parents:
                raise ValueError(f'Unsafe recursive migration source: {source}')
            # A shared managed copy needs an explicit upstream/local reconciliation first.
            if source.is_relative_to(project/'skills'):
                raise ValueError(f'Reconcile skills/ ownership and pin before migrating this source: {source}')
            text = (source/'SKILL.md').read_text()
            if not text.startswith('---\n') or len(text.split('---', 2)) != 3:
                raise ValueError(f'Missing existing skill frontmatter: {path}')
            front = text.split('---', 2)[1]
            if not re.search(r'^description: \S.+$', front, re.M) or not re.search(r'^name: .+$', front, re.M):
                raise ValueError(f'Existing skill needs name/description: {path}')
            # Preserve internal resource paths. External relative references must resolve
            # to the same consumer file after relocation; otherwise stop before writes.
            for doc in source.rglob('*.md'):
                for ref in re.findall(r'\[[^\]]*\]\(([^)]+)\)', doc.read_text()):
                    ref = ref.split('#', 1)[0].strip('<>')
                    if not ref or Path(ref).is_absolute() or re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', ref):
                        continue
                    before = (doc.parent/ref).resolve()
                    after = (target/doc.relative_to(source).parent/ref).resolve()
                    if not before.is_relative_to(source) and before != after:
                        raise ValueError(f'Rebase external relative reference before migration: {doc} -> {ref}')
            signatures.append(fingerprint(source))
            sources.append(source)
        if any(value != signatures[0] for value in signatures[1:]):
            raise ValueError(f'Conflicting host copies; reconcile them before migration: {old}')
        migrations.append({'old': old, 'name': name, 'target': target, 'legacy': legacy,
                           'source': sources[0], 'fingerprint': signatures[0]})
    return migrations


def describe(migrations):
    for item in migrations:
        print(f'Migrate {item["old"]} -> {item["target"]}; register as {item["name"]}')
        for path in item['legacy']:
            print(f'  Replace selected host entry after backup: {path}')


def apply(project, migrations, pending, write_links):
    """Back up originals before writes, retain a receipt, roll back owned effects on failure."""
    backup = Path(tempfile.mkdtemp(prefix=project.name+'-skill-migration-', dir=project.parent))
    originals = []
    created = []
    links = []
    receipt = {'status': 'preparing', 'project': str(project), 'skills': []}
    def record():
        (backup/'receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
    record()
    try:
        for index, item in enumerate(migrations):
            if fingerprint(item['source']) != item['fingerprint']:
                raise ValueError(f'Source changed during migration: {item["old"]}')
            stage = backup/'staged'/item['name']
            shutil.copytree(item['source'], stage, symlinks=True)
            skill = stage/'SKILL.md'
            text = skill.read_text()
            parts = text.split('---', 2)
            parts[1] = re.sub(r'^name: .+$', 'name: '+item['name'], parts[1], count=1, flags=re.M)
            skill.write_text('---'.join(parts))
            for offset, path in enumerate(item['legacy']):
                saved = backup/'originals'/f'{index}-{offset}'
                saved.parent.mkdir(parents=True, exist_ok=True)
                if path.is_symlink():
                    saved.symlink_to(os.readlink(path), target_is_directory=True)
                else:
                    shutil.copytree(path, saved, symlinks=True)
                originals.append((path, saved))
            receipt['skills'].append({'old_name': item['old'], 'name': item['name'],
                                     'target': str(item['target']), 'legacy': [str(p) for p in item['legacy']],
                                     'original_hashes': item['fingerprint']})
        receipt['originals'] = [{'path': str(path), 'backup': str(saved)} for path, saved in originals]
        receipt['status'] = 'backed_up'
        record()
        for item in migrations:
            created.append(item['target'])
            shutil.copytree(backup/'staged'/item['name'], item['target'], symlinks=True)
        for path, saved in originals:
            if path.is_symlink():
                path.unlink()
            else:
                shutil.rmtree(path)
        for link, target in pending:
            write_links([(link, target)])
            links.append(link)
        receipt['status'] = 'complete'
        record()
    except Exception as error:
        for link in reversed(links):
            link.unlink()
        for path in reversed(created):
            if path.exists():
                shutil.rmtree(path)
        for path, saved in originals:
            if path.exists() or path.is_symlink():
                continue  # A pre-mutation error leaves the original intact.
            if saved.is_symlink():
                path.symlink_to(os.readlink(saved), target_is_directory=True)
            else:
                shutil.copytree(saved, path, symlinks=True)
        receipt.update(status='rolled_back', error=str(error))
        record()
        raise RuntimeError(f'Migration rolled back; backup and receipt: {backup}') from error
    print(f'Migration backup and receipt: {backup}')
    return backup
