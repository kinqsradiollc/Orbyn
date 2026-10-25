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

    def test_target_owned_guidance_settings_and_private_work_are_preserved(self):
        target_files = ['AGENT.md', 'AGENTS.md', 'CLAUDE.md', 'codex.md', '.cursorrules',
                        '.cursor/rules/domain.mdc', '.codex/config.toml', '.claude/settings.json',
                        '.agents/skills/domain-check/SKILL.md', '.claude/skills/domain-check/SKILL.md',
                        'skills/domain-check/SKILL.md', 'project-skills/domain-check/SKILL.md',
                        'docs/agents/product.md', 'docs/agent-skill/orbyn/SKILL.md',
                        'tools/rea/AGENTS.md', 'tools/pstack/skills/example/SKILL.md']
        preserved = [self.stage(name) for name in target_files]
        preserved += [self.write(name) for name in ['.env', '.claude/settings.local.json',
                                                   'orbyn-references/local-note.txt']]
        before = {p: p.read_bytes() for p in preserved}
        self.assertEqual(boundary.check(self.root), 1 + len(target_files))
        self.assertEqual(before, {p: p.read_bytes() for p in preserved})

    def test_recognized_copied_installation_controls_are_rejected(self):
        for name in ['skills/catalog.json', 'skills/upstream-lock.json',
                     'scripts/install.py', 'scripts/sync-public-skills.py',
                     '.github/workflows/skills-upstream.yml']:
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

    def test_negated_research_rule_does_not_count_as_an_exclusion(self):
        (self.root / '.gitignore').write_text('/openSrc/\n!/orbyn-references/boundary-probe\n')
        with self.assertRaisesRegex(ValueError, 'Root .gitignore'):
            boundary.check(self.root)

    def test_bare_raw_research_file_symlink_and_gitlink_roots_are_rejected(self):
        self.stage('openSrc')
        with self.assertRaises(ValueError):
            boundary.check(self.root)
        subprocess.run(['git', '-C', str(self.root), 'rm', '--cached', '-q', 'openSrc'], check=True)
        target = self.write('allowed/retained.txt')
        (self.root / 'orbyn-references').symlink_to(target)
        subprocess.run(['git', '-C', str(self.root), 'add', '-f', 'orbyn-references'], check=True)
        with self.assertRaises(ValueError):
            boundary.check(self.root)
        subprocess.run(['git', '-C', str(self.root), 'rm', '--cached', '-q', 'orbyn-references'], check=True)
        subprocess.run(['git', '-C', str(self.root), 'update-index', '--add',
                        '--cacheinfo', '160000', 'a' * 40, 'openSrc'], check=True)
        with self.assertRaises(ValueError):
            boundary.check(self.root)

    def test_same_name_target_skills_are_not_classified_as_copied_prose(self):
        files = [self.stage(name) for name in ['.cursor/skills/how/SKILL.md',
                 '.agents/skills/how/SKILL.md', 'skills/how/SKILL.md']]
        before = {p: p.read_bytes() for p in files}
        boundary.check(self.root)
        self.assertEqual(before, {p: p.read_bytes() for p in files})


if __name__ == '__main__':
    unittest.main()
