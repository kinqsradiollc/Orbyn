---
name: orbyn-ci-design
description: "Design or repair CI, select affected checks, analyze bulk failures, verify release evidence and plan rollout or incident recovery. Keep artifact readiness and deployed health distinct; no implicit deployment authority."
---

# CI that checks the artifact it will promote

Read the consuming project's commands and contribution model. Identify the event,
candidate revision, untrusted inputs, required evidence, credential scope and any
external effect. Separate ordinary fork-PR validation from trusted maintainer
publication or deployment. Inspect current primary platform documentation when a
workflow depends on versioned action or token behavior.

Use the smallest useful lanes: document changes need metadata/link checks;
executable helpers need meaningful behavior checks; application changes need the
affected contract's checks. Keep fixtures disposable and preserve source/runtime
separation. Do not invoke a paid model or live provider merely to validate skill
frontmatter. Report live skill selection and model behavior separately.

For small changes and selective execution, follow
[proportional verification](references/change-scope.md). Cosmetic local work can
finish with relevant local checks and no hosted CI/CD. Published changes retain
their required merge status; use a known docs/skills fast path, broader checks for
uncertain/runtime changes and a final gate that cannot hide classifier or selected
job failures. Deployment is separate from green CI and must respect scope and
existing authority. Do not add a new skill or ask the human to invoke one merely
to decide the appropriate checks.

For fork contributions, use unprivileged PR execution, read-only tokens, no secrets
and no persisted checkout credentials. Do not execute a contributor's code in a
privileged target-PR or follow-up job. Pin actions to reviewed immutable revisions
and let dependency-update PRs propose changes. Treat issue text, branch names,
artifacts and downloaded manifests as data rather than shell code.

For cross-repository content, prefer an allowlisted manifest and explicit upstream
revision. Fail on drift, path escapes and overwriting local edits. CI may prepare
a reviewable PR under a maintainer trigger; it must not silently make private
content public or turn a successful check into permission to merge.

For example, a skills consumer can verify its local file hashes against a public
pin without a cross-repository write credential. A separate reviewed contribution
exports only the managed skill paths; the private application's Git history and
configuration never become part of that export.

Validate workflow syntax and the actual helper behavior, then inspect the remote
run for the exact candidate when available. Name branch-protection, secret or host
settings that remain unapplied. Deliver the workflow, commands and evidence; use
[orbyn-workflow](../orbyn-workflow/SKILL.md) for the broader change and
[security remediation](../orbyn-security-remediation/SKILL.md) only for existing findings.

## Maintain the verification map

For a requested verification inventory or stale recipes, use the [consumer-owned verification map](references/verification-map.md). Derive it from current source and existing commands; keep attempted and last-confirmed revisions separate.

## Bulk failures and release evidence

For many failed suites, instances or shards, use the [bulk method](references/bulk-failures.md)
and its disk-backed offline analyzer. Collect the complete expected matrix and
all attempts before diagnosing. Keep missing/invalid newest reports as blockers;
never truncate the inventory to a readable top list or erase a fail/pass retry.
Group shared symptoms as hypotheses, then use `how`/`tdd` for confirmed causes
and meaningful corrections. A failed pipeline does not by itself identify a code defect.

Use [release verification](references/release-verification.md) to bind required
stage evidence to the actual candidate, artifact bytes, configuration, current run
and freshness. Unknown/failed required gates block readiness. Offline JSON/digests
do not authenticate a provider or grant deployment authority. The agent completes
authorized collection and analysis without making the human invoke each helper.

## Affected graphs and operations

For cross-package selection, use [affected targets](references/affected-targets.md)
with the existing build graph, generator/runtime edges and conservative fallback.
For an authorized rollout plan or incident recovery, use
[health-driven rollout](references/rollout-recovery.md). Artifact readiness,
deployed health and recovery completion are separate evidence claims.
