#!/usr/bin/env python3
"""Check pinned offline reference bytes without network access or source execution."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess

ROOT = Path(__file__).resolve().parents[3]


def check_research_boundary(root):
    """Keep local research out of a checkout's index without following a parent repo."""
    probe = subprocess.run(['git', '-C', str(root), 'rev-parse', '--show-toplevel'],
                           capture_output=True, text=True)
    if probe.returncode or Path(probe.stdout.strip()).resolve() != root.resolve():
        return  # Non-Git snapshots can still validate their bundled offline bytes.
    for name in ['openSrc', 'orbyn-references']:
        tracked = subprocess.check_output(['git', '-C', str(root), 'ls-files', '-z', '--', name+'/'])
        if tracked:
            raise ValueError(f'{name} is local research material and must not be tracked or staged')
        directory = root/name
        if directory.is_symlink() or (directory.exists() and not directory.is_dir()):
            raise ValueError(f'Local research root must be a real directory: {name}')
        if directory.exists():
            ignored = subprocess.run(['git', '-C', str(root), 'check-ignore', '--no-index', '-q',
                                      '--', name+'/.orbyn-reference-probe'], capture_output=True)
            if ignored.returncode:
                raise ValueError(f'Exclude /{name}/ before storing local research')
            exposed = subprocess.check_output(['git', '-C', str(root), 'ls-files', '--others',
                                               '--exclude-standard', '-z', '--', name+'/'])
            if exposed:
                raise ValueError(f'Unignored files inside local research root: {name}')


def check(root):
    check_research_boundary(root)
    declared = set()
    for manifest in sorted((root/'skills').glob('*/references/upstream/*/snapshot.json')):
        data = json.loads(manifest.read_text())
        if (data.get('schema_version') != 1
                or not re.fullmatch(r'https://github.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', data.get('repository', ''))
                or not re.fullmatch('[0-9a-f]{40}', data.get('revision', ''))
                or not data.get('license') or not data.get('files')):
            raise ValueError(f'Invalid offline snapshot metadata: {manifest}')
        if not data.get('license_files') or not set(data['license_files']) <= data['files'].keys():
            raise ValueError(f'Snapshot needs bundled license files: {manifest}')
        expected = {manifest}
        for name, entry in data['files'].items():
            path = PurePosixPath(name)
            if path.is_absolute() or '..' in path.parts or '\\' in name or not path.parts:
                raise ValueError('Unsafe offline snapshot path')
            if path.name == 'SKILL.md':
                raise ValueError('Offline source must use SOURCE.md, not an active SKILL.md entrypoint')
            target = manifest.parent/name
            current = target
            while current != root:
                if current.is_symlink():
                    raise ValueError(f'Symlink in snapshot: {target}')
                current = current.parent
            if (not target.is_file() or not target.resolve().is_relative_to(root.resolve())
                    or hashlib.sha256(target.read_bytes()).hexdigest() != entry.get('sha256')):
                raise ValueError(f'Changed/missing offline source bytes: {target}')
            expected.add(target)
        actual = {p for p in manifest.parent.rglob('*') if p.is_file() or p.is_symlink()}
        if actual != expected:
            raise ValueError(f'Undeclared or missing snapshot files: {manifest}')
        declared.update(expected)
    for base in (root/'skills').glob('*/references/upstream'):
        actual = {p for p in base.rglob('*') if p.is_file() or p.is_symlink()}
        if not actual <= declared:
            raise ValueError(f'Unpinned source content: {base}')
    return declared


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    args = parser.parse_args()
    try:
        files = check(args.root.resolve(strict=True))
        print(f'OK: {len(files)} pinned offline source/metadata files; no network or source execution.')
    except (ValueError, OSError, KeyError, TypeError) as error:
        parser.exit(1, f'Offline source check failed: {error}\n')
