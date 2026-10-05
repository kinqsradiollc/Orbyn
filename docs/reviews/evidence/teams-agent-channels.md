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

## Independent bot transport — candidate, 6 October 2026

Teams bot transport uses separately configured single-tenant Microsoft application
credentials. Fixed token endpoint and Connector destination validation prevent
secrets leaving Microsoft endpoints; conversation path segments are encoded.
Concurrent token issuance is deduplicated in a bounded process cache, expiration
renews it and configuration digest prevents reuse across credential rotation.
No user OAuth, private ChatGPT or MCP credential is used. Bounded plain-text sends
return explicit sent/refused/rate-limited/unavailable/unknown outcomes. Ambiguous
network/server/malformed-success outcomes are never automatically replayed; an
explicit429 exposes only a bounded delay for durable scheduling.

/tmp/orbyn-channel-teams-transport-qualified-pure.log passes31/31 transport and
existing OAuth/Connector protocol cases. Backend types pass after rebuilding the
local workspace packages (/tmp/orbyn-channel-teams-transport-types-rebuilt.log).
The first typecheck used the reused worktree's earlier package dist and correctly
rejected missing Teams exports; package rebuild repaired that environment state.
No assertions were removed. This transport remains unconfigured/unwired. A
separate Teams durable outbox candidate is being implemented and must be tested
for source/consent/revision fencing, cold pool, ambiguity, restart and bounded
retry before mounting or enabling delivery. Real tenant acceptance remains open.

Primary contract: [Bot Connector application authentication](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication?view=azure-bot-service-4.0).
The identity checkpoint05dc8265 full local suite is still running unchanged; it
has exposed stale generated MCP catalog documentation. Preserve the terminal
result, regenerate the catalog, then rerun exact-source qualification.

## Durable Teams outbox — candidate, 6 October 2026

Migration249 gives Teams a distinct delivery namespace tied to its reviewed
conversation mapping and revision. Job intents queue only Background/nonidea
transitions; Overnight queues only the generic morning summary after its window.
Dispatch decrypts outside transactions, then rechecks owner, grant, exact
conversation/configuration/revision, project/team/source visibility and waiting
ID under the existing source advisory fence. Provider acceptance and outcome
commit are separate boundaries; expired claims become unknown, not queued.
Explicit429 and pre-send credential unavailability retry at most three attempts.
Fixed fourteen-day retention covers terminal/expired content-free receipts.

/tmp/orbyn-channel-teams-outbox-cold-initial.log passes7/7 on a separately marked
test database with pool1, empty SECRETS_KEY and mocked transport. Covered cases:
dedup/owned recipient/agent identity, hidden idea and per-night-job exclusion,
consent/owner/project/grant/configuration/conversation revocation, unknown and
expired-claim recovery, bounded rate-limit attempts, stale waiting IDs and one
generic morning message. Backend types/build pass in
/tmp/orbyn-channel-teams-outbox-qualified-types.log,
/tmp/orbyn-channel-teams-outbox-qualified-build.log and the later sweep-rule
/tmp/orbyn-channel-teams-outbox-latest-types.log. Retention database acceptance
remains open; the rule is fixed in the hourly sweeper.

This is not wired into transition hooks or worker delivery. DM opt-in, lifecycle
callbacks, shared-source races, post-acceptance commit ambiguity, reply cards,
HTTP shields, both clients and real tenant acceptance remain required before
Teams messaging is enabled. The source of PR205 is separately immutable while
its repaired full suite runs; no local DB suites overlap. Full ADR remains open.

## Lifecycle, delivery hooks and matching client controls — candidate

Migration250 adds a unique bot/tenant/conversation route hash and authenticated
link timestamp. Existing references lose DM permission without invented proof.
Connector-signed personal removal events clear exact current mappings; unrelated
installation actors, group events, other conversation/member events and old
timestamps cannot change ownership. The activity endpoint is mounted with a
64KiB raw parser isolated from ordinary JSON routes. Gateway replay/query logs
are disabled on both ports. Unknown text is acknowledged without persistence.

Independent bot credentials enable bounded Background and morning outbox
delivery, with current source/permission/revision fences. DM enablement and lost
challenge renewal have session-only strict versioned HTTP routes. Blank identity
or bot configuration cannot enable delivery. Settings on both clients uses a
shared abortable session-bound store; only a pending UUID is persisted, never
a challenge command, provider credential or callback code.

Evidence:22 cold installation cases and56 integrated protocol/HTTP/database
cases passed before additional migration/retention cases. Current pure shared
store, actual client JSX handlers and gateway cases pass21/21 in
`/tmp/orbyn-channel-teams-controls-pure-final.log`. All workspace types and
backend/web builds passed. New migration/retention acceptance and native export
are pending; no real tenant/native interaction, screenshots or visual acceptance
are claimed. Teams question replies remain required.

One initial store package build exposed an accidentally copied Slack method
name; it was corrected to the Teams method, with the failure retained in
`/tmp/orbyn-channel-teams-store-build.log` and passing repair in
`/tmp/orbyn-channel-teams-store-build-repaired.log`. Initial mobile types exposed
a missing required disabled property on SmallAction; the final workspace
typecheck passes without changing its contract.

### Current qualification result

The complete transport/lifecycle/controls cohort passes112/112, zero failures
and no skips (`/tmp/orbyn-channel-teams-controls-integrated-final.log`). This
includes real signed activity fixtures, actual migration250 against legacy
references, fixed receipt/private-capture retention, consent/revision races,
current-source delivery, post-acceptance commit rollback, HTTP shields, current
MCP inventory and actual web/native JSX action handlers. Cold-process pool1
installation/migration cases pass24/24 (`/tmp/orbyn-channel-teams-current-cold.log`).
All workspace types, whole formatting, backend/web builds and both native
exports pass; exports do not establish native interaction or screenshots. The
Expo export reports the existing missing ios.appleTeamId setting; no signing
configuration was changed. No provider credentials were used or printed.

The separate identity recovery head6bda01e9 passed its immutable full local run
with3130 passes, zero failures and one existing Tesseract skip
(`/tmp/orbyn-channel-teams-identity-recovery-full.log`). Its CI backend job is
still pending at recording time. Current delivery/controls source still needs
immutable full/CI qualification before main promotion. Teams replies, real
tenant, visual/native acceptance and the remaining full ADR scope stay open.

## Full identity checkpoint qualification and catalog repair

Immutable05dc8265 ended its full local run with3129 passes, one failure and one
existing Tesseract skip (3131 total;722536ms), recorded in
/tmp/orbyn-channel-teams-identity-full.log. The failure was the generated MCP
catalog route-exclusion count: Teams adds five credential-only routes. The
canonical generator changes only that count from280 to285 in docs/mcp.md and
docs/mcp-catalog.json. Four catalog consistency cases pass after regeneration
(/tmp/orbyn-channel-teams-catalog-repaired.log). No application, migration or test
assertion changes are needed. Exact repaired-source full/CI qualification remains
required; preserve the earlier failing terminal result. Full ADR remains active.

### Recovery integration and full qualification restart

The immutable delivery full run7bda2185 was deliberately stopped to integrate
the complete recovery fixture isolationd926b03c (both runtime lanes), not treated
as a full pass. The merged candidate175529be is tracked-clean with the original
assertions intact. Regenerated credential exclusions287 resolve the catalog
merge; both evidence histories are retained. No unresolved conflict remains.
The integrated source now starts a fresh immutable full run.41 recovery cases
passed before this integration;112 delivery/controls cases and24 cold cases
remain focused evidence. Teams replies and whole ADR acceptance remain open.

## Teams exact-card reply boundary — separate candidate

Reused the merged plugin checkout oncodex/agent-teams-replies, based on the
frozen delivery candidate5bc0bc9d. Existing untracked dependency symlink and
character checkout remain unchanged. A pure authenticated boundary supports
manual `adaptiveCard/action` Execute submissions and a named Submit fallback,
ignores automatic refresh/unrelated activities, requires signed personal actor
and consistent tenant/conversation, and bounds event time and input. Exactly
one option or text answer is accepted; standing-approval/extra fields refuse.
Delivery/waiting IDs, complete-question digest and transient card nonce remain
claims requiring server receipt validation, not authority by themselves.
Canonical retry digests ignore provider retry metadata while binding input.

Eleven real-RSA protocol/security cases pass in
`/tmp/orbyn-channel-teams-reply-fallback-pure.log`; focused module/dependency
typecheck passes in`/tmp/orbyn-channel-teams-reply-fallback-types.log`. The
boundary is unmounted. It cannot currently accept or apply a question answer.
Still required: complete bounded card rendering and sent-card identity; encrypted
durable callback receipts/dedup and bounded acknowledgement; live source/owner/
conversation/revision/expiry fencing; exact current waiting ID/digest and atomic
answer/chat/receipt transaction; fixed retention; restart/stale/replay/privacy
DB/HTTP cases and real tenant/client acceptance. Approval opens Orbyn review.

Primary contracts: [Microsoft Universal Action Model](https://learn.microsoft.com/en-us/adaptive-cards/authoring-cards/universal-action-model)
and [Teams card actions](https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-actions).
Execute invokes use manual vs automatic triggers. Submit fallback supplies
merged form/action data. Invoke acknowledgements use HTTP200 with a typed body;
capture is described as pending validation, while stale/refused cards use a
generic supported400 error body, without exposing another question.

## Main promotion and clean qualification — 6 October 2026

PR205 merged as `cf119497`, exact `d926b03c`, all four CI37334932950 jobs pass
(3130 backend passes,0 failures,1 existing skip). PR206 merged as `34bcaaca`, exact
`5bc0bc9d`, all four CI37335334670 jobs pass (3180 backend passes,0 failures,1
existing skip). Main and candidate share file tree
`40c84049d2b659b6227e9f84b73573e9f1cf698a`.

Fresh marked database `orbyn_channel_replies_20261006_6_test` completed unchanged
source qualification:3180 pass/0 fail/1 existing skip,707974ms, terminal exit0.
Log:`/tmp/orbyn-channel-teams-delivery-5bc0bc9d-fresh-full.log`.
CI logs:`/tmp/orbyn-channel-teams-identity-d926-ci.log` and
`/tmp/orbyn-channel-teams-delivery-5bc0bc9d-ci.log`.
Earlier reused-database log remains `/tmp/orbyn-channel-teams-delivery-5bc0bc9d-full.log`
(3171 pass/9 fail/1 skip). Interrupted-run queued fixture jobs interfered with
global claim/recovery expectations; fresh unchanged-source qualification passed.
No runtime/test deadlines, assertion budgets or isolation guarantees were weakened.
Docker was not restarted or reconfigured. Root user dirt remains preserved.

Deployment, real-tenant acceptance and native/browser visual interaction remain
unverified. Teams question cards/parser live separately at `c483a323`;16 pure
checks and focused TypeScript pass, but no receipt/consumer/card integration is
mounted. These checkpoints do not close C6 or the full ADR goal.

## Durable exact-question reply candidate — 6 October 2026

The reply branch now mounts manual Execute and named legacy Submit through the
existing signed raw activity endpoint. Complete question cards acquire nonce
hash/digest/15-minute authority only when their owned outbox commits sent.
Migration251 adds one encrypted durable receipt per sent card; capture and
consumption independently recheck current owner, reviewed actor/conversation,
DM consent/revision/configuration, assistant grant, project/source access and
complete current waiting question. Automatic refresh does not capture answers.
Answer, chat turn and accepted receipt commit together; terminal receipts erase
answer content. Approval payloads have no channel answer controls. The notifier
consumes receipts separately from model execution. Both client permission rows
briefly describe updates/questions/morning results. Privacy version advances to
`2026-10-06-teams-replies`; retention remains fixed and works when unconfigured.

Tests:132 integrated channel cases pass in
`/tmp/orbyn-channel-teams-replies-integrated-current.log`;20 actual sweeper/reply
cases pass after the sweeper repair in
`/tmp/orbyn-channel-teams-replies-sweep-integrated.log`;9 selected cold pool1
cases pass on fresh marked database9 in
`/tmp/orbyn-channel-teams-replies-cold-current.log`. These prove stale/forged
bindings, revocation after capture, expiry, source contention, restart recovery,
chat-write rollback, lost commit acknowledgement, fixed retention, real signed
HTTP401/403/400/422/413/429 and typed invocation acknowledgements. Existing Slack
reply cases are included. Initial fixture and HTTP expectation failures remain
in the first/second/current-focused logs; no required refusal assertion was
removed. Invalid query follows the existing422 contract; malformed signed JSON
separately verifies400. All three workspace typechecks, backend/web builds and
whole formatting passed before final freeze; full immutable qualification is next.

Cold testing exposed existing `runSweep` pool starvation: a session advisory
lock occupied the sole connection while retention/catalog/deletion requested
another. The sweep now runs its autocommit slices and settings queries through
that held client. The stalled owned test process was terminated; its partial
8-case log is retained as `/tmp/orbyn-channel-teams-replies-cold-pool.log`, not a
passing result. Original sweep concurrency/composite-key/retention assertions
pass. No Docker restart, configuration or production pool change occurred.

The reused checkout's old dependency symlink pointed at the character checkout's
stale package builds. Its original link is preserved at
`/tmp/orbyn-teams-replies-original-node_modules-link`; this branch now owns its
workspace-package links/builds and reuses immutable external dependency links.
Character source/builds were not changed. Early type diagnostics from stale
packages/incorrect direct TypeScript options are retained; a real workspace
check subsequently caught and repaired the worker logger reference.

[Microsoft's bot message size guidance](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/build-conversational-capability)
distinguishes bot messages from incoming webhooks and recommends an80KB
message budget. The transport bounds complete serialized UTF16 messages before
any token acquisition/send; card content itself remains bounded at24KB.

Simulator inspection retried and again returned -10005 timeoutReached. No
native/browser visual or real Teams tenant acceptance is claimed. Candidate
reply behavior is not on main until full qualification and promotion complete.
Full C1–C6/M1/D1/U1 remains active; Docs and whole-app layout matrices follow.

Compatibility follow-up: verified the primary Universal Action Model contract
again. Its older-client example uses card version1.2 and wraps Execute/fallback
in ActionSet. The builder now uses that baseline and a visible free-answer label
plus the supported input placeholder; server-side bounds remain mandatory.
Using top-level version1.4 would prevent some older clients from reaching the
Submit fallback. A regression assertion covers the compatible card version.
No automatic refresh or approval action is introduced.
