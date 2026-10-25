#!/usr/bin/env python3
"""Disposable multi-suite CI exercise and synthetic scale generator. No hosted effects."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys

GOOD = '''def total(price, discount):
    return max(0, price * (100-discount) // 100)
'''
BASELINE = GOOD.replace('    return', '    if price == 42:\n        return -1\n    return')
BROKEN = BASELINE.replace('max(0, price * (100-discount) // 100)', 'price * (100-discount) // 100')
RUNNER = '''import argparse, json, unittest
from product import total
p=argparse.ArgumentParser()
p.add_argument('--suite');p.add_argument('--count', type=int);p.add_argument('--output')
p.add_argument('--service-ready', choices=['yes','no'])
a=p.parse_args()
inputs=[(42,0,42),(-100,20,0),(100,20,80),(200,50,100),(0,50,0)]
class Case(unittest.TestCase):
    def runTest(self):
        if a.suite=='integration' and a.service_ready=='no':
            raise ConnectionError('Fixture dependency is unavailable')
        price, discount, expected=inputs[self.number % len(inputs)]
        self.assertEqual(total(price,discount),expected)
class Result(unittest.TestResult):
    def addFailure(self,test,err):
        super().addFailure(test,err);self.detail=(err[0].__name__,str(err[1]))
    def addError(self,test,err):
        super().addError(test,err);self.detail=(err[0].__name__,str(err[1]))
counts={}
with open(a.output,'x',encoding='utf-8') as stream:
    for i in range(a.count):
        case=Case();case.number=i;result=Result();case.run(result)
        status='error' if result.errors else 'failed' if result.failures else 'passed'
        row={'test_id':a.suite+'/test_%06d'%i,'status':status}
        if status!='passed':row.update(failure_type=result.detail[0],message=result.detail[1])
        stream.write(json.dumps(row)+'\\n');counts[status]=counts.get(status,0)+1
print(json.dumps({'selected':a.count,'counts':counts}))
raise SystemExit(1 if counts.get('failed') or counts.get('error') else 0)
'''


def sha(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            result.update(block)
    return result.hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, indent=2)+'\n')


def fresh(root):
    root = Path(root).absolute()
    if root.exists() or root.is_symlink() or root.parent.resolve() != root.parent or not root.parent.is_dir():
        raise ValueError('Use a nonexistent destination under an existing physical parent')
    root.mkdir()
    return root


def git(project, *args):
    return subprocess.check_output(['git', '-C', str(project), *args], text=True, stderr=subprocess.STDOUT).strip()


def create(root, tests_per_suite=100):
    if type(tests_per_suite) is not int or not 5 <= tests_per_suite <= 100000:
        raise ValueError('Expected 5..100000 tests per suite')
    root = fresh(root)
    project = root/'project'
    project.mkdir()
    (project/'runner.py').write_text(RUNNER)
    (project/'AGENTS.md').write_text('Synthetic pipeline only. Preserve local notes and output. No network, real deployment or consumer synchronization.\n')
    (project/'.gitignore').write_text('__pycache__/\noutput/\n')
    (project/'notes.md').write_text('Synthetic maintainer note.\n')
    git(project, 'init', '-q', '-b', 'main')
    for key, value in [('user.name', 'Pipeline Fixture'), ('user.email', 'fixture@example.invalid'),
                       ('commit.gpgsign', 'false'), ('core.hooksPath', '.no-hooks')]:
        git(project, 'config', key, value)
    slots = []
    for environment in ['test', 'uat', 'vt']:
        for instance in ['instance-1', 'instance-2']:
            for suite in ['unit', 'integration', 'contract']:
                slots.append(dict(id=f'{environment}/{instance}/{suite}', environment=environment,
                                  instance=instance, suite=suite, variant='python-stdlib', shard='1',
                                  config_sha256=hashlib.sha256(environment.encode()).hexdigest(),
                                  min_tests=tests_per_suite))
    phases, receipts = {}, []
    for phase, source in [('baseline', BASELINE), ('broken', BROKEN), ('fixed', GOOD)]:
        (project/'product.py').write_text(source)
        if phase == 'baseline':
            git(project, 'add', 'product.py', 'runner.py', 'AGENTS.md', '.gitignore', 'notes.md')
        else:
            git(project, 'add', 'product.py')
        git(project, 'commit', '-q', '-m', 'Synthetic '+phase+' candidate')
        revision = git(project, 'rev-parse', 'HEAD')
        artifact = root/(phase+'-artifact.bin')
        # This tiny fixture's build artifact is its exact product source, not an application package.
        artifact.write_bytes(source.encode())
        metadata = dict(revision=revision, artifact_sha256=sha(artifact))
        runs = []
        for index, slot in enumerate(slots):
            path = root/f'{phase}-{index:02d}.jsonl'
            service = 'no' if phase == 'broken' else 'yes'
            result = subprocess.run([sys.executable, '-B', 'runner.py', '--suite', slot['suite'],
                                     '--count', str(tests_per_suite), '--output', str(path),
                                     '--service-ready', service], cwd=project, capture_output=True, text=True)
            if result.returncode not in {0, 1}:
                raise RuntimeError('Fixture runner failed: '+result.stderr)
            observed = json.loads(result.stdout)
            receipts.append(dict(phase=phase, slot=slot['id'], command_exit=result.returncode, **observed))
            runs.append(dict(cohort='baseline' if phase == 'baseline' else 'candidate',
                             slot=slot['id'], attempt=1, run_id=f'{phase}-job-{index}',
                             status='success' if result.returncode == 0 else 'failure',
                             path=path.name, sha256=sha(path), config_sha256=slot['config_sha256'], **metadata))
        phases[phase] = dict(metadata=metadata, runs=runs)
        if phase == 'baseline':
            # Dirty tracked and ignored data must survive the remaining exercise.
            (project/'notes.md').write_text('UNRELATED LOCAL DRAFT: preserve verbatim.\n')
            output = project/'output'
            output.mkdir()
            (output/'keep.txt').write_text('UNRELATED LOCAL OUTPUT: preserve verbatim.\n')
        if phase == 'baseline':
            continue
        stage_runs = {env: f'{phase}-stage-{env}' for env in ['test', 'uat', 'vt']}
        plan = dict(schema_version=1, repository='fixture/widget-pipeline', inventory_complete=True,
                    baseline=phases['baseline']['metadata'], candidate=metadata, slots=slots,
                    stage_runs=stage_runs, runs=phases['baseline']['runs']+runs)
        plan_path = root/(phase+'-plan.json')
        write(plan_path, plan)
        stages = [dict(environment=env, config_sha256=hashlib.sha256(env.encode()).hexdigest(), run_id=run)
                  for env, run in stage_runs.items()]
        policy = dict(schema_version=1, repository=plan['repository'], target_environment='production',
                      max_age_seconds=3600, required_stages=stages, **metadata)
        write(root/(phase+'-policy.json'), policy)
        evidence = [dict(**stage, repository=plan['repository'], **metadata,
                         analysis_plan_sha256=sha(plan_path),
                         completed_at=datetime.now(timezone.utc).isoformat(),
                         conclusion='success' if all(r['status']=='success' for r in runs
                                                   if r['slot'].startswith(stage['environment']+'/')) else 'failure')
                    for stage in stages]
        write(root/(phase+'-stages.json'), evidence)
    write(root/'runner-receipts.json', receipts)
    preserved = {name: sha(project/name) for name in ['notes.md', 'output/keep.txt']}
    return dict(root=str(root), matrix_slots=len(slots), tests_per_phase=len(slots)*tests_per_suite,
                actual_test_executions=len(slots)*tests_per_suite*3, preserved=preserved,
                limits='Actual stdlib test invocations and Git commits; dependency outage and promotion are synthetic/local. Controller applies known fixture corrections, not a live agent evaluation.')


def stress(root, records_per_cohort=100000, failure_every=0):
    if type(records_per_cohort) is not int or not 1 <= records_per_cohort <= 1000000:
        raise ValueError('Expected 1..1000000 records per cohort')
    if type(failure_every) is not int or not 0 <= failure_every <= records_per_cohort:
        raise ValueError('Invalid synthetic failure interval')
    root = fresh(root)
    report = root/'report.jsonl'
    with report.open('x') as stream:
        for i in range(records_per_cohort):
            stream.write(json.dumps({'test_id': f'test-{i:07d}', 'status': 'passed'})+'\n')
    candidate = report
    if failure_every:
        candidate = root/'candidate-report.jsonl'
        with candidate.open('x') as stream:
            for i in range(records_per_cohort):
                row = dict(test_id=f'test-{i:07d}', status='passed')
                if i % failure_every == 0:
                    row.update(status='failed', failure_type='AssertionError',
                               message=f'Exact synthetic failure bucket {(i//failure_every)%1000}')
                stream.write(json.dumps(row)+'\n')
    metadata = dict(revision='a'*40, artifact_sha256='b'*64)
    slot = dict(id='scale', suite='scale', environment='test', instance='1', variant='synthetic',
                shard='1', config_sha256='c'*64, min_tests=records_per_cohort)
    runs = [dict(cohort=c, slot='scale', attempt=1, run_id=c+'-scale',
                 status='failure' if c=='candidate' and failure_every else 'success',
                 path=p.name, sha256=sha(p), config_sha256='c'*64, **metadata)
            for c,p in [('baseline',report),('candidate',candidate)]]
    write(root/'plan.json', dict(schema_version=1, repository='fixture/scale', inventory_complete=True,
                                baseline=metadata, candidate=metadata, slots=[slot], runs=runs))
    return dict(root=str(root), normalized_records=2*records_per_cohort,
                limits='Generated report records, not executed application tests or a live model trial.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['create', 'stress'])
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--tests-per-suite', type=int, default=100)
    parser.add_argument('--records-per-cohort', type=int, default=100000)
    parser.add_argument('--failure-every', type=int, default=0)
    args = parser.parse_args()
    result = create(args.root, args.tests_per_suite) if args.command == 'create' else stress(args.root, args.records_per_cohort, args.failure_every)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
