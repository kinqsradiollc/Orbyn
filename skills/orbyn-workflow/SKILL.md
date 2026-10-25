---
name: orbyn-workflow
description: "Route engineering work through investigation, design, implementation and verification, including open-source contribution intake and bounded PR feedback/CI iteration. Follow the consuming project's instructions."
---

# Orbyn engineering workflow

Follow the consuming project's instructions and requested scope; use the
[portable defaults](references/project-policy.md) only where guidance is missing.

Read the consuming checkout's optional `.agents/orbyn-context.json` using the
[context contract](../orbyn-setup/references/project-context.md). Follow relevant
pointers to existing guides; root instructions and user scope retain precedence.
Read relevant consumer-owned skills from `project-skills/` when the task needs
company/repository conventions. Follow the [ownership boundary](../orbyn-setup/references/project-skills.md)
when creating, adapting or relocating them; keep them outside public skill sync.
For work that needs a durable handoff, use the optional
[task record](references/task-record.md) without duplicating an existing tracker.

For setup without a selected layout, use the setup skill's
[one-time layout choice](../orbyn-setup/references/repository-workspaces.md):
nested is recommended/default for new workspaces; preserve existing explicit paths.
For a target inside the library's ignored `repo/` workspace, resolve that
repository and follow its [workspace contract](../orbyn-setup/references/repository-workspaces.md).
Read existing upstream instructions and skills in place; an ordinary contribution
does not authorize migrating their guidance or publishing local setup additions.

Use [local resources first](../orbyn-setup/references/offline.md). External citations
identify origins; fetch only when current information is required and network
access is available and authorized. Report stale or unavailable evidence.

Select skills and helpers from the user's ordinary task request; the human does
not need to name or invoke each step. Read the relevant reference directly when
a host lacks a Skill tool. Carry authorized work through its handoffs and checks;
do not hand executable setup commands back merely because another skill owns
them. Keep consequential authority and missing human-only decisions explicit.

When checkout isolation is needed or a worktree is requested, select
[orbyn-worktree](../orbyn-worktree/SKILL.md). Resolve the primary clone and prefer
its sibling `<repo>-wt/<purpose>/` root, reusing a suitable owned checkout first.
Preserve active legacy layouts and local output; isolation does not require a new
chat or imply separate databases/services.

Start from the user's requested outcome, current source and
[stack ownership](references/project-policy.md#stack-and-ownership). Use the
[skill system](references/project-policy.md#routing) to select the relevant handoff. Choose one playbook
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
| Investigate or contribute upstream   | [Contribution intake](playbooks/contribution-intake.md) |
| Address PR feedback or check CI      | [Bounded PR iteration](playbooks/pr-iteration.md) |
| Diagnose bulk CI or verify release evidence | [Pipeline failures](playbooks/pipeline-failures.md) |
| Plan a rollout or incident recovery | [Health and recovery](../orbyn-ci-design/references/rollout-recovery.md) |

Use [orbyn-plan](../orbyn-plan/SKILL.md) for explicit plans or a complex change;
use [orbyn-research](../orbyn-research/SKILL.md) for unresolved external facts and
[orbyn-skill-creator](../orbyn-skill-creator/SKILL.md) for skill-system changes.

For work crossing domain, transport, persistence and clients, use the
[Orbyn Engineering contract](references/fullstack-contract.md). Resolve the
consuming project’s actual owners before applying example stack conventions.
Backend effect design belongs to [orbyn-backend-design](../orbyn-backend-design/SKILL.md),
stored-format transitions to [orbyn-data-migration](../orbyn-data-migration/SKILL.md),
and trusted automation to [orbyn-ci-design](../orbyn-ci-design/SKILL.md).

For external code/skill freshness, downloaded research or selective upstream
updates, use [orbyn-upstream-review](../orbyn-upstream-review/SKILL.md). Keep raw
references in ignored `orbyn-references/`; adapt the existing owner and preserve
source/consumer pins separately. Available-source review does not require binary
reverse engineering or automatic installation of new upstream workflows.

For an explicitly requested portable/offline source audit, use
[orbyn-security-audit](../orbyn-security-audit/SKILL.md); existing findings remain
with remediation and a hosted security scan retains its own workflow.

Use [how](../how/SKILL.md) before changing unfamiliar behavior,
[architect](../architect/SKILL.md) for consequential data/ownership decisions,
[why](../why/SKILL.md) for historical constraints, and
[figure-it-out](../figure-it-out/SKILL.md) when a larger task needs its own plan.
Essential rules live with each engineering owner. Use the [method index](references/principles.md)
only when a decision needs a concrete example or check.

## Lead contract

For substantial work, the owning lead grounds and scopes the outcome, chooses the
design and delegates substantial investigation and implementation as applicable.
The lead stays responsible for integration, review and verification. A small clear edit or narrow
explanation can proceed directly. A child forbidden further delegation completes
its assigned task directly and returns the artifact to its owner; it never waits
for a nested worker.

Before dispatch, establish the requested end state, exclusions, current checkout
and candidate, owning data/contracts, failure behavior and authorized evidence.
For continuation, choose the minimum [task record](references/task-record.md)
that preserves the next action; use a [structured handoff](references/handoffs.md)
only when validation helps. Reconcile stale revisions before acting. Routine work
can rely on its existing diff, PR and CI without another log.
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

Follow the [consumer host and coordination boundary](references/project-policy.md#delegation-and-host-configuration).
Use configured named roles and preserve the required model, effort and processing
mode. If the host cannot do so, report the limit and continue permitted direct
work. Never silently substitute a model, launch a hidden inference process or
install a provider. Library model presets are optional, consumer-owned policy wins.

Give each child its role, outcome, source/candidate, owned files, allowed effects,
exclusions, relevant pointers and stopping condition. Reuse matching children;
tell writers they share the checkout and must preserve others' work. Default to
one child, at most two, without recursive delegation. Split independent outputs
only; serialize shared generated files and fixtures. Children return evidence to
the lead, who owns integration and review.

New sidebar/project chats require an explicit human request. This workflow
authorizes bounded native children, not extra user-owned sessions or messages.
Do not create sessions recursively or turn design comparison into a model panel.

## Review, verify and deliver

If the current task demonstrates a meaningful general skill gap, follow the
[optional contribution feedback](../orbyn-skill-creator/references/contribution-feedback.md):
prepare a concrete proposal, then offer it once without blocking the user's task.
Keep company-only material local. No automatic publication, self-edit, telemetry
or cross-user learning follows; exact existing contribution authority still applies.

For substantial work, the lead must inspect the actual returned artifacts and
diff against the intended contract, including affected callers, authority,
failure/recovery and unrelated changes. A delegate's summary is evidence to
inspect, not a completion verdict. Route concrete fixes back to the same child
and review the resulting diff. The lead writes the final assessment.

The lead performs verification proportional to the changed contract and inspects
its results. An implementation request includes appropriate local checks unless
explicitly excluded; respect consumer limits and separate external effects;
documentation needs document/link checks, not product builds. When runtime or
surface evidence is unavailable or excluded, report that limit explicitly.
Additional independent Verifier/Reviewer assignments are optional unless requested.
Requested independent qualification uses the same frozen candidate and at most
three full review rounds under [delivery](references/project-policy.md#verification-and-review). This limit
applies to requested independent qualification, not ordinary lead correction loops.

Deliver only the requested scope. Report changed behavior/artifacts, actual
evidence, unresolved limits and local/committed/pushed/merged/deployed state.
For authorized delivery, verify the successful owned commit and its validated
tree before pushing. A failed stage/commit stops dependent push, PR and CI actions;
a later command's success cannot repair that missing prerequisite. Use the
[commit and push gate](playbooks/opening-a-pr.md#commit-and-push-gate) for the
execution and remote-ref checks. Preserve the patch when host metadata is blocked.
No automatic PR, merge, publish, deployment, external message or monitor follows
from delegation or a playbook.

Use [unslop](../unslop/SKILL.md) for concise factual output. Report the result,
actual evidence and limits, without ceremonial principle citations. Source attribution and preserved dependencies are documented in
[attribution and resource boundaries](references/project-policy.md#documentation-and-attribution). Orbyn owns this workflow and its defaults.

## Language and technology decisions

For an affected code path, select [language guidance](../language-best-practices/SKILL.md)
from the actual files/manifests and load only its relevant local reference.
TypeScript schemas use that owner's [local TypeScript guide](../language-best-practices/references/typescript.md). Use
[stack selection](../orbyn-stack-selection/SKILL.md) for a requested recommendation
or demonstrated technology mismatch; it produces the decision for architect and
the implementation owners, not an automatic rewrite. The human requests the
outcome once; the agent chooses these handoffs internally.

## Operational method

Use the [local operating method](references/operating-method.md) for the execution
sequence, concrete failure case, expected result and stopping condition. It is
Orbyn-authored guidance; historical source notices remain in provenance.

## Execution invariants

Complete the agreed outcome, including necessary caller migration and removal,
without silently expanding authority. Use a small reusable tool for proven
repetition when its cost and failure behavior justify it. Separate concurrent
writers' files, fixtures and resources before serializing what truly must be shared.
Match each completion claim to direct evidence for the requested artifact; retain
missing checks as limits. Read conditional methods for
[outcomes](references/principles/outcome-oriented-execution.md),
[automation](references/principles/build-the-lever.md),
[shared state](references/principles/separate-before-serializing-shared-state.md) or
[proof](references/principles/prove-it-works.md) when needed.
For requested rollout or incident work, use the CI owner's
[health and recovery method](../orbyn-ci-design/references/rollout-recovery.md).

## Scope, review and resource handoff

Use [engineering scope](references/engineering-scope.md) for onboarding, ordinary
review, mentoring or junior/senior/staff responsibility questions. Scale ownership
and explanation to the task without lowering correctness or creating role-specific
skill catalogs. Cross-team strategy belongs to the planning owner.
For prototypes, evidence or local servers, use [artifact lifecycle](references/artifact-lifecycle.md)
to choose storage, retain the human handoff and clean only owned disposable resources.
