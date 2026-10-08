# C2 bounded design guidance — 8 October 2026

Candidate: `f0624e9d18f9d6ff48c2bb5f22ddb23739e8ec58`, branch
`codex/c2-chatgpt-completion`, checkout
`/Users/anhdang/.codex/worktrees/adr-release-qualification/Orbyn`.
Input: `docs/reviews/c2-full-2026-10-08.md`.

Design consult only. Formal review remains **0/3**. Reviewer inspected source and
test assertions; no tests, builds, visuals, live sign-in, source edits or acceptance
were performed. This is a bounded correction plan, not an exhaustive security audit.
Builder's reported development results are not independent Tester qualification.

## Hosted connection: contract conclusion and remaining work

Builder's central interpretation is supported by the current official docs:

- The [OSS overview](https://developers.openai.com/siwc/token-sharing-open-source)
  covers open-source/local plan sharing and directs paid or remotely hosted apps
  to an interest form. It does not establish Orbyn's hosted eligibility.
- [Local registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
  uses `dynamic_agent_client` initially, then the issued account/workspace client
  ID. No preissued ID or partner secret is required for that flow. Its callback
  uses HTTP `127.0.0.1`; replacing it with an Orbyn HTTPS callback is unsupported
  by that contract. A callback carries code/state/issued ID, not refresh tokens.
- The [website guide](https://developers.openai.com/siwc/website) describes a
  limited partner identity integration with a provisioned client, registered
  callback and token-endpoint authentication method. It explicitly covers
  identity scopes. Its existence does not authorize hosted plan inference.

**Conclusion:** the inspected guides and candidate do not supply a complete,
provisioned standalone hosted-plan contract. This is an unresolved prerequisite,
not proof that hosted plan use is universally impossible. A popup is a presentation
choice; it cannot supply missing provider authorization. The user's later manual
test does not establish hosted approval. Removing the hidden desktop handoff is
correct but does not fulfill the standalone web requirement.

### Builder plan

1. Keep standalone hosted connection explicitly incomplete. The current web UI
   at `desktop/src/features/settings/ChatgptRemoteModels.tsx:48` only explains
   unavailability; it implements no hosted connection. Record the concrete missing
   provisioned contract: eligible application/client, exact callbacks, permitted
   plan scopes/resource, token authentication and hosted credential/execution
   rules. An identity-only client ID is insufficient evidence.
2. Code the capability/state boundary now if needed: distinguish local runtime,
   hosted unavailable, hosted configured and account grant disabled. Preserve
   account models/defaults and truthful usage. Do not add a pretend successful
   popup, reinterpret identity as plan permission, or route a browser through a
   desktop executor while claiming independence. Provider-specific hosted exchange
   and inference must wait for the applicable contract.
3. Once that contract exists, implement a separate hosted adapter. Proposed Orbyn
   design: authenticated start/status/cancel routes; expiring one-use OAuth
   transactions bound to the initiating Orbyn user/session and browser; server-side
   PKCE/nonce validation and token exchange; exact callback and safe return targets.
   Use popup completion only as a signal to refetch authenticated status. Check
   message origin/source and attempt identity; send no provider tokens to the
   opener, browser storage or completion URL. Handle blocked/closed popup,
   cancellation, denial, expiry, duplicate callback and session replacement.
4. Hosted credential custody is a deliberate architecture change from
   `docs/architecture.md:763` and the local-only `ChatgptPlanClient` contract.
   Define a protected server credential owner, rotation serialization and
   disconnect/revocation lifecycle under the approved rules. Add an explicitly
   hosted execution path with owned catalogs/preferences and enqueue-time account
   selection. Do not weaken the existing signed local-executor authority checks
   to impersonate a device. Exact provider parameters remain contract-dependent.
5. Tester should prove hosted success with desktop absent, account/session
   isolation, denied plan grant, callback replay, concurrent attempts, rotation,
   logout/revoke and explicit fallback. Deterministic transport fixtures qualify
   implementation only. The user's real-account check remains separately recorded.

## Concrete local fixes to batch now

### P1 — Do not restore a consumed refresh token after rotation

Location: `mobile/src/lib/chatgpt-local-sign-in.ts:805–857`; related desktop
post-refresh checks in `desktop/chatgpt-credentials.cjs:84–106`.

After receiving a replacement grant, native refresh still awaits backend identity
and connection checks before saving it. Failure there leaves the previous grant.
Worse, a session change during the protected write explicitly restores `original`
at line857. A rotating provider has already consumed that old refresh token;
returning to the account can send it again and force reconnect. This is a durable
credential transition, not an ordinary reversible UI write. The official
[session guide](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
requires using the latest replacement and serializing rotation.

Builder: distinguish pre-provider failure from rotation received/pending
verification/committed states. Keep any unverified replacement in protected,
non-executable recovery storage for the exact original owner, or retire the
observed grant and explicitly require reconnect. Never reactivate or overwrite a
newer owner/registration. Never restore the consumed token as usable. Apply the
same failure analysis to desktop when post-rotation verification/network checks
fail; do not weaken identity verification to avoid losing the token.

Tester: a stateful provider fixture must consume refresh token R1 when returning
R2 and reject reuse. Cover cancellation/session replacement during persistence,
temporary backend verification failure after provider success, storage failure,
and later reconnect preservation. The existing test named “session changes during
refreshed secure write restore only the prior registration” currently asserts the
wrong recovery property; checking byte equality alone misses provider rotation.

### P2 — Retain verified identity when plan permission is declined

Location: `mobile/src/lib/chatgpt-local-sign-in.ts:653–656` and
`backend/tests/chatgpt-native-sign-in.unit.test.ts:716`.

Native sign-in verifies/creates server identity, then throws before storing the
registration whenever `sharingGranted` is false. This loses the issued local
registration and credentials instead of representing a connected identity with
disabled plan use. Desktop already has that state (`chatgpt-manager.cjs:255–260`).
The [recovery guide](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)
requires retaining a valid sign-in without plan permission while blocking inference.

Builder: persist the verified registration with disabled permission; expose that
state in native account management, preserving other accounts/defaults. Gate
catalog publication and inference separately. Split the test that groups denied
scope with a mismatched identity: only the latter must reject identity storage.
Tester: valid identity without plan permission remains selectable/reconnectable,
never performs inference, and reuses its issued ID on later authorization.

### P2 — Add an explicit enable-plan consent action

Locations: `packages/core/src/chatgpt-local-oauth.ts:47–76` and
`desktop/chatgpt-oauth.cjs:220–234`, plus Settings and connection-call contracts.

Neither authorization builder accepts a consent intent or emits a consent
parameter. Ordinary reauthorization can skip consent, so reconnecting after a
decline need not enable plan usage. The recovery guide above documents explicit
reconsent for this action: use the supported `prompt=consent` mechanism;
`force_reconsent=true` requires confirmation of rollout for the integration.

Builder: carry an explicit user-selected “Enable ChatGPT plan usage” intent through
native and desktop flows, reuse the saved issued ID, request the complete scopes,
and request consent for this action only. Keep ordinary reconnect unchanged.
Tester: assert generated parameters for both intents, declined-again behavior,
successful enablement, and continued account/client identity isolation.

## Handoff boundary

Batch the three local corrections and the hosted capability/status decision before
the eventual complete-stage Tester handoff. Keep plan tier and account-wide quota
unknown unless supported by authoritative data; Orbyn's recorded usage is not the
subscriber's remaining allowance. C2 stays open. No formal round was consumed,
no production eligibility inferred, and no acceptance or source delivery is claimed.
