#!/usr/bin/env python3
"""Create/check consumer-owned context pointers. Never execute commands or copy document content."""
import argparse
import json
from pathlib import Path, PurePosixPath

CONTEXT = '.agents/orbyn-context.json'
DOCUMENTS = {
    'instructions': ['AGENTS.md', 'CLAUDE.md'],
    'stack': ['docs/agents/stack.md', 'docs/architecture.md'],
    'development': ['docs/agents/development.md', 'CONTRIBUTING.md'],
    'verification': ['docs/agents/delivery.md'],
    'design': ['docs/agents/ui-ux.md'],
    'brand': ['docs/brand.md'],
}


def local_path(project, value, file_only=False):
    if not isinstance(value, str) or not value:
        raise ValueError('Context paths must be non-empty strings')
    path = PurePosixPath(value)
    if path.is_absolute() or '..' in path.parts or '\\' in value or ':' in value:
        raise ValueError(f'Expected a project-relative path: {value}')
    target = (project / value).resolve(strict=True)
    if not target.is_relative_to(project) or (file_only and not target.is_file()):
        raise ValueError(f'Context path leaves the project or has the wrong kind: {value}')
    return target


def context_path(project):
    for path in [project / '.agents', project / CONTEXT]:
        if path.is_symlink():
            raise ValueError('Refusing a symlinked context destination')
    return project / CONTEXT


def check(project):
    project = project.resolve(strict=True)
    data = json.loads(context_path(project).read_text())
    if (not isinstance(data, dict) or data.get('schema_version') != 1 or not isinstance(data.get('project_name'), str)
            or not data['project_name'].strip()):
        raise ValueError('Expected context schema 1 and a project name')
    if set(data) - {'schema_version', 'project_name', 'documents', 'owners'}:
        raise ValueError('Unknown context fields; commands and credentials do not belong here')
    for group in ['documents', 'owners']:
        values = data.get(group)
        if not isinstance(values, dict):
            raise ValueError(f'{group} must map names to existing project-relative paths')
        for name, value in values.items():
            if not isinstance(name, str) or not name.strip():
                raise ValueError('Context entries need a name')
            local_path(project, value, file_only=group == 'documents')
    return data


def initialize(project, name=None):
    project = project.resolve(strict=True)
    if not project.is_dir():
        raise ValueError('Project must be an existing directory')
    target = context_path(project)
    if target.exists():
        check(project)
        return False
    if name is not None and not name.strip():
        raise ValueError('Project name must not be blank')
    documents = {}
    for role, candidates in DOCUMENTS.items():
        for candidate in candidates:
            if (project / candidate).is_file():
                local_path(project, candidate, file_only=True)
                documents[role] = candidate
                break
    data = {'schema_version': 1, 'project_name': name or project.name,
            'documents': documents, 'owners': {}}
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('x') as stream:
        stream.write(json.dumps(data, indent=2) + '\n')
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['init', 'check'])
    parser.add_argument('--project', type=Path, required=True)
    parser.add_argument('--name')
    args = parser.parse_args()
    try:
        if args.command == 'init':
            created = initialize(args.project, args.name)
            print('Created context pointers; review owners and missing roles.' if created else 'Existing context preserved.')
        else:
            check(args.project)
            print('Context pointers resolve inside the project; content and authority are not inferred.')
    except (OSError, ValueError, TypeError) as error:
        parser.exit(1, f'Project context stopped: {error}\n')


if __name__ == '__main__':
    main()
