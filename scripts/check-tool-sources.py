#!/usr/bin/env python3
"""Verify retained tooling snapshots without installing or running their engines."""
import argparse
import configparser
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess


def source_path(root, relative):
    if (not isinstance(relative, str) or not relative or '\\' in relative
            or PurePosixPath(relative).is_absolute()
            or '..' in PurePosixPath(relative).parts):
        raise ValueError(f'Invalid source path: {relative!r}')
    path = root / relative
    if not path.resolve().is_relative_to(root):
        raise ValueError(f'External source target: {relative}')
    return path


def check(root):
    root = root.resolve(strict=True)
    manifest = json.loads((root / 'tools/upstream-manifest.json').read_text())
    modules = configparser.ConfigParser()
    modules.read(root / '.gitmodules')
    index = {}
    result = subprocess.check_output(['git', 'ls-files', '--stage', '-z'], cwd=root)
    for record in filter(None, result.decode().split('\0')):
        metadata, path = record.split('\t', 1)
        mode, revision, stage = metadata.split()
        if stage == '0':
            index[path] = (mode, revision)
    errors = []
    count = pins = 0
    for source in manifest['imports']:
        base = source_path(root, source['destination'])
        for entry in source['files']:
            path = source_path(root, str(base.relative_to(root) / entry['path']))
            label = path.relative_to(root).as_posix()
            if label not in index:
                errors.append(f'Imported file is not tracked: {label}')
            if not path.exists():
                errors.append(f'Missing imported file: {label}')
                continue
            is_link = path.is_symlink()
            if is_link != (entry['kind'] == 'symlink'):
                errors.append(f'Changed file kind: {label}')
            data = os.readlink(path).encode() if is_link else path.read_bytes()
            if hashlib.sha256(data).hexdigest() != entry['sha256']:
                errors.append(f'Changed upstream bytes: {label}')
            if not is_link and bool(path.stat().st_mode & 0o111) != entry['executable']:
                errors.append(f'Changed executable bit: {label}')
            count += 1
        for module in source['submodules']:
            path = source_path(root, str(base.relative_to(root) / module['path']))
            label = path.relative_to(root).as_posix()
            section = f'submodule "{label}"'
            if index.get(label) != ('160000', module['revision']):
                errors.append(f'Wrong/missing gitlink: {label}')
            if modules.get(section, 'path', fallback='') != label:
                errors.append(f'Wrong module path: {label}')
            if modules.get(section, 'url', fallback='') != module['repository']:
                errors.append(f'Wrong module URL: {label}')
            pins += 1
    if errors:
        raise ValueError('\n'.join(errors))
    return count, pins


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    try:
        count, pins = check(args.root)
        print(f'OK: {count} imported files and {pins} gitlink pins. Static source integrity only.')
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'Tool source check failed: {error}\n')


if __name__ == '__main__':
    main()
