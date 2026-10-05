# Agent channel delivery — implementation and acceptance

Scope: A6/C6 Slack, then Teams. Existing incoming-webhook digest delivery is a
separate feature; it does not establish OAuth installation, private DM delivery
or replies to assistant waiting cards. Personal ChatGPT credentials and portable
MCP grants are not channel credentials. No message is sent by this checkpoint.

## Signed Slack reply boundary

`modules/agent-channels/slack-interactions.ts` verifies the raw request bytes
before form/JSON parsing. It uses Slack's v0 HMAC, timing-safe comparison and a
five-minute timestamp window. Payloads are limited to64KiB. Only one supported
button action from the configured app in a DM is normalized; response URLs,
messages and host metadata are not followed or granted authority. Body digests
provide stable receipt keys for retries; a digest alone is not deduplication.

Actor/workspace/channel/message, delivery ID, connection revision and expiry
must match a server-owned sent-card record. The current waiting ID and kind
must match that record. Approval is once-only; no channel interaction can grant
standing permission. Questions accept current displayed choices or bounded
submitted text. Stale/answered cards reject409 instead of answering the next
prompt. Tests cover signatures, bounds, app/actor isolation, revoked/changed
connections, stale prompts, choice/text answers and safe error messages.

Evidence:7/7 pure tests pass (/tmp/orbyn-slack-reply-contract.log), fresh package
build and backend types pass (/tmp/orbyn-slack-reply-types-fresh.log). The first
typecheck used stale built core declarations; rebuilding packages resolved it
without changing application types. No endpoint, installation or real delivery
is claimed by these pure helpers.

Official references: [request verification](https://docs.slack.dev/authentication/verifying-requests-from-slack/),
[block action payload](https://docs.slack.dev/reference/interaction-payloads/block_actions-payload/),
[OAuth installation](https://docs.slack.dev/authentication/installing-with-oauth/).

## Retained implementation pipeline

| Stage              | Required implementation                                                                                                                                                   | Acceptance evidence                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Slack installation | Configured app, session-bound single-use OAuth request, verified workspace/installer/scopes, encrypted bot token, explicit DM opt-in, unlink/version fencing              | Owner/account-switch/replay/rate/security tests and authorized workspace installation           |
| Durable delivery   | Owner/workspace binding, queued outbox with dedup, current source/title visibility and connection consent, bounded messages, no automatic replay after uncertain dispatch | Queue/revoke/source-change/process-restart cases; actual consented DM delivery                  |
| Reply consumption  | Durable private sent-card binding and callback receipt, raw signed route, current live owner/source/waiting checks, existing transactional answer/apply path              | Duplicate/replayed/stale card cases, no cross-owner decisions, real question and approval reply |
| Both clients       | Connections, opt-in/unlink and actionable delivery/expiry status on web/desktop/mobile                                                                                    | Current interaction tests, desktop/narrow/iOS/Android inspection and screenshots                |
| Teams              | Microsoft app installation/account mapping and provider-specific authentication, same bounded outbox/receipt/waiting invariants                                           | Official provider contracts, mocked security and real authorized delivery/reply                 |

Delivery must never offer Approve for a plan that could not be fully represented
and reviewed in its sent card; use a link to the owned in-app review instead.
Queueing, estimated costs and message acceptance are distinct from confirmed
remote delivery. Raw external errors and private Slack payloads are not stored
in public receipts or shown in recovery text. Retention, Privacy Policy and API
route inventory changes are required when persistent channel paths are mounted.

## Session-bound Slack installation candidate — 5 October 2026

Migration241 adds one local mapping per owner/provider and bounded pending
OAuth state. Only a state digest is stored; a callback atomically claims it
once before an external code exchange. The fixed Slack endpoint, minimum bot
scopes and exact administrator HTTPS callback are validated. App/workspace/
installing-user/bot identity and grants are checked; personal Slack user tokens
are ignored. Bot credentials and optional rotation metadata are encrypted.

A callback only captures a pending installation. Review/confirmation requires
the exact initiating Orbyn session, current app configuration, reviewed actor
and connection revision. Logout/account disable/config changes/expired requests
refuse installation. Duplicate callbacks cannot dispatch another exchange;
unknown failures stay final. Duplicate confirmation cannot enable messages.
A live Slack actor cannot be mapped to two Orbyn owners. DM opt-in/disable and
local unlink advance the connection revision; unlink clears credentials rather
than uninstalling a bot shared by a workspace. Expired pending records join the
hourly sweep, disconnected mappings retain no credentials and expire after30
days. Privacy disclosure/version and optional environment definitions are added.

Crypto happens outside transaction ownership locks, then the exact encrypted
snapshot is fenced inside them, so a one-connection pool works. Ten fresh local
database cases pass with DB_POOL_MAX=1 and a database-backed encryption key in
/tmp/orbyn-slack-install-local-db.log. Seventeen pure protocol/reply checks pass
in /tmp/orbyn-slack-install-pure.log. Ten request-log/gateway checks pass in
/tmp/orbyn-slack-install-gateway-tests.log. Callback query codes/state are removed
from backend request serialization; both gateway callback hops suppress query
logs and automatic proxy retries. This is source/contract verification, not a
live gateway or authorized Slack workspace installation.

The service is not yet mounted: HTTP shields, public callback/status endpoints,
both client connection controls, rotating-token runtime, durable outbox and
transactional waiting-card replies still need implementation and qualification.
No Slack messages were sent. Official source contracts:
[OAuth installation](https://docs.slack.dev/authentication/installing-with-oauth/),
[oauth.v2.access](https://docs.slack.dev/reference/methods/oauth.v2.access/).
