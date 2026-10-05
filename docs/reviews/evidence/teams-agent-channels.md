# Teams agent channel implementation evidence

## Authentication boundary — 6 October 2026 candidate

This is the next A6 adapter after the Slack checkpoint. No Teams route, owner
mapping, delivery worker or client control is mounted yet; this is not a working
Teams connection or a completed A6 claim.

The standalone boundary verifies the exact bot app audience, Bot Connector
issuer, RS256 signature, expiry/not-before with the documented five-minute skew,
Teams signing-key endorsement, recipient bot ID and serviceUrl claim. JWT headers
cannot select a key URL. Microsoft's fixed HTTPS key endpoint uses bounded
responses, request cancellation, deduplicated refresh and a one-minute unknown-key
refresh cooldown. Cache expiry is one hour. Bad signatures/identities fail before
activity JSON decoding; request size and UTF-8/content type remain bounded.

The public-cloud connector URL validator restricts credential destinations to
Microsoft's connector host and reviewed regional/Teams base paths, optionally
with a tenant UUID. It rejects endpoint paths, redirects, userinfo, alternate
ports, normalization ambiguity, queries and fragments. Sovereign-cloud issuer,
key and connector configuration needs a separate adapter; public-cloud trust must
never authorize another cloud implicitly.

## Authoritative provider contracts

- [Bot Connector authentication](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication?view=azure-bot-service-4.0)
  separates service credentials from user authentication and requires audience,
  issuer, validity, signature, service URL matching and channel endorsement.
- [Teams proactive messages](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages)
  requires installation/conversation identity. Do not manufacture a conversation
  reference from a supplied email or user-entered URL.

A successful connector JWT is not an Orbyn account link, DM consent or a grant to
answer a question. The remaining adapter must bind a separately verified Microsoft
tenant/user identity to the initiating Orbyn session, then confirm the installed
personal conversation and explicit opt-in. Bot application authentication and
user OAuth have separate purposes; no private ChatGPT or MCP token is involved.

## Current evidence

- `/tmp/orbyn-channel-teams-auth-exact-audience.log`:11/11 pure RSA-JWT/key-cache/
  destination/bounds tests, no network or database side effects.
- `/tmp/orbyn-channel-teams-auth-qualified-types.log`: backend typecheck passes.
- Retained diagnostics: first URL-validator test6pass/1fail exposed an overly
  broad path allowance, repaired by allowing only known base paths and optional
  tenant UUID. A key-cache factory refactor initially had invalid nested export
  syntax; repaired before the10/10 and final11/11 runs. No assertions were removed.

The Slack combined checkpoint3d163bcd stays unchanged in its own worktree while
its full suite runs. These Teams checks do not qualify Slack or complete any
external/provider/native/visual acceptance gate.

## Implementation still required

| Work          | Required outcome                                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User OAuth    | Session-bound state/PKCE/nonce, verified tenant and user, exact issuer/client claims, safe encrypted temporary capture and explicit review                     |
| Installation  | Authenticated personal installation events, exact tenant/user/conversation mapping, uninstall and conversation lifecycle fencing                               |
| Delivery      | Fixed Microsoft client-credential token acquisition, bounded transport, durable Background and one morning Overnight outbox, current visibility/consent checks |
| Replies       | Exact displayed card, waiting ID, owner/conversation/consent revision, dedup and transactional question consumption; complete approval review retained         |
| Controls      | Both clients connect, review, opt in/out, show truthful status and disconnect; responsive/native interaction acceptance                                        |
| Retention     | Pending data expiry, encrypted token clearing, bounded content-free receipts and account deletion                                                              |
| Qualification | Provider mock contracts and actual HTTP shields, restart/race/revocation tests, full/CI then authorized real tenant delivery and stale-card refusal            |

All C1–C6/M1/D1/U1 requirements remain active. No main promotion, deployment or
full-goal completion is claimed by this foundation.

## Live key catalog correction

Microsoft's fixed public endpoint was read without any user or bot credential.
Its document measured814616bytes with233RSAkeys,72endorsed for Teams. The
initial64KiB/100key cap would reject this current document. The loader now uses
an explicit2MiB/1024key document budget, strips unused certificate metadata, and
retains the64KiB incoming-activity limit. The oversize assertion moves to the new
key-document boundary; no signature, audience, endorsement or destination rule
is weakened. A233key fixture proves the actual-size catalog is accepted.
`/tmp/orbyn-channel-teams-live-catalog-final.log` passes12/12; latest backend types
pass. A live call through the production key loader accepts233keys and72Teams
endorsed keys while retaining no certificate metadata. This proves key discovery,
not a live Teams installation, user identity, callback or message delivery.
The earlier11/12 intermediate catalog run is retained as the key-count failure;
the1..1024 array bound and metadata stripping were then corrected.

## Session-bound account link — candidate, 6 October 2026

Identity-only Microsoft organizational OAuth now uses session-bound state, PKCE
and nonce, strict issuer/audience/tenant/object-ID claims and fixed Microsoft key
and token endpoints. Callback redemption commits a unique claim before remote
exchange; an uncertain result clears private temporary data and requires a new
attempt. Captured identity is encrypted for ten minutes and reviewed only by the
original live Orbyn session. Crypto runs outside transactions for cold pool-one
operation. Identity reads recheck ownership and expiry after decryption.

Explicit review binds tenant/object ID, current connection revision and OAuth
configuration. Concurrent owners cannot claim the same bot/tenant/user identity.
Review returns one ten-minute personal-conversation challenge and leaves DMs off.
No Microsoft access/refresh token is retained. A provider-authenticated personal
message must prove the reviewed recipient before conversation binding; an admin's
installation event alone must not choose the recipient. This handshake, mounted
routes, bot credentials, delivery, replies and both client controls remain open.
Migration248 and fixed sweeps cover expired private captures and thirty-day
disconnected/abandoned links; Privacy text describes this candidate collection.

Evidence:

- /tmp/orbyn-channel-teams-oauth-pure.log:21/21 OAuth and connector protocol cases.
- /tmp/orbyn-channel-teams-account-integrated.log:37/37 Teams account-link, Slack
  installation/vault and retention database cases.
- /tmp/orbyn-channel-teams-account-cold-final.log:12/12 latest account-link cases
  with DB_POOL_MAX1 and empty SECRETS_KEY; includes review, ownership, revocation,
  replay, cross-owner race, pending bounds and fixed retention.
- /tmp/orbyn-channel-teams-account-qualified-types.log and
  /tmp/orbyn-channel-teams-account-qualified-build.log: backend types/build pass.

Retained /tmp/orbyn-channel-teams-install-db.log initially failed8/9 because the
claim UPDATE incorrectly included FOR UPDATE. The query was repaired while
retaining the unique-redemption assertions; the repaired run passed9/9 before
adding three race/retention/bounds cases. No provider or native/visual acceptance
is claimed. Main690f6246 now includes PR204: exact head853d4682 passed all four
CI37321894816 jobs; source3d163bcd full local suite passed3089 with0 failures and
one existing Tesseract skip. User deployment remains manual. Full ADR is active.

## Personal conversation proof — candidate, 6 October 2026

The linking service verifies the Connector JWT before parsing a bounded personal
message. Only the exact reviewed bot/tenant/AAD sender can consume the one-use
`/orbyn connect` challenge. Both tenant fields must agree; group conversations,
installation events, malformed challenges and wrong audiences cannot link. The
reference is encrypted outside transactions, then current owner/configuration,
challenge expiry and disconnect are rechecked under owner locks. Concurrent
messages consume the challenge once, advance the connection revision and leave
DM consent false. No external send occurs. This service is not yet mounted.

/tmp/orbyn-channel-teams-personal-link-cold.log passes16/16 database cases with
pool1 and no environment secrets key, including real RSA-signed activity fixtures
and ownership/replay/expiry/disconnect refusal. It extends the account-link tests;
no assertions or authority checks were removed. Backend typecheck/build are
confirmed by /tmp/orbyn-channel-teams-personal-link-types.log and
/tmp/orbyn-channel-teams-personal-link-build.log (both pass). Microsoft's personal-message shape is grounded in
[the official message activity contract](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/build-conversational-capability).
Actual installation/user interaction, bot transport, delivery, question replies,
client controls, HTTP shields and native/visual acceptance remain outstanding.

## HTTP and disconnect controls — candidate, 6 October 2026

Optional Teams status/start/read/review/disconnect and the public OAuth callback
are mounted on the API. Typed core/API-client contracts are available to both
clients. Status truthfully exposes delivery unavailable; no activity or DM opt-in
endpoint is mounted. The original session is required throughout review; API keys
and MCP/plugin access are excluded by credential classification. Both gateway
callback paths omit access/error query logs and disable proxy replay; request URL
serialization removes OAuth query data. Disconnect erases conversation/challenge
authority and all unfinished owner OAuth attempts, even without configuration.

/tmp/orbyn-channel-teams-controls-integrated-final.log passes58/58 protocol, HTTP,
actual route inventory, gateway/privacy and database cases.
/tmp/orbyn-channel-teams-controls-cold.log passes17/17 single-pool account cases.
Retained diagnostics: initial API-client build missed the UUID schema import;
repaired using the exported typed installation ID. Copied HTTP scaffolding had an
inapplicable Slack permission call; removed because this checkpoint exposes no
Teams permission endpoint. The first mixed test invocation lacked the required
TEST_DATABASE_URL for the actual inventory suite; the final isolated test-DB
wrapper ran all58 cases serially. No security assertion or inventory ratchet was
weakened. Full combined suite/CI, transport, replies, both UIs and authorized real
tenant/native/visual acceptance remain open.

All workspace typechecks, backend build and repository format check also pass:
/tmp/orbyn-channel-teams-controls-all-types.log,
/tmp/orbyn-channel-teams-controls-build.log and
/tmp/orbyn-channel-teams-controls-format.log. Combined full-suite qualification
is still required before this candidate can be promoted to main.
