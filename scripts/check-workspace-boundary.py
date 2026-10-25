#!/usr/bin/env python3
"""Reject a tracked copied engineering installation or raw research in Orbyn."""
import argparse
from pathlib import Path
import subprocess

RETIRED_FILES = {
    'AGENTS.md', 'AGENT.md', 'CLAUDE.md', '.cursorrules', 'codex.md',
    '.github/workflows/skills-upstream.yml', 'tools/skill-adaptations.json',
    'scripts/install.py', 'scripts/check-agent-assets.py',
    'scripts/sync-agent-models.py', 'scripts/sync-agent-skills.py',
    'scripts/sync-public-skills.py',
}
RETIRED_PREFIXES = ('skills/', 'project-skills/', '.agents/', '.codex/', '.claude/',
                    'docs/agents/', 'openSrc/', 'orbyn-references/')
RESEARCH_PROBES = ('openSrc/boundary-probe', 'orbyn-references/boundary-probe')


def check(root):
    root = root.resolve(strict=True)
    tracked = subprocess.check_output(['git', 'ls-files', '--cached', '-z'], cwd=root)
    rejected = [p for p in tracked.decode().split('\0')
                if p in RETIRED_FILES or p.startswith(RETIRED_PREFIXES)]
    if rejected:
        raise ValueError('Retired installation or raw research is staged/tracked:\n'
                         + '\n'.join(sorted(set(rejected))))
    ignored = subprocess.run(['git', '-c', 'core.excludesFile=/dev/null', 'check-ignore',
                              '--no-index', '--verbose', '--stdin'], cwd=root,
                             input='\n'.join(RESEARCH_PROBES) + '\n', text=True,
                             capture_output=True)
    matched = set()
    for line in ignored.stdout.splitlines():
        origin, path = line.split('\t', 1)
        if origin.split(':', 1)[0] == '.gitignore':
            matched.add(path)
    if ignored.returncode not in {0, 1} or matched != set(RESEARCH_PROBES):
        raise ValueError('Root .gitignore must exclude openSrc/ and orbyn-references/')
    return len([p for p in tracked.decode().split('\0') if p])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    try:
        count = check(args.root)
        print(f'OK: {count} indexed paths respect the workspace boundary; untracked work is untouched.')
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'Workspace boundary check failed: {error}\n')


if __name__ == '__main__':
    main()
