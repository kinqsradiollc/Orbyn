# Delivery workflow

Use [AGENTS.md](../../AGENTS.md) and the current task's requested scope. This guide
replaces the blanket role pipeline for every change. Retired checkpoint reports do not govern current work.

## Default delivery

1. Understand the outcome and affected system; choose the relevant
   [playbook](../../skills/orbyn-workflow/SKILL.md).
2. Implement the complete agreed behavior in coherent units. Keep a short plan or
   decision trail when scope warrants it. Preserve unrelated changes.
3. Obtain the checks authorized for this task and proportional to its risks.
   Respect explicit exclusions and session instructions about testing. Inspect
   the result and diff; missing checks remain unverified.
4. Review the artifact for correctness, ownership, unnecessary complexity and
   unresolved requirements. Self-review is sufficient unless independent review
   was requested. Use [review criteria](review.md).
5. Deliver to the requested state. Commit, PR, merge, publish and deployment are
   distinct actions; do not initiate them solely because a playbook mentions them.

Documents and skill migrations use reference, provenance and format checks.
Do not run product builds or visual sweeps for instructions-only changes.
Source checks cannot establish runtime behavior; a build cannot establish UX;
mocked providers cannot establish a live provider works.

## Independent qualification, when requested

The engineer freezes the full candidate and hands it to the verifier, who executes the
agreed checks and writes the result. The reviewer examines code, tests and evidence,
then approves or supplies a prioritized correction batch. The engineer fixes; the verifier
rechecks affected behavior; the reviewer closes findings. Respect assigned role limits.

Record exact checkout, branch, commit, scope/exclusions, fixtures, commands,
terminal outcomes, reports, known gaps and the next owner. Preserve failed attempts.
Retain older results only with relevant source/dependency equivalence.

Maximum three full review rounds, with early approval allowed. Known-finding
closure may finish the current round. Do not relabel a new full review as closure
or reset the counter. After the third round, report unresolved findings and seek
user direction. A user-waived gate is excluded, not passed.

## Visual work

Choose a finite set of changed states and concrete risks. Use shared web preview
for web/desktop and Expo web for the mobile renderer; responsive web alone does
not qualify mobile. Installed native work needs explicit scope. When a visual verifier is assigned, send candidate, URL, cases, viewports, themes and report
location; otherwise inspect within the authorized current workflow.

Use one fixture owner. Capture actual viewport/zoom and source identity. Do not
mutate fixtures during inspection or retry unchanged blocked browser actions.
Restore only owned state. Report rendering, accessibility structure and actual
assistive/native behavior separately. No repeated screenshot sweep per edit.

## Completion record

State changed behavior, source identity, executed checks and their outcomes,
untested/blocked requirements, and actual local/committed/pushed/merged/deployed
state. Keep durable task records under `docs/work/` only when needed, following
[documentation policy](documentation.md). Never claim
completion while a required part of the agreed scope remains unresolved.
