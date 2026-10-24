#!/usr/bin/env python3
"""Validate/register consumer-owned skills; never move, export or overwrite skills."""
import argparse
import json
import os
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[3]
NAME = re.compile(r'[a-z0-9]+(?:-[a-z0-9]+)*')


def shared_names():
    return {entry['name'] for entry in json.loads((ROOT / 'skills/catalog.json').read_text())['skills']}


def inventory(project, reserved=None):
    project = project.resolve(strict=True)
    base = project / 'project-skills'
    if base.is_symlink() or (base.exists() and not base.is_dir()):
        raise ValueError('project-skills must be a real directory inside the consumer')
    if not base.exists():
        return {}
    reserved = shared_names() if reserved is None else reserved
    found = {}
    for namespace in sorted(base.iterdir()):
        if namespace.is_symlink():
            raise ValueError(f'Symlinked project namespace: {namespace.name}')
        if not namespace.is_dir():
            continue
        if not NAME.fullmatch(namespace.name):
            raise ValueError(f'Invalid project namespace: {namespace.name}')
        if (namespace/'SKILL.md').exists():
            raise ValueError('Use project-skills/<company-or-repo>/<namespaced-skill>/SKILL.md')
        for skill in sorted(namespace.iterdir()):
            if skill.is_symlink():
                raise ValueError(f'Symlinked project skill: {skill.name}')
            if not skill.is_dir():
                continue
            source = skill / 'SKILL.md'
            if source.is_symlink() or not source.is_file():
                raise ValueError(f'Project skill needs a regular SKILL.md: {skill}')
            name = skill.name
            if (not NAME.fullmatch(name) or len(name) >= 64
                    or not name.startswith(namespace.name + '-')):
                raise ValueError(f'Use a namespaced skill name such as {namespace.name}-release: {name}')
            if name in reserved or name in found:
                raise ValueError(f'Project/shared skill name collision: {name}')
            text = source.read_text(encoding='utf-8')
            if not text.startswith('---\n') or len(text.split('---', 2)) != 3:
                raise ValueError(f'Missing project skill frontmatter: {name}')
            front = text.split('---', 2)[1]
            if (f'\nname: {name}\n' not in '\n' + front
                    or not re.search(r'^description: \S.+$', front, re.M)):
                raise ValueError(f'Project skill name/description mismatch: {name}')
            found[name] = skill
    return found


def hosts_for(host):
    if host not in {'both', 'codex', 'claude'}:
        raise ValueError('Unknown host')
    return ['.agents', '.claude'] if host == 'both' else ['.agents' if host == 'codex' else '.claude']


def plan_links(project, sources, hosts, require_existing=False, replacing=(), planned_sources=()):
    """Preflight both hosts before returning any writes; preserve unrelated entries."""
    pending = []
    for host in hosts:
        base = project / host / 'skills'
        for parent in [project / host, base]:
            if parent.is_symlink() or (parent.exists() and not parent.is_dir()):
                raise ValueError(f'Refusing a non-directory or symlinked host path: {parent}')
        for name, target in sorted(sources.items()):
            link = base / name
            if target not in planned_sources and not (target / 'SKILL.md').is_file():
                raise ValueError(f'Missing skill source: {name}')
            if link in replacing:
                pending.append((link, target))
            elif link.exists() or link.is_symlink():
                if not link.is_symlink() or link.resolve() != target.resolve():
                    raise ValueError(f'Conflicting discovery entry: {link}')
            elif require_existing:
                raise ValueError(f'Missing project discovery link: {link}')
            else:
                pending.append((link, target))
    return pending


def write_links(pending):
    for link, target in pending:
        link.parent.mkdir(parents=True, exist_ok=True)
        link.symlink_to(os.path.relpath(target, link.parent), target_is_directory=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['check', 'link'])
    parser.add_argument('--project', type=Path, required=True)
    parser.add_argument('--host', choices=['codex', 'claude', 'both'], default='both')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    try:
        project = args.project.resolve(strict=True)
        sources = inventory(project)
        pending = plan_links(project, sources, hosts_for(args.host), args.command == 'check')
        if args.command == 'link' and not args.dry_run:
            write_links(pending)
        print(f'{len(sources)} consumer-owned skills; {len(pending)} discovery links '
              + ('planned.' if args.dry_run else 'created.' if args.command == 'link' else 'validated.'))
        print('No skill moves, public export, model settings or policy changes.')
    except (OSError, ValueError) as error:
        parser.exit(1, f'Project skills stopped: {error}\n')


if __name__ == '__main__':
    main()
