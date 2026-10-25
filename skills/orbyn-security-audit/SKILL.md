---
name: orbyn-security-audit
description: "Perform an explicitly requested local or offline source security audit when a hosted scanner is unavailable or a portable audit is requested; preserve coverage, independent validation and structured findings."
---

# Portable source security audit

Use this workflow only within an explicit audit request and the consuming
project's policy. Creating, researching or installing this skill does not start
an audit. Questions about one saved finding belong to
[security remediation](../orbyn-security-remediation/SKILL.md). If a requested
hosted security integration is available, use its owning workflow; do not run
duplicate local and hosted scans or silently substitute one for the other.

Select this skill from the ordinary audit request; the human does not need to
invoke reconnaissance, hunting, verification and reporting separately. Follow
the [local audit protocol](references/protocol.md) for the complete
coverage and findings contracts, validators and threat-class references.

## Establish the audit boundary

Identify the target checkout, exact source revision and dirty files, requested
paths, allowed tools, execution scope, output location and budget. Inspect only
the relevant instructions and source. Keep the target read-only. Resolve domain,
API, storage, client, worker, infrastructure and external trust boundaries from
actual source; absent layers stay inapplicable. Existing company audit policy
stays in the consumer's guides or `project-skills/`, outside public sync.

Use a new owned output directory outside the target unless the user selected an
ignored in-repo location. The lead owns run metadata, architecture, coverage
ledger and findings; each investigator/verifier gets a separate scratch/output
scope. Record models, source identity, capabilities, budget and missing evidence.
The workflow uses local coordination policy and preserves the user’s authority
for every external action.

## Investigate, challenge and report

1. Map inputs, principals, effects and existing controls. Seed a coverage ledger
   from reachable source paths and relevant threat classes, with concrete owners.
2. Investigate bounded units. Reserve capacity for independent verification and
   coverage criticism before adding hunting work. Track inspected, blocked and
   deferred units; a grep hit or assigned task is not completed coverage.
3. Deduplicate candidates by boundary/root cause and have a fresh authorized
   verifier try to disprove each one against the same source. Keep rejected and
   unresolved evidence. Do not call a same-author reread independent verification.
4. Produce structured findings and verify the records again before deriving prose.
   Use the bundled schema and coverage/findings validators; reports and JSON must
   agree. Report source coverage and exclusions rather than implying exhaustiveness.

For every proposed defect, name the lower-trust actor/input, intended control,
crossed boundary, affected resource and bounded observed result. Distinguish
`confirmed`, `needs_validation` and `rejected`; unresolved records name the missing
fact and carry no severity. A best-practice gap or defense-in-depth suggestion
without a reachable violation is not a confirmed vulnerability. Only confirmed
findings receive severity, calibrated to the demonstrated consequence.

## Execution and evidence limits

Use local source and the bundled references offline. Execute target-controlled
builds, tests, fixtures or processes only when authorized and all controls in the
local protocol can be enforced: isolated network/environment, read-only target,
owned scratch writes and bounded resources. Otherwise continue static inspection,
record the exact missing execution evidence and retain an incomplete/unverified
result. Never use a live endpoint or production identity as a fallback.

Fresh investigators/verifiers must preserve the configured model, processing and
role boundaries. If the host cannot provide required independence, record the
blocker and return preliminary source observations; do not claim a completed
independently verified audit. A user budget or review cap is a hard limit, not a
reason to relabel unfinished work complete.

Return run identity, coverage, structured records, report, explicit blockers and
smallest proposed source fixes. Remediation is a separate authorized handoff.
Do not change target source, publish findings, open issues, message authors or
start a hosted Codex Security scan merely because this method describes audits.

The [synthetic blocked-evidence example](examples/static-limit.md) demonstrates
an incomplete source observation without assigning unsupported severity.
