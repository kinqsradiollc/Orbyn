# Offer a useful lesson back to the shared library

Use when current authorized work demonstrates a meaningful reusable gap in a
shared skill: a missing failure boundary, incorrect instruction, effective
workflow correction or portable helper improvement. The agent can notice and
offer it without the human invoking `reflect` or a contribution skill. This is
an optional feedback loop, not automatic self-modification or a second task
imposed on every user.

## Establish the lesson before offering it

Finish or stabilize the user's requested work first. Use its actual artifacts
and observations; do not scan unrelated chats, private histories or company
directories to find lessons. Separate demonstrated behavior from a hypothesis.
One-off preferences, ordinary successful work and speculative “best practices”
do not justify a contribution prompt. Consolidate related gaps into one proposal.

Locate the existing canonical owner. Prefer a small correction and useful
regression/example to another overlapping skill. Use
[reflection](../../reflect/SKILL.md) for the failed assumption, correction and
nearby non-applicable case. Treat these as handoffs; do not recursively invoke
skills, spawn a panel or install tools merely to offer an improvement.

Classify ownership under the [project-skill boundary](../../orbyn-setup/references/project-skills.md).
Company procedures, private context, credentials, proprietary code/data and
personal preferences remain local. Company-only findings need no public offer.
If a public abstraction is possible, independently write the general method and
synthetic example and verify that redistribution is permitted. Renaming private
identifiers or hashing a transcript does not make it safe to publish. Preserve
third-party licenses/credits; user consent does not relicense someone else's work.
Potential security disclosures follow the relevant private reporting policy and
separate authority, not a public issue containing the finding.

## Make a concrete, optional offer

Before asking, prepare a concise proposal in the current conversation or approved
local output, without modifying the consumer's managed skills/pin just to solicit
consent. Include enough proposed text or a small diff for the user to review:

- Observed problem and the actual evidence, with its limits.
- Owning skill/path and proposed reusable change; a synthetic example/regression.
- Exact intended public destination and files/content to include, with private
  project data, logs, identities and history excluded.
- Planned validation and any licensing/ownership uncertainty.

Do not create a public issue/fork/PR, push, comment or upload evidence merely to
make the proposal reviewable. A short local proposal is sufficient when preparing
a full patch would interrupt the main task or require ungranted scope.

At a natural completion/checkpoint, ask once for that distinct proposal:

> I found a reusable improvement to `<skill>`: `<specific change and evidence>`.
> Here is the proposed text/diff and what it would include. Would you like me to
> open a public PR to `kinqsradio/orbyn-fullstack-skills`, show a local patch first,
> or keep this local?

Public submission requires an explicit answer covering this change/content and
destination. Silence, a preselected option, installation, local-fix permission,
generic autonomy and “show me a draft” are not publication authority. If the user
already authorized this exact contribution, honor that scope without asking
again. Changed content or a different destination needs scope reconciliation.

Decline or no answer leaves publication pending and the main task unblocked.
Do not repeat the same offer without new material evidence or changed scope.
Respect visible opt-outs; do not create persistent memory, telemetry, background
monitors, mandatory task logs or a global opt-in as a side effect. Record only
what an already-approved project record requires. Do not claim the library learns
from all users automatically.

## Complete an approved contribution

For a local-draft answer, prepare/review the local patch and checks within that
scope; wait for separate publication authority. For an approved public PR:

1. Verify destination, contribution rules, current public main/open PRs and source
   pin. Follow the [single-candidate handoff](../../orbyn-upstream-review/references/release-handoff.md).
   Reuse related owned work; preserve unrelated changes and active consumers.
2. Author only the approved general change in a clean contribution checkout,
   using [worktree/privacy policy](../../orbyn-worktree/SKILL.md). Prefer local or
   permitted private preparation. Verify public visibility before publishing;
   never turn a private consumer clone/history into the public contribution.
3. Follow the creator's authoring/check method: preserve notices, migrate related
   references, add failure-sensitive evaluation coverage and update discovery and
   managed hashes. Inspect the exact allowlisted diff for publication. A hash
   allowlist is not a privacy or ownership review.
4. Within the granted scope, push/open the PR and handle permitted CI/feedback
   through [bounded iteration](../../orbyn-workflow/playbooks/pr-iteration.md).
   If account/network capability is unavailable, keep the checked local draft
   and report the blocker. Do not install providers or borrow another account.
5. Report local/committed/pushed/PR/merged state accurately. Public-PR permission
   does not authorize maintainer merge, deployment, external messages elsewhere
   or consumer repinning. After acceptance, consumer promotion remains separately
   scoped; never announce a proposed change as a released improvement.

## Worked boundaries

**Reusable repair:** a CI method accepted an older green result after a newer
report became invalid. Current-task reproduction establishes the failure. Offer
an exact missing-report guard plus a fictional regression; exclude the employer's
job names, logs and configuration. Publish only if that scoped proposal is approved.

**Company customization:** a private release requires an internal approver and
named customer exception. Keep it under the consumer's project-skill namespace.
Do not offer the confidential policy for public contribution merely because it
improved this task.

**Draft, decline or offline:** “show a patch first” authorizes a local draft;
“keep local” ends the offer. No answer is not consent. A network failure preserves
the draft and original work; none of these states is an open public PR.

**Already authorized:** “contribute this generic parser fix publicly to the skills
repository” covers that reviewed fix. Complete its checks and submission without
another routine permission question; it still does not approve merging or repinning.
