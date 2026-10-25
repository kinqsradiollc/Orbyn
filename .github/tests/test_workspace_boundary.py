"""Enforce target boundaries without touching untracked/private target work."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('workspace_boundary', ROOT / 'scripts/check-workspace-boundary.py')
boundary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(boundary)


class WorkspaceBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        (self.root / '.gitignore').write_text('/openSrc/\n/orbyn-references/\n.env\n')
        subprocess.run(['git', '-C', str(self.root), 'add', '.gitignore'], check=True)

    def write(self, name):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('preserved fixture data\n')
        return path

    def stage(self, name):
        path = self.write(name)
        subprocess.run(['git', '-C', str(self.root), 'add', '-f', '--', name], check=True)
        return path

    def test_product_guides_snapshots_and_untracked_private_work_are_allowed(self):
        for name in ['docs/agent-skill/orbyn/SKILL.md', 'tools/rea/AGENTS.md',
                     'tools/pstack/skills/example/SKILL.md']:
            self.stage(name)
        preserved = [self.write(name) for name in ['AGENTS.md', '.env',
                     '.claude/settings.local.json', 'orbyn-references/local-note.txt']]
        before = {p: p.read_bytes() for p in preserved}
        self.assertEqual(boundary.check(self.root), 4)
        self.assertEqual(before, {p: p.read_bytes() for p in preserved})

    def test_staged_retired_instructions_discovery_and_sync_are_rejected(self):
        for name in ['AGENTS.md', 'AGENT.md', 'CLAUDE.md', 'skills/upstream-lock.json',
                     '.agents/skills/example', '.claude/skills/example', '.codex/config.toml',
                     'scripts/sync-public-skills.py', '.github/workflows/skills-upstream.yml']:
            with self.subTest(name=name):
                self.stage(name)
                with self.assertRaisesRegex(ValueError, 'staged/tracked'):
                    boundary.check(self.root)
                subprocess.run(['git', '-C', str(self.root), 'rm', '--cached', '-q', '--', name], check=True)

    def test_force_added_raw_research_is_rejected(self):
        for name in ['openSrc/source.txt', 'orbyn-references/source.txt']:
            with self.subTest(name=name):
                self.stage(name)
                with self.assertRaisesRegex(ValueError, 'raw research'):
                    boundary.check(self.root)
                subprocess.run(['git', '-C', str(self.root), 'rm', '--cached', '-q', '--', name], check=True)

    def test_research_exclusions_must_be_in_root_ignore_policy(self):
        (self.root / '.gitignore').write_text('/openSrc/\n')
        with self.assertRaisesRegex(ValueError, 'Root .gitignore'):
            boundary.check(self.root)


if __name__ == '__main__':
    unittest.main()
