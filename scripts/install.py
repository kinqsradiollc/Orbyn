#!/usr/bin/env python3
"""Install library discovery links without changing project policy or models."""
import argparse
import json
from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parents[1]
PRESETS = ROOT / 'skills/orbyn-setup/assets/presets.json'
PROJECT_SKILLS = runpy.run_path(str(ROOT / 'skills/orbyn-setup/scripts/project_skills.py'))
MIGRATION = runpy.run_path(str(ROOT / 'skills/orbyn-setup/scripts/migrate_skills.py'))


def selection(selected=(), presets=(), all_skills=False):
    catalog = json.loads((ROOT / 'skills/catalog.json').read_text())
    names = {entry['name'] for entry in catalog['skills']}
    config = json.loads(PRESETS.read_text())
    if config.get('schema_version') != 1 or config.get('default') not in config.get('presets', {}):
        raise ValueError('Invalid preset configuration')
    for name, preset in config['presets'].items():
        entries = preset['skills']
        if not entries or len(entries) != len(set(entries)) or set(entries) - names:
            raise ValueError(f'Invalid skill selection in preset: {name}')
    if all_skills and (selected or presets):
        raise ValueError('--all cannot be combined with --skill or --preset')
    if all_skills:
        return names
    chosen = list(presets) if presets or selected else [config['default']]
    wanted = set(selected)
    for preset in chosen:
        if preset not in config['presets']:
            raise ValueError(f'Unknown preset: {preset}')
        wanted.update(config['presets'][preset]['skills'])
    if wanted - names:
        raise ValueError('Unknown skills: ' + ', '.join(sorted(wanted - names)))
    return wanted


def install(project, host, selected=(), presets=(), all_skills=False, dry_run=False,
            project_skills=False, migrate_skills=(), namespace=None):
    project = project.resolve(strict=True)
    if not project.is_dir():
        raise ValueError('Project must be an existing directory')
    if host not in {'both', 'codex', 'claude'}:
        raise ValueError('Unknown host')
    wanted = selection(selected, presets, all_skills)
    if migrate_skills and host != 'both':
        raise ValueError('Migration reconciles both hosts; use --host both')
    local = PROJECT_SKILLS['inventory'](project, selection(all_skills=True))
    migrations = MIGRATION['plan'](project, migrate_skills, namespace, selection(all_skills=True))
    sources = {name: ROOT / 'skills' / name for name in wanted}
    if project_skills:
        sources.update(local)
    sources.update({item['name']: item['target'] for item in migrations})
    replacing = {path for item in migrations for path in item['legacy']}
    pending = PROJECT_SKILLS['plan_links'](project, sources, PROJECT_SKILLS['hosts_for'](host),
                                          replacing=replacing,
                                          planned_sources={item['target'] for item in migrations})
    MIGRATION['describe'](migrations)
    if not dry_run:
        if migrations:
            MIGRATION['apply'](project, migrations, pending, PROJECT_SKILLS['write_links'])
        else:
            PROJECT_SKILLS['write_links'](pending)
    return len(pending)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path)
    parser.add_argument('--host', choices=['codex', 'claude', 'both'], default='both')
    parser.add_argument('--skill', action='append', default=[])
    parser.add_argument('--preset', action='append', default=[])
    parser.add_argument('--all', action='store_true', help='explicitly register every skill')
    parser.add_argument('--list-presets', action='store_true')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--project-skills', action='store_true', help='also register consumer-owned project-skills; never export or move them')
    parser.add_argument('--migrate-skill', action='append', default=[], help='explicit existing host skill name to relocate into the company namespace')
    parser.add_argument('--namespace', help='company/repo namespace required with --migrate-skill')
    args = parser.parse_args()
    try:
        if args.list_presets:
            selection()  # Validate before displaying.
            config = json.loads(PRESETS.read_text())
            for name, preset in config['presets'].items():
                print(f'{name}: {len(preset["skills"])} skills — {preset["description"]}')
            return
        if args.project is None:
            parser.error('--project is required unless --list-presets is used')
        count = install(args.project, args.host, args.skill, args.preset, args.all, args.dry_run,
                        args.project_skills, args.migrate_skill, args.namespace)
        verb = 'Would create' if args.dry_run else 'Created'
        print(f'{verb} {count} discovery links; existing selections and project settings preserved.')
    except (OSError, ValueError, RuntimeError) as error:
        parser.exit(1, f'Install stopped: {error}\n')


if __name__ == '__main__':
    main()
