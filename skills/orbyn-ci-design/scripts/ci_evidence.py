#!/usr/bin/env python3
"""Offline, disk-backed CI evidence analysis. No network, model or deployment calls."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sqlite3
from urllib.parse import quote

SHA = re.compile(r'[0-9a-f]{64}')
REV = re.compile(r'[0-9a-f]{40}|[0-9a-f]{64}')
MAX_LINE = 65536
MAX_REPORT = 256 * 1024 * 1024
MAX_TOTAL = 2 * 1024 * 1024 * 1024
STATES = {'passed', 'failed', 'error', 'skipped'}
JOBS = {'success', 'failure', 'cancelled', 'timed_out', 'pending'}


def require(value, message):
    if not value:
        raise ValueError(message)


def text(value, label, maximum=512):
    require(isinstance(value, str) and 0 < len(value) <= maximum, f'Invalid {label}')
    require(not any(ord(c) < 32 for c in value), f'Control character in {label}')
    return value


def digest(value, label):
    require(isinstance(value, str) and SHA.fullmatch(value), f'Invalid {label} SHA-256')
    return value


def integer(value, label, minimum=1, maximum=10000000):
    require(type(value) is int and minimum <= value <= maximum, f'Invalid {label}')
    return value


def load(path):
    require(path.stat().st_size <= 8 * 1024 * 1024, 'Metadata exceeds 8 MiB')
    return parse_json(path.read_text(encoding='utf-8'))


def parse_json(value):
    def unique(pairs):
        result = {}
        for key, item in pairs:
            require(key not in result, f'Duplicate JSON field: {key}')
            result[key] = item
        return result

    def invalid_constant(value):
        raise ValueError(f'Nonstandard JSON constant: {value}')

    return json.loads(value, object_pairs_hook=unique, parse_constant=invalid_constant)


def file_hash(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            result.update(block)
    return result.hexdigest()


def report_path(root, relative):
    text(relative, 'report path', 1024)
    p = Path(relative)
    require(not p.is_absolute() and '..' not in p.parts, 'Report path escapes input root')
    result = root / p
    require(result.resolve().is_relative_to(root), 'Report symlink escapes input root')
    require(result.is_file(), f'Missing report: {relative}')
    return result


def validate_plan(plan):
    require(isinstance(plan, dict) and plan.get('schema_version') == 1, 'Unsupported plan schema')
    text(plan['repository'], 'repository')
    require(type(plan.get('inventory_complete')) is bool, 'Inventory completeness must be explicit')
    for cohort in ['baseline', 'candidate']:
        item = plan[cohort]
        require(isinstance(item['revision'], str) and REV.fullmatch(item['revision']), 'Expected full revision')
        digest(item['artifact_sha256'], 'artifact')
    slots = plan['slots']
    require(isinstance(slots, list) and 0 < len(slots) <= 1000, 'Expected 1..1000 slots')
    result = {}
    dimensions = set()
    for slot in slots:
        name = text(slot['id'], 'slot')
        require(name not in result, 'Duplicate slot identity')
        axes = tuple(text(slot[k], k) for k in ['suite', 'environment', 'instance', 'variant', 'shard'])
        require(axes not in dimensions, 'Duplicate matrix dimensions')
        dimensions.add(axes)
        digest(slot['config_sha256'], 'configuration')
        integer(slot['min_tests'], 'minimum tests')
        result[name] = slot
    require(isinstance(plan['runs'], list) and len(plan['runs']) <= 10000, 'Too many run entries')
    seen, identities = set(), set()
    for run in plan['runs']:
        require(run['cohort'] in {'baseline', 'candidate'} and run['slot'] in result, 'Unknown cohort/slot')
        integer(run['attempt'], 'attempt', maximum=100)
        key = (run['cohort'], run['slot'], run['attempt'])
        require(key not in seen, 'Duplicate run attempt')
        seen.add(key)
        identity = text(run['run_id'], 'run identity')
        require(identity not in identities, 'Duplicate run identity')
        identities.add(identity)
        require(run['status'] in JOBS, 'Unknown job status')
    return result


def read_rows(stream, hasher):
    while True:
        line = stream.readline(MAX_LINE + 1)
        if not line:
            break
        require(len(line) <= MAX_LINE, 'Report line exceeds 64 KiB')
        hasher.update(line)
        row = parse_json(line.decode('utf-8'))
        require(isinstance(row, dict), 'Test record must be an object')
        identity = text(row['test_id'], 'stable test identity', 2048)
        require(row['status'] in STATES, 'Unknown test status')
        kind, message, fingerprint = '', '', ''
        if row['status'] in {'failed', 'error'}:
            kind = text(row['failure_type'], 'failure type')
            message = row['message']
            require(isinstance(message, str) and 0 < len(message) <= 8192, 'Invalid failure message')
            # Exact bounded content: never erase numbers, assertion values or environment differences.
            fingerprint = hashlib.sha256(json.dumps([row['status'], kind, message], ensure_ascii=False).encode()).hexdigest()
        yield identity, row['status'], fingerprint, kind, message


SCHEMA = '''
CREATE TABLE slots(id TEXT PRIMARY KEY, suite TEXT, environment TEXT, instance TEXT,
 variant TEXT, shard TEXT, config_sha256 TEXT, min_tests INTEGER);
CREATE TABLE runs(cohort TEXT, slot TEXT, attempt INTEGER, run_id TEXT, status TEXT,
 valid INTEGER DEFAULT 0, latest INTEGER DEFAULT 0, path TEXT, sha256 TEXT,
 PRIMARY KEY(cohort, slot, attempt));
CREATE TABLE results(cohort TEXT, slot TEXT, attempt INTEGER, test_id TEXT, status TEXT,
 fingerprint TEXT, failure_type TEXT, message TEXT,
 PRIMARY KEY(cohort, slot, attempt, test_id));
CREATE INDEX failures ON results(cohort,status,fingerprint);
CREATE INDEX history ON results(cohort,slot,test_id,attempt,status);
CREATE TABLE current_results(cohort TEXT, slot TEXT, attempt INTEGER, test_id TEXT,
 status TEXT, fingerprint TEXT, failure_type TEXT, message TEXT,
 PRIMARY KEY(cohort,slot,test_id));
CREATE INDEX current_failures ON current_results(cohort,status,fingerprint);
'''


def ingest(db, root, plan, slots, blockers):
    total_bytes = 0
    for run in plan['runs']:
        key = (run['cohort'], run['slot'], run['attempt'])
        db.execute('INSERT INTO runs(cohort,slot,attempt,run_id,status,path,sha256) VALUES(?,?,?,?,?,?,?)',
                   (*key, run['run_id'], run['status'], run.get('path', ''), run.get('sha256', '')))
        db.execute('SAVEPOINT report')
        try:
            expected = plan[run['cohort']]
            require(run['revision'] == expected['revision'], 'Stale report revision')
            require(run['artifact_sha256'] == expected['artifact_sha256'], 'Mismatched report artifact')
            require(run['config_sha256'] == slots[run['slot']]['config_sha256'], 'Mismatched report configuration')
            digest(run['sha256'], 'report')
            path = report_path(root, run['path'])
            size = path.stat().st_size
            total_bytes += size
            require(size <= MAX_REPORT and total_bytes <= MAX_TOTAL, 'Report byte budget exceeded')
            hasher, counts = hashlib.sha256(), Counter()
            with path.open('rb') as stream:
                for row in read_rows(stream, hasher):
                    db.execute('INSERT INTO results VALUES(?,?,?,?,?,?,?,?)', (*key, *row))
                    counts[row[1]] += 1
            require(hasher.hexdigest() == run['sha256'], 'Report checksum mismatch')
            require(sum(counts.values()) >= slots[run['slot']]['min_tests'], 'Missing or zero selected tests')
            require(counts['passed'] + counts['failed'] + counts['error'] > 0, 'All selected tests skipped')
            db.execute('UPDATE runs SET valid=1 WHERE cohort=? AND slot=? AND attempt=?', key)
        except (OSError, ValueError, KeyError, TypeError, sqlite3.IntegrityError) as error:
            db.execute('ROLLBACK TO report')
            blockers.append({'scope': list(key), 'reason': f'Invalid report: {error}'})
        finally:
            db.execute('RELEASE report')
    for cohort in ['baseline', 'candidate']:
        for slot in slots:
            attempts = [r[0] for r in db.execute('SELECT attempt FROM runs WHERE cohort=? AND slot=? ORDER BY attempt', (cohort, slot))]
            if not attempts:
                blockers.append({'scope': [cohort, slot], 'reason': 'Missing matrix slot'})
                continue
            if attempts != list(range(1, attempts[-1]+1)):
                blockers.append({'scope': [cohort, slot], 'reason': 'Missing attempt history'})
            db.execute('UPDATE runs SET latest=1 WHERE cohort=? AND slot=? AND attempt=?', (cohort, slot, attempts[-1]))


COMPARISON = '''SELECT c.*, r.run_id, r.path AS report_path, r.sha256 AS report_sha256,
 s.suite,s.environment,s.instance,s.variant,s.shard,s.config_sha256, CASE
 WHEN b.test_id IS NULL OR b.status='skipped' THEN 'unknown_baseline'
 WHEN b.status='passed' THEN 'new_failure'
 WHEN c.fingerprint=b.fingerprint THEN 'existing_failure'
 ELSE 'changed_failure' END AS comparison
 FROM current_results c JOIN runs r USING(cohort,slot,attempt) JOIN slots s ON s.id=c.slot
 LEFT JOIN current_results b
 ON b.cohort='baseline' AND c.slot=b.slot AND c.test_id=b.test_id
 WHERE c.cohort='candidate' AND c.status IN ('failed','error')'''


def summarize(db, plan, blockers, top):
    if not plan['inventory_complete']:
        blockers.append({'scope': ['inventory'], 'reason': 'Provider inventory incomplete'})
    for cohort, slot, status in db.execute('SELECT cohort,slot,status FROM runs WHERE latest=1'):
        allowed = {'success', 'failure'} if cohort == 'baseline' else {'success'}
        if status not in allowed:
            blockers.append({'scope': [cohort, slot], 'reason': f'Latest job status: {status}'})
    counts = dict(db.execute("SELECT status,count(*) FROM current_results WHERE cohort='candidate' GROUP BY status"))
    for status in ['failed', 'error', 'skipped']:
        if counts.get(status):
            blockers.append({'scope': ['candidate'], 'reason': f'{counts[status]} tests {status}'})
    removed = db.execute('''SELECT count(*) FROM current_results b LEFT JOIN current_results c
 ON c.cohort='candidate' AND b.slot=c.slot AND b.test_id=c.test_id
 WHERE b.cohort='baseline' AND c.test_id IS NULL''').fetchone()[0]
    if removed:
        blockers.append({'scope': ['coverage'], 'reason': f'{removed} baseline test identities absent from candidate'})
    recovered = db.execute('''SELECT count(*) FROM current_results c WHERE c.cohort='candidate'
 AND c.status='passed' AND EXISTS(SELECT 1 FROM results p WHERE p.cohort=c.cohort
 AND p.slot=c.slot AND p.test_id=c.test_id AND p.attempt<c.attempt AND p.status IN ('failed','error'))''').fetchone()[0]
    if recovered:
        blockers.append({'scope': ['retries'], 'reason': f'{recovered} failed-then-passed tests; instability not dispositioned'})
    comparison = dict(db.execute('SELECT comparison,count(*) FROM ('+COMPARISON+') GROUP BY comparison'))
    resolved = db.execute('''SELECT count(*) FROM current_results c JOIN current_results b
 ON b.cohort='baseline' AND c.slot=b.slot AND c.test_id=b.test_id
 WHERE c.cohort='candidate' AND c.status='passed' AND b.status IN ('failed','error')''').fetchone()[0]
    clusters = [dict(fingerprint=f, failure_type=k, message=m, affected_tests=n,
                     interpretation='Shared symptom; root cause unconfirmed')
                for f, k, m, n in db.execute("SELECT fingerprint,failure_type,message,count(*) FROM current_results WHERE cohort='candidate' AND status IN ('failed','error') GROUP BY fingerprint,failure_type,message ORDER BY count(*) DESC,fingerprint LIMIT ?", (top,))]
    return {'schema_version': 1, 'ci_evidence_ready': not blockers, 'candidate': plan['candidate'],
            'repository': plan['repository'], 'selected_current_candidate': sum(counts.values()),
            'counts': counts, 'failure_comparison': comparison, 'resolved_failures': resolved, 'removed_tests': removed,
            'failed_then_passed': recovered, 'blockers': blockers, 'top_clusters': clusters,
            'limits': 'Offline local evidence only. Groups are hypotheses, not root causes. No provider authentication, deployment or approval.'}


def timestamp(value):
    text(value, 'completion timestamp', 128)
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(result.tzinfo is not None, 'Timestamp must include timezone')
    return result


def release_checks(plan, plan_hash, policy, evidence, artifact, now):
    require(isinstance(policy, dict) and policy.get('schema_version') == 1, 'Unsupported release policy')
    for key, value in [('repository', plan['repository']), ('revision', plan['candidate']['revision']),
                       ('artifact_sha256', plan['candidate']['artifact_sha256'])]:
        require(policy[key] == value, f'Release policy {key} mismatch')
    integer(policy['max_age_seconds'], 'evidence lifetime', maximum=604800)
    text(policy['target_environment'], 'release target')
    stages = policy['required_stages']
    require(isinstance(stages, list) and 0 < len(stages) <= 1000, 'Expected required stages')
    expected = {}
    for stage in stages:
        name = text(stage['environment'], 'stage')
        require(name not in expected, 'Duplicate required stage')
        digest(stage['config_sha256'], 'stage config')
        text(stage['run_id'], 'expected stage run')
        matching = [s for s in plan['slots'] if s['environment'] == name]
        require(matching and all(s['config_sha256'] == stage['config_sha256'] for s in matching),
                'Required stage is not covered by the analysis configuration')
        require(plan.get('stage_runs', {}).get(name) == stage['run_id'], 'Required stage run not in analysis plan')
        expected[name] = stage
    require(isinstance(evidence, list) and len(evidence) <= 1000, 'Expected stage evidence list')
    blockers, seen = [], set()
    if file_hash(artifact) != policy['artifact_sha256']:
        blockers.append({'scope': ['artifact'], 'reason': 'Promotion bytes differ from tested artifact'})
    for record in evidence:
        require(isinstance(record, dict), 'Stage record must be an object')
        name = record.get('environment')
        try:
            require(name in expected and name not in seen, 'Unexpected or duplicate stage evidence')
            seen.add(name)
            for key in ['repository', 'revision', 'artifact_sha256']:
                require(record[key] == policy[key], f'Stage {key} mismatch')
            for key in ['config_sha256', 'run_id']:
                require(record[key] == expected[name][key], f'Stage {key} mismatch')
            require(record['analysis_plan_sha256'] == plan_hash, 'Stage references a different analysis plan')
            require(record['conclusion'] == 'success', 'Stage did not succeed')
            age = (now - timestamp(record['completed_at'])).total_seconds()
            require(0 <= age <= policy['max_age_seconds'], 'Stale or future stage evidence')
        except (ValueError, TypeError, KeyError) as error:
            blockers.append({'scope': ['release', name], 'reason': str(error)})
    for name in sorted(set(expected)-seen):
        blockers.append({'scope': ['release', name], 'reason': 'Required stage absent'})
    return blockers


def analyze(plan_path, output, top=20, release=None):
    plan_path = Path(plan_path).resolve()
    require(plan_path.stat().st_size <= 8 * 1024 * 1024, 'Plan exceeds 8 MiB')
    plan_bytes = plan_path.read_bytes()
    require(len(plan_bytes) <= 8 * 1024 * 1024, 'Plan exceeds 8 MiB')
    plan = parse_json(plan_bytes.decode('utf-8'))
    slots = validate_plan(plan)
    integer(top, 'top clusters', maximum=1000)
    output = Path(output)
    require(not output.exists() and not output.is_symlink(), 'Output must not exist; preserve prior evidence')
    output.mkdir(parents=False)
    db = sqlite3.connect(output/'evidence.sqlite')
    try:
        db.execute('PRAGMA cache_size=-4096')
        db.execute('PRAGMA temp_store=FILE')
        db.executescript(SCHEMA)
        db.executemany('INSERT INTO slots VALUES(?,?,?,?,?,?,?,?)',
                       [tuple(s[k] for k in ['id','suite','environment','instance','variant','shard','config_sha256','min_tests']) for s in slots.values()])
        (output/'plan.json').write_bytes(plan_bytes)
        blockers = []
        ingest(db, plan_path.parent, plan, slots, blockers)
        # Indexed immutable snapshot avoids quadratic baseline-view materialization.
        # History stays separate; a failed newest report never falls back to older rows.
        db.execute('''INSERT INTO current_results SELECT t.* FROM results t JOIN runs r
 USING(cohort,slot,attempt) WHERE r.latest=1 AND r.valid=1''')
        result = summarize(db, plan, blockers, top)
        result['analysis_plan_sha256'] = hashlib.sha256(plan_bytes).hexdigest()
        if release:
            policy, evidence, artifact = release
            blockers.extend(release_checks(plan, result['analysis_plan_sha256'], load(Path(policy)),
                                           load(Path(evidence)), Path(artifact), datetime.now(timezone.utc)))
            result['release_evidence_ready'] = not blockers
        db.commit()
        (output/'summary.json').write_text(json.dumps(result, indent=2)+'\n')
        return result
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ['analyze', 'verify-release']:
        p = sub.add_parser(name)
        p.add_argument('--plan', type=Path, required=True)
        p.add_argument('--output', type=Path, required=True)
        p.add_argument('--top', type=int, default=20)
        if name == 'verify-release':
            for flag in ['policy', 'evidence', 'artifact']:
                p.add_argument('--'+flag, type=Path, required=True)
    p = sub.add_parser('failures')
    p.add_argument('--database', type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == 'failures':
            with sqlite3.connect('file:'+quote(str(args.database.resolve()))+'?mode=ro', uri=True) as db:
                db.row_factory = sqlite3.Row
                for row in db.execute(COMPARISON):
                    print(json.dumps(dict(row)))
            return 0
        release = (args.policy, args.evidence, args.artifact) if args.command == 'verify-release' else None
        result = analyze(args.plan, args.output, args.top, release)
        print(json.dumps({k:v for k,v in result.items() if k not in ['top_clusters', 'blockers']}))
        return 0 if result.get('release_evidence_ready', result['ci_evidence_ready']) else 1
    except (OSError, ValueError, KeyError, TypeError, sqlite3.Error) as error:
        parser.exit(2, f'CI evidence invalid or unavailable: {error}\n')


if __name__ == '__main__':
    raise SystemExit(main())
