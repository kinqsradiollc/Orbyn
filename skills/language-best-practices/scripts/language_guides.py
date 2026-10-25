#!/usr/bin/env python3
"""Route supplied relative file names to local guides; no project reads or commands."""
import argparse
import json
from pathlib import Path, PurePosixPath

REGISTRY = Path(__file__).resolve().parents[1] / 'references/routes.json'


def route(paths):
    config = json.loads(REGISTRY.read_text(encoding='utf-8'))
    if config.get('schema_version') != 1:
        raise ValueError('Unsupported language routing schema')
    selected, ambiguous, unmatched = {}, [], []
    for raw in sorted(set(paths)):
        path = PurePosixPath(raw)
        if (not raw or '\x00' in raw or '\\' in raw or ':' in raw
                or path.is_absolute() or '..' in path.parts or not path.parts):
            raise ValueError('Use repository-relative file names without traversal')
        suffix = path.suffix
        if suffix in config['ambiguous_extensions']:
            ambiguous.append({'path': raw, 'candidates': config['ambiguous_extensions'][suffix]})
        elif suffix in config['extensions']:
            language = config['extensions'][suffix]
            selected.setdefault(language, []).append(raw)
        else:
            unmatched.append(raw)
    return {
        'schema_version': 1,
        'guides': [{'language': language, 'reference': config['guides'][language], 'paths': names}
                   for language, names in sorted(selected.items())],
        'ambiguous': ambiguous,
        'unmatched': unmatched,
        'limits': 'Names only; confirm actual language, target version and ownership before use.',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('paths', nargs='+', help='Repository-relative changed/owned paths')
    args = parser.parse_args()
    try:
        print(json.dumps(route(args.paths), indent=2))
    except ValueError as error:
        parser.error(str(error))


if __name__ == '__main__':
    main()
