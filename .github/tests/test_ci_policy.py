"""Exercise the consumer map and actual remote-preflight shell in disposable Git repos."""
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('ci_scope', ROOT/'skills/orbyn-ci-design/scripts/ci_scope.py')
scope = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scope)
POLICY = json.loads((ROOT/'.github/ci-scope.json').read_text())
workflow = (ROOT/'.github/workflows/deploy.yml').read_text()
REMOTE = textwrap.dedent(re.search(r"<<'REMOTE'\n(.*?)\n[ ]+REMOTE", workflow, re.S).group(1))


class ConsumerPolicyTests(unittest.TestCase):
    def test_product_docs_skills_and_license_do_not_build_or_deploy_the_app(self):
        for path in ['README.md', 'LICENSE', 'docs/assistant.md', 'docs/agents/tooling.md',
                     'skills/how/SKILL.md', 'scripts/sync-agent-skills.py']:
            with self.subTest(path=path):
                decision = scope.classify([path], POLICY)
                self.assertFalse(decision['run_app'])
                self.assertFalse(decision['deploy'])

    def test_runtime_dependencies_and_container_inputs_need_full_checks(self):
        for path in ['backend/src/routes.ts', 'packages/core/src/tasks.ts', 'desktop/src/main.ts',
                     'package-lock.json', 'compose.yaml', 'pgbouncer/Dockerfile']:
            with self.subTest(path=path):
                decision = scope.classify(['README.md', path], POLICY)
                self.assertTrue(decision['run_app'])
                self.assertTrue(decision['deploy'])

    def test_ci_changes_and_unknown_paths_check_broadly_without_auto_promotion(self):
        for path in ['.github/workflows/ci.yml', 'unknown-root-file',
                     'skills/orbyn-ci-design/scripts/ci_scope.py', 'mobile/src/screen.tsx']:
            with self.subTest(path=path):
                decision = scope.classify([path], POLICY)
                self.assertTrue(decision['run_app'])
                self.assertFalse(decision['deploy'])


class DeploymentPreflightTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.origin, self.source, self.server = [self.root/name for name in ['origin.git', 'source', 'server']]
        self.run_git(self.root, 'init', '-q', '--bare', '--initial-branch=main', str(self.origin))
        self.run_git(self.root, 'clone', '-q', str(self.origin), str(self.source))
        (self.source/'scripts').mkdir()
        stub = self.source/'scripts/deploy.sh'
        stub.write_text('#!/usr/bin/env bash\nset -euo pipefail\n'
                        '[ "$1" = --no-pull ]\ngit rev-parse HEAD > "$TASK_DEPLOY_RECEIPT"\n')
        stub.chmod(0o755)
        (self.source/'tracked.txt').write_text('baseline')
        self.initial = self.commit(self.source)
        self.run_git(self.source, 'push', '-q', 'origin', 'main')
        self.run_git(self.root, 'clone', '-q', str(self.origin), str(self.server))
        (self.source/'tracked.txt').write_text('tested candidate')
        self.candidate = self.commit(self.source)
        self.run_git(self.source, 'push', '-q', 'origin', 'main')
        self.receipt = self.root/'deployment-receipt'

    def run_git(self, root, *args):
        return subprocess.check_output(['git', '-C', str(root), *args], text=True,
                                       stderr=subprocess.STDOUT).strip()

    def commit(self, root):
        self.run_git(root, 'add', '--all')
        self.run_git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                     'commit', '-qm', 'Fixture', '--no-verify')
        return self.run_git(root, 'rev-parse', 'HEAD')

    def preflight(self, candidate=None):
        return subprocess.run(['bash', '-s', '--', str(self.server), candidate or self.candidate],
                              input=REMOTE, text=True, capture_output=True,
                              env=dict(os.environ, TASK_DEPLOY_RECEIPT=str(self.receipt)))

    def test_exact_clean_candidate_fast_forwards_and_disables_another_pull(self):
        result = self.preflight()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.run_git(self.server, 'rev-parse', 'HEAD'), self.candidate)
        self.assertEqual(self.receipt.read_text().strip(), self.candidate)

    def test_stale_candidate_keeps_server_unchanged(self):
        (self.source/'tracked.txt').write_text('later untested candidate')
        self.commit(self.source)
        self.run_git(self.source, 'push', '-q', 'origin', 'main')
        self.assertNotEqual(self.preflight().returncode, 0)
        self.assertEqual(self.run_git(self.server, 'rev-parse', 'HEAD'), self.initial)
        self.assertFalse(self.receipt.exists())

    def test_dirty_server_work_is_preserved(self):
        (self.server/'tracked.txt').write_text('valuable server work')
        self.assertNotEqual(self.preflight().returncode, 0)
        self.assertEqual((self.server/'tracked.txt').read_text(), 'valuable server work')
        self.assertEqual(self.run_git(self.server, 'rev-parse', 'HEAD'), self.initial)
        self.assertFalse(self.receipt.exists())

    def test_diverged_server_commits_are_not_reset(self):
        (self.server/'local.txt').write_text('valuable local commit')
        local = self.commit(self.server)
        self.assertNotEqual(self.preflight().returncode, 0)
        self.assertEqual(self.run_git(self.server, 'rev-parse', 'HEAD'), local)
        self.assertFalse(self.receipt.exists())

    def test_foreign_server_branch_is_not_switched(self):
        self.run_git(self.server, 'checkout', '-qb', 'local-work')
        self.assertNotEqual(self.preflight().returncode, 0)
        self.assertEqual(self.run_git(self.server, 'branch', '--show-current'), 'local-work')
        self.assertFalse(self.receipt.exists())
