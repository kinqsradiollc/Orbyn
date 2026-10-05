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
macOS ARM binary without changing dependencies. The main rerun passed7/7, zero failures/skips,
in /tmp/orbyn-main-689a15a4-sweep-regression-repaired.log. No production
execution or full ADR acceptance is claimed.

Source checkpoint4b9c670f is pushed; current main689a15a4 is integrated without
conflicts as54976eeb. The worktree is tracked-clean. Full rotation/reply/Teams,
exact-head qualification and real/native/visual acceptance remain open; this
channel runtime/UI is not on main.

## Rotating-token worker candidate — 5 October 2026

Migration243 adds durable refresh claims, expiry, retry availability and explicit
ready/refreshing/unknown/reconnect states. The notifier claims one due mapping
before HTTP, decrypts outside authority transactions, locks live owner/mapping
through one bounded redemption, encrypts outside the guard, then publishes the
new pair only against the exact retained claim/configuration/cipher snapshot.
Successful refresh preserves workspace/actor/scopes and DM consent revision.
Disabling DMs concurrently cannot be undone by publishing fresh credentials.
A reconnect or unlink fences and clears the older claim.

The fixed Slack endpoint uses only refresh-token grant and configured app
credentials. Returned identity fields must match when present; missing optional
identity fields retain the previously verified mapping. Scope drift, token reuse,
user-token responses, oversized/malformed bodies and uncertain transport/commit
outcomes cannot be accepted or replayed. Ambiguity clears local credentials and
turns DMs off. Declared429 delays are bounded and capped at three attempts.
Long-lived tokens are not refreshed. Delivery waits for a valid rotation without
consuming send attempts, then reloads the new ciphertext; mismatched expiry
metadata remains a refusal. Both clients show refresh/reconnect status and cannot
turn messages back on without available credentials.

Evidence:31/31 pure protocol/client/store/route cases pass in
/tmp/orbyn-channel-rotation-pure-final.log.126/126 integrated database cases,
zero failures/skips, pass in /tmp/orbyn-channel-rotation-integrated.log, including
registered HTTP shields, installation, outbox, notices, Overnight, Agenda and
sweep suites. Rotation tests cover four concurrent workers, unknown restart,
rate-limit delays, invalid-token refusal, revoked owner/mapping, post-redemption
commit refusal, cold DB_POOL_MAX=1 and an actually blocked concurrent consent
write. Earlier logs retain the failed empty-scope check and expiry-deferral check;
input/source guards were corrected without weakening those assertions.

Workspace typechecks, full formatting, web build and iOS/Android exports pass
in /tmp/orbyn-channel-rotation-types-final.log,
/tmp/orbyn-channel-rotation-format-final.log,
/tmp/orbyn-channel-rotation-web-build.log and
/tmp/orbyn-channel-rotation-native-export.log. Builds are not native interaction
or screenshots. No real provider call, token exchange or external message occurred.
API/setup and Privacy documentation describe current source and boundaries.

Slack's two-active-token limit requires canonical workspace-bot credential
coordination across independently consented owner mappings. Current rotation
claims isolate one stored owner pair, but do not yet coordinate every mapping
for the same app/workspace/bot. This is a required implementation gate before
channel production promotion, not a complete rotation/A6 claim. Continue that
coordination, then durable exact-card signed replies, Teams, exact-head full/CI
qualification and authorized external/native/visual acceptance.

Official references: [token rotation](https://docs.slack.dev/authentication/using-token-rotation/),
[oauth.v2.access](https://docs.slack.dev/reference/methods/oauth.v2.access/).

Main429f2de2 passed all four CI jobs in37308099452:2976 backend passes, zero
failures and one existing Tesseract skip. Production Deploy runs were skipped;
the user deploys manually. This proves the main retention/docs checkpoint's CI,
not this unmerged channel source or whole ADR completion.

## Canonical workspace bot vault — 6 October 2026 candidate

Supersedes the owner-pair runtime described above. Checkpoint35ec3c69 preserves
that earlier tested design; this candidate replaces it with one encrypted bot
vault per provider/app/workspace/bot and separate owner-local verified actor,
reviewed scopes and DM consent revision. Installer provenance is checked against
the vault; delivery selects the recipient only from the live owner mapping.
Owner rows are constrained to contain no credential or expiry copy. Equivalent
returned scope order is normalized; changed scope sets disable affected owners'
DM consent and require their own review. No status response reveals another
owner or the shared vault/installer/credentials.

Concurrent workers claim/redemption/publication use the canonical pair. HTTP is
fenced by live reviewed mappings and the exact claimed encrypted snapshot.
Uncertainty/expired claims clear the pair and disable recipient permissions,
without replay. Bounded post-redemption publication can wait for a concurrent
local consent write and preserves its newer revision/disabled state. Unlinking
one owner, including the original OAuth installer, preserves others; last unlink
or account deletion erases the pair without provider uninstall. Empty unreferenced
vault metadata receives a fixed30-day sweeper rule.

Migrations244/245 discard candidate-era competing credentials and invalidate
unconfirmed exchanges rather than infer which single-use token survives. Owners
must explicitly reconnect. A temporary-schema upgrade regression applies the
actual241/243/244/245 SQL to populated legacy rows, including an in-flight claim,
and proves erasure, consent invalidation and the prohibition on owner secrets.

Current integrated run133/133 passes, zero failures/skips:
/tmp/orbyn-channel-vault-integrated-final.log. Pure31/31 passes:
/tmp/orbyn-channel-vault-pure-final.log. Two further shared-owner regressions
(scope-order stability and concurrent final-owner deletion) join the full
qualification run; its terminal result must be recorded before promotion.
All workspace typechecks and backend build passed before those two test-only
additions; latest legal/package rebuild and all workspace types are rerunning.

Retained failed runs:/tmp/orbyn-channel-vault-db.log (35/36),
/tmp/orbyn-channel-vault-db-final.log (36/42),
/tmp/orbyn-channel-vault-db-repaired.log (41/42),
/tmp/orbyn-channel-vault-integrated.log (131/132). Fixes retain assertions: use
PostgreSQL's5s timeout syntax, address the mapping UUID for the permission writer,
and review the provider's normalized actual scopes. The shared-vault regressions
cover three owners, one concurrent redemption, canonical-token/owner-recipient
DM isolation, installer unlink, final-owner credential cleanup, scope drift,
unknown-token refusal, deletion during publication and populated upgrades.

Signed exact-card reply consumption, Teams, authorized live Slack delivery,
current desktop/narrow/native screenshots and full/CI qualification remain open.
No real provider request/message or Docker engine operation occurred. Channel
runtime/UI remains on its candidate branch, not main. Full ADR remains active.

### Stale OAuth confirmation fence

Migration246 adds a database-maintained canonical credential generation and
records that generation/namespace in the encrypted pending capture. Confirmation
may replace only that exact canonical revision; an older review cannot overwrite
a newer rotation or another owner's freshly confirmed connection. Unknown or
deleted vault references require a fresh connection. Claim/state/credential
changes advance the generation through a database trigger, including last-owner
cleanup. Two additional regressions exercise stale captured pairs after rotation
and after another owner connects.

The broader diagnostic run /tmp/orbyn-channel-vault-full.log started before this
final fence and command-map repair, and cannot qualify the exact latest source.
It found the missing settings.agent-channels credentials-only reason; the
original three command registry assertions pass after adding that reason in
/tmp/orbyn-channel-vault-command-map.log. Keep its failures and terminal result;
run latest source serially again before claiming full qualification.

Updated legal/package build and all workspace typechecks pass:
/tmp/orbyn-channel-vault-final-types.log. Web build, iOS/Android exports and whole
format check pass:/tmp/orbyn-channel-vault-web-build.log,
/tmp/orbyn-channel-vault-native-export.log and /tmp/orbyn-channel-vault-format.log.
These do not establish native/browser visual acceptance. Latest fence-only
backend types are in /tmp/orbyn-channel-vault-generation-types.log.

### Latest-source focused qualification

After the generation fence and terminal stale-capture cleanup, all137 integrated
cases pass with zero failures/skips in
/tmp/orbyn-channel-vault-generation-integrated.log. Backend types pass in
/tmp/orbyn-channel-vault-generation-final-types.log and whole format check passes
in /tmp/orbyn-channel-vault-generation-format.log. The command mapping repair
passes its original3/3 assertions. Stale confirmation commits a failed pending
request with no encrypted pair before returning409, allowing a fresh connection.

The earlier broader diagnostic run is terminal:3062 passes, two failures (both
missing command mapping, now repaired), and one existing Tesseract skip out of
3065 tests;718096ms. It contains passing canonical/stale-generation cases but
started before final edits and is not exact-head qualification. Preserve
/tmp/orbyn-channel-vault-full.log. A fresh full run of the committed checkpoint
is required; no claim of all tests passing or full/CI qualification is made yet.

## Immutable vault and signed-question follow-up, 6 October 2026

- Immutable d9225450: `/tmp/orbyn-channel-d9225450-full.log`,3064pass/0fail/1existing skip,3065total,718357ms. Terminal session79486 exit0.
- New signed-question source: `/tmp/orbyn-channel-reply-db-repaired.log`,26/26 DB/outbox; `/tmp/orbyn-channel-reply-protocol.log`,27/27 raw-signature/events/card/OAuth; `/tmp/orbyn-channel-reply-http-repaired.log`,2/2 mounted HTTP callback shields.
- Backend types: `/tmp/orbyn-channel-reply-wired-types.log` passes. These focused runs do not qualify the combined source's full suite or external Slack behavior.
- Retained failures: `/tmp/orbyn-channel-reply-db.log` has invalid grant-revoke fixture then an incompatible pool mock hang (terminated130); `/tmp/orbyn-channel-reply-http-pure.log`37pass/2fixturefail because createService modules omitted. Repairs preserve acceptance assertions; queued fixture receipts are isolated per test.
- The reused runtime-integration worktree owns codex/agent-channel-replies. Immutable vault qualification tree remains unchanged. Root user dirt and all unrelated branches/worktrees remain preserved.
- Pending: combined latest-source focused/full/CI, exact-card real Slack callback/choice/thread/expiry/revoke acceptance, web/mobile native/visual, Teams, all other governing ADR requirements. No main/production/full-goal completion claimed.

### Combined signed-reply checkpoint qualification

- `/tmp/orbyn-channel-reply-integrated-final.log`:64/64 latest-source DB cases,
  including replies/outbox/installations/vault/HTTP ownership/rotation/retention.
- `/tmp/orbyn-channel-reply-cold-final2.log`:12/12 reply tests with DB_POOL_MAX1,
  empty SECRETS_KEY and the DB-backed encryption key; no nested-pool deadlock.
- `/tmp/orbyn-channel-reply-final-pure.log`:41/41 protocol, mounted HTTP shield,
  ordinary JSON parser isolation, gateway privacy/no-retry and log-redaction cases.
- All workspace types `/tmp/orbyn-channel-reply-all-types.log`, latest backend
  `/tmp/orbyn-channel-reply-latest-types.log`, backend build
  `/tmp/orbyn-channel-reply-backend-build.log` pass. Whole format check passes.
- Additional retained diagnostics: a one-connection wrapper incorrectly included
  existing multi-connection fence tests and stopped130 after9passes
  (`/tmp/orbyn-channel-reply-cold-integrated.log`); this is a runner configuration
  error, not evidence for source acceptance. The corrected cold run isolates reply
  tests, while the combined64case run uses the normal pool10.
- `/tmp/orbyn-channel-reply-cold-latest.log` had11pass/1retention-fixturefail because
  it ran the consumer after expiring the pending reply: the consumer correctly
  erased content and retained a new terminal receipt. The fixture now expires the
  pending answer after the completed-answer setup, testing the sweeper with Slack
  disabled. The original deletion and retention assertions remain unchanged.
- Full suite/CI for the combined checkpoint remains pending; canonical d922's
  3064pass result belongs to that earlier immutable source only. No production or
  real workspace/native/visual acceptance is claimed.

## Immutable signed-reply full qualification — 6 October 2026

Committed/pushed3d163bcd finished `/tmp/orbyn-channel-3d163bcd-full.log`:
3089pass/0fail/1existing Tesseract skip,3090total,719714ms. Terminal session90571
exit0. Its worktree stayed tracked-clean throughout the run; Teams implementation
was in another worktree. This documentation-only evidence update changes no
qualified application, migration or test source. Combined CI and real Slack /
client-native-visual acceptance still remain; no main promotion is claimed yet.
