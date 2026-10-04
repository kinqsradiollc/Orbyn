# ADR 001 — Orbyn agent, provider, plugin and document platform

Date: 30 September 2026. Status: **accepted architectural direction; implementation incomplete**.

### Current ChatGPT checkpoint — 4 October 2026

`codex/chatgpt-execution` adds private signed device dispatch, personal provider
choice and explicit default-provider fallback. A queued request captures the
provider consent revision; changing that choice fences claim, publication and
read. Only a known admission rejection can use fallback. Partial or unknown
completion cannot be retried through another billing provider. Connect starts
authorization directly; the local callback flow still requires a running Orbyn
runtime. MCP permissions and plugin calls remain separate.

Focused routing/security checks pass; this candidate is not production-qualified
or merged. Full-suite stability, real-account inference and measured usage display,
cross-client visual acceptance and the full governing C1-C6/M1/D1/U1 contract
remain required. Current evidence and limitations are recorded in
[the task handoff](../reviews/task.md#chatgpt-dispatch-and-provider-choice-candidate--4-october-2026).

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

Docs PR #138 had green CI on `25e1e6f`; combined character candidate `788161e`
passed 37 focused checks, all types/build/format, with new CI still running.
Its fresh native verification is blocked by an iOS password-save prompt, pending
the user's dismissal. Web/mobile-web and native Android interaction gates remain
open. The governing review and implementation handoff
retain the full remaining scope; these checkpoints do not complete the ADR.

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

### Main-based rendered PDF checkpoint — 3 October 2026

Add a separately authenticated offline document renderer process and required
shared helpers, with a dedicated Chromium image, credential/network isolation,
enabled sandbox and bounded work/cancellation. The API authorizes primary-read
snapshots and rechecks access/version before returning a file. Signed requests
retain replay nonces until signature expiry, including allowed clock skew.
Production rollout starts PDF before API and validates its independent key.

This checkpoint prints math and all ten Mermaid families through the existing
PDF export contract shared by web, desktop and mobile. Standalone HTML gets
escaped source markers; this does not claim complete rendered HTML, publication,
inline image-byte or native sharing acceptance. Root-locked first-party build
dependencies generate only the backend asset; no app module imports are added.
Web/native editor and settings changes remain in their respective candidates.

Qualification requires focused real export tests, full local suite, workspace
types/build/format and exact-head CI including the hardened renderer image.
Main promotion remains conditional on those results. Full C1–C6/M1/D1/U1 scope
remains active; no deployment, release or cleanup is performed.

## Qualification correction — 3 October 2026

- Main21c6c076 full local suite is terminal:2,245/2,246, one old clipboard expectation for `<h2>Plan</h2>` after authored level1 correctly becameh1. Updated that expectation and added exact all-six-level HTML/clipboard regressions; no h7. h4–h6 print at readable body size. [Heading fixture](pdf-heading-levels.png) inspected with no overlap or clipping.
- Combineda039f271 CI37057124805 failed one all-family PDF text assertion despite local2,488/2,488. Reproduced in a hardened offline Linux renderer: “flowchart” prints correctly but pdf.js returns adjacent `fl`/`owchart` font runs. The test inserted a false space. Position-based line reconstruction and normalization now recover all ten exact headings and all six required SVG labels from the Linux file. A regression covers split font runs and ligatures; expected headings are exact line checks.
  -Current57 browser/helper/service/primary/deployment units and63 actual export/rich-page/heading/text checks pass. All workspace types/build/full formatting pass after the fix. Linux diagnostic artifact is `/tmp/orbyn-pdf-linux-api-batch.pdf`; its older image isolates printing/font behavior and is not current-head image qualification.
  -New full exact-head local and CI qualification required after committing this correction. Previous main/combined CI failures are not passing evidence. PR161 stays draft until corrected full local/all CI pass; no main merge/deploy/release/cleanup.

### Authorized picture snapshots for PDF and HTML — 3 October 2026

Candidate follows the qualified PDF checkpoint and uses the same endpoint on all
clients. Export authorized raster bytes as inert data URIs rather than omitting
pictures. Authorize on the primary, fetch only bounded signed first-party paths,
keep credentials/network out of the renderer, and recheck page/file access before
delivery. Missing/revoked pictures must fail explicitly rather than produce a
caption-only partial file. Preserve copied-file reference access when the original
page is removed. Evidence: `docs/reviews/evidence/doc-export-images.md`.

This closes the candidate's PDF/HTML picture-byte gap, subject to full current-head
qualification. It does not close native sharing, complete rendered HTML/publication,
Word/export/editor parity or broader C1–C6/M1/D1/U1 acceptance. Goal remains active.

### Portable rendered HTML candidate — 3 October 2026

Use the private first-party renderer for the existing HTML export endpoint as
well as PDF. Bind internal signatures to output format, share replay/concurrency
limits, render inert SVG images and MathML, retain escaped source, and install
script/frame/network-denying CSP before content. Keep screen styles with bounded
print overrides under media rules. Recheck current page/file authority before
sending the complete file. Evidence: `docs/reviews/evidence/doc-rendered-html.md`.

Candidate is stacked on the image export checkpoint, not yet qualified for main.
Publication, source/editor/Word parity, native interaction and the remaining full
ADR gates still require implementation/acceptance; the objective remains active.

### Signed-in Home/profile promotion candidate — 3 October 2026

Extract the signed-in Home guide and separate agent profiles from the larger
candidate onto current main (`192cb475`), with matching web/desktop and native
entry points. Keep the same shared Background/Overnight requests and workflow
steps as public Home. Replace the generic companion subtitle with “Background
progress and Overnight results.” Browse every character preset without changing
account settings. Profile activity, last work and outputs come from a private,
permission-filtered primary snapshot; refresh and avatar presence are not work.

The profile contract distinguishes idle, queued/recovering, working, waiting and
scheduled states. Overnight alone has a night window and estimated budget. Each
lane keeps its own activity and outputs. Open completed work only when the current
interactive chat can safely switch. User-facing activity labels are shared by
both clients; structured state is validated independently of copy.

Research remains the primary [Muse design account](https://introducing.muse.ai/)
and [Dots tasks and memory](https://learn.chatgpt.com/docs/dots/tasks-and-memory).
Their useful presentation patterns inform reviewable responsibilities; this
candidate adds no browser, computer, voice or external messaging capabilities.

Focused profile/store/client/Home checks pass 22/22. The first typecheck exposed
an omitted shared activity-label export; the scoped prerequisite was added and
current qualification continues. Full local/all-CI results, web test-server visual
acceptance and native screenshot/interaction acceptance are separate gates. No
claim of full U1, reflection or collaboration completion follows from this Home
increment.

### Published diagrams and delivery authority — 3 October 2026

Render public-page Mermaid sources in an isolated synthetic batch through the
private HTML renderer, returning inert images and escaped source without sending
publication forms, app links or live media capabilities to Chromium. Keep the
published layout and script/frame-denying policy. Recheck publication/password,
team policy, page revision, public links, files and folder navigation on the
primary after rendering, before returning HTML. Refuse revoked or changed
snapshots explicitly. Evidence: `docs/reviews/evidence/publication-renderer.md`.

This candidate requires complete exact-head qualification before main promotion.
It does not close editor, Word/export, native sharing, whole-app UI or the full
C1–C6/M1/D1/U1 goal.

### Gantt label readability candidate — 3 October 2026

Keep task, section and chronological labels readable in the isolated renderer.
Measure tick spacing and retain one label per displayed date, preserving the
underlying grid, authored format and task times. The current synthetic printed
fixture and real PDF font/bounds checks are recorded in
`docs/reviews/evidence/diagram-readability.md`. Both clients' exports use this
server rendering path. Editor/native preview parity and complete D1/U1 remain
open; candidate needs full exact-head qualification before main promotion.

### Home review information and progressive disclosure — 3 October 2026

Rechecked [Muse’s product design](https://introducing.muse.ai/) and
[Dots’ task/profile controls](https://help.openai.com/en/articles/20001530-getting-started-with-your-dot).
Muse makes activity and responsibility visible; Dots separates in-progress,
scheduled and completed work. Orbyn should present these as work a person can
inspect and direct. The two agents retain separate runtimes and schedules.

The Home section currently repeats its explanation as a summary, quotation,
three steps and review instructions. Keep the example request, destination and
stopping condition visible; put procedural steps behind a keyboard-accessible
“How … works” disclosure on public Home. Signed-in web and mobile must expose
review destinations and pause conditions before their optional guide is opened.
Use concrete requests naming source notes, requested output and unanswered
questions. Morning copy must distinguish finished work from queued work.
Preserve palette, all character presets and evidence-based idle status.

This is a presentation candidate atop PR165, not a worker or reflection change.
User test-server web review remains outstanding; native interaction/screenshot
acceptance is still required. Complete C1–C6/M1/D1/U1 remains active.

### Scoped Markdown parity qualification — 3 October 2026

Six-level headings and page-scoped references must work across schemas, saved
pages, private read projections, comment positions, Word/clipboard exports and
both clients. Reference definitions remain editable Markdown; HTML does not
show them as page text. The scoped candidate preserves the existing publication
and diagram changes on main1100ca98. See
`docs/reviews/evidence/markdown-parity.md` for evidence and remaining acceptance
gates. This does not close D1 or the wider UI scope.

### Embedded reference context — 3 October 2026

An embedded section resolves references from its authorized source page, even
when the definitions are outside the selected heading. Privacy projection
precedes section selection; inaccessible object destinations are excluded from
the returned context. Both clients isolate embedded reference and footnote
contexts from the containing page. See
`docs/reviews/evidence/reference-embeds.md`; runtime/visual acceptance and full
qualification remain open.

### Current-draft source inspection and fragment navigation — 3 October 2026

Scoped candidate atop PR169: both page menus expose a source/rendered inspector
for current editor blocks; the panel owns no second draft/save. Document identity
fences hide the panel on a page switch. Web selection and scrolling map between
anchored Markdown lines and rendered blocks; mobile offers source/rendered tabs.

Ordinary editors resolve bounded Unicode heading fragments and unfold only
sections covering the target, waiting for saved fold preferences. Embedded
fragments open the source page through their own navigation context. Retain
page-scoped references and current authorization; no parent-page fragment reuse.
Current candidate passes20 focused and115 combined export/rich-page/navigation
checks plus all workspace types/builds/full formatting. Full matching-head local
and CI qualification and actual editor/native screenshot/interaction acceptance
remain required. Source editing, the other D1 Markdown requirements and full U1
remain open; no goal completion, deployment or cleanup is claimed.

### Native and desktop diagram preview candidate — 3 October 2026

Scoped candidate on PR172 replaces mobile flowchart-only rendering with the
bundled strict engine and gives desktop bounded rendering plus source/fit/zoom/
pan/SVG controls. Native canvas adapts to the window and tall fit diagrams expose
pan. All ten native synthetic fixtures rendered; source, fit/zoom and pan were
exercised, and SVG export opened the native share sheet. Evidence and retained
failures: `../reviews/evidence/native-diagram-parity.md`. Full final-head tests,
CI, signed-in editor/parent-scroll/Android/web acceptance remain open. This does
not complete D1/U1 or authorize deployment. All C1–C6/M1/D1/U1 scope remains.

### Docs code and metadata controls candidate — 3 October 2026

Both clients provide code copying, known-language source/highlighting and
readable metadata disclosure while preserving exact literal source. Native
monospace is platform-correct; web overflow stays in the block. Actual native
synthetic controls were exercised and screens recorded. Evidence:
`../reviews/evidence/code-metadata-controls.md`. Final full-suite/CI, signed-in
editor, Android and web visual gates remain open. This candidate does not finish
D1/U1; the complete C1–C6/M1/D1/U1 scope and excluded product features remain.

### Source editing candidate — 3 October 2026

The source/preview pane now delegates Markdown edits to each client's existing
editor update/save queue. Reading and Suggesting modes retain inspection only.
Retained anchors keep block identity; duplicate anchors show an unsaved-source
error and can be restored explicitly. The parser reports original source-line
ranges so blank lines, alternate fences and CRLF do not desynchronize preview
navigation. Typed source echoes are tracked by weak block identity to avoid
rewinding newer native input. Native caret positioning is applied once when
returning from preview rather than controlled during typing.

This candidate follows code/metadata PR174. Native synthetic typing, preview,
validation and restoration were exercised with screenshots. Complete signed-in
revision/conflict/keyboard/swipe/Android acceptance and frozen full local/CI are
still required. The user will manually validate web presentation; blocked
browser access is not bypassed. This does not complete C1–C6/M1/D1/U1 or authorize
deployment/cleanup.

### ChatGPT model settings promotion candidate — 3 October 2026

First-party Settings on web/desktop/mobile expose owned device catalogs and
account-bound defaults. The credential-owning runtime rereads the shared
default before capturing inference; failed, foreign or regressed reads cannot
use a cached model. Device discovery returns credential-free metadata for
current owned registrations and is excluded from agent tools. This is a scoped
candidate; evidence and remaining M1/U1 acceptance gates are recorded in
`docs/reviews/evidence/chatgpt-model-settings.md`.

### Separate plugin UI resource adapter checkpoint — 3 October 2026

The plugin HTTP backend now exposes bounded resource discovery/reads separately
from first-party sessions. Static Orbyn cards reuse the existing portable MCP
renderer, declared MIME and CSP metadata. Resource visibility intersects live
connector tool scope with the explicit card UI setting; unknown addresses are
refused without network fetch. This adapter does not establish host launch or
extension transport acceptance. Host screenshots, grant/account switching,
managed/BYO execution, asynchronous results and reconnect cursors remain open.
See docs/reviews/task.md for exact tests and the unavailable local database gate.
All C1–C6/M1/D1/U1 implementation requirements remain active.

### Plugin protocol adapter checkpoint — 3 October 2026

A per-request MCP SDK server now serves current and legacy stateless exchanges
at the separate plugin boundary. The adapter receives only the independently
resolved plugin principal; HTTP/protocol tool calls share policy, budgets and
domain receipt execution. UI cards intersect current tool scope and the card
UI opt-in. Private zero-TTL protocol metadata supplements no-store HTTP replies.
Protocol tests establish exchange behavior with synthetic authorized callbacks,
not actual account, provider or hosted UI acceptance. Remaining C6 gates and the
full retained implementation scope stay open in docs/reviews/task.md.

### Plugin async import candidate — 3 October 2026

The separate plugin backend now has a local candidate for durable import handles
and bounded status-event replay through its independently authenticated grant.
It reuses domain import/receipt execution, records content-free transitions,
revalidates current project/document scope at retrieval and binds reconnect
positions to current account/grant/client/resource/job authority. See
`docs/reviews/evidence/plugin-import-jobs.md` for actual route/unit evidence and
remaining gates. Converter writes still require originating-grant provenance and
current write-policy checks; protocol async jobs and actual provider/host launch
acceptance also remain open. This candidate does not complete C6 or the full
C1–C6/M1/D1/U1 goal and must not be promoted before the write guard is proven.

### Home/task layout correction from user review — 3 October 2026

User screenshots identify excessive repeated explanatory copy on signed-in Home
and a bulky task toolbar. The full application redesign remains required.
Signed-in Home should be a compact working entry point: identity, short Background
and Overnight rows, actual activity access and an optional guide. Detailed
examples, timing and stopping conditions belong behind disclosure, with collapse
controls above long content. Public Home uses the same short agent descriptions.
Preserve all character choices and existing task actions, with compact responsive
controls and direct empty-state copy. Native screenshot fixture proof is limited
to the inspected component; real account/runtime, Android, all other surfaces and
full C1–C6/M1/D1/U1 acceptance remain open. Web visuals remain delegated to the
user's preview/test-server review under the existing permission restriction.

### Plugin import producer guard follow-up — 3 October 2026

The originating grant/client/recipient is now captured by both synchronous and
async plugin import starts. Upload admission, post-stream commit and converter
page creation recheck live authority; FK deletion retains the origin flag and
never falls back to first-party power. Real uploaded Word conversion,13 denial
variants and mid-stream encrypted-object cleanup are tested. This supersedes
the earlier missing-producer-guard note. Latest-main full/CI qualification and
remaining protocol/host/account/provider gates still apply; full C1–C6/M1/D1/U1
remains incomplete. Legacy in-flight imports require the documented rollout
handling rather than invented identity snapshots.

### Independent embeddings integration — 3 October 2026

The retained independent-embedding implementation is extracted onto current main
with migration218. Legacy workers stay disabled; explicit embedding provider,
model, verified dimensions, revision-bound consent and generation are independent
of generation settings. Both client admin surfaces expose setup and indexing
state. Schema/setup/client checks21/21, stock-provider checks17/17, late-install
backfill1/1 and actual legacy-vector upgrade1/1 pass. Full local/CI and real
provider/platform acceptance remain required. See
`docs/reviews/evidence/independent-embedding-main-integration.md`. This checkpoint
does not complete provider/model administration or whole-app U1.

### Views workspace layout — 3 October 2026

View layout selection remains immediately available. Filtering, grouping and
sorting share a disclosure on web/desktop and mobile, preserving source-specific
options, custom fields and the existing autosave path. Library instructions are
shortened, headers and rail items bounded on narrow screens, and horizontal table
scrolling is keyboard accessible. Current30 focused checks and all workspace
typechecks pass. Source/CSS checks are not rendered geometry acceptance; user web
review and actual native/Android interactions remain required alongside full
local/CI qualification. This increment does not complete whole-app U1 redesign.

### Overnight reflection integration — 3 October 2026

Reflection is an explicit Night Shift opt-in, using bounded source IDs and
revisions rather than copied private text in queued requests. Current principal
Personal/team restrictions are applied during selection, initial execution and
resumed provider checkpoints. Changed evidence, lost membership, project AI
exclusion or mismatched scope owner stops use of the evidence. Reflection
produces reviewable results; inferred memory writes remain prohibited.

Migration217 retains existing source kinds and adds transcript/run dependencies
plus deduplication receipts. Current main visibility rules and activity retention
remain intact. Both clients expose consent and reflection review. Integration
tests caught SQL parameter typing and missing dependency constraints; corrected
without weakening assertions. The current combined reflection/night-settings/
Overnight suite passes28/28, including selected-team changes and membership
revocation. Full local tests, build/format, CI and signed-in native/web acceptance
remain required; this is not a completed C3/U1 claim.

### Settings modality and layout — user requirement, 4 October 2026

Settings opens as a bounded web/desktop modal over the existing workspace, keeping
documents/chats mounted. Native retains its settings sheet. Preserve search and
setting-command entry points, category navigation, keyboard/viewport containment,
focus return and nested dialog ownership. One-time recovery material cannot be
lost by closing or changing category before acknowledgement.

The next layout checkpoint also replaces wrapped Admin tabs with a desktop rail
and compact native selector, bounded scrolling menus and progressive disclosure
for budget/embedding setup. Budget saves must change only the allowance and
reject stale settings snapshots. Latest UI controls21 and real HTTP budget tests3
pass; full/CI and remaining platform acceptance remain required. Web visuals are
user-reviewed under the latest explicit blind-redesign allowance; native screens
are inspected directly. Evidence and limitations:
`docs/reviews/evidence/settings-modal-layout.md`. This does not complete all U1.

### Maintained pages storage and management — 4 October 2026 (not promoted)

A5 now has a local owner/assistant-bound storage and management API candidate.
Exact page/block and binding revisions protect explicit rebinding; current grant,
page and workspace authority is intersected before context/update. Only selected
blocks enter context, and current link/AI visibility removes private derived
labels. Metadata snapshots never copy page text. Shared-page binding instructions
remain private to their owner. Both clients have typed management contracts.

Focused28/28 tests and all workspace types pass. The scheduler, scoped model jobs,
guarded document writes (including linked-task side effects), @orbyn comment
jobs/replies, consent and review UI, native interactions, and full local/CI
qualification remain open. Details: `docs/reviews/evidence/maintained-pages-contract.md`.
No production promotion or A5 completion is asserted.

### Maintained pages guarded application — 4 October 2026 (not promoted)

A5's internal apply path now uses normal document persistence with selected-block
processing, independent linked-task authorization, current trust/action-rule
checks and atomic page/binding revision advancement. Human blocks and unrelated
task ticks are preserved. Stale/moved/paused work, outside-bound patches and task
permission failures cannot advance the baseline. Concurrent receipts save once.

Docs/assistant-Docs/binding/API/core/inventory/catalog regressions118/118 and all
workspace types pass. Scheduler/model staging/review receipts, both client UX,
@orbyn comment jobs/replies, full qualification and native acceptance remain open.
This does not complete A5 or the full C1-C6/M1/D1/U1 contract.

### A5 durable scoped jobs — 4 October 2026 (not promoted)

The maintained-page candidate now queues ID/revision references, claims by
runtime lane with replaceable leases, stages bounded selected-block results and
uses a unique owner-bound approval card. It retains the original assistant rule
revision through review/resume. Binding edits, expired windows and stale source
references invalidate output. Source permissions and write rules are rechecked
before model context is returned and before atomic page/job completion.

Final focused/regression159/159 pass. Producer/provider execution, account model
selection, shared Overnight serialization/budget/ten-run/reflection accounting,
both client selection/consent/status/review UI, scoped @orbyn comments, full
qualification and native acceptance remain open. Details and the next proof
matrix: `docs/reviews/evidence/maintained-pages-contract.md`.
This is not an A5 or whole C1-C6/M1/D1/U1 completion claim.

### A5 hosted consumer and consent/source follow-up — 4 October (not promoted)

The internal consumer now executes bounded hosted HTTP completions on selected
blocks, reserves cost before transmission, stages output and uses guarded atomic
application. Original model provenance survives account removal/switch, with no
hosted fallback from queued account work. Actual connected-device execution is
still unimplemented. Original review consent cannot be weakened after queueing.
Night model work stops at its window while saved patches remain owner/nonce-bound
reviewable in the morning without further inference. Transactional live signals
and durable Study synchronization preserve client re-entry behavior.

209 current regressions, workspace types and production build pass. The four-file
compatible provider guard/key-redaction subset is PR194 on4e0a246f, awaiting full
qualification. Maintained-page service/producer/account/source/UI/undo/Night
integration and native/full gates remain open; see the maintained-pages evidence
matrix. Do not label a target-only paraphrasing consumer a complete maintained
page: explicit authorized fresh source selection and @orbyn workflow are retained.

### A5 owner review API checkpoint — 4 October 2026 (not promoted)

Owned document-run listing and nonce-bound decisions are available in the development
branch and shared client contract. Progress GETs neither create nor touch assistant
grants; they omit worker leases and hide proposals when current source or authority
changed. Decision transactions retain Night → grant → document → binding → run lock
ordering and reject stale/repeated cards. Successful saves synchronize Study.

Focused HTTP coverage passes15/15 with no skips/cancellations; all workspace types
pass. Evidence: `/tmp/orbyn-page-review-api-focused.log` and
`/tmp/orbyn-page-review-api-final-types.log`. This is not a visible/running feature:
service/shared-slot integration, sources, budget/activity/undo, both client controls
and the broader C1-C6/M1/D1/U1 acceptance remain open.

Main is now ee45ecf0: PR194 merged after corrected934e87d8 passed2582/2582
local tests and all four CI jobs37149341825. User deploys main themselves.

### A5 shared provider capacity checkpoint — 4 October (not promoted)

Chat and maintained-page claims now use the same transaction advisory lock and
count live leases across both queues. Background page work shares the existing
two Background slots; it cannot consume the four interactive slots. The separate
two Overnight slots and eight total slots remain unchanged. Expired leases and
waiting jobs do not occupy execution capacity. Mixed queue regressions prove
both directions, concurrent page claims and released capacity after expiry.

Verified45/45 (runs, owner review API, provider consumer, runtime lanes and runner),
zero skips/cancellations; backend typecheck passes. Evidence:
`/tmp/orbyn-page-shared-slots-verified.log` and
`/tmp/orbyn-page-shared-slots-types.log`. Earlier fixture failures are superseded
by this terminal code0 run; they are not passing evidence.

Still no service producer/consumer or client controls. Before activation, require
shared consumer lifecycle/shutdown recovery, mixed-version worker rollout safety,
Night per-person serial ordering/ten-run/reflection/morning outputs, explicit
source selection, budgets/activity/undo and all broader ADR acceptance gates.

### A5 consumer lifecycle and Night serialization — 4 October (not promoted)

Private Background/Overnight services now claim page work through their existing
lane runner, sharing process capacity, cross-replica leases and shutdown. Queue
preference alternates to avoid starving scoped work behind chat automation.
Interactive workers reject scoped automation. The runner stops each scoped job
once and waits for its cleanup. Uncharged or already staged work is requeued
without another provider charge; unknown charged requests remain held.

Claim guards serialize page and ordinary Overnight work for the same person.
The Night scanner sees queued/running page jobs before selecting or closing work.
Waiting human review does not occupy provider execution capacity. Different
people retain the existing two global Overnight slots.

Verified77/77 tests, no skips/cancellations, terminal code0:
`/tmp/orbyn-page-worker-lifecycle-final-tests.log`. Backend typecheck code0:
`/tmp/orbyn-page-worker-lifecycle-final-types.log`. Tests cover consumer recovery,
uncertain requests, process capacity/shutdown, exact approvals, mixed queue
claims, existing Night scanner behavior and original runner recovery. Source
wiring is present; a full live-service/page scheduling acceptance is still absent.

Next: actual bounded due producer with current source/authority; Night candidate
integration and ten-run/reflection slot accounting/morning results; safe rolling
upgrade activation; explicit sources, budgets/activity/undo; both clients and
complete ADR/local/CI/runtime/native qualification. Do not promote as finished A5.

### A5 bounded Background producer / service delivery — 4 October (not promoted)

The private Background service now scans due bindings once per minute in bounded
round-robin batches. It excludes disabled/suspended/revoked/expired owners,
paused/ended bindings, active jobs, inaccessible/AI-excluded pages and Night-owned
follow-through. Each candidate rebuilds current authority and selected context
inside the canonical transaction lock order. Reviewed deny rules stop queueing;
source/authority conflicts do not advance the schedule. Concurrent replicas queue
a due occurrence once. Selected unavailable models retain the existing defer
semantics without falling back to a different account/provider.

Verified79/79 tests, terminal code0, no skips/cancellations:
`/tmp/orbyn-page-due-service-tests.log`. Backend types pass:
`/tmp/orbyn-page-due-service-types.log`. New actual-service test starts the private
Background Fastify worker, observes its real due producer and hosted HTTP fixture
request, verifies ready200 and selected-block version2 save while preserving the
human block, then closes the worker. This proves local service delivery; it is
not real-provider/account or deployed production acceptance.

Night candidate/ten-run/reflection slot accounting and morning outputs remain
next. Safe rolling upgrade, explicit source selection beyond target blocks,
budget/activity/undo, web/mobile controls and full ADR qualification remain open.
Main is unchanged; this feature is still on the development branch.

### A5 Night plan, shared limits and morning progress — 4 October (not promoted)

Due page bindings participate in the existing Night candidate plan through
follow-through. Current source, page ownership and reviewed rules are checked
before selection and again inside queueing. They use the scoped page queue,
retain original consent/model provenance, and advance the Night cursor/run count
atomically. Queued/running pages serialize with ordinary Night work; the shared
ten-run cap and final reflection slot still apply. No private instruction or
page title is copied into the Night candidate labels.

The Night API now includes optional scoped page progress metadata. Current
assistant authority and page visibility guard it; no proposal words, worker
leases, credentials or hidden titles are exposed there. Page approvals remain
nonce-bound in their document API. Morning digest counts finished/review/settling
page work and links to the document; the existing single morning push also treats
page work as settling. Revoking the current scope hides its page progress.

Verified93/93 tests, no skips/cancellations, terminal code0:
`/tmp/orbyn-page-night-service-final-tests.log`. All workspace types pass in
`/tmp/orbyn-page-night-all-types.log`. New tests cover dedup/run accounting, shared
ten-run cap, reflection slot priority, current visibility and morning metadata.
An actual private Overnight worker test queues from the real scanner, calls the
local HTTP provider fixture once, stages required approval, reads the Night
progress, closes its runtime, then applies an exact owner decision without
resuming inference. Real provider/account/deployment acceptance is still open.

Next both client binding/source/consent/status/review controls and Night page
cards. Still open: explicit source selection beyond target blocks; budgets and
activity/undo; including page outcomes in reflection evidence; safe rolling
worker activation; verified account-default/device inference; broader full
local/CI/web/manual/native acceptance and complete C1-C6/M1/D1/U1. Main unchanged.

### A5 cross-client controls draft — 4 October (visual acceptance pending)

Web/desktop now has a bounded native modal; mobile has our native BottomSheet.
Both document menus flush pending edits and refuse unsaved/offline work before
opening Page updates. One shared portable controller owns fresh page/binding/run
reads, stable missing-block IDs through ordinary CAS document persistence,
selected-block create/edit, pause/resume/remove and exact waiting-card decisions.
Account switches prevent dependent writes and clear old evidence. Disposal and
React effect replay cannot restore an old result or leave the panel busy forever.

Both surfaces show selected blocks/instructions/daily or weekly cadence, saved
schedules behind options, recent status/token estimates and the actual saved
proposal in Markdown source before Apply/Decline. Pausing preserves the original
reviewed page revision; explicit Edit/Save reviews and rebinds current blocks.
The web native dialog owns focus/Escape; repeat buttons remain inside it, avoiding
our Select portal outside the browser's modal top layer. Palette/radius tokens
and native scrolling/keyboard sheet primitives are retained.

Shared controller4/4 unit checks pass, no skips/cancellations:
`/tmp/orbyn-page-controls-delivery-tests.log`. All workspace types code0:
`/tmp/orbyn-page-controls-delivery-types.log`. Production build code0:
`/tmp/orbyn-page-controls-delivery-build.log` (existing large-chunk warning remains).
These prove source/build/controller behavior, not rendered acceptance. The iOS
Simulator was reached with Computer Use, but it is still serving the prior preview
source; its existing planner429 overlay is not evidence for this draft's layout.

Next switch owned API/Metro previews to this branch against the marked preview DB
with migrations219-223, preserve the test admin, inspect/screenshot the new native
sheet, typing/scrolling/schedule/review states and correct layout. Web visual
acceptance remains human review under the explicit blind-redesign authorization;
no saved Browser Use block bypass. Add Night page cards on both clients, explicit
additional sources/budgets, activity/undo/page reflection evidence, rolling worker
activation and account/default device delivery. Full local/CI/native/ADR acceptance
still required before main promotion; full C1-C6/M1/D1/U1 remains active.

### A5 native inspection, schedule layout and Night cards — 4 October (not promoted)

Owned API/web/Metro previews now use this branch; migrations219-223 were applied
only after proving the preview database's `_test` name and server-side test marker.
The existing local admin/session is preserved. Persistent helper backups remain
in `/tmp/*before-maintained-pages`; current preview PIDs are recorded externally.

Actual iPhone17/iOS26.5 Computer Use verified saved page content, menu entry,
selected-block checkbox, instruction typing, weekly schedule creation, Pause,
paused Edit/Resume actions and reopening with retained selection/cadence. The
first run caught a real save guard bug: mobile's focused draft left a reference
`dirty` flag set after successful persistence. The new shared content/title
comparison accepts saved drafts and refuses changed/offline content. It has a
focused regression alongside the shared controller tests.

Both clients now collapse configuration when schedules exist and show schedules
and recent runs first. Add/Edit opens just the configuration section. Native has
an explicit accessible Close; its action was verified to restore the underlying
page without changing saved content. Night page cards on both clients open the
corresponding page; they are excluded from unrelated chat bulk decisions.
Screenshots: `docs/reviews/evidence/maintained-pages-ui/`. Before-layout and edited
form snapshots are labeled separately; compact paused view includes the final
Close control and singular block wording. Native scroll/drag attempts did not
move the earlier long form; this is not scroll acceptance. Software keyboard,
long proposals, Night cards, landscape/dark/large-text/Android and web rendered
acceptance remain open. HMR left an empty native modal once; returning to Expo
Home and reconnecting the owned Metro project restored it. No browser bypass.

98/98 combined store/controller/Night/reflection/page service/API/run tests pass,
zero skips/cancellations, terminal code0:
`/tmp/orbyn-page-native-layout-regressions.log`. All workspace types pass in
`/tmp/orbyn-page-native-acceptance-types.log`; final production build passes in
`/tmp/orbyn-page-native-acceptance-build.log` (existing large-chunk warning).
Rendered acceptance is limited to the interactions above, not the full app.
A new planner GET/items429 was observed after native dismissal; production
refresh/profile429 is explicitly still unresolved, not merely an old overlay.

Next exact proposal/approval native screenshots, Night page cards and manual web
acceptance. Then explicit additional sources and budgets, activity/undo and page
reflection evidence, rolling worker safety, real account/device delivery and
remaining full C1-C6/M1/D1/U1 gates. Main promotion/full goal completion remains
unproven; the disposable native schedule stays paused and production untouched.

### A5 native exact review and receipt follow-up — 4 October (not promoted)

A labeled proposal was staged through internal scoped helpers in the marked
local preview DB only. It is a UI fixture, not provider/inference evidence:
modelCalls0 and synthetic100 estimated tokens. Native UI showed the exact saved
replacement, then Apply changed the owned run to done and removed its waiting
card. The underlying document displayed exactly `UI fixture: a concise disposable
summary.`; authoritative DB check reported version6, done and waiting ID cleared.
The disposable schedule was paused and prior Night preferences restored.

Native Overnight displayed its separate page-result card and Open page action;
current screenshots are in `docs/reviews/evidence/maintained-pages-ui/` with
`fixture` in their filenames. Existing dev LogBox partially covered the review
buttons visually, although the native accessibility action and persisted result
were verified. This is not long-proposal/software-keyboard/Android acceptance.

Inspection also caught stale receipt metadata: external/maintained saves updated
content but left the old Saved time. Both editors now update receipt time on
accepted clean external changes and maintained-page callbacks; callbacks older
than the current page revision cannot regress it. All workspace types pass in
`/tmp/orbyn-page-review-receipt-types.log`. Native re-read displayed the newer
20-minute receipt instead of the old one-hour label. No local draft was overwritten.

Main/PR195 remains a separate compatible session-rate checkpoint. Corrected e4ed6749
passed CI37157146020 all four jobs. Its local full run completed2396 checks without
failures before sessions.test.ts stalled with an identical IPv6 local/peer TCP
endpoint and no registered PostgreSQL connection. That confirmed transport stall
was cancelled and recorded externally, not called passing qualification. A new
fresh marked IPv4 full run is live; merge still waits for complete local evidence.

Next: complete that qualified main checkpoint and bring it into this branch,
then complete explicit extra sources/budgets, activity/undo and page reflection,
rolling worker activation, real account/device execution, remaining native/web
render acceptance and full C1-C6/M1/D1/U1. No A5/main or whole-goal completion claim.

### Session refresh rate-limit candidate — 4 October (qualification pending)

The observed local429 burst contained288-311 requests/minute from web and mobile
sharing loopback; steady traffic was27/minute. A compatible backend-only candidate
counts global authenticated app requests per verified live device session instead
of sharing an IP bucket. Session identifiers come from indexed current DB lookup;
no raw token or client-supplied identity becomes a bucket. No authorization is
cached/skipped. Expired/deleted/disabled/forged sessions fall back to IP, and
route-specific stricter session limits remain IP-based. Existing API-key/MCP
buckets, threshold180, gateway burst limits and authentication behavior remain.
This addresses shared-address interference, not all possible429 causes or
production deployment acceptance.

Focused134/134 regressions pass in `/tmp/orbyn-session-limits-verified-regressions.log`.
Low-limit tests now start a fresh verified session rather than pretending a new
IP resets that device's window. The first helper version imported the DB pool
before test setup finished; it was corrected to dynamic imports after the marked
DB check. That failed run was cancelled after verified connection failures and
is not passing evidence. Workspace types pass in `/tmp/orbyn-session-limits-types.log`.
Build/full fresh DB/CI and controlled runtime qualification are next.

Candidate lives on codex/session-refresh-limits in devday-model-catalog/Orbyn.
No unfinished maintained-page files are included. A5 remains f8780ee6 in its own
branch; all source/budget/activity/undo/reflection/device/native/whole ADR gates
stay open. Main remains ee45ecf0; user handles production deployment.

### Session rate-window qualification follow-up — 4 October

Exact c82b0d22 full local run terminated code1:2568/2587 passed,19 failed,
no skips/cancellations. CI37155960329 passed mobile/Docker/mail and failed
backend-and-web. No merge was attempted. Every local failure traced to fixtures
that reused a device session across unrelated cases or treated a new IP as a
fresh global window. Fresh independent sessions now isolate those windows;
long template/picture suites use an independent device session per case.
The prior authorization-proof time is copied exactly, never refreshed by the
fixture. Lazy backend imports preserve both marked DB selection and each file's
local renderer/environment setup.

148/148 corrected affected regressions pass, no skips/cancellations:
`/tmp/orbyn-session-limit-window-verified-regressions.log`. New checkpoint/fresh
full run and exact CI are required; c82's failed full run is not qualification.
Product thresholds/stricter routes/gateway/API-key/MCP behavior stay unchanged.
A5/native work remains separate and incomplete; main remains ee45ecf0.

### Qualified main checkpoint and workspace layout draft — 4 October

PR195 merged exact e4ed6749 after full fresh IPv4 local2588/2588 code0, no skips
or cancellations, and CI37157146020 all four jobs passed. Main/origin main now
7f253b80; the primary checkout fast-forwarded with user changes preserved. This
addresses authenticated session/IP interference; production deployment remains
with the user and universal production429 resolution is not asserted. Qualified
main was integrated into the maintained-pages branch. Only two documentation
append conflicts occurred; both histories were retained and markers cleared.
The owned preview API restarted with the qualified session bucket implementation.

U1's new signed-in workspace layout draft now spans every web/desktop screen:
compact sidebar/wordmark, header rail toggle, quieter location label, consistent
working-surface padding and cards, unrestricted Docs canvas width, smaller Home
panels and a task toolbar with separate title/progress and search/layout/filter
rows. Desktop/tablet rail geometry uses one224px/72px pair; existing800px mobile
web drawer breakpoint stays aligned, and coarse-pointer controls retain44px
minimum targets. Palette/radius tokens are used and public landing/auth/dialog
surfaces retain their separate styling. Navigation controls now reference the
same accessible sidebar landmark and report expanded state.

Source-contract4/4 checks pass in `/tmp/orbyn-workspace-layout-contract-tests.log`;
final desktop types pass in `/tmp/orbyn-workspace-layout-final-types.log`.
All workspace types/production build pass in
`/tmp/orbyn-workspace-redesign-final-types.log` and
`/tmp/orbyn-workspace-redesign-build.log` before final aria-only control wiring.
These are source/build checks, not overlap or visual acceptance. Browser Use was
retried at the original127.0.0.1:5174/app tab and again denied by saved permission;
no alternate browser/port/CDP/indirect bypass was attempted. User's standing blind
web redesign/manual screenshot review authorization applies. The live preview
serves this draft; rendered web acceptance remains pending.

Next complete remaining whole-app layouts and manual web/desktop acceptance,
retaining native behavior/feature parity. A5 extra source selection, per-binding
budgets, activity/undo/page reflection, rolling worker activation and actual
account/device inference remain open, along with full C1-C6/M1/D1/U1 gates.
No workspace/A5 production promotion or full goal completion is asserted.

## 2026-10-04 — chat layout and contextual suggestion feedback

Scope clarification: character configuration belongs exclusively to Background
and Overnight. Those agents need separate identities and profiles as well as
separate runtimes. Interactive chat uses Orbyn and does not force character setup.
Independent per-agent saved identity/configuration remains open; the legacy
Background/Overnight identity is still shared.

The collapsed-sidebar screenshot revealed competing chat/workspace CSS and an
obsolete 148px character header. The draft now gives chat viewport rules priority,
uses a compact aligned header and centers the empty heading above its bounded
composer. Search fields use one wrapper focus indicator. Connection controls now
expose desktop connection instructions on web/mobile; direct web/mobile ChatGPT
sign-in and verified device inference remain incomplete.

Shared chat actions now request fresh model-generated task suggestions, priorities,
plans and reflections from authorized context. Prompts request evidence/citations,
separate inferred patterns from observed facts, avoid invented commitments and
require review before task creation. The invented personal example task was removed.
These action labels are requests, not already generated recommendations. No extra
background inference or refresh-time AI calls were added.

Home quote selection still draws an excerpt from the person's selected page.
Automatic AI Home task suggestions and context-based quote/excerpt selection are
NOT complete. Next implement a bounded, consented generation pipeline with source
references, freshness/invalidation, account isolation, current visibility checks,
no duplicate tasks and explicit AI-written reflection labels. Reuse Background
outputs where appropriate; preserve separate Overnight execution and review.

Validation: all workspace typechecks passed and focused regression checks 9/9
passed (no skips). iOS was inspected and captured at
`docs/reviews/evidence/interactive-agent-separation/ios-context-actions.png`:
new actions/composer are visible without overlap in the current portrait viewport.
Production web build passed. Source tests are not rendered web acceptance or live model-output validation.
Browser permission remains blocked; user-authorized manual web screenshot review
applies. No main promotion, production deployment or full ADR completion asserted.

## 2026-10-04 — independent automation identities checkpoint

Background and Overnight now have distinct persisted name/persona/character
settings. Migration224 copies each existing legacy identity into two independent
rows once; later saves are owner/lane-bound and compare an expected revision.
Concurrent or stale saves return409. Defaults for new accounts use lane names.
First-party identity routes reject API keys, unknown lanes/bodies/query arguments,
and rate-limit writes. They do not alter grants or make either worker active.

Interactive chat retains Orbyn with no automation persona. Automation context
reads the relevant lane identity. Profile snapshots and both Home companion cards
read the separate identities. The client validates returned lane/revision metadata
and suppresses save broadcasts after an account change. Web/mobile settings have
Background/Overnight selection, a reload action and a compact character preview;
detailed appearance editing opens only when requested. The original shared
`/me/agent` interface remains for legacy integration compatibility and no longer
controls these two runtime identities after migration.

Evidence: API/migration3/3 pass in `/tmp/orbyn-lane-identities-api-final2.log`,
including simultaneous save CAS, account separation,401/403/400/422/429 coverage,
legacy snapshot preservation and owner-delete cascade. Client/profile/runtime
contract8/8 checks pass in `/tmp/orbyn-lane-identities-final-units.log`.
All workspace types and production build passed on the final source checkpoint
(`/tmp/orbyn-lane-identities-final-source-types.log` and
`/tmp/orbyn-lane-identities-final-source-build.log`). Final native spacing adjustment
has its own typecheck in `/tmp/orbyn-lane-identities-final-native-types.log`.

Native iOS was actually operated: switch to Overnight, edit name, save, switch to
Background (unchanged), return to Overnight (saved name persisted), then restore
the fixture name. Screenshot `docs/reviews/evidence/automation-identities/ios-overnight-saved.png`
shows the compact editor. `ios-compact-identity-restored.png` shows the selected
segmented control after fixture restoration (a final10pt gap separates it from
Reload). `ios-restored-fixture.json` records the verified local
test database's independent revisions and restored names. Native drag/scroll APIs
returned noWindowsAvailable; accessibility clicks brought controls into view.
The screenshot still includes the old planner429 LogBox. Broad native layout,
keyboard/landscape/large-text, Android and web rendered acceptance remain open.
Preview test database was marker-verified, migrated and owned API restarted.
No production migration/deployment, main promotion or full ADR completion claimed.

Next qualify a frozen branch head, then isolate qualified production checkpoints.
Continue automatic grounded Home suggestions/reflections, A5 source/budget controls,
activity/undo/page-reflection, actual device inference, external host acceptance
and whole-app C1-C6/M1/D1/U1 requirements. Existing execution lanes remain separate.

### Frozen qualification correction — independent identities / A5 capability mapping

Checkpoint `deffbfc4` is committed and pushed. Its full fresh marked test-database
run was stopped after a confirmed failure in `agent-no-ai.test.ts`: six maintained-
page control routes were classified as hosted inference with no declared twins.
The failed run is not passing evidence. Cancellation and exact head are recorded
in `/tmp/orbyn-lane-identities-deffbfc4-cancelled.json`.

Inspection shows these six routes configure/inspect owner-approved bindings and
review results; they do not expose model execution to outside agents. They now
use the existing `assistant_control` classification, preserving first-party
restriction. The maintained-page feature has an explicit outside-agent equivalent:
`fetch`, `get_history`, `edit_doc` under the connection's existing grant and its
own model/scheduler. It neither enrolls hosted work nor approves hosted output.
A dedicated contract asserts this separation while the existing import-graph
shield still checks all capabilities for provider/hosted-run imports. The old
unused global identity lane helper was removed so it cannot suggest that the two
new persisted profiles still share a settings object.

Focused API/migration/client/import-graph/parity7/7 checks passed in
`/tmp/orbyn-lane-identities-parity-followup.log`. A fresh full run on the corrected
frozen head is still required. Web/manual review, native wide/keyboard/large-text,
Android, automatic Home recommendations/reflections, A5 source/budget/activity,
reflection evidence, verified device inference and external host gates remain
open. No main promotion or deployment is asserted.

### Route inventory qualification follow-up — 4 October 2026

The exact `6974d65c` route-inventory preflight found the new GET/PUT lane identity
routes were not classified. That run was stopped on this confirmed same-head
failure; `/tmp/orbyn-lane-identities-6974d65c-cancelled.json` is not passing evidence.
Both endpoints now explicitly use `assistant_control`; they remain first-party
and cannot be reached by connected agents. The complete route inventory,
model-free import-graph/twin shield and identity API/migration checks now pass
12/12 with no skips in `/tmp/orbyn-identities-inventory-parity-final.log`. The
focused identity schema/runtime/client checks pass4/4 in
`/tmp/orbyn-identities-parity-units.log`. All workspace types pass in
`/tmp/orbyn-identities-parity-final-types.log`. A fresh exact-head full suite remains
required before main promotion; full ADR and visual acceptance remain open.

## 2026-10-04 — SIWC plan/usage priority and narrow-panel feedback

User priority: use the official Sign in with ChatGPT flow; a pre-issued client ID
is not needed for local dynamic registration. The pasted prototype starts with
`dynamic_agent_client`, receives an issued ID and uses granted plan credentials.
Existing desktop OAuth already follows that pattern with persistent installation
host ID, PKCE/state/nonce, bounded loopback callback, retained registration,
verified ID token and protected credentials. Do not add a partner client-ID gate
to this local flow. The official website identity flow is distinct; a local
127.0.0.1 callback reaches the browser's computer, not a hosted API. Direct web
sign-in/connected-device inference is still incomplete and remains highest priority.

Official sources inspected: cookbook article `sign-in-with-chatgpt`, SIWC website,
self-hosted VMs, models-and-inference, token-reference and errors-and-recovery.
OpenAI authentication metadata is opaque. Do not invent Plus/Pro tier claims,
remaining quota or reset times from identity tokens or error codes. Identity,
granted plan permission, live model discovery and completed inference are
separate evidence states. Account and workspace registrations remain separate.

A desktop `verify-plan` metadata command now sends one fixed short test through
the selected account/default model's private runtime. It requires granted plan
access, fresh account model discovery, nonempty output and response.completed.
The receipt is account-bound, records the actual used model, time and only valid
provider-reported input/output/total token counts. Missing/invalid counts stay
unknown. Account switching/closing the runtime drops this receipt. It is a proof
for that completed test request, not a guarantee of future quota or plan tier.
The renderer cannot supply arbitrary test content or credentials. Quota and
eligibility errors remain terminal and do not change billing. Errors preserve
sanitized machine code, HTTP status and request ID; no provider body is echoed.

Desktop settings expose Verify plan access (explicitly describes the small test)
and Manage ChatGPT usage. Web/mobile expose the same official usage-settings link
and remind the person to choose the corresponding ChatGPT account. Remote/native
verification receipts and actual user-chat plan inference remain open; this is
not full cross-client plan verification or remaining-allowance delivery.

The narrow chat drawer uses available chat width via ResizeObserver, a single
History/Upcoming open state, bounded overlay width, scrim, close/Escape/Tab focus
behavior and inert conversation controls. Opening global navigation closes chat
panels; opening a chat panel closes global navigation. Duplicate header controls
are hidden under the overlay. Manual web layout acceptance is still pending.
Home fixtures now use separate lane reads/subscriptions and real functional state
updates. Account changes hide prior identities immediately. Generated MCP docs
were regenerated after inventory changes. The stopped ee0cd5a2 full run had11
failures (ten Home old-fixture dependency failures and the catalog mismatch),
not four; cancellation is recorded and is not passing evidence.

Evidence: plan/UI49/49 focused checks pass in
`/tmp/orbyn-priority-plan-ui-final-tests.log`; inventory/catalog13/13 pass in
`/tmp/orbyn-priority-plan-inventory-tests.log`, all without skips. All workspace
types pass in `/tmp/orbyn-priority-plan-final-types.log`; production build passes
in `/tmp/orbyn-priority-plan-final-build.log`. The owned preview API was restored
and health returned ok after a PostgreSQL connection terminated unexpectedly.

User-requested browser diagnostic: original127.0.0.1:5174/app was explicitly
rejected by saved Block preference. An unrelated example.com page opened via the
same Browser Use surface. Screenshot `evidence/browser-access/example-com-control.png`
is public diagnostic evidence, not Orbyn web acceptance. No alternate port,
Chrome, CDP or indirect blocked-preview inspection was attempted. Full frozen-head
local/CI and actual OpenAI account authorization/inference acceptance remain
required; no main promotion, deployment or whole ADR completion claimed.

## 2026-10-04 — one-button ChatGPT provider authorization follow-up

User clarification: MCP is a separate Orbyn data/tool connection. Provider
settings must offer one Connect to ChatGPT button, start authorization directly,
let the person finish OpenAI sign-in/consent, and return to updated connection
state. Remove Connect on desktop and the intermediate sign-in-settings tutorial.
ChatGPT-primary chat routing and a separately chosen Orbyn-default fallback are
now the immediate next implementation priority. Neither is claimed delivered.

Migration225 adds bounded, ten-minute, session-bound authorization handoffs.
First-party web/mobile start a request; the signed-in credential-owning app for
the same person claims it once and calls the existing dynamic SIWC flow directly.
Web's opaque app link speeds up that handoff; the app also watches explicitly
requested pending handoffs for cross-client initiation. Different accounts,
replay, expired/revoked initiating sessions and other claimant sessions cannot
complete a request. OpenAI codes/tokens are absent from handoff storage and app
links. The user still finishes actual OpenAI consent. No MCP grant is minted or
changed. Original/claiming Orbyn sessions and current verified connection are
rechecked before completion. Hourly sweeping deletes expired handoffs.

Web/mobile now show Connect to ChatGPT and bounded, cancellable status polling;
no sign-in-settings redirect is part of the primary action. The installed,
signed-in credential-owning app is still required for this local OAuth callback
flow. Pure hosted-browser OAuth and native-only local callback ownership have not
been invented or claimed. This limitation must remain visible in qualification.

Focused source/API/client/UI/inventory tests pass70/70 with no skips in
`/tmp/orbyn-one-click-full-focused.log`; all workspace types and production build
pass in `/tmp/orbyn-one-click-final-source-types.log` and
`/tmp/orbyn-one-click-final-source-build.log`. Current native controls were actually
inspected in dark mode and captured at
`evidence/chatgpt-one-click/ios-connect-usage-controls.png`, showing one provider
Connect action, refresh and usage management without overlap. No actual OpenAI
account consent or live plan inference was performed. The test preview was
marker-verified and migrated through225; the helper's fixed console message still
says224 and is not the migration-version authority.

The desktop fixed verification request and measured usage receipt remain in this
candidate; availability, permission and completed inference remain distinct.
Web/mobile can view official usage settings; no account tier, remaining allowance
or reset time is fabricated. Actual composer/job routing through the user's
ChatGPT account, signed execution results and explicit default-provider fallback
remain open before production promotion. Full C1-C6/M1/D1/U1 scope is retained.

### 4905456e full qualification correction — 4 October 2026

The full run was stopped on confirmed failures and is not passing evidence.
Replay/rules failures coincide with PostgreSQL connection termination and recovery
mode57P03. A healthy marked-database rerun of those actual suites passed37/37 in
`/tmp/orbyn-490-replay-rules-recheck.log`; no product assertions were removed.
Model-control fixtures lacked new core/API/session/error imports and used one
state cell for every React hook. They now model separate state/ref slots and
functional state updates. Existing bounded-search, disabled/offline selection
and model/default behavior checks remain. Font styles were moved onto the shared
11/13/15/18/24/36 scale; no checker exception was added. Neatness and model UI19/19
checks passed in `/tmp/orbyn-490-style-ui-followup.log`.

A separate attached model worktree is on `codex/chatgpt-execution` for the actual
inference transport. Its workspace package builds are isolated; preserved preview
files and the former dependency symlink remain intact. Runtime request/receipt
contracts and encrypted request storage are in progress there, not delivered.
Continue ChatGPT-primary routing and explicit Orbyn-default fallback first, while
retaining every C1-C6/M1/D1/U1 requirement. No main or production promotion claimed.

## 2026-10-04 — signed ChatGPT inference broker foundation (not delivered routing)

Execution work is isolated in the attached `devday-model-catalog/Orbyn` worktree
on `codex/chatgpt-execution`, based on current source checkpoint0de9ca3d. Its
workspace package links point to its own builds; preserved preview files are
untouched and the former dependency symlink remains backed up under/tmp.

Migration226 introduces bounded per-job request storage with encrypted prompts
and results, a two-minute expiry and one active request per job. The internal
runner queue captures the current owned account, model, enrollment/lease epochs,
input hash and nonce. No HTTP endpoint accepts arbitrary prompt input. A claim
requires the exact enrolled Orbyn session and current lease/catalog/account.
Publication verifies an Ed25519 signature covering the exact request identity,
nonce, epochs, model and completed/failed result. Replays, forged results, changed
leases, another owner and inactive/unverified-source jobs are rejected. Input is
cleared on completion/cancellation. Runner result reads recheck current job/source
access. These are storage/contract gates; no device polling endpoint, processing
loop, composer integration, fallback choice or live provider result is delivered.

Backend types pass in `/tmp/orbyn-inference-broker-final-types.log`. Broker storage
checks3/3 pass with no skips in `/tmp/orbyn-inference-broker-final-three-tests.log`.
This diagnostic run uses `PGOPTIONS=-c jit=off`; it does not modify PostgreSQL or
production configuration. No OpenAI request is made. Fixture fixes preserve real
JSON encoding, mandatory chat IDs and allowed inactive job states.

Current full checkpoint qualification0de9ca3d actually ended code1, signal:null:
2670/2677 pass, seven failures, no skips. The attempted cancellation happened
after its handle had already disappeared (ESRCH); the cancellation record was
corrected and the exit JSON is authoritative. Logs confirm a PostgreSQL backend
was SIGKILLed while evaluating the replay permission query, with container OOM
state and postmaster recovery. This affected both full and broker test sessions.
JIT-off broker passing is not proof the replay OOM is fixed. Investigate query
planning/memory and complete fresh full/CI qualification; do not restart Docker
Desktop or erase test/primary data as a workaround. Source permission predicates
must stay enforced. Goal remains full C1-C6/M1/D1/U1, with actual ChatGPT-primary
execution and explicit Orbyn-default fallback highest priority.
