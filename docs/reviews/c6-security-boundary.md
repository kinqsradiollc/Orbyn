# C6 plugin security boundary

## Authority and data flow

| Boundary | Control | Failure response |
| --- | --- | --- |
| Host → gateway | Only `/plugin`, `/plugin/*` and plugin resource metadata reach the private plugin service; body, connection and request limits apply. | Disabled recipient returns 404; unavailable service fails closed. |
| Host → OAuth | Plugin and portable MCP have distinct resource recipients. The plugin resolves a fresh connector grant for each request; no browser session fallback. | Wrong recipient, expired token, revoked grant or account switch is refused. |
| Plugin → Orbyn capability | Registry policy intersects the owner, workspace, scope and current trust. Writes recheck authority in a transaction and retain receipts. | Stale authority stops a write; a host hint cannot select an owner or team. |
| Plugin → workspace AI | Owner consent pins a managed/BYO provider and model with a version, allowance and server-held credentials. ChatGPT plan tokens never enter this path. | Changed consent/provider or exhausted allowance fails closed; no silent fallback. |
| Host UI → tool | CSP disallows outside resources. UI resources require current tool scope and UI opt-in. `open_orbyn` returns no account content; Today loads after a user click. | Unsupported hosts keep portable tools; missing scope or UI opt-in hides the resource. |
| Public page → private source | Publication pins explicit blocks or a separately consented live scope. | Revocation and source visibility are rechecked; a public link is never a plugin credential. |

## Review and scan gate

The source review covers recipient confusion, account switching, token handling,
authorization races, UI resource origin, host-supplied metadata, replay, quota
and public/private content boundaries. A finding needs a stable ID, affected
commit, reachable path, severity, owner and reproduction evidence. Duplicate
alerts for the same reachable dependency/path are grouped; fixes remain Builder
changes that Tester checks and Reviewer assesses. No scan-generated patch merges
without review.

On 11 October 2026, the read-only GitHub code-scanning alerts endpoint returned
HTTP 404, `no analysis found`, plus a missing `admin:repo_hook` scope notice.
This is **not** a clean scan. Codex Security entitlement and an authorized scan
artifact remain unverified. Do not expand token scopes or add a secret-bearing
CI job until scan access and its supported workflow are established. Existing
dependency audit evidence is recorded in
[security-scan-status-2026-10-02.md](security-scan-status-2026-10-02.md);
it does not replace the code scan.
