"""Narrow, offline PR fixture. It never calls a hosted service."""
import argparse
import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args], text=True).strip()


def storage():
    common = Path(git('rev-parse', '--path-format=absolute', '--git-common-dir'))
    path = common.parent.parent/'.forge-state.json'
    state = json.loads(path.read_text())
    if state.get('fixture') != 'orbyn-contribution-lab-v1':
        raise ValueError('Not a contribution-lab repository')
    if Path(git('remote', 'get-url', 'origin')).resolve() != path.parent/'remote.git':
        raise ValueError('The fixture only permits its own local Git remote')
    return path, state


def head():
    branch = git('branch', '--show-current')
    if branch != 'fix/duplicate-delivery':
        raise ValueError('Use the owned task branch')
    remote = git('ls-remote', 'origin', 'refs/heads/'+branch).split()
    return git('rev-parse', 'HEAD'), remote[0] if remote else None


def status(state):
    local, remote = head()
    check = state.get('check')
    return {'provider': 'LOCAL FIXTURE, not hosted GitHub',
            'pr': state.get('pr'), 'local_head': local, 'head': remote,
            'base': state['base'], 'required_check': check,
            'required_current': bool(check and check['head'] == remote),
            'optional_native': 'skipped by fixture policy',
            'responses': state['responses']}


def run(args):
    path, state = storage()
    if args.command == 'status':
        return status(state), 0
    if args.command == 'issue':
        return {'number': 7, 'state': 'open', 'assignment': None,
                'competing_prs': [], 'source': 'controlled local fixture',
                'body': (ROOT/'ISSUE.md').read_text()}, 0
    if args.command == 'reviews':
        cursor = args.cursor
        if cursor < 0 or cursor > len(state['reviews']):
            raise ValueError('Invalid review cursor')
        end = min(cursor+2, len(state['reviews']))
        return {'threads': state['reviews'][cursor:end],
                'hasNextPage': end < len(state['reviews']), 'endCursor': end}, 0
    if args.command == 'respond':
        if not state['pr'] or args.thread not in {r['id'] for r in state['reviews']}:
            raise ValueError('Unknown PR/thread')
        state['responses'][args.thread] = {'disposition': args.disposition,
                                          'evidence': args.evidence}
    elif args.command == 'open':
        local, remote = head()
        if local != remote or remote == state['base']:
            raise ValueError('Push an owned change before opening the fixture PR')
        state['pr'] = {'number': 1, 'state': 'OPEN', 'base_ref': 'main',
                       'head_ref': 'fix/duplicate-delivery'}
    elif args.command == 'ci':
        local, remote = head()
        if not state['pr'] or local != remote:
            raise ValueError('CI needs an open PR and the pushed local head')
        if git('status', '--porcelain', '--untracked-files=all', '--', 'src', 'tests', 'tools'):
            raise ValueError('Commit owned source/tests before recording CI for a SHA')
        result = subprocess.run([sys.executable, str(ROOT/'tools/check.py')],
                                cwd=ROOT, capture_output=True, text=True, timeout=30)
        try:
            report = json.loads(result.stdout.splitlines()[-1])
        except (ValueError, IndexError):
            report = {}
        success = (result.returncode == 0 and report.get('selected', 0) > 0
                   and report.get('success') is True
                   and report.get('skipped', 0) < report.get('selected', 0))
        state['check'] = {'head': remote, 'name': 'fixture-tests', 'required': True,
                          'conclusion': 'success' if success else 'failure',
                          'report': report}
        path.write_text(json.dumps(state, indent=2)+'\n')
        return {'check': state['check'], 'stdout': result.stdout,
                'stderr': result.stderr, 'exit_code': result.returncode}, 0 if success else 1
    path.write_text(json.dumps(state, indent=2)+'\n')
    return status(state), 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ['status', 'issue', 'open', 'ci']:
        sub.add_parser(name)
    reviews = sub.add_parser('reviews')
    reviews.add_argument('--cursor', type=int, default=0)
    response = sub.add_parser('respond')
    response.add_argument('--thread', required=True)
    response.add_argument('--disposition', required=True,
                          choices=['addressed', 'already-addressed', 'declined'])
    response.add_argument('--evidence', required=True)
    try:
        value, code = run(parser.parse_args())
        print(json.dumps(value, indent=2))
        return code
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(json.dumps({'error': str(error)}), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
