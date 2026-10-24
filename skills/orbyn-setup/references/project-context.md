# Project-owned context

Resolve the **consuming repository root** from the task and its instructions, not
from the skill's symlink target. Read `.agents/orbyn-context.json` there when it
exists. The pointer file helps locate existing guides; it does not replace root
instructions or grant permission to execute commands, publish or change models.

```json
{
  "schema_version": 1,
  "project_name": "Example product",
  "documents": {
    "instructions": "AGENTS.md",
    "stack": "docs/architecture.md",
    "design": "docs/design.md",
    "brand": "docs/voice.md"
  },
  "owners": {
    "domain": "src/domain",
    "web": "src/ui"
  }
}
```

These example paths must be replaced with existing paths. Missing roles stay
absent; never create an application layer just to fill this map. `documents`
points to files; `owners` points to files or directories. Paths are relative to
the consuming project and must resolve inside it. Never store credentials here.

The helper can initialize pointers to a small set of existing guides without
reading their contents, and check the map without executing anything:

```sh
python3 /path/to/library/skills/orbyn-setup/scripts/project_context.py init --project /path/to/project
python3 /path/to/library/skills/orbyn-setup/scripts/project_context.py check --project /path/to/project
```

Initialization preserves an existing valid map. Inspect the result and add actual
owners after tracing source. Read only the documents relevant to the task. When
no map exists, use ordinary repository discovery; setup is not a prerequisite.

Project design owns palette, typography tokens, navigation and motion choices.
Project brand guidance owns audience, approved voice examples, vocabulary and
evidence-backed claims. The portable skills own the method. Keep preferences in
their existing guides and link them here instead of duplicating their content.

This file belongs to the consumer. The shared skill sync allowlist excludes it,
so a public update preserves project customization and a skill export cannot
publish it. Installing skills does not create the map or change host models.
