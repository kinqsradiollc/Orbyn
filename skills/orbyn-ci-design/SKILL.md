---
name: orbyn-ci-design
description: "Design or repair CI checks, contribution automation and release promotion with scoped credentials, deterministic artifacts and clear evidence boundaries. Use for workflow changes; not permission to publish, merge or deploy."
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
