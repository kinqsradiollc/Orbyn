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

- The assigned engineer owns patches; use an independent reviewer when requested. Preserve unrelated work and candidate provenance. Follow [repository policy](../../AGENTS.md) for testing and delivery scope.
- Authentication is not proof of mailbox ownership. Public registration must not grant admin from first-account ordering or caller-submitted email. Bootstrap must require operator-controlled proof.
- OAuth authority is the intersection of token consent, current connection policy and current resource visibility. Check every redirect recipient, not only metadata hosts. Issue offline credentials only with offline consent; rotation must not reveal successor tokens to replayed credentials.
- Keep OAuth consent mutation and code issuance atomic; generation checks must cover issuance and exchange, not just one side. When testing is authorized, cover concurrent re-consent and consumed-code interleavings.
- A cached legacy encryption key survives database key deletion. Fence and remove all old writers before converting/retiring it; an advisory lock does not protect against old code that ignores that lock. Define failed migration retry and rollback without restarting old writers over converted data. Migration-only cutover attestations must never be enabled globally.
- When verification is authorized, verify live revocation through the authenticated route with an initial payload, committed revocation, later payload rejection and an authorized reader control. Control OAuth race tests at the real SQL completion boundary; pool callback queries require a pool-level barrier, not just a client promise wrapper.
- Recheck authorization for live events and file reads after revocation; possession of an old URL or subscription is not continuing permission.
- Publishing must exclude private Memory and unauthorized labels/content. API-key access must have explicit publication authority.
- Never log bearer URLs, query tokens, raw document content or credentials. Backups need restrictive permissions before writing.
- Emergency agent shutdown must cover every external-agent recipient. Proxy exemptions must be opt-in, not a default public subnet bypass.
- Inventory encrypted JSON fields as well as credential columns before retiring a legacy key. Upgrade fixtures must include cached job results. Verify every service keeps its required least-privilege secret references.
- Normalize alternate IP forms (mapped IPv6, translation and tunneling) before metadata checks. Transport changes require fixture updates and legitimate upload/recording/public-media controls.
- Keep credential encryption keys outside production database dumps. Bound provider response bytes and bind validated DNS addresses to the actual network connection.

## Closeout

Record finding IDs, affected source, invariant, patch, focused checks and remaining limits in a Markdown task ledger. Test the reported trigger, an alternate bypass and a legitimate control when authorized. Mark fixed only with evidence; keep unavailable checks open. Update preventive checks in the owning tests when testing is authorized, or in the authorized skill scope. Never launch a scan to close a remediation ticket.
