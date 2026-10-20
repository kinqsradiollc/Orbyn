---
name: principle-guard-the-context-window
description: "Keep investigation context useful during large searches and long tasks."
---

# Principle guard the context window

Follow [repository policy](../../AGENTS.md) and [model/agent policy](../../docs/agents/model-policy.md). Use only relevant references.

Search narrowly, cap output and read only relevant sections. Keep file pointers and compact evidence summaries. Delegate genuinely independent bulk analysis to an in-task subagent with a small brief; do not clone the entire conversation by default. Do not reread unchanged files or load every skill reference.
