# Orbyn Skills

This directory contains local skill definitions for the Orbyn project.
Skills are used by the BrainRouter agent to guide its behavior when working on this codebase.

## Enabled Skills

- `planning-skill.md` - Breaks work into ordered tasks
- `spec-driven-skill.md` - Creates specs before coding
- `adr-skill.md` - Architecture decision records
- `testing-skill.md` - Security shield verification & mocking rules
- `conventions-skill.md` - Coding conventions and style
- `code-review-and-quality.md` - Code review standards
- `incremental-skill.md` - Incremental delivery checklist
- `shipping-skill.md` - Release checklist
- `changelog-generator.md` - Changelog generation
- `verify-loop.md` - Verification loop

## Usage

When working on Orbyn, the BrainRouter agent will automatically load these skills
based on the workspace configuration in `.brainrouter/workspace.json`.

You can also manually load a skill using the `mcp_brainrouter_get_skill` tool
with `scope: "local"`.
