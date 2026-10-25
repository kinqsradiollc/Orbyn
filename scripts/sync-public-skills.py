#!/usr/bin/env python3
"""Hash-pinned skills import/export. No network, commits, pushes or private-tree export."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess

REPOSITORY = 'https://github.com/kinqsradio/orbyn-fullstack-skills'
MANIFEST = 'distribution/manifest.json'
LOCK = 'skills/upstream-lock.json'
NAME = re.compile(r'[a-z0-9]+(?:-[a-z0-9]+)*')
EXTENSIONS = {'.md', '.json', '.py', '.sh', '.cjs', '.html', '.txt', '.yaml', '.yml'}


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n', encoding='utf-8')


def control_path(root, relative):
    if relative not in {MANIFEST, LOCK}:
        raise ValueError('Unknown control file')
    current = root
    for part in PurePosixPath(relative).parts:
        current = current / part
        if current.is_symlink():
            raise ValueError(f'Symlink in control path: {relative}')
    return root / relative


def safe_path(root, relative):
    """Reject escape paths and symlink parents before either reads or writes."""
    parts = PurePosixPath(relative).parts
    if (not isinstance(relative, str) or '\\' in relative or not parts
            or PurePosixPath(relative).is_absolute() or '..' in parts
            or any(part.startswith('.') for part in parts)):
        raise ValueError(f'Unsafe managed path: {relative}')
    if not (relative in {'skills/catalog.json', 'skills/README.md'}
            or (len(parts) >= 3 and parts[0] == 'skills' and NAME.fullmatch(parts[1]))):
        raise ValueError(f'Path outside skills allowlist: {relative}')
    current = root
    for part in parts:
        current = current / part
        if current.is_symlink():
            raise ValueError(f'Symlink in managed path: {relative}')
    return root / relative


def inventory(root):
    catalog = load(safe_path(root, 'skills/catalog.json'))
    names = [entry['name'] for entry in catalog['skills']]
    if len(names) != len(set(names)) or any(not NAME.fullmatch(name) for name in names):
        raise ValueError('Invalid or duplicate catalog name')
    actual = {p.parent.name for p in (root / 'skills').glob('*/SKILL.md')}
    if set(names) != actual:
        raise ValueError('Catalog and skill folders differ')
    paths = ['skills/catalog.json', 'skills/README.md']
    for name in sorted(names):
        base = safe_path(root, f'skills/{name}/SKILL.md').parent
        for path in sorted(base.rglob('*')):
            relative = path.relative_to(root).as_posix()
            if '__pycache__' in path.parts or path.suffix == '.pyc':
                continue
            safe_path(root, relative)
            if path.is_dir():
                continue
            if path.name != 'LICENSE' and path.suffix not in EXTENSIONS:
                raise ValueError(f'Unexpected skill asset type: {relative}')
            if path.stat().st_size > 1024 * 1024:
                raise ValueError(f'Skill asset exceeds 1 MiB: {relative}')
            paths.append(relative)
    return {p: hashlib.sha256(safe_path(root, p).read_bytes()).hexdigest() for p in sorted(paths)}


def validate_map(files):
    if not isinstance(files, dict) or not files:
        raise ValueError('Missing managed file hashes')
    for path, digest in files.items():
        safe_path(Path('/__skills_manifest__'), path)
        if not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest):
            raise ValueError(f'Invalid digest for {path}')


def manifest(root):
    data = load(control_path(root, MANIFEST))
    if data.get('schema_version') != 1 or data.get('repository') != REPOSITORY:
        raise ValueError('Unsupported manifest or repository')
    validate_map(data.get('files'))
    if data['files'] != inventory(root):
        raise ValueError('Manifest differs from files; regenerate and review it')
    return data['files']


def lock(root):
    data = load(control_path(root, LOCK))
    if (data.get('schema_version') != 1 or data.get('repository') != REPOSITORY
            or not re.fullmatch('[0-9a-f]{40}', data.get('revision', ''))):
        raise ValueError('Unsupported consumer lock')
    validate_map(data.get('files'))
    return data


def differences(before, after):
    return sorted(p for p in before.keys() | after.keys() if before.get(p) != after.get(p))


def revision(root):
    value = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
    if not re.fullmatch('[0-9a-f]{40}', value):
        raise ValueError('Expected a full committed revision')
    dirty = subprocess.check_output(['git', '-C', str(root), 'status', '--porcelain', '--', 'skills', MANIFEST], text=True)
    if dirty:
        raise ValueError('Upstream managed files/manifest must be committed and clean')
    return value


def write_lock(root, source, files):
    save(control_path(root, LOCK), {'schema_version': 1, 'repository': REPOSITORY,
                      'revision': revision(source), 'files': files})


def copy_changes(source, destination, paths):
    # Preflight every path and file before the first mutation.
    operations = []
    for path in paths:
        src, dst = safe_path(source, path), safe_path(destination, path)
        if dst.exists() and not dst.is_file():
            raise ValueError(f'Not a regular destination file: {path}')
        operations.append((dst, src.read_bytes() if src.exists() else None))
    for dst, data in operations:
        if data is None:
            if dst.exists():
                dst.unlink()
        else:
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(data)


def run(command, root, upstream=None, write=False):
    root = root.resolve()
    if command == 'manifest':
        value = {'schema_version': 1, 'repository': REPOSITORY, 'files': inventory(root)}
        if write:
            save(control_path(root, MANIFEST), value)
        elif load(control_path(root, MANIFEST)) != value:
            raise ValueError('Manifest is stale')
        print(f'Manifest matches {len(value["files"])} managed files.')
        return
    if command == 'check':
        baseline = lock(root)
        changed = differences(baseline['files'], inventory(root))
        if changed:
            raise ValueError('Skills differ from upstream pin:\n' + '\n'.join(changed)
                             + '\nContribute upstream, then pull or pin the reviewed revision.')
        if upstream is not None:
            upstream = upstream.resolve()
            if (baseline['revision'] != revision(upstream)
                    or baseline['files'] != manifest(upstream)):
                raise ValueError('Consumer lock does not match the supplied public revision/manifest')
        print(f'Skills match upstream pin {baseline["revision"]}. No network or writes.')
        return
    if upstream is None:
        raise ValueError('--upstream checkout is required')
    upstream = upstream.resolve()
    if upstream == root:
        raise ValueError('Consumer and upstream must be distinct checkouts')
    remote = manifest(upstream)
    upstream_revision = revision(upstream)
    current = inventory(root)
    if command == 'pin':
        if differences(current, remote):
            raise ValueError('Pin requires consumer files to exactly match upstream')
        write_lock(root, upstream, remote)
        print(f'Pinned {upstream_revision}; skill content was unchanged.')
        return
    baseline = lock(root)['files']
    if command == 'pull':
        if current != baseline and current != remote:
            raise ValueError('Consumer has local skill edits; export/reconcile them before pull')
        paths = differences(current, remote)
        copy_changes(upstream, root, paths)
        write_lock(root, upstream, remote)
        print(f'Imported {len(paths)} paths; pinned {upstream_revision}. Regenerate host links.')
        return
    if command == 'export':
        changed = differences(baseline, current)
        conflicts = [p for p in changed if remote.get(p) != baseline.get(p) and remote.get(p) != current.get(p)]
        if conflicts:
            raise ValueError('Both consumer and upstream changed:\n' + '\n'.join(conflicts))
        print('Allowlisted contribution paths:\n' + ('\n'.join(changed) or '(none)'))
        if write and changed:
            branch = subprocess.check_output(['git', '-C', str(upstream), 'branch', '--show-current'], text=True).strip()
            if not branch or branch in {'main', 'master'}:
                raise ValueError('Create an upstream contribution branch before --write')
            copy_changes(root, upstream, changed)
            run('manifest', upstream, write=True)
            print('Exported locally only. Review the diff; commit/push/PR are separate actions.')
        return
    raise ValueError(f'Unknown command: {command}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['manifest', 'check', 'pin', 'pull', 'export'])
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--upstream', type=Path)
    parser.add_argument('--write', action='store_true', help='write manifest or apply export; other operations are explicit')
    args = parser.parse_args()
    try:
        run(args.command, args.root, args.upstream, args.write)
    except (ValueError, OSError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'Skills sync stopped: {error}\n')


if __name__ == '__main__':
    main()
