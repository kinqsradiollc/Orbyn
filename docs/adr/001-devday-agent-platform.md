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

Scheduler PR #141 is now merged as main `7f3894f`; ADR evidence is committed on
main `9e1a2c8`. Full local 2,120/2,120, all types/build/format and all CI jobs
passed; candidate, tested merge and main trees match. Plugin candidate `9ce1961`
passed 2,116/2,116 and all CI jobs but remains draft with interaction gates and
current-main integration outstanding. Neither checkpoint is a deployment.

Proposal rule source `35d186f` records server-generated runtime/revision/action-
space evidence and rechecks it under the original grant at human review. Rule
edits invalidate stale suggestions. Built-in and plugin plan identities are
preserved; a plan cannot choose another connection or take assistant identity
from its action input. Thirty-six current regressions, backend types and seven
fresh-database migration/review tests passed. This is unmerged source. Current
job/source provenance, read/effect/notification checks, agent records, cross-client
editing, budgets and actual receiving-worker collaboration remain required.

### Activity checkpoint and scope continuity — 2 October 2026

PR #140 is merged as main `9e7e505`, from frozen candidate `01b8757`.
Migration 210 records content-free job transitions in separate owner/runtime
streams with monotonic replay cursors and 90-day event retention. The private
read route and typed client recheck current source visibility. Polling,
heartbeats and checkpoint-only writes do not fabricate work activity.
The fresh marked database suite passed 2,112/2,112, with no failures, skips or
cancellations. Workspace types, production builds and full formatting passed;
all four CI jobs passed. Candidate, CI merge and resulting main trees are
identical (`f62fdf5209f0dfb77b60ccb5788724c005742d04`). No deployment occurred.

The governing revised implementation review remains the full acceptance
contract. This checkpoint does not narrow it to assistant chat or activity:
whole-app layout, Docs editing/rendering/export, views and settings, provider
and embedding options, actual account-specific model execution, separate plugin
integration, typed agent rules, durable budgets and bounded cross-runtime
collaboration remain required. Web/desktop features require mobile parity.
Preserve main's character work and Orbyn's palette. Unverified responsive/native
behavior and external integration gates remain open. Related worktree cleanup
comes after integration and qualification, without discarding retained work.

### Independent Overnight scheduling checkpoint — 2 October 2026

PR #141 is merged as main `7f3894f`, from frozen candidate `9b87ce3`.
The scheduler's per-owner busy check now applies to Overnight jobs; unrelated
queued/running Background or interactive jobs cannot starve its night work.
Own-lane serialization and the shared-task ownership guard remain enforced.
Four new regression cases failed before the correction. Afterward, the focused
night/runtime/ownership suite passed 53/53 and the fresh full local suite passed
2,120/2,120 with no failures, skips or cancellations. All workspace types,
production builds and full formatting passed; every CI job passed. Candidate,
GitHub merge and resulting main trees match
`3e2d1b8410f139b625c88036679d62a77c08caca`. No deployment occurred.

This completes a scheduler checkpoint, not bounded handoff dispatch or full A4.
Typed rules, agent ownership records, durable budgets, receiving authorization
and cross-runtime round trips still require integration. The whole-app D1/U1,
provider/model, plugin and mobile parity deliverables remain in scope.

### Current main/source reconciliation — 2 October 2026

The chronological record above includes earlier candidate states. Current main
**dabb770** includes qualified PR **#143**, merge **9c344b8**: typed write rules,
stale approval fences and server-held Review producing-job/rule/runtime authority.
Exact **e58ed27** passed **2,141/2,141** full local tests, all workspace types/build/
format and all CI jobs **36995158096**. Candidate/CI merge/main trees matched.
Public rule editor routes/UI remain disabled and full A4/D1/U1 remains active.

Scoped privacy/deletion candidate **f79c852**, draft PR **#144**, is frozen on
current main with full qualification running. Source **977288c**, **866e4c0**,
**411935e** retain owner/team history during ordinary target removal, suppress
notice job-only source exposure and hide Review summaries after source loss.
Actual generated runtime, providers, Docs, profile and whole-app UI/native/browser
acceptance, typed agent records/editor, budgets and receiving collaboration remain
required. Character work is preserved; no deployment or cleanup occurred.

### Qualified source privacy and parent deletion checkpoint — 2 October 2026

PR **#144** is merged as main **eccf338**, from frozen candidate **f79c852** on
base **dabb770**. Migration 213 prevents account/team cascades from recreating
history-access metadata for a disappearing parent; ordinary target deletion
retains original owner/team history. Personal notice enqueue/inbox/push delivery
checks job-only dependencies; Review summaries, counts, outcomes and saved
notices omit unavailable producing-job sources. No production data was touched
during reproduction. Current access protection does not prove source revisions.

Fresh marked database full local suite passed **2,151/2,151**, no failures/skips/
cancellations (563,046 ms); combined focused suite **69/69** passed. All workspace
types, production builds and full formatting passed. Every CI job
**36996647235** passed. Candidate, GitHub merge **2f1984a** and resulting main
trees match **a903b6c7158871b05472e3afb54d824290df80fa**. No deployment occurred.

The entire revised acceptance contract remains active: account-specific real
model execution/defaults, provider/embedding options, separate plugin backend
and supported host integration, full Docs Markdown/Mermaid parity, whole-app
web/desktop/mobile UX, independent agent profiles and bounded authorized
collaboration, typed ownership/rules/editor, reviewed source revisions and
budget reservations. Public rule editor remains disabled. Preserve character
work, Orbyn palette and mobile parity; cleanup follows complete integration and
qualification. Voice/computer-use product features and speculative Decisions
remain outside scope.

### Handoff dependency revision evidence — source checkpoint, 2 October 2026

Requested handoffs now bind current recorded dependency revisions, in addition
to producer result, Review/Undo outcome, runtime and container. Source row locks
fence concurrent edits during reviewed request/acknowledgement. Reading/polling
transcripts does not create a new revision; substantive edits invalidate earlier
requests or acknowledgements. Four stale-source regressions and the lock race
failed before correction. Fresh migrated source cohort passed38/38, backend
types and scoped formatting passed. This source checkpoint remains unmerged.

This is not original provider-read version snapshots, complete dependency closure
or authority to dispatch receiving jobs. Per-agent ownership/rules, current
receiving permissions/connection, durable budget reservations and actual separate
worker handoff/recovery/UI proof remain required. Full model/provider/plugin,
Docs/Mermaid and whole-app web/desktop/mobile acceptance remains active.

### Cached result authority — source checkpoint, 2 October 2026

Assistant write retries previously returned cached private results before current
destination policy ran. Source now binds the result to a server-generated digest
of effective owner/grant, lane/job, scope, team role/policy, toolsets, flags, trust
and typed rule revision. Changed or legacy-unbound authority holds the result;
the original mutation is not repeated. Names and set ordering do not invalidate
equivalent authority. For job-bound results, replay also checks the owned current
container, immutable runtime lane and strict recorded source visibility.

Four authority regressions and three producing-source regressions failed before
their respective fixes. Current rules/trust/Review/handoff/replay cohort passed
72/72, with backend types and scoped formatting. This is unmerged source, not
complete replay authorization: target visibility and grant-scoped dependency
closure, original provider-read versions, concurrent source fencing and replay
across every supported target family still require implementation and proof.
The full ADR, whole-app and mobile acceptance gates remain open.

### Qualified current assistant authority checkpoint — 2 October 2026

PR #145 merged as main **3450e87**, from frozen candidate **04d1ff7** on
base **456e01a**. Each capability reloads the current owned active assistant
grant and intersects it with server-selected caller restrictions. Current
Personal/team access, team role/policy, toolsets, trust, approval exceptions and
outside-content restrictions cannot expand earlier authority. Reads use primary;
writes serialize grant changes. Typed rule revision fences remain in place.

Exact candidate full local suite passed **2,157/2,157**, zero failures, skips or
cancellations,556,800ms, on fresh marked **orbyn_authority_04d1ff7_test**. Workspace
types, production builds and full formatting passed. All CI **37000288172** jobs
passed; backend passed2,156 with one Tesseract skip and zero failures. CI checked
merge **a94a7c4**. Candidate, CI merge and resulting main trees are identical
**94774365fcabd2b7d331d35a3d110880dce5a641**. Main fast-forward preserved user
mobile/app.json and unrelated files. No deployment occurred.

Source **c237cfb** additionally binds cached assistant results to effective
authority and rechecks producing-job/container/current sources. Its72 focused
checks and backend types/format passed, but it remains unmerged pending complete
cached-target authorization, grant-scoped dependency closure and source revision/
concurrency proof. Private receiving handoffs/budgets, typed read/effect/notice
policy, agent ownership/editor, full real account models/providers/embeddings,
plugin host acceptance, complete Docs/Mermaid and whole-app web/desktop/mobile
UI gates remain required. Preserve Orbyn palette and characters. Saved web
preview denial remains respected; cleanup follows complete integration and
qualification. Voice/computer-use product features and speculative Decisions
remain outside scope; the full ADR goal remains active.

### Current cached target and effective source scope — source checkpoint, 2 October 2026

Cached assistant result targets and structured resource links now recheck current
effective grant scope. This covers the32 receipt families currently produced by
write capabilities, including persisted resources and synthetic settings/focus
receipts. A foreign owner, excluded project, removed/off team or source moved
beyond the earlier caller's teams cannot expose the stored private answer.
Scoped source helpers preserve the existing owner-wide projections when no
restriction is supplied. Identity/reference parsing never treats prose or plan
step labels as authorization evidence. Holds do not rerun the original mutation;
restoring target access can return that original answer with the same client_ref.

Two real regressions failed before correction. Current focused rules/Review/
handoff/notices/visibility/replay suite passed98/98. Positive/foreign-owner tests
exercise persistent receipt families against PostgreSQL; synthetic Personal and
team receipts, disabled team policy and linked focus destinations are covered.
Family-specific bounded queries replaced a costly combined CASE: observed local
task check fell from3,327ms to34ms. This is not a production latency benchmark.

Original provider-read versions, complete nested dependency closure, concurrent
source fences, other persisted replay paths, receiving handoffs and budgets,
typed read/effect/notice policy and owner/editor UI remain required. This source
needs current-main full qualification before scoped promotion; it does not
complete cached-result security or the full M1/D1/U1 and C1–C6 ADR acceptance.

### Completed document draft replay — source checkpoint, 2 October 2026

A completed long-document draft can return its persisted answer under a new
client_ref. That path previously disclosed saved page titles and identities after
destination project exclusion, page deletion or loss of effective Personal scope.
All three regressions failed before correction. It now rechecks current producing
job/source access and every saved destination before returning any saved result
or draft-completed error. Unchanged access and restored access return the original
answer without creating another page. Ordinary connector behavior is preserved.

The current source cohort passed103/103, with backend types and scoped formatting.
This follow-up is separate from frozen PR #146; it is not included in that PR's
full qualification. Complete nested dependency closure, original provider-read
revisions, concurrency fences and other persisted fast paths remain open. The
full model/provider/plugin, Docs/Mermaid and whole-app/mobile ADR remains active.

### Qualified cached assistant result checkpoint — 2 October 2026

PR #146 merged as main **c9b6c78**, from frozen **0033a96** on unchanged base
**7c08aa6**. Assistant cached write results bind to current effective authority
and recheck producing job/container/source access, grant-scoped source visibility
and typed targets/structured links across the32 produced receipt families. A held
result does not repeat the mutation; restoring target access can return the
original answer. Ordinary connector replay remains unchanged.

Exact candidate local full suite passed **2,176/2,176**, zero failures, skips or
cancellations,556,169ms. All workspace types, production builds and full formatting
passed. All CI **37003294826** jobs succeeded; backend passed2,175 with one
Tesseract-dependent skip and zero failures. CI merge **cd57b95**, candidate and
resulting main have identical tree **0d1f05994b7ed460131fe2e16ba9d3ad4ce59222**.
Local main fast-forward preserved user mobile/app.json and unrelated files.

This checkpoint does not complete replay security or the full ADR. Original
provider-read revisions, nested dependency closure, concurrent source fences and
other persisted result paths remain open. Completed document draft replay is a
separate source follow-up, not in this merge. Receiving handoffs/budgets, typed
read/effect/notice policy, owner/editor UX, actual models/defaults/execution,
providers/embeddings, separate plugin host acceptance, complete Docs/Mermaid and
whole-app web/desktop/mobile acceptance remain required. Preserve palette and
characters. No deployment or cleanup occurred; voice/computer-use product
features and the speculative Decisions adapter remain excluded.

### Qualified completed document draft checkpoint — 2 October 2026

PR #147 merged as main **4bbcfec**, from frozen **53089fd** on base
**e1d46af**, at 12:25:15 UTC. Completed append_doc answers replayed under a
new client_ref now recheck producing evidence and destination access before
returning saved titles, identities or links. Restored access returns the saved
answer without another page mutation. Five focused regressions cover unchanged
access, excluded projects, deleted destinations, narrowed personal access and
restored access. Ordinary connector guards remain unchanged.

Exact candidate local full suite passed **2,181/2,181**, zero failures, skips or
cancellations, 590,567 ms, on fresh marked orbyn_draft_candidate_test. All
workspace types, production builds and full formatting passed. All CI
**37004911014** jobs succeeded; backend passed 2,180 with one Tesseract skip.
CI merge **94006ee**, candidate and resulting main have identical tree
**ab575239dd8e10fab7a52d32946a75a1229ab95f**. Local main fast-forward preserved
user mobile/app.json and unrelated files.

This closes the completed-draft fast path only. Original provider-read revisions,
nested dependency closure and concurrent source fences remain open, alongside
models/defaults/execution, providers/embeddings, separate plugin integration,
agent collaboration/reflection and whole-app Docs/UI acceptance. Preserve palette
and characters; voice/computer-use product features remain excluded. No
deployment or cleanup occurred. The full ADR remains active.

### Native Mermaid correctness checkpoint — 2 October 2026

Source dc5a2c8 fixes failures reproduced on the actual bundled engine in the
owned narrow iOS preview: static diagrams rejected by unconditional stock CSS
keyframes, initial horizontal clipping, omitted vertical padding, unreadable
dark ER attribute rows and failed deferred native export dependency loading.
Only exact inert stock keyframe bodies are stripped; unknown CSS at-rules,
escapes and external resources remain rejected. Width is measured and diagrams
fit initially, with relative zoom and Fit reset. Height includes host padding;
ER row colors come from validated Orbyn surface tokens. Expo export dependencies
are loaded in the initial module graph. No new permissions or network access.

Corrected before-fix regressions failed; combined final cohort passed26/26 with
mobile/backend types passing. Native flowchart/sequence/state/ER rendering,
sequence zoom/refit/source and SVG file creation/system handoff are proven in
docs/reviews/evidence/mermaid-native/. No recipient or save destination selected.
Six remaining diagram families, malformed/large fixtures, light theme, Android,
web/mobile-web and complete Docs/UI acceptance remain open. Source7026041
reconciles current mainc30c5fc; its sole conflict was a test blank line, with all
regressions preserved. This source checkpoint is not merged or deployed.

### Screenshot acceptance requirement — user clarification, 2 October 2026

Every web, desktop and mobile redesign must include screenshots of the actual
running surface and inspection for overlap, clipping, label readability, toolbar
wrapping and nested overlay containment. Include relevant narrow/wide widths,
both themes, long content and keyboard/large text states. Store provenance with
commit, platform, viewport, fixture and observed defects. Passing tests, builds
or responsive web screenshots do not replace native evidence. Unavailable
surfaces remain explicitly unverified and cannot be declared complete.

Mermaid's ten native fixture families now rendered, but screenshot review exposed
further styling defects. Shared palette rules and adaptive measured Gantt tick
selection are implemented for web/desktop and mobile. Native rechecks prove pie
segment distinction, non-overlapping Gantt dates and restored Morning journey
section text. Mindmap root alignment/faint links and small fitted labels still
need work. Fullscreen/zoom usability and remaining platform/theme gates stay
open. This remains an implementation checkpoint, not release acceptance.

### Home agent presentation — 3 October 2026

Apply the user’s Muse/Dots direction to both public and signed-in Home, with native
parity. Research: [Muse design](https://introducing.muse.ai/) emphasizes visible
background activity, meaningful interruptions, and task-shaped outputs;
[official Dots documentation](https://learn.chatgpt.com/docs/dots) describes work
between conversations and separate task activity. These inform the presentation,
not additional Orbyn capabilities or blanket permission to act.

Home should explain a concrete responsibility and where to review its result.
Public examples must be labeled examples, never fabricated live runs. Use two
plain editorial rows for Background and Overnight, with separate timing and
morning review descriptions; keep character customization distinct from work.
Signed-in Home opens real permission-filtered profiles with activity and outputs.
Idle must remain idle when no authorized work exists. Reflection and inter-agent
collaboration remain existing acceptance gates, not advertised completed features.
Preserve Orbyn tokens and character preferences; avoid generic slogans and a
repeated grid of decorative feature cards.

The user owns web visual validation on their test server for this increment.
Code/build checks do not establish visual acceptance. Native screenshot and
interaction acceptance remains required and the disposable account’s terms
confirmation is still pending.

3 October D1 frontmatter checkpoint: closed initial YAML metadata is preserved
as one literal source block, including delimiters, blank lines, BOM, tags and
anchor-like text; it is never evaluated. Both client code views identify it as
YAML frontmatter and use bundled syntax coloring. A moved or malformed edited
block exports as a safe fence. Leading thematic rules serialize unambiguously,
and legacy anchored rules remain rules. Markdown and HTML export regressions
cover source retention and script escaping. This does not complete reference
links, synchronized source/preview, D1 export coverage or whole-app U1. Native
visual acceptance remains pending, with the explicit terms confirmation gate.

### D1 source and preview synchronization — 3 October 2026

The candidate now maps the existing anchored serializer to exact block offsets
and lines. Web source and rendered panes synchronize scrolling from actual
block geometry, suppress reciprocal programmatic scroll events, and share the
parent editor's live blocks. Native preview scrolling retains the corresponding
source block when toggling. Both previews own heading/stable-block navigation;
opening a different page dismisses the preview and uses existing app routing.
No separate draft, revision or save request is introduced. Source is read-only.

Mapping and actual component regressions pass 12/12. Current mobile types and
desktop production build qualify code paths only. Real browser/native geometry,
link interactions, screenshots, keyboard and theme acceptance remain unproven.
Raw-source editing is not introduced or claimed; the editor continues to own
changes. Full D1 and U1 remain incomplete.

### D1 Mermaid rendering bounds — 3 October 2026

Desktop now applies the same 65,536-character/2,048-line input and 2 MiB output
bounds as native. Diagram configuration is locked, with strict security, inert
labels, 512-edge limit and suppressed engine error drawings. Shared preparation
rejects configuration headers/directives and image/icon pack or CSS resource
URLs before rendering; unsupported source remains available. Native's bundled
asset is regenerated from that shared source.

Twenty-three bounds/runtime/actual desktop effect regressions pass, all ten
diagram family fixtures parse under the real strict engine, desktop build and
mobile types pass. These checks establish neither visual acceptance nor complete
SVG resource sanitization on desktop. Current whole-page HTML export emits
Mermaid source, while standalone diagram SVG export exists; rendered whole-page
HTML/PDF parity remains an explicit D1 gap, not closed by source fallback.

### Home copy follow-up — 3 October 2026

Replace vague first-screen metaphors with tasks, calendar, project notes and
delegated work. Present Background and Overnight as separate work schedules,
with an explicit review destination for each. Label illustrative requests as
examples and keep idle behavior truthful. Muse informs visible activity and
meaningful interruptions; Dots informs work between conversations. Their
capabilities do not establish capabilities in Orbyn. Reflection and collaboration
remain open acceptance gates. This follow-up changes copy only; the user’s web
visual validation and native acceptance remain outstanding.

### Home responsibility and review layout — 3 October 2026

Follow-up research confirms the useful presentation patterns: Muse puts activity
and approved permissions behind the avatar; Dots brings back results and asks
for decisions between conversations. Use the primary sources linked above.
Orbyn adopts visible responsibility, review destinations and pause conditions.
It does not inherit their cloud computers, app access or always-on execution.

Public Home uses a straight, in-flow planner example and two editorial agent rows
with labeled requests, review destinations and stopping conditions. Shared core
copy keeps the web and native signed-in Home descriptions consistent. No status
or output is fabricated. Reflection and collaboration remain open acceptance
gates. All character presets remain available; browsing never changes identity.
Web visual acceptance belongs to the user's test-server review for this increment;
native screenshot and interaction acceptance remains open.

### Whole-page HTML diagrams — 3 October 2026

Render only Mermaid regions in the existing permission-filtered export snapshot.
Both clients use the same bounded, strict first-party isolated engine, deny network
access, and embed sanitized SVG as inert image data URIs. Escaped source remains
available. Failure gives a generic caption with source; scope change or editor
close cancels the file. Serial bridge requests retain a live engine through a
batch and reject stale replies. Desktop loads the engine lazily.

Evidence: `docs/reviews/evidence/diagram-html-export.md`; 37 focused checks,
17 export API checks, all ten real engine parse/render families, workspace types
and production build pass. DOM geometry is synthetic; offline Chrome checks are
engine evidence, not app screenshots. Native sharing, user web visual review,
PDF/publication/server-direct rendering, latest-unsaved-revision export and full
D1/U1 acceptance remain open. This does not close the ADR.

### Home responsibilities before decoration — 3 October 2026

Rechecked primary product references: [Muse's design account](https://introducing.muse.ai/)
puts work status, activity and approved permissions behind the avatar, and describes
notifications for meaningful results or input. [Dots documentation](https://learn.chatgpt.com/docs/dots)
describes ongoing responsibilities between conversations. Use those interaction
patterns to explain Orbyn's existing work; they do not prove Orbyn has the same tools.

Public Home now gives Background and Overnight their own section before the feature
catalog and character gallery. Navigation opens the agents section. Each has a timing,
a labeled example request, a review destination and a stopping condition. Replace
vague supporting slogans with specific task, calendar, project and review copy.
Character presets stay available in their own section. Signed-in web/native Home
must show the same timing and pause details alongside their existing activity entry.
No fake running states, always-on promise or completed reflection claim is introduced.
Code tests establish content and ordering, not screenshot acceptance. The user's
test-server web review and native visual acceptance remain open.

### Export revision fence — 3 October 2026

An editor may bind file export to its last confirmed saved document revision.
The API checks visibility before the revision and returns409 on a mismatch for
all formats. The shared client carries the optional version and never silently
retries a conflict against a newer revision. Existing unversioned callers remain
compatible. Candidate API/client checks pass; editor save-success and offline
failure integration, revision capture during concurrent typing, and every share
path remain required before current-source export acceptance can close.

### Home density follow-up — 3 October 2026

Rechecked [Muse's design account](https://introducing.muse.ai/) and
[Dots' profile and task controls](https://help.openai.com/en/articles/20001530-getting-started-with-your-dot).
Muse explains task-shaped outputs and updates worth interrupting for; Dots exposes
work through activity, schedules and profile controls. Apply those presentation
patterns to Orbyn's verified responsibilities, retaining its palette and characters.

Public Home gives example requests their own readable quotation and keeps results
and stopping conditions alongside them. Signed-in web/desktop and native Home
show two compact responsibilities first, with detailed requests, review destinations
and pause conditions behind an accessible “How agents work” toggle. Agent activity
remains the primary action; character browsing remains a separate action.
No invented activity or outputs appear. Reflection, shared handoffs and full agent
runtime acceptance remain open; this change does not advertise them as delivered.

Thirteen Home content/interaction checks pass, including opening/closing the guide
on both clients, separate profile access and preserving all character presets.
These checks do not establish visual acceptance: the user will review web on the
test server; native screenshots/interaction acceptance still remain required.

### Confirmed revision on editor file actions — 3 October 2026

Both editors keep a dedicated server-confirmed export snapshot, separate from the
optimistic CRDT merge baseline. Editable file actions flush once, then compare
the current title/content structurally with that receipt. Offline-only or caught
save failures, newer typing during the save, invalid revisions and changed page
identity stop the export. A successful action sends the confirmed version to the
permission-filtered API; it never silently exports a newer remote revision.
Readers and suggestion mode export the saved page without applying an unapproved
draft. Every format and Markdown/PDF share entry uses this guard.

Editor/account scope teardown cancels before a new scope paints; native file
conversion and sharing availability recheck cancellation before creating or
handing off files. Web sharing rechecks before its download fallback.
Forty-nine focused checks exercise shared equality, actual editor save/export
functions, share menus, native file actions and renderer scope teardown. Workspace
types and production build pass on the combined source. Full current-head local
qualification, PDF rendered math/diagrams, publication/server rendering and actual
native file/share interaction remain required. No full D1/U1 acceptance is claimed.

### Saved-revision export API checkpoint — 3 October 2026

Optional expected document versions protect file exports against concurrent
changes. Check visibility first, then return409 for any format at a different
saved revision. Invalid versions use the established422 schema response. Shared
clients carry the revision and never silently retry against a newer one.
Unversioned callers keep their existing behavior. The isolated candidate passes
17 export API checks, one real client check, all workspace types and production
builds. Exact-head CI remains required before merging this checkpoint.

This is API foundation only: both editors still need explicit save-success and
offline/failure handling, revision capture and all share-path integration.
Rendered PDF, publication, native sharing and whole D1/U1 acceptance remain open.

### Primary reads for file actions — 3 October 2026

Export file transport does not carry the ordinary JSON transport's read-after-write
header. Lag-tolerant replica reads could falsely reject a newly saved revision or
return older content/visibility. Both the file export route and its legacy Markdown
route now use the primary for the document and task/link permission enrichment.
This gives file actions current primary state even for existing unversioned callers.
Current-version conflicts and visibility-first404 behavior remain unchanged.
Regression checks execute the actual handlers with distinct primary and replica
dependencies; no export query or helper may use the stale replica. This is a
backend freshness checkpoint; PDF visual rendering and full D1/U1 remain open.

### Public Home request examples — 3 October 2026

[Muse's design account](https://introducing.muse.ai/) describes task-shaped outputs
and meaningful updates. [Dots' profile documentation](https://help.openai.com/en/articles/20001530-getting-started-with-your-dot)
exposes activity and task controls. Use those presentation patterns to make
Orbyn's existing responsibilities easier to understand. Public Home now gives
each agent a labeled example quotation, followed by where to review the work
and when it pauses. Preserve all character presets, Orbyn tokens and truthful
idle behavior. This checkpoint changes public presentation only; signed-in/native
Home refinements remain in the larger candidate. Reflection/collaboration and
the full ADR acceptance gates remain open. User test-server visual review is
still outstanding; automated content checks do not prove visual acceptance.

### Home responsibilities and product copy — 3 October 2026

Latest user direction: Background and Overnight should feel like personal agents
with ongoing responsibilities, informed by Muse and Dots. Both public Home and
signed-in Home must explain the product in concrete language and preserve mobile
parity. Avoid invented live status, generic AI slogans and capability claims that
have not passed the governing acceptance contract.

Primary references rechecked:

- [Muse's design account](https://introducing.muse.ai/): task-shaped outputs,
  visible activity and notifications worth interrupting for.
- [Meet dots](https://learn.chatgpt.com/docs/dots): work between conversations,
  continued responsibilities and decisions brought back for human review.
- [Dots tasks and memory](https://learn.chatgpt.com/docs/dots/tasks-and-memory):
  distinct task context, reviewable outputs and explicit recurring work.

These are product references; Orbyn does not inherit their computer, browser,
voice, messaging, account access or arbitrary action capabilities.

| Surface or behavior               | Decision                                                                                                                                    | Current implementation boundary                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Public Home                       | Show a project-notes-to-checklist request and a night research queue, each with three concrete steps.                                       | Examples are labeled; no fabricated tasks or activity.                                                                            |
| Signed-in web/desktop/mobile Home | Use the same responsibilities and optional step-by-step guide; retain real profile activity behind the existing action.                     | Character browsing does not mutate settings. Status comes from authorized profile evidence, never avatar animation or local time. |
| Background                        | Delegated work has progress, sources, an output and a place for decisions.                                                                  | Existing task/profile behavior; full ongoing-goal and routine qualification remains open.                                         |
| Overnight                         | Explicit queue, chosen window, bounded budget and morning review of completed and unfinished work.                                          | Window/budget constraints remain visible; no promise that every queued task finishes.                                             |
| Reflection                        | With explicit consent, review evidence from prior work and propose lessons with sources.                                                    | Existing reflection candidate remains an acceptance gate. Home must not describe it as shipped.                                   |
| Collaboration                     | Keep separate processes, runs, budgets and activity; exchange bounded, authorized handoffs with acknowledgments and source revision checks. | Complete receiving-worker dispatch and separate-process runtime proof remain open. UI copy cannot substitute for this work.       |
| Notifications                     | Surface meaningful results or decisions; preserve the morning review destination and quiet behavior.                                        | Delivery-policy acceptance remains part of the governing contract.                                                                |

This increment changes Home content and layout, not worker capabilities. The
public workflow collapses to one column at narrow widths; signed-in guide content
wraps and native content grows naturally. Web visual acceptance remains with the
user's test server for this increment. Native screenshot/interaction acceptance
and the complete U1 gates remain open. Retain current character work and palette.

Public Home promotion candidate: based on main9702f19e, includes only shared
copy, the public page's workflow layout, its focused checks and this ADR section.
Signed-in Home/profile and renderer work remain in the larger draft. Local Home
checks3/3, all workspace typechecks/builds and full formatting pass. Web visual
acceptance is still delegated to the user's test server for this increment;
full exact-head local and CI qualification is required before main merge.
