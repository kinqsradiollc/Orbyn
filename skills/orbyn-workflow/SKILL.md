---
name: orbyn-workflow
description: "Route substantial Orbyn engineering work through evidence-led investigation, design, implementation and verification. Use for Orbyn workflow requests and multi-step changes."
---

# Orbyn engineering workflow

Follow [repository policy](../../AGENTS.md) and [model/agent policy](../../docs/agents/model-policy.md). Use only relevant references.

Start from the user's requested outcome, current source and
[stack ownership](../../docs/agents/stack.md). Use the
[skill system](../../docs/agents/skill-system.md) to select the relevant handoff. Choose one playbook
below; a clear small edit can proceed directly. Keep the plan as short as the task
permits. Do not load the whole library or repeat a checklist in every reply.

| Work | Playbook |
| --- | --- |
| Explain current behavior | [Investigation](playbooks/investigation.md) |
| Fix a defect | [Bug fix](playbooks/bug-fix.md) |
| Improve measured performance | [Performance](playbooks/perf-issue.md) |
| Diagnose live behavior | [Runtime forensics](playbooks/runtime-forensics.md) |
| Analyze a captured profile | [Trace forensics](playbooks/trace-forensics.md) |
| Add behavior | [Feature](playbooks/feature.md) |
| Change structure | [Refactoring](playbooks/refactoring.md) |
| Resolve an empirical design question | [Prototype](playbooks/prototype.md) |
| Match a reference UI | [Visual parity](playbooks/visual-parity.md) |
| Author reusable instructions | [Skill authoring](playbooks/authoring-a-skill.md) |
| Compare prompt/skill behavior | [Evaluation](playbooks/eval.md) |
| Long authorized work | [Autonomous run](playbooks/autonomous-run.md) |
| Resume existing work | [Session pickup](playbooks/session-pickup.md) |
| User requests a pause | [Pause safely](playbooks/pause-safely.md) |
| Large migration or staged delivery | [Multi-phase plan](playbooks/multi-phase-plan.md) |
| User requests PR delivery | [Opening a PR](playbooks/opening-a-pr.md) |

Use [orbyn-plan](../orbyn-plan/SKILL.md) for explicit plans or a complex change;
use [orbyn-research](../orbyn-research/SKILL.md) for unresolved external facts and
[orbyn-skill-creator](../orbyn-skill-creator/SKILL.md) for skill-system changes.

Use [how](../how/SKILL.md) before changing unfamiliar behavior,
[architect](../architect/SKILL.md) for consequential data/ownership decisions,
[why](../why/SKILL.md) for historical constraints, and
[figure-it-out](../figure-it-out/SKILL.md) when a larger task needs its own plan.
Use [principles](references/principles.md) to select only the relevant leaf rules.

Use [Orbyn roles](../../docs/agents/roles.md) to assign work. Delegate through
`orbyn-agent` with a concrete role, file ownership and stopping condition. Reuse an
existing matching child. Read this skill and load a relevant principle leaf when
it helps resolve the current task; avoid ceremonial rule recitation.

Use [session coordination](../../docs/agents/coordination.md) to choose ownership.
For separately tracked project work, create or reuse a named project session when
the user requests that split. Its owner may use up to two native subagents for
bounded supporting tasks. Do not recursively create sessions or model panels.
A small edit stays in the current session. Sol/medium and Sonnet/medium are the
defaults; never use Astra, Fable or maximum effort. Keep briefs short and file
ownership explicit. The owning session integrates and verifies artifacts.

Use [unslop](../unslop/SKILL.md) for concise factual output. Report the result,
actual evidence and limits, without ceremonial principle citations. Source attribution and preserved dependencies are documented in
[tooling](../../docs/agents/tooling.md). Orbyn owns this workflow and its defaults.
