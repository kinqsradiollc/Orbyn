# ADR 001 — Orbyn agent, provider, plugin and document platform

Date: 30 September 2026. Status: **accepted architectural direction; implementation incomplete**.

## Context and scope

The user authorized implementation of the revised DevDay plan with production checkpoints on main. Voice, computer use and the speculative Decisions API integration are excluded. The existing durable assistant, source visibility, approvals, receipts, Docs and managed connections remain the foundation. The governing acceptance contract is [the revised implementation review](../reviews/devday-2026-implementation-review.md), including M1, D1 and U1. No removed feature is required to finish this ADR's scope.

## Decisions

### 1. Separate Orbyn identity, provider credentials and executor identity

OpenAI identity linking creates an Orbyn account/session after verified issuer, audience, subject and nonce checks. Existing-account linking requires authenticated proof, not matching email alone. First-party sign-in, connector grants and plan-use authorization are separate transactions. SIWC is presented first where an eligible implemented flow exists; managed/BYO providers remain supported. Eligibility gates are visible release constraints.

Plan access/refresh tokens live only in their authorized user-controlled runtime and are never stored in shared Orbyn backend databases or plugin infrastructure. Executor registrations carry user, account/workspace, connection and host identity; leases fence concurrent devices. A device cannot extend its owner's backend rights. Server mutations always run through typed capability policy, durable receipts and revision guards.

### 2. Connection-specific adapters and model defaults

Use a discriminated connection contract for managed, BYO and plan-local routes. Implement plan streaming Responses separately from managed adapters; reject unsupported request fields/tools locally before sending. Preserve cancellation, typed completion/failure and checkpoints through SSE reconnects. A plan request must not silently become a managed billed request.

The credential owner fetches the account's `/v1/models` catalog. Expose the first-party `/models` contract and model selection through an authenticated sanitized snapshot, with explicit freshness/account generation. Only display eligible list entries and preserve provider ordering. Default model is scoped to user + connection + account/workspace. Revalidate on inference, model list refresh, account change and revocation. Never use an arbitrary curated fallback for unavailable entitlements. Managed usage and plan usage remain distinct; estimates are not provider billing guarantees.

### 3. Typed rules extend current assistant ownership

Migrate the current named assistant into the multi-agent owner model while retaining memory, goals, routines and preferences. Text standing instructions are not executable policy. Typed rules bind action class, agent and space; deny wins over ask, ask over allow. Allow cannot override ownership, source restrictions, team policy, hard stops, budgets or stale revisions. Recheck policy at execution, apply and notification delivery.

Persist activity events with authorized replay cursors. Polling remains a recovery mechanism. Use durable work reservations and distinguish estimate, reported usage and billed usage. Background plan jobs defer when the runtime is absent unless the user explicitly permits managed fallback.

### 4. Plugin has its own authenticated backend integration

Create a separately routed integration module/process boundary for plugin launch contexts, UI resources, tool calls and events. It resolves connector principals and resource/audience scopes independently of first-party sessions. Plugin backend calls use approved managed/BYO credentials; they cannot borrow plan tokens or first-party `/models` defaults.

Reuse the capability registry and domain mutation services through an explicit adapter. Do not proxy arbitrary first-party routes, trust host metadata as authorization, or duplicate transaction/receipt code. UI resources use declared schemas, CSP and bounded inputs; callbacks/events are deduplicated and replay-safe. Existing MCP tools remain portable when extension UI is unavailable.

### 5. Markdown remains portable structured content

Extend existing blocks and parser; preserve source syntax, stable block anchors and document revisions. Adopt the explicit D1 matrix for CommonMark/GFM, code, math, footnotes, callouts, reference links/frontmatter, TOC and Mermaid diagram families. Provide source/rendered preview synchronization, contained scrolling and export parity across desktop/web/mobile.

All diagram rendering is strict, bounded and bundled/isolated. Document input cannot relax security, insert script, trigger arbitrary network access or grant file access. Unknown syntax remains source; parse errors are recoverable inline. Mobile diagram parity cannot be declared from its current flowchart-only implementation. Preserve source links and authorization through preview, publication and exports.

### 6. Shared pages and channels retain bounded authority

Assistant-owned blocks identify exact block revisions and writable scope. Human edits are conflict checked. Page mentions launch deduplicated scoped jobs; effective authority is an intersection of actor rights, agent scope and page permissions. Public snapshot/live publication requires explicit consent, revocation and current source checks. Slack/Teams connections require authorized installation and exact waiting-card identity for replies.

### 7. Production checkpoints require current evidence

Develop in the isolated worktree and merge scoped ready commits into main. Documentation acceptance does not imply product completion. Every checkpoint records tests, migrations, clean Docker builds where affected, typechecks and runtime proof. U1 requires desktop/mobile responsive and native interaction checks for affected features, with stale state and overlay races. External account/provider/platform access gates are recorded as incomplete until actually exercised.

## Alternatives rejected

- One shared adapter/token store for plan, managed and plugin: incompatible permissions, billing and request contracts.
- Plugin UI directly calling first-party APIs under the browser session: confuses connector grants and account authority.
- Treating a model slug as globally entitled: catalogs and defaults vary by account/workspace.
- Replacing all existing editor blocks with a new renderer: loses anchors, suggestions and current document contracts.
- Arbitrary VS Code extension parity or executable HTML: unbounded behavior outside D1 and unsafe for shared documents.
- Merging partially verified product code because typechecks pass: does not establish UI/runtime correctness.

## Consequences and migration

New connection/executor, catalog/default, typed rule/agent ownership, activity, block binding and publication records will require versioned schemas and retention rules. Migrations preserve existing managed connections, named-agent settings and document source/anchors. The next implementation checkpoint must inventory exact current schema and affected clients before introducing migrations. Version API contracts in core/API client and include clean image dependency coverage, including the already repaired backend API-client packaging.

## Acceptance and current state

This ADR is complete as an architectural decision. Product implementation remains open in C1–C6, with per-feature acceptance criteria in the governing artifact. No OAuth runtime, new `/models` route, typed rules, mobile Mermaid parity, plugin service or UI repair is claimed by this documentation checkpoint.

### Integration constraint — 2 October 2026

Main now includes companion wardrobe and assistant chat redesign (`7c96f70`) and
companion editor save visibility (`e4370a3`). Preserve those characters, controls
and styling when integrating the broader platform and UI changes. Qualification
on an older main base does not qualify the combined version: integrate current
main and rerun the affected checks before each application checkpoint.

Assigned-source ownership PR #139 is merged as main `76ec92b`, from candidate
`51ce91b`, preserving the current character implementation. Its database guard
serializes Background/Overnight ownership across shared-task members. It also
corrects six off-scale character/assistant font sizes in both clients. Focused
checks, all workspace types, production builds and formatting passed. The full
local suite passed 2,103/2,103; CI passed all jobs with 2,102 backend passes,
zero failures and one Tesseract skip. Separate compiled processes verified the
guard; main has the same tree as the qualified source and CI merge commit.
This is a merged checkpoint, not a deployment or whole-app UI completion.

Handoff acknowledgment source `6fd43f4` derives receiving outcomes from
current completed-job evidence, checks producer revision and both jobs' access,
and serializes idempotent retries. The combined contract/storage/request checks
passed 27/27, with backend types and formatting. It does not enable dispatch,
grant receiving authority or prove separate-worker collaboration. Source
`deb93cb`/`114bb2d` also derives durable failure reasons without copying provider
error text or restricted outcomes; its 32 contract/storage/request checks and
backend types passed. Handoff services remain unmerged and unwired.

Docs PR #138 candidate `514679f` includes current main and characters, Unicode
heading links and owning-page URLs. All 56 focused checks, workspace types,
production builds and formatting passed. The full local suite passed 2,111/2,111;
CI passed all jobs, with 2,110 backend passes, zero failures and one Tesseract skip.
Its fresh native verification is blocked by an iOS password-save prompt, pending
the user's dismissal. Web/mobile-web and native Android interaction gates remain
open. The governing review and implementation handoff
retain the full remaining scope; these checkpoints do not complete the ADR.

Persisted activity source now implements migration 210, owner/runtime sequence
counters, content-free job transition events, a private authorized replay route,
typed client recovery and 90-day event retention. Heartbeats, polling and
checkpoint-only writes create no activity. Imported historical jobs do not
fabricate fresh completion timestamps. Current source visibility filters live
job links; expired jobs retain only content-free historical events. Queuing alone
does not set last-work activity. Sixty focused activity, handoff, sweep and runtime
checks passed on a fresh marked test database. The isolated activity candidate
`01b8757` is now merged through PR #140 as main `9e7e505`: 2,112/2,112 full local
tests, workspace types, production builds, full formatting and all CI jobs passed.
Candidate, CI merge and main trees match. Main `2ba1ae2` records scope continuity.
Profile UI, worker dispatch, budgets and separate-process collaboration are open.

Profile source now adds a private read-only snapshot and a Your agents panel on
both clients, retaining the main character design. Working requires a current
execution lease; expired leases are recovery pending, waiting remains distinct,
and an empty night window is idle. Future enabled windows can be scheduled.
Last-work time comes from authorized persisted events, not presence. Existing
night token estimates and limits are shown as estimates, not billed usage or
new budget reservations. Shared request cancellation fences closed/account-change
generations and clears stale status after failure. Forty-two focused checks,
all workspace types, production builds and scoped formatting passed. This is
unmerged source; responsive/native interaction, reviewed permissions, durable
budget reservations, dispatch and complete collaboration still need proof.

Profile recent activity and completed-output links now exist in both clients.
The snapshot bounds each lane to eight events and five outputs, applies current
source visibility, and removes output links after job deletion. Imported historical
jobs and later outcome edits cannot invent fresh completion timestamps. Mobile
opens an output after sheet dismissal; both clients use the existing chat access
checks. Current corrected-source regression passed 19/19, with 21/21 character/
style/catalog checks, all workspace types, production builds and scoped formatting.
This is a source checkpoint, not a merged or visually qualified UI. The full
governing review, including D1/U1 and whole-app mobile parity, remains required.

The scheduler still used a global queued/running busy check after worker lanes
were separated. Source `0ae3d05` scopes that check to Overnight: unrelated
Background/interactive jobs no longer block it, while own-lane serialization and
the shared-task ownership guard remain. Four regression cases failed before the
fix; all 53 focused night/runtime/ownership checks passed afterward. Isolated
main candidate `9b87ce3` is draft PR #141 with full qualification in progress.
It does not enable handoff dispatch or complete agent collaboration.

Retained plugin recipient/discovery work is reconciled with main `2ba1ae2` in
`9ce1961`, draft PR #142, preserving newer runtime and character changes.
Recipient-specific consent/grant lookup, code/refresh binding, public configured
discovery and authentication challenges remain separate from portable MCP and
first-party sessions. All eight overlaps are resolved; 62 current focused checks
passed. Combined full qualification is running; previous branch results do not
qualify this tree. Actual consent/host launch, provider calls, gateway/deployment
and plugin UI/resources/events remain required, and the candidate is unmerged.

Typed action restriction source `4ec8644` preserves existing named-assistant
ownership and adds bounded, revisioned runtime/action/space rules. Current write
transactions load persisted restrictions under the grant lock; deny dominates
ask/allow without raising underlying authority. Approval cards and apply checks
fence rule revision changes. Nineteen focused regressions and backend types
passed, plus seven tests with all migrations in a fresh marked database, including
actual concurrent rule/write locking. This source is unmerged and not full A4:
agent ownership migration, cross-client editing/inspection, proposal provenance,
read/effect rules, receiving budgets/dispatch and separate-worker handoffs remain.
No public rule editing route or inferred standing-instruction policy is enabled.
