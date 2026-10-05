# Agent channel delivery — implementation and acceptance

Scope: A6/C6 Slack, then Teams. Existing incoming-webhook digest delivery is a
separate feature; it does not establish OAuth installation, private DM delivery
or replies to assistant waiting cards. Personal ChatGPT credentials and portable
MCP grants are not channel credentials. No real Slack message has been sent during qualification.

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

## Mounted installation endpoint candidate — 5 October 2026

Current main8b6748c5 is integrated. Session-only status/start/review/confirm,
versioned permission and local unlink endpoints are registered in the API.
The public callback captures credentials by single-use state; it cannot link
an account or enable messages. Its static response sets no-store, no-referrer
and restrictive CSP. Callback query logs are redacted; gateway callback paths
disable logging and upstream replay. Live nginx verification remains open.

Confirmed identity includes actual granted bot scopes and explicit same-session
review. Installation/permission endpoints bypass response idempotency caching,
so every change rechecks live authority. They are excluded from MCP/plugin
capabilities. Shared client methods reject contract drift, forged authorization
hosts, credentials in replies and invalid request IDs. Reads are fresh.

Evidence:34/34 pure HTTP/client/protocol/gateway/catalog checks pass in
/tmp/orbyn-channel-mounted-pure-2.log.11/11 real database/registered endpoint
checks pass in /tmp/orbyn-channel-mounted-db.log; installation tests use a
one-connection pool with the database-backed encryption key, demonstrating
that encryption does not deadlock the ownership transaction. All workspace
typechecks pass in /tmp/orbyn-channel-mounted-types.log. Earlier failed local
checks are retained; these results correspond to the repaired candidate.

This candidate has no client connection screens, durable DM outbox, rotating
token worker or mounted reply handler. No external message or authorized live
installation was performed. Keep source qualification, real Slack/native UI
acceptance, Teams and the whole ADR goal open. This source is not on main.

## Callback inventory correction and final focused rerun

The full7fbce27e run was stopped deliberately after review found the public OAuth
callback incorrectly listed among session-only exclusions. No complete-suite
pass is claimed from /tmp/orbyn-channel-7fbce27e-full.log. Classify that callback
as PUBLIC and retain every authenticated installation endpoint in EXCLUDED.
The unchanged route inventory/audience assertions now pass with both installation
and mounted endpoint suites:17/17 in /tmp/orbyn-channel-route-inventory-db.log.
Final pure rerun34/34 passes in /tmp/orbyn-channel-mounted-pure-final.log.
Workspace types and formatting pass in /tmp/orbyn-channel-mounted-types-final.log
and /tmp/orbyn-channel-mounted-format-final.log. Full local/CI qualification
remains open before promotion. No shield assertion was weakened.

The existing5174 preview process was found serving7f60b352,39 commits behind
main. Its clean tracked checkout was fast-forwarded to8b6748c5 and package
builds passed; both untracked connection-preview files were preserved. The
listener is still running. This metadata check is not a browser screenshot
or a visual acceptance claim.

## Durable Slack DM delivery candidate — 5 October 2026

Migration242 and the notifier implement a durable outbox with owner/connection
revision binding, transition deduplication and a committed dispatch claim before
external HTTP. Background updates use the current independently named agent;
Overnight emits one generic morning notice using its separate identity, without
individual night-job messages. Questions and approvals open the in-app review;
this candidate does not expose an in-Slack approval action.

Before dispatch, the worker rechecks live owner, grant, source provenance,
project/team policy, current waiting ID, encrypted actor/workspace/scopes and
explicit DM consent under the shared source fence. Source writes cannot commit
through the guarded send. Fixed provider URLs, bounded replies and sanitized
outcomes retain no message bodies. Slack acceptance IDs and terminal outcomes
expire after14 days. Expired or ambiguous dispatches are terminal unknown;
provider-declared429 waits its bounded Retry-After, with at most three attempts.
An uncertain commit after provider acceptance cannot replay a message.

Qualification:96/96 database/integrated cases pass, zero failures/skips in
/tmp/orbyn-channel-outbox-cold-integrated.log. This includes a fresh subprocess
with DB_POOL_MAX=1 and a database-backed encryption key, concurrent workers,
actual blocked source mutation, unknown/restart handling, consent/source/waiting
revocation and a rejected database commit after simulated provider acceptance.
Existing away notices, Overnight, Agenda guards and scheduled-runtime suites
are included.25/25 pure provider/client/route/OAuth/reply cases pass in
/tmp/orbyn-channel-outbox-final-pure.log. All workspace types and changed source
formatting pass in /tmp/orbyn-channel-outbox-current-types.log and
/tmp/orbyn-channel-outbox-final-format.log.

This remains branch source. Full local/CI qualification, rotating-token worker,
both client controls, transactional signed reply consumption, Teams and
real authorized Slack/native/visual acceptance remain open. No real external
message, production deployment or whole-ADR completion is claimed.

## Cross-client connection controls and retention correction — 5 October 2026

The shared session-bound SlackChannelStore now owns Connect, same-session
pending review, exact actor/scopes/version confirmation, permission changes
and local unlink. Both clients place this in Connections → Agent channels,
separate from personal ChatGPT providers and MCP grants. DMs default off;
revocation stays available when administrator setup becomes unavailable.

Web reserves a popup directly in the click and provides an explicit provider
link when it cannot open. Native opens the validated authorization URL.
Both restore only a pending request UUID, poll pending requests at ten-second
intervals within their server expiry, and abort reads on disposal. Account
switches suppress late callbacks. Mobile serializes UUID storage writes and
logout clears the UUID. No credentials or OAuth callback parameters are stored
by these controls. Disconnect is a title toolbar action on web and a MoreMenu
on mobile. Theme tokens, wrapping actions and a narrow identity layout retain
the existing visual system.

Eight shared-store behavioral cases and15 existing Settings navigation/layout
cases pass (23/23, zero failures/skips):
/tmp/orbyn-channel-controls-settings-pure.log. Current workspace typechecks pass
in /tmp/orbyn-channel-controls-final-types-2.log; web production build and both
iOS/Android exports pass in /tmp/orbyn-channel-controls-final-web-build.log and
/tmp/orbyn-channel-controls-final-native-export.log. These are build/source
checks, not native interactions or screenshots. The permitted preview still
serves main; the saved browser restriction and prior simulator timeout remain
unresolved. Visual/manual and actual authorized Slack acceptance remain open.

Review found the fixed outbox retention rule incorrectly used the configurable
retention parameter: the sweeper intentionally passes zero to fixed rules.
Use an explicit14-day SQL cutoff. Include expired queued and abandoned
claims even when Slack configuration is disabled, while preserving recent
outcomes and live leases. A regression exercises the real rule predicate for
all those cases. Final integrated outbox/away/Overnight/Agenda/sweeper cohort
passes103/103, zero failures/skips, in
/tmp/orbyn-channel-retention-integrated-final.log.

The broader run launched atb27eb8ba completed3027 passes, zero failures and one
existing Tesseract skip in /tmp/orbyn-channel-b27eb8ba-full.log. UI/retention
source work proceeded during that run, so it is diagnostic broad coverage,
not an exact committed-head qualification. A fresh exact-head full local/CI
run remains required before promotion. No real Slack message was sent.

### Fixed retention dispatcher repair

The same zero-day dispatcher affected five other declared fixed rules:
disconnected mappings, Agenda summaries, completed/awaiting maintained-page
runs and assistant nudges. The dispatcher now passes rule.days for fixed rules.
Generic production-sweeper regression proves a14-day fixed rule retains a
one-day-old row and removes a15-day-old row. Existing tuple replacement,
composite-key, missing-key and security cases pass:7/7 in
/tmp/orbyn-fixed-sweep-engine-regression.log. The current channel/outbox/notice/
Agenda/sweep cohort passes104/104, zero failures/skips, in
/tmp/orbyn-channel-fixed-retention-final.log.

This independent two-file repair is committed on main as689a15a4 and pushed.
The larger channel/UI implementation remains a candidate. Root local tests
initially stopped before source execution because its esbuild installation
contained a different platform binary; the rerun uses the already installed
macOS ARM binary without changing dependencies. Main qualification follows
in /tmp/orbyn-main-689a15a4-sweep-regression-repaired.log. No production
execution or full ADR acceptance is claimed.
