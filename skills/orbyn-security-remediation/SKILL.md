---
name: orbyn-security-remediation
description: Investigate and resolve existing Orbyn security findings, record evidence and add preventive checks without starting a security scan.
---

# Existing security findings

## Permission and evidence

- Never run, restart or rejoin any Codex Security scan unless the user explicitly requests that scan. Ordinary review, checkpoint qualification and local QA permission do not authorize scanning.
- Read saved findings and preserve original scan ID, revision, outcome and coverage. A canceled or failed scan is partial evidence, never a clean qualification.
- Consolidate duplicate causes but retain every original finding ID in the task ledger.
- Trace each reported path against current source. Classify confirmed, already safe, duplicate, intentional with documented invariant, or unresolved. Do not equate a scanner label with a verified exploit.

## Fix the boundary

- The assigned engineer owns patches; use an independent reviewer when requested. Preserve unrelated work and candidate provenance. Follow [project instructions and scope](../orbyn-workflow/references/project-policy.md#scope-and-evidence) for testing and delivery scope.
- State the violated invariant and trace attacker-controlled input to the actual
  authority or effect boundary. Check current callers, alternate paths and the
  legitimate behavior that must remain available.
- Correct that owner with appropriate validation, authorization, atomicity,
  resource limits or compatibility. Preserve least privilege and avoid exposing
  secrets or user content in logs, fixtures or reports.
- Use [conditional finding patterns](references/finding-patterns.md) only when the
  finding involves those systems. Keep concrete race/revocation/migration controls
  from the relevant pattern; do not apply every historical product check.

## Closeout

Record finding IDs, affected source, invariant, patch, focused checks and remaining limits in a Markdown task ledger. Test the reported trigger, an alternate bypass and a legitimate control when authorized. Mark fixed only with evidence; keep unavailable checks open. Update preventive checks in the owning tests when testing is authorized, or in the authorized skill scope. Never launch a scan to close a remediation ticket.
