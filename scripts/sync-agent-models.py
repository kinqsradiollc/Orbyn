#!/usr/bin/env python3
"""Sync project model settings from docs/agents/models.json; no model invocation."""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import re
import sys
import tomllib

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/agents/models.json'


def set_toml(text, section, key, value):
    """Change only one owned key; preserve unrelated sections, comments and values."""
    before = tomllib.loads(text)
    expected = deepcopy(before)
    owner = expected
    for component in section.split('.') if section else []:
        owner = owner.setdefault(component, {})
        if not isinstance(owner, dict):
            raise ValueError(f'Expected TOML table for {section}')
    owner[key] = value
    encoded = json.dumps(value)
    headers = list(re.finditer(r'^\[[^\n]+\]\s*$', text, re.M))
    if section:
        header = next((m for m in headers if m.group().strip() == f'[{section}]'), None)
        if header is None:
            result = text.rstrip() + f'\n\n[{section}]\n{key} = {encoded}\n'
            return validate_toml_update(result, expected, section, key)
        start = header.end()
        end = next((m.start() for m in headers if m.start() > header.start()), len(text))
    else:
        start, end = 0, headers[0].start() if headers else len(text)
    body = text[start:end]
    pattern = rf'^{re.escape(key)}\s*=.*$'
    if re.search(pattern, body, re.M):
        body = re.sub(pattern, lambda _: f'{key} = {encoded}', body, flags=re.M)
    else:
        body = body.rstrip() + f'\n{key} = {encoded}\n\n'
    result = text[:start] + body + text[end:]
    return validate_toml_update(result, expected, section, key)


def validate_toml_update(text, expected, section, key):
    """Fail closed if textual replacement changes anything except the owned value."""
    if tomllib.loads(text) != expected:
        raise ValueError(f'Cannot safely update TOML {section or "root"}.{key}; unrelated values would change')
    return text


def yaml_metadata(value, key):
    """Emit stable plain YAML scalars, rejecting syntax requiring YAML quoting."""
    if (not isinstance(value, str) or value != value.strip()
            or not re.fullmatch(r'[A-Za-z][A-Za-z0-9 ,./()_-]*', value)
            or value.lower() in {'null', 'true', 'false', 'yes', 'no', 'y', 'n', 'on', 'off'}):
        raise ValueError(f'Unsupported Claude {key} metadata; use a plain text scalar without YAML punctuation or line breaks')
    return value


def require(condition, message):
    if not condition:
        raise ValueError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--write', action='store_true')
    args = parser.parse_args()
    data = json.loads(SOURCE.read_text())
    require(type(data['schema_version']) is int and data['schema_version'] == 1, 'Unsupported model registry version')
    agents, speed = data['agents'], data['processing']
    require(set(agents) == {'orbyn-agent', 'orbyn-light'}, 'Expected standard and light agents')
    expected_speed = {
        'codex_service_tier': 'default', 'codex_fast_mode': False,
        'codex_ultrafast_mode': False, 'claude_fast_mode': False,
        'claude_disable_fast_mode': '1',
    }
    require(speed == expected_speed and all(type(speed.get(key)) is type(value) for key, value in expected_speed.items()), 'Only standard processing is authorized')
    for host in ['codex', 'claude']:
        require(data['defaults'][host] in agents, f'Unknown default: {host}')
        for name, agent in agents.items():
            setting = agent[host]
            require(isinstance(setting['model'], str) and bool(setting['model'].strip()) and setting['effort'] in ['low', 'medium', 'high'], f'Invalid model/effort: {name}/{host}')
            require(not any(x in setting['model'].lower() for x in ['astra', 'fable', 'fast', 'priority']), f'Manual-only or accelerated automatic model: {name}/{host}')
            require(setting['model'] != data['human_only'][host]['model'], f'Human-only model in automatic tier: {name}')
    owned = [ROOT / '.codex/config.toml', ROOT / '.claude/settings.json', ROOT / 'docs/agents/model-policy.md']
    for name in agents:
        owned.extend([ROOT / f'.codex/agents/{name}.toml', ROOT / f'.claude/agents/{name}.md'])
    originals = {path: path.read_text() for path in owned}
    outputs = {}
    path = ROOT / '.codex/config.toml'
    text = originals[path]
    default = agents[data['defaults']['codex']]['codex']
    for key, value in [('model', default['model']), ('model_reasoning_effort', default['effort']), ('service_tier', speed['codex_service_tier'])]:
        text = set_toml(text, '', key, value)
    for key in ['fast_mode', 'ultrafast_mode']:
        text = set_toml(text, 'features', key, speed['codex_' + key])
    for name, agent in agents.items():
        text = set_toml(text, f'agents.{name}', 'description', agent['purpose'])
        text = set_toml(text, f'agents.{name}', 'config_file', f'agents/{name}.toml')
    tomllib.loads(text)
    outputs[path] = text
    for name, agent in agents.items():
        path = ROOT / f'.codex/agents/{name}.toml'
        text = originals[path]
        for key, value in [('name', name), ('description', agent['purpose']), ('model', agent['codex']['model']), ('model_reasoning_effort', agent['codex']['effort'])]:
            text = set_toml(text, '', key, value)
        tomllib.loads(text)
        outputs[path] = text
        path = ROOT / f'.claude/agents/{name}.md'
        text = originals[path]
        require(text.startswith('---\n'), f'Missing frontmatter: {path}')
        parts = text.split('---', 2)
        for key, value in [('name', name), ('description', agent['purpose']), ('model', agent['claude']['model']), ('effort', agent['claude']['effort'])]:
            pattern = rf'^{key}:.*$'
            require(re.search(pattern, parts[1], re.M), f'Missing {key}: {path}')
            encoded = yaml_metadata(value, key)
            parts[1] = re.sub(pattern, lambda _: f'{key}: {encoded}', parts[1], flags=re.M)
        outputs[path] = '---'.join(parts)
    path = ROOT / '.claude/settings.json'
    settings = json.loads(originals[path])
    default = agents[data['defaults']['claude']]['claude']
    settings.update(model=default['model'], effortLevel=default['effort'], fastMode=speed['claude_fast_mode'])
    settings.setdefault('env', {})['CLAUDE_CODE_DISABLE_FAST_MODE'] = speed['claude_disable_fast_mode']
    outputs[path] = json.dumps(settings, indent=2) + '\n'
    path = ROOT / 'docs/agents/model-policy.md'
    text = originals[path]
    rows = [['Agent / selection', 'OpenAI model / effort', 'Claude model / effort']]
    for name, agent in agents.items():
        a, b = agent['codex'], agent['claude']
        rows.append([f'`{name}`', f"`{a['model']}` / {a['effort']}", f"`{b['model']}` / {b['effort']}"])
    rows.append(['Explicit human selection only', f"`{data['human_only']['codex']['model']}` / human-selected effort", f"`{data['human_only']['claude']['model']}` / human-selected effort"])
    widths = [max(3, *(len(row[column]) for row in rows)) for column in range(3)]
    def table_row(row):
        return '| ' + ' | '.join(cell.ljust(width) for cell, width in zip(row, widths)) + ' |'
    table = ['<!-- agent-models:start -->', '', table_row(rows[0]), table_row(['-' * width for width in widths])]
    table.extend(table_row(row) for row in rows[1:])
    table.extend(['', '<!-- agent-models:end -->'])
    pattern = r'<!-- agent-models:start -->.*?<!-- agent-models:end -->'
    require(re.search(pattern, text, re.S), 'Missing generated routing table')
    outputs[path] = re.sub(pattern, lambda _: '\n'.join(table), text, flags=re.S)
    require(all(path.read_text() == original for path, original in originals.items()), 'Configuration changed during sync; retry after coordinating the writer')
    changed = [p for p, text in outputs.items() if originals[p] != text]
    if args.check and changed:
        for path in changed:
            print(f'Model configuration drift: {path.relative_to(ROOT)}', file=sys.stderr)
        print('Review docs/agents/models.json, then run python3 scripts/sync-agent-models.py --write', file=sys.stderr)
        return 1
    if args.write:
        for path in changed:
            path.write_text(outputs[path])
    print(f"OK: model registry {'synchronized' if args.write else 'matches'} both hosts ({len(changed)} changed files).")
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (AssertionError, KeyError, ValueError) as error:
        print(f'Invalid model registry/configuration: {error}', file=sys.stderr)
        sys.exit(1)
