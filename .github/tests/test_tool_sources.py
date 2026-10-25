"""Check immutable source preservation in disposable repositories, without engines."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('tool_sources', ROOT / 'scripts/check-tool-sources.py')
sources = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sources)


class ToolSourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'checkout'
        self.root.mkdir()
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        self.source = self.root / 'tools/example/source.txt'
        self.source.parent.mkdir(parents=True)
        self.source.write_text('retained upstream source\n')
        self.source.chmod(0o644)
        self.manifest = {'imports': [{'destination': 'tools/example', 'files': [{
            'path': 'source.txt', 'kind': 'file', 'executable': False,
            'sha256': hashlib.sha256(self.source.read_bytes()).hexdigest(),
        }], 'submodules': []}]}
        self.save_manifest()
        subprocess.run(['git', '-C', str(self.root), 'add', 'tools'], check=True)
        self.assertEqual(sources.check(self.root), (1, 0))

    def save_manifest(self):
        (self.root / 'tools/upstream-manifest.json').write_text(json.dumps(self.manifest))

    def test_changed_source_bytes_are_rejected(self):
        self.source.write_text('changed\n')
        with self.assertRaisesRegex(ValueError, 'Changed upstream bytes'):
            sources.check(self.root)

    def test_changed_executable_mode_is_rejected(self):
        self.source.chmod(0o755)
        with self.assertRaisesRegex(ValueError, 'Changed executable bit'):
            sources.check(self.root)

    def test_untracked_source_is_rejected(self):
        subprocess.run(['git', '-C', str(self.root), 'rm', '--cached', '-q',
                        'tools/example/source.txt'], check=True)
        with self.assertRaisesRegex(ValueError, 'Imported file is not tracked'):
            sources.check(self.root)

    def test_external_symlink_target_is_rejected(self):
        outside = Path(self.temp.name) / 'outside.txt'
        outside.write_text('outside source\n')
        self.source.unlink()
        self.source.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'External source target'):
            sources.check(self.root)

    def test_gitlink_revision_and_repository_are_preserved(self):
        revision = 'a' * 40
        label = 'tools/example/provider'
        self.manifest['imports'][0]['submodules'] = [{
            'path': 'provider', 'revision': revision,
            'repository': 'https://example.invalid/provider.git',
        }]
        self.save_manifest()
        (self.root / '.gitmodules').write_text(
            f'[submodule "{label}"]\npath = {label}\n'
            'url = https://example.invalid/provider.git\n')
        subprocess.run(['git', '-C', str(self.root), 'update-index', '--add',
                        '--cacheinfo', '160000', revision, label], check=True)
        self.assertEqual(sources.check(self.root), (1, 1))
        self.manifest['imports'][0]['submodules'][0]['revision'] = 'b' * 40
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, 'Wrong/missing gitlink'):
            sources.check(self.root)


if __name__ == '__main__':
    unittest.main()
