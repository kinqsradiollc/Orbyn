import importlib.util
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/check-code-organization.py"
SPEC = importlib.util.spec_from_file_location("code_organization", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CodeOrganizationTests(unittest.TestCase):
    def fixture(self, files):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        for name, body in files.items():
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(body)
        return root

    def test_domain_imports_and_shared_consumers(self):
        root = self.fixture({
            "packages/core/src/documents/doc.ts": "export const id = 1;",
            "packages/core/src/index.ts": 'export * from "./documents/doc.js";',
            "packages/api-client/src/client.ts": 'import { id } from "@orbyn/core";',
            "desktop/src/features/documents/editor.tsx": 'import { id } from "@orbyn/core";',
            "mobile/src/features/documents/editor.tsx": 'import { client } from "@orbyn/api-client";',
        })
        self.assertEqual(MODULE.check(root), [])

    def test_core_cannot_depend_on_transport(self):
        root = self.fixture({"packages/core/src/doc.ts": 'import { client } from "@orbyn/api-client";'})
        self.assertIn("Cross-layer import", MODULE.check(root)[0])

    def test_client_cannot_import_another_application(self):
        root = self.fixture({
            "mobile/src/features/tasks/view.tsx": 'import { task } from "../../../../desktop/src/task";',
            "desktop/src/task.ts": "export const task = 1;",
        })
        self.assertIn("Cross-layer import", MODULE.check(root)[0])

    def test_missing_moved_import_fails(self):
        root = self.fixture({"desktop/src/app/main.ts": 'import "../features/docs/DocEditor";'})
        self.assertIn("Unresolved literal import", MODULE.check(root)[0])

    def test_retired_directory_fails(self):
        root = self.fixture({"mobile/src/screens/Task.tsx": "export {};"})
        self.assertIn("Retired source directory", MODULE.check(root)[0])

    def test_dynamic_literal_import_is_checked(self):
        root = self.fixture({"packages/core/src/main.ts": 'void import("./missing.js");'})
        self.assertIn("Unresolved literal import", MODULE.check(root)[0])

    def test_comments_and_external_imports_are_not_local_dependencies(self):
        root = self.fixture({"packages/core/src/main.ts": '// import "./missing.js";\nimport { z } from "zod";\n/* import "./also-missing.js"; */'})
        self.assertEqual(MODULE.check(root), [])


if __name__ == "__main__":
    unittest.main()
