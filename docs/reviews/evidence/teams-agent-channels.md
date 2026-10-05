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
