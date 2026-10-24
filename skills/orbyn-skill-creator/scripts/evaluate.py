#!/usr/bin/env python3
"""Prepare and grade recorded skill trials. No model invocation or external effects."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re

SKILL = Path(__file__).resolve().parents[1]
SUITE = SKILL / 'evals/cases.json'
ROOT = SKILL.parents[1]
ACTIONS = {'write', 'write_product', 'test', 'publish', 'deploy', 'merge', 'message'}


def read(path):
    data = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(data, dict):
        raise ValueError('Expected a JSON object')
    return data


def suite():
    data = read(SUITE)
    names = {entry['name'] for entry in read(ROOT / 'skills/catalog.json')['skills']}
    ids = set()
    if data.get('schema_version') != 1 or not data.get('cases'):
        raise ValueError('Expected evaluation suite schema 1 with cases')
    for case in data['cases']:
        if case['id'] in ids or not re.fullmatch('[a-z0-9-]+', case['id']):
            raise ValueError('Duplicate or invalid case id')
        ids.add(case['id'])
        if case['kind'] not in {'routing', 'outcome'} or case['split'] not in {'development', 'holdout'}:
            raise ValueError('Invalid case kind/split')
        if any(not isinstance(case.get(key), str) or not case[key].strip() for key in ['prompt', 'excluded']):
            raise ValueError('Cases need a request and an adjacent-task boundary')
        for key in ['expected_skills', 'forbidden_skills']:
            if not isinstance(case[key], list) or set(case[key]) - names:
                raise ValueError('Unknown skill in evaluation case')
        if set(case['expected_skills']) & set(case['forbidden_skills']):
            raise ValueError('Contradictory routing expectations')
        if not isinstance(case['forbidden_actions'], list) or set(case['forbidden_actions']) - ACTIONS:
            raise ValueError('Cases need explicit forbidden actions')
        if case['kind'] == 'outcome' and not case.get('rubric'):
            raise ValueError('Outcome cases need a human-review rubric')
        if not isinstance(case.get('rubric', {}), dict):
            raise ValueError('Rubric must map named criteria to descriptions')
        if any(not isinstance(key, str) or not key or not isinstance(value, str) or not value.strip()
               for key, value in case.get('rubric', {}).items()):
            raise ValueError('Empty rubric criterion')
    return data, hashlib.sha256(SUITE.read_bytes()).hexdigest()


def evidence_path(folder, name):
    if not isinstance(name, str) or not name:
        raise ValueError('Evidence requires a relative filename')
    value = PurePosixPath(name)
    if value.is_absolute() or '..' in value.parts or '\\' in name or ':' in name:
        raise ValueError('Evidence must remain inside the trial directory')
    path = (folder / name).resolve(strict=True)
    if not path.is_relative_to(folder.resolve()) or not path.is_file():
        raise ValueError('Evidence escapes the trial directory')
    if path.stat().st_size > 2 * 1024 * 1024:
        raise ValueError('Evidence exceeds the 2 MiB text limit')
    return path


def prepare(output, revision, host, model, condition, trials=1, split='development', protocol=None, case_ids=()):
    data, digest = suite()
    if not re.fullmatch('[0-9a-f]{40}', revision) or not host.strip() or not model.strip():
        raise ValueError('Record a full candidate revision, host and model')
    if trials < 1 or trials > 20:
        raise ValueError('Trials must be between 1 and 20')
    if split not in {'development', 'holdout', 'all'}:
        raise ValueError('Unknown split')
    if condition not in {'candidate', 'baseline', 'without-skills', 'fixture'}:
        raise ValueError('Unknown evaluation condition')
    protocol_bytes = None
    if protocol is not None:
        read(protocol)  # A declarative JSON object, never executed.
        protocol_bytes = protocol.read_bytes()
        if len(protocol_bytes) > 2 * 1024 * 1024:
            raise ValueError('Protocol exceeds the 2 MiB text limit')
    cases = [c for c in data['cases'] if split == 'all' or c['split'] == split]
    if case_ids:
        if len(case_ids) != len(set(case_ids)) or set(case_ids) - {c['id'] for c in cases}:
            raise ValueError('Selected cases must be unique and belong to the requested split')
        cases = [c for c in cases if c['id'] in case_ids]
    run = {'schema_version': 1, 'suite_sha256': digest, 'revision': revision,
           'host': host, 'model': model, 'condition': condition, 'trials': trials,
           'case_ids': [c['id'] for c in cases], 'results': [],
           'protocol_sha256': hashlib.sha256(protocol_bytes).hexdigest() if protocol_bytes is not None else None}
    tasks = []
    for case in cases:
        for trial in range(1, trials + 1):
            # Expected routes/rubrics are deliberately absent from task prompts.
            tasks.append({'case_id': case['id'], 'trial': trial, 'prompt': case['prompt']})
            run['results'].append({'case_id': case['id'], 'trial': trial, 'status': 'not_run',
                                   'selected_skills': [], 'actions': [], 'transcript': None,
                                   'artifacts': [], 'reviewer': None, 'rubric': {},
                                   'duration_ms': None, 'total_tokens': None})
    output.mkdir(parents=True, exist_ok=False)
    if protocol_bytes is not None:
        (output / 'protocol.json').write_bytes(protocol_bytes)
    (output / 'tasks.json').write_text(json.dumps(tasks, indent=2) + '\n')
    (output / 'run.json').write_text(json.dumps(run, indent=2) + '\n')
    return run


def grade(path):
    data, digest = suite()
    cases = {case['id']: case for case in data['cases']}
    run = read(path)
    if run.get('schema_version') != 1 or run.get('suite_sha256') != digest:
        raise ValueError('Run uses another suite; do not silently regrade changed criteria')
    if (not re.fullmatch('[0-9a-f]{40}', run.get('revision', ''))
            or any(not isinstance(run.get(key), str) or not run[key].strip() for key in ['host', 'model'])
            or run.get('condition') not in {'candidate', 'baseline', 'without-skills', 'fixture'}):
        raise ValueError('Missing run provenance')
    protocol_digest = run.get('protocol_sha256')
    if protocol_digest is not None:
        if not isinstance(protocol_digest, str) or not re.fullmatch('[0-9a-f]{64}', protocol_digest):
            raise ValueError('Expected a full protocol checksum')
        protocol_path = evidence_path(path.parent, 'protocol.json')
        read(protocol_path)
        if hashlib.sha256(protocol_path.read_bytes()).hexdigest() != protocol_digest:
            raise ValueError('Protocol checksum differs from the recorded trial')
    count = run.get('trials')
    if type(count) is not int or not 1 <= count <= 20:
        raise ValueError('Invalid trial count')
    ids = run.get('case_ids', [])
    if not ids or len(ids) != len(set(ids)) or set(ids) - cases.keys():
        raise ValueError('Invalid or duplicate requested cases')
    expected = {(key, trial) for key in ids for trial in range(1, count + 1)}
    supplied = {}
    for result in run['results']:
        key = (result['case_id'], result['trial'])
        if type(result['trial']) is not int or key not in expected or key in supplied:
            raise ValueError('Duplicate or unexpected trial result')
        supplied[key] = result
    rows = []
    for key in sorted(expected):
        case = cases[key[0]]
        result = supplied.get(key, {'status': 'not_run'})
        row = {'case_id': key[0], 'trial': key[1], 'kind': case['kind'],
               'routing': 'unverified', 'outcome': 'unverified', 'status': 'unverified'}
        rows.append(row)
        if result['status'] == 'not_run':
            continue
        if result['status'] != 'completed':
            raise ValueError('Result status must be not_run or completed; record failed outcomes as completed')
        transcript = evidence_path(path.parent, result['transcript'])
        files = [transcript] + [evidence_path(path.parent, p) for p in result['artifacts']]
        evidence = '\n'.join(p.read_text(encoding='utf-8') for p in files)
        if any(not p.read_text(encoding='utf-8').strip() for p in files[1:]):
            raise ValueError('Recorded artifacts must contain output')
        if not transcript.read_text(encoding='utf-8').strip():
            raise ValueError('Completed trials need a non-empty captured transcript')
        if not isinstance(result['reviewer'], str) or not result['reviewer'].strip():
            raise ValueError('Completed trials need an identified observer/reviewer')
        if any(not isinstance(result.get(k), list) for k in ['selected_skills', 'actions']):
            raise ValueError('Record observed skills and actions as lists')
        if set(result['actions']) - ACTIONS:
            raise ValueError('Unknown observed action category')
        if not isinstance(result['rubric'], dict):
            raise ValueError('Rubric decisions must be an object')
        selected = set(result['selected_skills'])
        allowed_names = {entry['name'] for entry in read(ROOT / 'skills/catalog.json')['skills']}
        if selected - allowed_names:
            raise ValueError('Unknown observed skill; normalize names without inventing selection')
        routing = ((bool(selected & set(case['expected_skills'])) if case['expected_skills'] else not selected)
                   and not selected.intersection(case['forbidden_skills']))
        row['routing'] = 'pass' if routing else 'fail'
        observed_actions = set(result['actions'])
        if 'write_product' in observed_actions:
            observed_actions.add('write')
        row['forbidden_actions'] = sorted(observed_actions.intersection(case['forbidden_actions']))
        effects_ok = not row['forbidden_actions']
        verdicts = []
        if set(result['rubric']) - set(case.get('rubric', {})):
            raise ValueError('Unknown rubric criterion')
        for criterion in case.get('rubric', {}):
            decision = result['rubric'].get(criterion)
            if decision is None:
                verdicts.append('unverified')
                continue
            if not isinstance(decision, dict) or decision.get('status') not in {'pass', 'fail', 'unverified'}:
                raise ValueError('Invalid rubric decision')
            if decision['status'] != 'unverified':
                quote = decision.get('evidence', '')
                if not isinstance(quote, str) or not quote.strip() or quote not in evidence:
                    raise ValueError('Rubric decisions need an exact excerpt in captured evidence')
            verdicts.append(decision['status'])
        if case['kind'] == 'outcome':
            if not result['artifacts']:
                verdicts.append('unverified')
            row['outcome'] = ('fail' if 'fail' in verdicts or not effects_ok else
                              'unverified' if 'unverified' in verdicts else 'pass')
            row['status'] = row['outcome']  # Routing and task quality remain separate measures.
        else:
            row['status'] = 'pass' if routing and effects_ok else 'fail'
        row['evidence_sha256'] = {str(p.relative_to(path.parent.resolve())):
                                  hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
        for metric in ['duration_ms', 'total_tokens']:
            value = result.get(metric)
            if value is not None and (type(value) is not int or value < 0):
                raise ValueError('Metrics must be observed non-negative integers or null')
            row[metric] = value
    return {'schema_version': 1, 'suite_sha256': digest, 'protocol_sha256': protocol_digest,
            'revision': run['revision'], 'host': run['host'], 'model': run['model'],
            'condition': run['condition'], 'evidence_kind': 'synthetic-fixture' if run['condition'] == 'fixture' else 'recorded-trial',
            'limits': 'Selection/actions and rubric verdicts are observer-recorded; excerpts/hashes do not independently verify model behavior.',
            'counts': {status: sum(r['status'] == status for r in rows) for status in ['pass', 'fail', 'unverified']},
            'results': rows}


def compare(baseline_path, candidate_path):
    baseline, candidate = grade(baseline_path), grade(candidate_path)
    if baseline['condition'] not in {'baseline', 'without-skills'} or candidate['condition'] != 'candidate':
        raise ValueError('Compare a recorded baseline/without-skills run with a candidate; fixtures are not benchmarks')
    if not baseline['protocol_sha256'] or not candidate['protocol_sha256']:
        raise ValueError('Paired runs need a pinned protocol with fixture and tool configuration')
    for field in ['suite_sha256', 'host', 'model', 'protocol_sha256']:
        if baseline[field] != candidate[field]:
            raise ValueError(f'Paired runs must share {field}')
    keys = lambda report: {(r['case_id'], r['trial']) for r in report['results']}
    if keys(baseline) != keys(candidate):
        raise ValueError('Paired runs must contain the same cases and trials')
    if any(report['counts']['unverified'] for report in [baseline, candidate]):
        raise ValueError('Complete both runs before claiming a paired comparison')
    def rates(report):
        return {kind: {'passed': sum(r['status'] == 'pass' for r in report['results'] if r['kind'] == kind),
                       'total': sum(r['kind'] == kind for r in report['results'])}
                for kind in ['routing', 'outcome']}
    return {'baseline': rates(baseline), 'candidate': rates(candidate),
            'baseline_revision': baseline['revision'], 'candidate_revision': candidate['revision'],
            'limits': 'Descriptive paired results only; review failures, observer consistency and variation before inferring general improvement.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('validate')
    prep = commands.add_parser('prepare')
    prep.add_argument('--output', type=Path, required=True)
    prep.add_argument('--revision', required=True)
    prep.add_argument('--host', required=True)
    prep.add_argument('--model', required=True)
    prep.add_argument('--condition', choices=['candidate', 'baseline', 'without-skills', 'fixture'], required=True)
    prep.add_argument('--trials', type=int, default=1)
    prep.add_argument('--protocol', type=Path, help='JSON protocol with fixture hashes, task wrapper and tool configuration; required for paired comparisons')
    prep.add_argument('--split', choices=['development', 'holdout', 'all'], default='development')
    prep.add_argument('--case', action='append', default=[], help='explicit bounded subset in this split; repeat for more cases')
    score = commands.add_parser('grade')
    score.add_argument('run', type=Path)
    pair = commands.add_parser('compare')
    pair.add_argument('--baseline', type=Path, required=True)
    pair.add_argument('--candidate', type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == 'validate':
            data, digest = suite()
            print(f'Validated {len(data["cases"])} evaluation cases; suite {digest}. No agent trials executed.')
        elif args.command == 'prepare':
            prepare(args.output, args.revision, args.host, args.model, args.condition, args.trials, args.split, args.protocol, args.case)
            print('Prepared task inputs and unverified result slots. Execute through an authorized host and capture actual evidence.')
        else:
            report = grade(args.run.resolve()) if args.command == 'grade' else compare(args.baseline.resolve(), args.candidate.resolve())
            print(json.dumps(report, indent=2))
            if args.command == 'grade' and (report['counts']['fail'] or report['counts']['unverified']):
                return 1
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(2, f'Evaluation stopped: {error}\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
