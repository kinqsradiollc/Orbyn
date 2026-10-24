---
name: orbyn-workflow
description: "Route substantial Orbyn engineering work through evidence-led investigation, design, implementation and verification. Use for Orbyn workflow requests and multi-step changes."
---

# Orbyn engineering workflow

Follow the consuming project's instructions first. Use [Orbyn Engineering policy](../../AGENTS.md) and [host/model guidance](../../docs/agents/model-policy.md) where applicable; load only relevant references.

Read the consuming checkout's optional `.agents/orbyn-context.json` using the
[context contract](../orbyn-setup/references/project-context.md). Follow relevant
pointers to existing guides; root instructions and user scope retain precedence.
Read relevant consumer-owned skills from `project-skills/` when the task needs
company/repository conventions. Follow the [ownership boundary](../orbyn-setup/references/project-skills.md)
when creating, adapting or relocating them; keep them outside public skill sync.
For work that needs a durable handoff, use the optional
[task record](references/task-record.md) without duplicating an existing tracker.

Use [local resources first](../orbyn-setup/references/offline.md). External citations
identify origins; fetch only when current information is required and network
access is available and authorized. Report stale or unavailable evidence.

Select skills and helpers from the user's ordinary task request; the human does
not need to name or invoke each step. Read the relevant reference directly when
a host lacks a Skill tool. Carry authorized work through its handoffs and checks;
do not hand executable setup commands back merely because another skill owns
them. Keep consequential authority and missing human-only decisions explicit.

Start from the user's requested outcome, current source and
[stack ownership](../../docs/agents/stack.md). Use the
[skill system](../../docs/agents/skill-system.md) to select the relevant handoff. Choose one playbook
below; a clear small edit can proceed directly. Keep the plan as short as the task
permits. Do not load the whole library or repeat a checklist in every reply.

| Work                                 | Playbook                                            |
| ------------------------------------ | --------------------------------------------------- |
| Explain current behavior             | [Investigation](playbooks/investigation.md)         |
| Fix a defect                         | [Bug fix](playbooks/bug-fix.md)                     |
| Improve measured performance         | [Performance](playbooks/perf-issue.md)              |
| Diagnose live behavior               | [Runtime forensics](playbooks/runtime-forensics.md) |
| Analyze a captured profile           | [Trace forensics](playbooks/trace-forensics.md)     |
| Add behavior                         | [Feature](playbooks/feature.md)                     |
| Change structure                     | [Refactoring](playbooks/refactoring.md)             |
| Resolve an empirical design question | [Prototype](playbooks/prototype.md)                 |
| Match a reference UI                 | [Visual parity](playbooks/visual-parity.md)         |
| Author reusable instructions         | [Skill authoring](playbooks/authoring-a-skill.md)   |
| Compare prompt/skill behavior        | [Evaluation](playbooks/eval.md)                     |
| Long authorized work                 | [Autonomous run](playbooks/autonomous-run.md)       |
| Resume existing work                 | [Session pickup](playbooks/session-pickup.md)       |
| User requests a pause                | [Pause safely](playbooks/pause-safely.md)           |
| Large migration or staged delivery   | [Multi-phase plan](playbooks/multi-phase-plan.md)   |
| User requests PR delivery            | [Opening a PR](playbooks/opening-a-pr.md)           |

Use [orbyn-plan](../orbyn-plan/SKILL.md) for explicit plans or a complex change;
use [orbyn-research](../orbyn-research/SKILL.md) for unresolved external facts and
[orbyn-skill-creator](../orbyn-skill-creator/SKILL.md) for skill-system changes.

For work crossing domain, transport, persistence and clients, use the
[Orbyn Engineering contract](references/fullstack-contract.md). Resolve the
consuming project’s actual owners before applying example stack conventions.
Backend effect design belongs to [orbyn-backend-design](../orbyn-backend-design/SKILL.md),
stored-format transitions to [orbyn-data-migration](../orbyn-data-migration/SKILL.md),
and trusted automation to [orbyn-ci-design](../orbyn-ci-design/SKILL.md).

For an explicitly requested portable/offline source audit, use
[orbyn-security-audit](../orbyn-security-audit/SKILL.md); existing findings remain
with remediation and a hosted security scan retains its own workflow.
Use the [engineering decision aids](references/engineering-methods.md) for module
contracts, complete delivery slices and behavior-focused diagnosis/testing,
without requiring extra human invocations.

Use [how](../how/SKILL.md) before changing unfamiliar behavior,
[architect](../architect/SKILL.md) for consequential data/ownership decisions,
[why](../why/SKILL.md) for historical constraints, and
[figure-it-out](../figure-it-out/SKILL.md) when a larger task needs its own plan.
Use [principles](references/principles.md) to select only the relevant leaf rules.

## Lead contract

For substantial work, the owning lead grounds and scopes the outcome, chooses the
design and delegates substantial investigation and implementation as applicable.
The lead stays responsible for integration, review and verification. A small clear edit or narrow
explanation can proceed directly. A child forbidden further delegation completes
its assigned task directly and returns the artifact to its owner; it never waits
for a nested worker.

Before dispatch, establish the requested end state, exclusions, current checkout
and candidate, owning data/contracts, failure behavior and authorized evidence.
Resolve blocking facts first. Use the selected playbook to shape the work rather
than repeating every workflow phase.

For multi-step implementation, write a short throughput checkpoint:

- Blocking first steps before dispatch.
- Independent workstreams and their owned paths.
- Shared mutable state to separate or serialize under one owner.
- Smallest safe decomposition, including why one worker is sufficient when coupled.

Mark an inapplicable dimension briefly instead of manufacturing parallel work.
For read-only investigation, one line naming the independent slices or why one
investigator is sufficient is enough. Revisit the checkpoint when a phase changes
ownership or dependencies.

## Delegate within the current session

Use [Orbyn roles](../../docs/agents/roles.md) and the named native `orbyn-agent`
or `orbyn-light` definition selected by assignment complexity. Give each child
its role, outcome, source/candidate, owned files, allowed effects/checks,
exclusions, relevant skill/file pointers and stopping condition. Keep briefs
self-contained and compact. Reuse a matching child for follow-up fixes. Tell
writers they share the checkout and must preserve others' changes.

Follow [coordination](../../docs/agents/coordination.md): default to one child,
never more than two active children, and no recursive delegation. Delegate
coupled implementation to one owner; split only genuinely independent outputs.
Assign disjoint writes or serialize them, including generated files and fixtures.
Design alternatives can run sequentially when slots are occupied. Children return
artifacts and evidence to their owner, not to other user-owned chats.

Read the assignments in [the shared model registry](../../docs/agents/models.json)
and follow [model policy](../../docs/agents/model-policy.md) for tier, effort and
standard processing speed. Never enable Fast, Priority, Ultrafast or speed variants. The registry's human-only tier requires explicit human
selection. Check the named type and its definition before dispatch and inspect
effective model/effort/speed when exposed. If the named type is unavailable or
required settings cannot be preserved, report that boundary and do permitted
work directly. Never substitute a generic agent, hidden CLI inference process or
unrequested model. Missing runtime metadata remains unverified; configured speed
alone is not proof of effective speed.

New sidebar/project chats require an explicit human request. This workflow
authorizes bounded native children, not extra user-owned sessions or messages.
Do not create sessions recursively or turn design comparison into a model panel.

## Review, verify and deliver

For substantial work, the lead must inspect the actual returned artifacts and
diff against the intended contract, including affected callers, authority,
failure/recovery and unrelated changes. A delegate's summary is evidence to
inspect, not a completion verdict. Route concrete fixes back to the same child
and review the resulting diff. The lead writes the final assessment.

The lead performs authorized verification proportional to the changed contract
and inspects its results. Do not add or run tests without applicable authorization;
documentation needs document/link checks, not product builds. When runtime or
surface evidence is unavailable or excluded, report that limit explicitly.
Additional independent Verifier/Reviewer assignments are optional unless requested.
Requested independent qualification uses the same frozen candidate and at most
three full review rounds under [delivery](../../docs/agents/delivery.md). This limit
applies to requested independent qualification, not ordinary lead correction loops.

Deliver only the requested scope. Report changed behavior/artifacts, actual
evidence, unresolved limits and local/committed/pushed/merged/deployed state.
No automatic PR, merge, publish, deployment, external message or monitor follows
from delegation or a playbook.

Use [unslop](../unslop/SKILL.md) for concise factual output. Report the result,
actual evidence and limits, without ceremonial principle citations. Source attribution and preserved dependencies are documented in
[tooling](../../docs/agents/tooling.md). Orbyn owns this workflow and its defaults.
