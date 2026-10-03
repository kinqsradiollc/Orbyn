# Separate plugin async import candidate — 3 October 2026

## Implemented locally

The separate plugin service has bounded POST /plugin/jobs/imports and GET
/plugin/jobs/:id/events routes. Starting uses the existing start_import
capability, independently authenticated plugin principal, policy/quotas and
transactional domain receipts. Refusal/approval results remain ordinary tool
results; no fake job is created. Replaying the same receipt returns the same
job. Initial status and converter transitions persist in dedicated grant/owner
job and event tables. Events contain status only. Duplicate same-state updates
produce no new event. Expired jobs/events cascade through the standard sweeper.

Retrieval uses fresh locked plugin authority and source locks. It checks the
original project, current import destination and resulting document (including
AI visibility, memberships and Trash) before events or links. It locks imports
before jobs, matching converter trigger order. Reads do not update last_write_at.
Response schemas bound pages to100 events, opaque cursor512 characters, typed
job/status fields and a current document link. No file/document title or content
is persisted in status events. Cursors bind owner/grant/client/resource/job/current
permission scope/source identity, expire and reject structural/sequence abuse.

## Observed evidence

- Cursor/store/protocol units17/17 terminal0:
  /tmp/orbyn-plugin-import-final-units.log.
- Actual separate-service integration13/13 terminal0:
  /tmp/orbyn-plugin-import-final-service.log. Includes start_import through the
  new route, same-receipt replay, converter-style status updates, duplicate
  suppression, cursor continuation, current personal-scope denial and deleted
  document refusal; shield401/403/400/429 with Retry-After on both new routes.
- First shield failure reused a previously saturated IP bucket. Independent
  fixture IPs restore isolation without weakening the status assertions.
- Positive start test initially had importing disabled. It now supplies/restores
  a dummy fixture FILES_SECRET; production configuration was not changed.
- Backend types38475/72059 and build72544 terminated0. Full formatting75644
  observed a routes file being edited; final formatting/type/build required.

## Remaining gates — not ready for main

The integration seeds completed import/document state; it does not prove real
uploaded-file conversion. Converter final writes currently recheck the user's
project access but do not carry/recheck the originating plugin grant. Add durable
producer provenance and current grant/client/trust/source guards before those
writes; prove revocation and project-policy changes during execution. Keep this
candidate out of main until that write-authority gate is addressed.

Also required: cross-account/grant and expired/deleted source integration,
concurrent progress/retrieval and bounded large event pagination; protocol task
methods/async plan jobs and hosted launch/UI/account/provider flows. Full exact
committed-head suite/CI and the retained C1–C6/M1/D1/U1 audit remain open. This is
an async import increment, not complete C6 or ADR delivery. No main merge,
deployment, release or original-work cleanup occurred.

## Producer guard follow-up — latest 3 October

New server-owned import origin records grant/client/recipient inside the capability
write transaction, covering synchronous plugin starts as well as the async route.
The origin flag survives FK deletion and never becomes a first-party fallback.
Before INSERT docs, the converter locks current OAuth/grant/user/client/membership
and project authority, checks file write scope, trust, account/client/policy state
and expiry, and attributes successful writes to the plugin grant. No bearer or
user-controlled plan token is stored or recovered.

The real Word upload/file-store/converter/page/event flow now passes, including
11 denial variants: revocation, grant deletion, read-only, lost Personal, ask-first,
blocked client, project exclusion, token expiry, grant expiry, disabled owner and
lost file toolset. Denied cases save no page and retain the origin flag. Final
serial checks30/30 terminated0, no skips/cancellations:
/tmp/orbyn-plugin-producer-final-regressions.log. The earlier parallel20/20 run
is retained as exploratory evidence; qualification uses serial DB suites.

Plugin migrations are renumbered215/216 to follow main's214 doc reference
migration. Existing candidate/identifiable legacy plugin starts lack a trustworthy
original recipient snapshot and fail closed pending reimport. Drain legacy
in-flight imports before production upgrade; deleted legacy grants can have lost
activity attribution. This is a rollout limitation, not a reconstructed identity.

This follow-up supersedes the earlier missing-write-guard paragraph. It still
requires latest-main integration, fresh full/CI, broader cross-account/concurrency/
expiry/large-page and protocol/host acceptance. No complete C6/ADR claim.

Upload admission and the post-stream queue transaction now use the same current
producer guard. Revocation before upload creates no reservation; revocation
mid-stream clears the reservation and deletes both ciphertext/key files before
returning403. Actual real-stream fixtures verify those filesystem removals,
failed/waiting state and zero documents. Latest serial30/30 terminal0:
/tmp/orbyn-plugin-producer-guard-regressions.log. These two variants add to the
12 earlier conversion scenarios; permissions are not held for the whole stream.
