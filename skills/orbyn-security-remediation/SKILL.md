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

- Builder owns patches; Reviewer inspects code and test evidence. Preserve unrelated work and frozen candidate provenance.
- Authentication is not proof of mailbox ownership. Public registration must not grant admin from first-account ordering or caller-submitted email. Bootstrap must require operator-controlled proof.
- OAuth authority is the intersection of token consent, current connection policy and current resource visibility. Check every redirect recipient, not only metadata hosts. Issue offline credentials only with offline consent; rotation must not reveal successor tokens to replayed credentials.
- Keep OAuth consent mutation and code issuance atomic; generation checks must cover issuance and exchange, not just one side. Test concurrent re-consent and consumed-code interleavings.
- Recheck authorization for live events and file reads after revocation; possession of an old URL or subscription is not continuing permission.
- Publishing must exclude private Memory and unauthorized labels/content. API-key access must have explicit publication authority.
- Never log bearer URLs, query tokens, raw document content or credentials. Backups need restrictive permissions before writing.
- Emergency agent shutdown must cover every external-agent recipient. Proxy exemptions must be opt-in, not a default public subnet bypass.
- Inventory encrypted JSON fields as well as credential columns before retiring a legacy key. Upgrade fixtures must include cached job results. Verify every service keeps its required least-privilege secret references.
- Normalize alternate IP forms (mapped IPv6, translation and tunneling) before metadata checks. Transport changes require fixture updates and legitimate upload/recording/public-media controls.
- Keep credential encryption keys outside production database dumps. Bound provider response bytes and bind validated DNS addresses to the actual network connection.

## Closeout

Record finding IDs, affected source, invariant, patch, focused checks and remaining limits in a Markdown task ledger. Test the reported trigger, an alternate bypass and a legitimate control when authorized. Mark fixed only with evidence; keep unavailable checks open. Update preventive checks in the owning tests/skills. Never launch a scan to close a remediation ticket.
