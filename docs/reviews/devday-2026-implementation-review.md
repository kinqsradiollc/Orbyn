# DevDay 2026 → Orbyn: researched implementation proposal

## Current delivery state — 6 October 2026

Main application checkpoint `14415dcb` includes balanced links after Docs nested formatting and
exact delimiter editing (PR208), following Teams PR205–207 and Slack PR204.
PR208 exact `4c9edf00` and main have identical tested file tree; all four
CI37346372738 jobs and the fresh full local suite pass (3383 passes,0 failures,
1 existing skip). Balanced-link PR209 exact `4c3dffb4` is merged after all four CI37348529721 jobs
and fresh local full suite3403/0/1 passed. The complete current state and implementation pipeline are in
[ADR001](../adr/001-devday-agent-platform.md#authoritative-checkpoint--6-october-2026)
and [the live handoff](task.md#authoritative-implementation-pipeline--6-october-2026).
D1, U1, agent/provider acceptance, real-account/tenant/host checks and final cleanup
remain open. User deploys manually. The retained contract below is unchanged;
older checkpoint maps are historical.

## Completed draft result qualification — 2 October 2026

PR #147 merged as **4bbcfec** from frozen **53089fd** on base **e1d46af**.
Completed append_doc results recheck producing evidence and destination access
before replaying saved titles, identities or links under a new client_ref.
Unchanged/restored access returns the original answer without another mutation.
Five focused regressions and the source seven-file cohort (103/103) passed.
Exact candidate full local tests passed **2,181/2,181**, zero failures/skips, with
all workspace types/build/full-format passing. All CI **37004911014** jobs
succeeded; backend passed 2,180 with one Tesseract skip. Candidate, CI merge
94006ee and resulting main share tree ab575239dd8e10fab7a52d32946a75a1229ab95f.
This is a qualified checkpoint, not deployment or completion of the full ADR.

## Latest qualified checkpoint — 2 October 2026

PR #146 is merged as **c9b6c78** from **0033a96**, base **7c08aa6**. Cached
assistant results bind current authority and recheck current producer/source and
target access using the effective grant scope. Full local tests passed2,176/2,176,
with all workspace types/build/full-format and all CI37003294826 jobs successful.
CI backend passed2,175 with one Tesseract skip and zero failures. Candidate,
CI mergecd57b95 and main have identical tree0d1f05994b7ed460131fe2e16ba9d3ad4ce59222.
User changes and character work are preserved; no deployment or cleanup occurred.

The complete C1–C6/M1/D1/U1 contract below remains active. Cached-result nested
dependency closure, original provider-read revisions/concurrency and other
persisted fast paths still require work. Source completed-draft replay follow-up
is not included in this merge. Agent ownership/editor, read/effect/notice policy,
budgets/collaboration, actual models/defaults/execution/providers/embeddings,
plugin host acceptance and all Docs/Mermaid/whole-app/mobile gates remain open.

## Current checkpoint map — 2 October 2026

This map updates delivery evidence without reducing the full contract below.
Voice, computer use and speculative removed rows remain excluded. Backend,
web/desktop and mobile remain in scope.

| Area                                                     | Authoritative checkpoint                                                                      | Evidence and remaining gates                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main session/profile work                                | Pushed through `60de59c`                                                                      | Profile, mutation errors and preference results are session-bound; web tab account changes clear root planner data. Focused checks and workspace typecheck passed on main. Nested caches, other callbacks and visual/native interaction remain open.                                                                                              |
| Main Docs literals/math exports and mobile file handling | Integrated through `b6096c8`                                                                  | Shared code spans, escaped literals and safe links; bounded MathML HTML export; 13 real mobile utility checks with platform/share mocks and workspace types passed. The exact main full suite passed 2,078/2,078. Native bundles passed on corresponding local source. Browser/native visual interaction and broader Markdown parity remain open. |
| Main ChatGPT private inference                           | Pushed `fef8f7c`, `76fb218`, `3f5ae6f`                                                        | Saved-default adapter and executor lease fencing are private; 26 model/transport checks and 25 lease/runtime checks passed on main. No new inference IPC command exists. Signed job assignment/results, composer routing and real-account acceptance remain open.                                                                                 |
| Plugin recipient/discovery                               | Local `codex/devday-plugin-boundary`, proof `c6f4b03`                                         | Frozen source `e60fb32` passed 1,995/1,995 backend tests after fixture and runner fixes. Recipient consent, isolated grants/tokens, service discovery and challenges are not merged. Browser consent, gateway, host, provider and deployment gates remain open.                                                                                   |
| Docs mobile Mermaid                                      | Local `codex/devday-model-catalog`, source `ca21820` and `b1df2ef`, packaging proof `4717551` | Ten families pass the actual strict parser; nine source/runtime checks, workspace types and iOS/Android exports passed. Parsing and packaging do not prove diagram appearance, export interaction or native navigation.                                                                                                                           |
| Settings/embedding/Docs source                           | Local model/Docs worktree                                                                     | Settings redesign, headings/fences and embedding lifecycle work remain distinct unmerged checkpoints. Web build passed locally; preview permission still blocks visual acceptance. Earlier frozen embedding suite evidence remains scoped to its own source.                                                                                      |
| Broad ADR                                                | Active, incomplete                                                                            | Agent rules/ownership/activity/budgets, bound and published pages, Slack/Teams, full Markdown parity, composer/actual inference and cross-client UI acceptance remain deliverables. Existing foundations do not prove these complete.                                                                                                             |

### Runtime and reflection update — 2 October 2026

- **Merged runtime isolation:** PR #135, main `c1b3ffa`. Migration 206 assigns
  immutable interactive/background/overnight lanes; separate Background and
  Overnight services own their claims, concurrency, readiness and shutdown.
  Notifier fallback rejects automation instead of collapsing both into one
  process. Exact candidate `e6f6376` passed 2,091/2,091 full local tests and all
  CI jobs. Process tests exercised independent restart/recovery and idle workers.
- **Merged Memory safeguard:** PR #136, main `3677d53`. Generated automation
  conversations cannot enter automatic personal Memory extraction. Source owner,
  person origin and access are checked at enqueue/extraction/write boundaries.
  Exact candidate `0392e92` passed 2,094/2,094 full local tests and all CI jobs.
- **Reflection candidate:** draft PR #137, `codex/overnight-reflection`, current
  head `061a501`, based on main `3677d53`. Explicit consent, bounded current source
  evidence, durable revision receipts, read-only reflection and numbered source
  links exist on both clients. Initial candidate `8535357` passed 2,104/2,104 full
  local tests and production build/types/format. Follow-up removes misleading
  change-review controls from reflections, rejects their keep/undo operations,
  and distinguishes Queued from Working. Focused review tests passed 13/13;
  full types/build/format passed and b29f454 passed 2,105/2,105 full local tests.
  Test-only 061a501 fixes same-tick fixture timestamps and adds a scan-cutoff
  regression (10/10 focused). All four CI jobs passed; backend reported 2,105
  passed, zero failed and one Tesseract-dependent skip out of 2,106.
  Native source navigation and compact long-label wrapping were observed with
  synthetic fixtures. Long-content scrolling and web/mobile-web visual gates
  remain open. This is not merged or deployed.
- **Docs navigation candidate:** source `77b7d5b`, isolated main candidate
  `25e1e6f` on draft PR #138, `codex/docs-navigation`. Both editors resolve heading fragments
  and own-origin app links inside the app, preserving drafts and unrelated folds.
  Mobile measures outer heading rows and applies destination pages/fragments
  together after loading; HTML preserves heading levels and working local heading
  links with private-resource filtering. Source and isolated main candidate f96264e passed 53 focused checks,
  workspace types, production build and formatting. Native iOS taps on a fresh
  candidate bundle proved relative app navigation, a folded same-page heading
  jump, outline navigation into a folded section and a cross-page heading link
  after correcting a stale-page race. CI 36979623013 found one stale rich-copy
  heading assertion; 25e1e6f corrects it and adds clipboard level coverage (20/20
  focused checks). CI 36980902473 passed all jobs: backend 2,098 passed, zero
  failed and one known Tesseract-dependent skip. Web/mobile-web/native Android
  interaction gates remain open. This is unmerged and does not
  complete D1.
- **Handoff foundation:** local source `98ff22a`, `0c8f832` and `4eaa652` defines
  bounded receipts, durable chain counters and explicit follow-up requests.
  Current owner, source visibility, completed producer, outcome/review revision
  and container/dependency bindings are rechecked before creation or replay.
  Reciprocal follow-ups preserve acknowledged ancestry and cannot reset depth;
  UUID case variants deduplicate. Exact storage migration and full fresh-database
  migrations were exercised. Combined focused tests passed 23/23, with no skips
  or failures; backend types and focused formatting passed. Receiving jobs and
  acknowledgments were simulated for these tests. No endpoints or dispatch loop
  are enabled. Receiving-side rules/connections/budgets, cross-lane source
  reservations, separate-worker round trips and client controls remain required.
  This source foundation is unmerged and does not deliver collaboration.
- **Assigned source ownership:** PR #139 is merged on main as `76ec92b`, from
  qualified candidate `51ce91b`. It serializes task/goal/routine ownership across Background/Overnight and
  across members of shared tasks. Waiting or expired leases retain ownership;
  explicit completion releases it. Migration 209 preserves existing active
  overlaps on upgrade and rejects new overlapping claims and identity changes.
  It preserves main's character updates and corrects six off-scale font sizes on
  both clients without changing the shared scale. Current candidate checks passed
  13/13 ownership/runtime and 17/17 character/style checks, all workspace types,
  production builds and formatting. Full local suite passed 2,103/2,103; CI
  36984587146 passed all four jobs, with 2,102 backend passes, zero failures and
  one known Tesseract skip. Independent compiled processes proved ownership,
  waiting and release behavior. Main's tree matches the tested candidate and CI
  merge tree. This does not enable handoff dispatch or establish whole-app UI acceptance.
- **Remaining agent scope:** truthful separate profiles/workspaces, durable
  authorized Daytime/Overnight handoffs, typed rules, receiving source inheritance,
  activity/budgets
  and the complete cross-client surface ledger remain required. Shared storage
  and a saved reflection do not prove collaboration is implemented.

Latest precise process handles, logs and outstanding gates are recorded in
`docs/reviews/task.md` on the model/Docs implementation branch. No passing subset
or historical result completes the broader delivery contract.

A main full-suite run on frozen code `986e77f` passed all 2,014 tests, with no
failures, skips or cancellations, and exited successfully. It used only the
marked disposable test database. Evidence:
`/tmp/orbyn-main-session-inference-full-tests.log`. This verifies that main source;
the separate local plugin suite remains scoped to its own checkpoint. User changes to
`mobile/app.json` and unrelated untracked files are preserved and are not part
of these checkpoints.

**Status: revised implementation contract; user authorized tested production checkpoints.** Prepared 30 September 2026 against `main` at `b91ced2`. Worktree: `/Users/anhdang/.codex/worktrees/devday-2026-plan/Orbyn`; branch `codex/devday-2026-plan`. This document supersedes the implementation assumptions in `docs/openai-devday-2026.md`; the original is preserved beside it. Backend, desktop/web and mobile remain in scope.

## 1. What changed after research

| Original assumption                                              | Current evidence and consequence                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 treats ChatGPT identity and plan inference as one integration | They are distinct contracts. Website identity is a selected-partner trial; OSS plan usage has dynamic registration. Verify Orbyn's eligibility and deployment mode before promising website or mobile availability. [Quickstart](https://developers.openai.com/siwc/quickstart), [website](https://developers.openai.com/siwc/website).                              |
| Existing model adapter can be reused unchanged for plan usage    | Plan usage requires streaming Responses, `store:false`, a complete input array and restricted parameters/tools. Introduce a dedicated adapter and capability matrix. Existing server adapter returns a completed text response and is unsuitable unchanged. [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations). |
| Model list is a generic normal API list with a curated fallback  | Documented plan catalog uses `models[]`, visibility, slug and display name. Refresh on account switch; never silently select an unentitled fallback. Preserve the user's model choice. [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).                                                                    |
| Agent identity and rules are absent                              | Named assistant identity already lives in agent settings; standing rules already exist as text. New work is multi-agent ownership and deterministic enforcement, not a second unrelated identity system.                                                                                                                                                             |
| Document block tools are unlanded                                | That branch's work is already merged. Reuse current structured docs/comments and their revisions.                                                                                                                                                                                                                                                                    |
| Extensions have no docs, therefore A11 must wait                 | Public extension docs and SDK links exist. A11 can be scoped now, with host feature detection and a portable MCP fallback. [Extensions](https://developers.openai.com/plugins/build/extensions).                                                                                                                                                                     |
| Security CLI can simply run in CI                                | CLI availability does not imply scan entitlement: running scans needs Codex Security access. Keep CI secrets protected and patch publication human-approved. [Security access](https://developers.openai.com/blog/scaling-cyber-defenders-with-daybreak).                                                                                                            |
| Ultrafast is generically 6× priced                               | Do not carry this number into pricing UI. Sol documentation gives standard token rates and Fast at 2× standard; Fast and Ultrafast are distinct. Per-model/account availability must be checked. [Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol).                                                                                                   |

Dots, Space, Pro 500, Marketplace reach and Decisions preview details are not independently established by the developer pages fetched in this audit. Treat their product descriptions as inspiration, not an API contract or promised Orbyn dependency. No benchmark/price comparison is a measured Orbyn result.

## 2. Source and repository evidence

Official pages were opened, not merely search snippets. The source file's older checkout references are stale: R1–R10 and the Docker repair are now in main. This is source research and planning; no new product tests or provider calls were performed.

| Existing surface    | Inspected code                                                                                  | Reuse / remaining gap                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Provider adapters   | `backend/src/modules/ai/providers/adapters.ts`, `resolve.ts`                                    | Managed formats, Responses routing, timeout/error handling; add plan transport and explicit feature negotiation.         |
| Durable execution   | `backend/src/modules/ai/agent/run.ts`, `loop.ts`; `worker/night-shift.ts`                       | Leases, checkpoints, decisions and receipts; add device executor ownership without duplicating mutation engines.         |
| Identity and rules  | `modules/agent-context/routes.ts`; `packages/core/src/agent-inbox.ts`; `capabilities/policy.ts` | Named assistant and text rules already exist; typed rules and multiple agent records are new.                            |
| Activity / delivery | `modules/presence/live.ts`; `worker/delivery.ts`; `agent/notices.ts`                            | Existing announcements and durable notices; add resumable step events and external channel adapters.                     |
| Pages               | `modules/docs/comments.ts`, docs structure/services                                             | Human mentions and page authorization exist; scoped agent mentions/bound blocks require new behavior.                    |
| Distribution        | MCP catalog, `modules/mcp-server`, `modules/oauth`                                              | Existing OAuth server is not an SIWC identity client. Keep connector grants separate from OpenAI identity.               |
| CI                  | `.github/workflows/ci.yml`, `deploy.yml`                                                        | Tests, builds, mobile bundles and Docker checks exist. Security scanning/access and richer interactive QA are additions. |

## 3. Proposed architecture and invariants

```mermaid
flowchart TD
  UI[Desktop / web / mobile] --> SESSION[Orbyn identity and session]
  UI --> PICK[Connection and model choice]
  PICK --> MANAGED[Managed / BYO provider gateway]
  PICK --> DEVICE[User-controlled plan executor]
  DEVICE --> RESP[Eligible streaming Responses requests]
  MANAGED --> JOB[Durable job and checkpoint protocol]
  DEVICE --> JOB
  JOB --> POLICY[Current ownership + source visibility + typed rules]
  POLICY --> REVIEW[Version-bound Review / receipts / Undo]
  POLICY --> READ[Read-only capabilities]
  JOB --> ACTIVITY[Authorized activity and channel delivery]
```

**Credential boundary:** identity verification may create an Orbyn session. Plan access/refresh tokens stay in the authorized user-controlled runtime; server jobs hold an executor/connection reference, not those tokens. Device tool requests are untrusted instructions and must pass normal server capability authorization. A signed-in browser is not proof it may execute any job.

**Durability:** executor leases fence old devices; checkpoints and submission IDs survive reconnects; cancellation and approvals retain waiting identity checks. Refresh credentials atomically; switching account cannot reuse another account's model catalog or job. A fallback must use explicit consent and retain original provenance/billing visibility. No server-side account pooling.

**Permission composition:** effective access is the intersection of actor rights, workspace policy, agent scope, source visibility and rule restrictions. A page's grant list is an upper bound on eligible participants, not authority to impersonate another viewer. Never inherit the union of page viewers' permissions.

**Rules:** deterministic deny dominates approval, which dominates allow. Allow never overrides authentication, team policy, stale revisions, hard stops or source exclusion. Plain-language instructions remain guidance until converted into a reviewed typed rule. Rule edits invalidate applicable pending decisions and are rechecked before mutation.

## 4. Delivery ledger for the retained scope

Each row is part of the eventual scope. “Gate/spike” preserves the feature for review; it does not declare it delivered.

| ID / proposed priority    | Implementation deliverable and primary modules                                                                                                                                                                                                                                                                                                                           | Acceptance evidence required                                                                                                                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 / P0: SIWC             | Separate identity linking from plan credentials. Electron system-browser PKCE/state/nonce and validated ID token; secure OS storage; atomic refresh; first-option branding. Web partner flow and mobile callback/storage are separate eligibility spikes. Device executor, account model picker and dedicated SSE adapter in shared contracts + Electron/mobile modules. | State/nonce/replay/issuer/audience/account-link attacks rejected; no email-only account merge; actual eligible plan call; logout/revoke/account-switch tests; no tokens in server logs/DB; web and native callback proof. Unsupported deployment remains clearly unavailable, not a decorative sign-in button. |
| A2 / P0: managed AI       | Add connection-kind discriminator while keeping provider resolution, budgets, team/MCP flows and managed automations. Plan transport cannot leak into managed credentials or vice versa.                                                                                                                                                                                 | Existing provider suite passes; same managed conversation and automation behavior; explicit model/connection preserved; no silent paid fallback.                                                                                                                                                               |
| A3 / P0: Sol + caching    | Add catalog entry and capability validation; Responses tool path; supported reasoning values. Cache stable instruction/tool prefixes with documented controls, measure hits/write/input/output usage. Keep selected model rather than forcing a default.                                                                                                                 | Managed mock payload tests and real permitted probe; cost/latency quality evaluation against current baseline; unsupported settings fail clearly. API price is not an end-user plan bill.                                                                                                                      |
| A4: agent platform        | Typed per-action rules; adapt named assistant into multi-agent identity/owner/scope; link routines/goals, memory and channel settings; proactive read-only profile; persisted activity events; work/speed budgets; non-overridable hard stops; specialist agent ownership.                                                                                               | Every write path enforces rules; revocation during execution; impersonation/source leakage tests; job recovery with changed identity/scope; resumable activity; budget reservation races and accounting reconciliation; both clients render ownership/rules/activity.                                          |
| A5 / P2: maintained pages | Bind exact block IDs to agent + schedule; preserve human blocks; `@orbyn` comments create scoped jobs and replies; page UI creates routines; authorization intersection; mobile reading/sharing and editing remain planned.                                                                                                                                              | Concurrent human edit produces conflict, not overwrite; deleted/moved blocks invalidate bindings; revoked page access stops work/delivery; mention edit/delete/retry dedup; private comments never enter shared results; desktop and mobile flows exercised.                                                   |
| A6 / P2: Slack then Teams | OAuth installation, workspace/account mapping, opt-in DM delivery, durable outbox, signed callback validation, dedup, unsubscribe/revocation; replies map to exact waiting ID.                                                                                                                                                                                           | Provider mock contracts; verified signatures/replay/rate limits; real authorized test workspace delivery and stale reply rejection; titles rechecked for current visibility. Nothing sent without explicit connection consent.                                                                                 |
| A7 / P2: published pages  | Read-only publication record, explicit content selection, scoped revocable token, expiry and audit; distinguish pinned snapshot from live refresh. Reuse links/privacy modules.                                                                                                                                                                                          | Anonymous boundary tests; unpublished/private/source-excluded data absent; revocation immediate; updates don't silently broaden published scope; responsive viewer proof.                                                                                                                                      |
| A10 / P0 gate: security   | Confirm scan access, then scheduled CLI/SDK workflow with scoped secrets; threat models for OAuth, plan runtime, tools and publication; triage/dedup and reviewed patches.                                                                                                                                                                                               | Authorized scan artifact and controlled finding fixture; forks cannot read secrets; severity policy and human merge; report access unavailable accurately.                                                                                                                                                     |
| A11 / P2: plugin          | Build MCP Apps UI/extension resources, sidebar/composer/file-viewer entry points where supported; feature-detect hosts; preserve typed catalog and existing OAuth grants; partner SIWC outer/inner flows stay separate.                                                                                                                                                  | Local plugin connection, OAuth/account-switch, CSP/resource-origin and inaccessible-tool tests; supported ChatGPT/Codex surfaces proven; portable tool-only fallback. Submission approval is an external gate.                                                                                                 |

Prompt caching controls are documented for newer models, including implicit versus explicit breakpoint choices; apply only to supporting managed routes and never assume a field is supported on plan usage. [Caching](https://developers.openai.com/api/docs/guides/prompt-caching).

## 5. Execution order and review gates

1. **Contract foundation:** SIWC eligibility/deployment decision, threat model, shared connection/executor types, provider capability matrix and clean Docker dependency checks. Desktop local spike first; backend/web/mobile design stays in scope.
2. **Provider and rules:** A2 regression baseline, A3 model/caching evaluation, A4 typed policy/hard stops, A10 scan-access check. Auth “first option” becomes enabled only for platforms where the correct flow is available.
3. **Local plan runtime:** A1 credential flow and real inference, then executor fencing/reconnect/consent/fallback. Approval/mutations stay on Orbyn's existing authorized receipt path. Mobile rollout waits for native flow feasibility, not an invented loopback equivalent.
4. **Agent ownership:** A4 identities, routines/goals, scope, events and budgets; migrate existing named assistant without losing memory or schedules.
5. **Collaboration/distribution:** A5 bound pages/comments, A6 channels, A7 publication and A11 plugin. Deliver end-to-end permission and cross-client proof per feature.
6. **Docs and UI parity:** deliver the D1 Markdown contract and U1 cross-client regression matrix below. Voice, computer-use features/harnesses and the speculative Decisions adapter are removed from delivery scope.

No calendar estimate is committed: partner access, native callback constraints and external integrations are not established. Each stage needs backend focused regressions, full suite, core/API/client typechecks, clean backend/web images, migrations from empty and previous schema, iOS/Android exports, desktop/web and native mobile interaction proof. Existing 1,726-test results establish the prior baseline only.

## 6. Decisions for review

Preserve the source file's stated preferences: SIWC first when eligible, managed API available, user selects the model. The following are proposals requiring review:

- Launch plan runtime on personal desktop first; do not enable shared-team plan billing until ownership/terms are reviewed.
- Offline plan jobs defer by default; managed fallback requires explicit per-user authorization, clear billing and a recorded connection change.
- Multi-agent scope and typed rules precede assistant-maintained shared pages.
- Keep current MCP `get_profile` design; the obsolete Memory draft's profile relocation is not a prerequisite for SIWC.
- Web SIWC partner access and mobile flow feasibility are release gates. Continue existing sign-in while unavailable.
- Live published pages require explicit live consent, not an automatic widening of a snapshot link.
- Security scan entitlement, Slack/Teams credentials and real plan inference tests require authorized test accounts at implementation time.

## 7. Cleanup and stop boundary

All old refs are recoverable in `.codex-cleanup-backups/2026-09-30/all-refs-before-final-cleanup.bundle` in the primary checkout. Local worktree configuration and untracked Gradle files were preserved before old worktree removal. The original branch review is retained as historical evidence.

Remote cleanup status: automatic approval review rejected deletion of all 49 non-main GitHub branches; exact-scope confirmation is pending. The new planning branch is local only.

**Implementation proceeds in checkpoints after this revision.** Each merge requires the acceptance evidence below. Architecture documentation does not constitute delivered product behavior.

## 8. Revised scope and added contracts

The user removed voice and computer use. A8, A9 and speculative A12 are not implementation deliverables. Their historical research in the original source file is superseded by this contract. Security scanning remains an access-gated engineering control, not an autonomous app-control feature.

### P1 — Separate plugin backend integration

Add a plugin integration module and explicit service boundary alongside the existing MCP process. Plugin resource/UI/event handlers use the same typed capabilities but an independently authenticated connector principal; they do not call the browser's assistant session or impersonate first-party routes. Host-provided metadata is untrusted. Plugin backend provider calls use authorized managed/BYO connections only. User-controlled plan tokens never enter this integration. Apply trust, scopes, revisions and durable receipts before writes. Share domain services rather than duplicating tool mutations. Define explicit schemas for launch context, UI resource reads, tool calls, asynchronous job/result events and reconnect cursors. Retain the existing portable MCP surface. Test separate issuer/resource/audience and account-switch behavior, inaccessible tools, rate limiting, duplicate callbacks and tenant isolation.

#### P1 checkpoint evidence — 1 October 2026

The separate backend is now implemented through scoped connector grants,
recipient-bound token guards, a live plugin principal, a standalone HTTP
service, and shared capability execution. Authentication/service foundations
are pushed to main through 751cba8; execution and the calendar-fixture correction are validated through
8f7836d, with 1,991 full-suite tests passing and zero failures or skips. The integration is disabled by
default and OAuth consent still accepts MCP only.

Execution passed 74 focused regressions on main plus workspace typecheck and
build. Image orbyn-plugin-execution:dda1804 built successfully; compiled smoke
checks against a separately marked disposable test database proved plugin
identity, shared reads, session rejection, first-party route isolation, disabled
routes, and concurrent requests producing one task with a replayed receipt.
These checks seed OAuth credentials directly and do not prove an authorization
flow or host launch. See [plugin boundary evidence](plugin-boundary-review-2026-10-01.md).

#### P1 current source audit — 5 October 2026

The October 1 list above is historical. Current main `9c5bb744` contains:

| Contract                                          | Current source and regression coverage                                                                                                                                                                            | Status                                                                                                                                             |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent OAuth recipient and account switching | `modules/plugin/auth.ts`, `modules/oauth/resources.ts`; `oauth.test.ts` exercises plugin consent, wrong-resource exchange/refresh rejection, independent MCP/plugin grants, two-account isolation and revocation. | Implemented; external host authorization acceptance remains open.                                                                                  |
| Protected-resource metadata and service wiring    | `modules/plugin/discovery.ts`, `services/plugin.ts`; `plugin-service.test.ts` and `plugin-compose.unit.test.ts`. Plugin is a separate process and configured recipient, disabled without `PLUGIN_PUBLIC_URL`.     | Implemented; production configuration and host discovery remain unverified.                                                                        |
| Bounded protocol and UI resources                 | `modules/plugin/tool-input.ts`, `protocol.ts`, `ui-resources.ts`; matching unit tests and service regressions enforce scopes, UI opt-in, bounded identifiers and CSP declarations.                                | Implemented; host-rendered UI acceptance remains open.                                                                                             |
| Asynchronous imports and reconnect cursors        | `modules/plugin/import-jobs.ts`, `job-cursor.ts`, `job-resource.ts`, `modules/imports/plugin-producer.ts`; service tests cover replay, grant/account isolation, pagination and invalid/expired cursors.           | Implemented; external host event/reconnect acceptance remains open.                                                                                |
| Backend provider execution and launch context     | Current plugin dispatch executes the shared domain capability registry; there is no plugin inference/provider dispatch path. Existing tool input is not a complete host launch-context schema.                    | Not complete. Add separately authorized managed/BYO provider calls and bounded launch context; never use first-party sessions or user plan tokens. |

Fresh isolated source checks at integrated candidate `a2d30b88` passed 32/32
with no skips or failures across principal, tool input, UI resource, protocol,
job cursor/import and Compose tests (`/tmp/orbyn-plugin-a2-pure-audit.log`). The
initial main-checkout attempt could not load tsx because its installed esbuild
binary was for another platform (`/tmp/orbyn-plugin-current-audit-unit.log`).
The mixed candidate attempt passed 32 cases but its auth test failed during setup
because no test database was available (`/tmp/orbyn-plugin-a2-current-audit-unit.log`).
No dependency or database configuration was changed. Authentication integration
requires the separately marked test database and is not newly qualified here.

Current source inspection is not a new live OAuth, tenant, provider or host test.
Retain managed/BYO execution, launch-context schemas, external host/tenant
acceptance and deployment qualification as P1/P2 work. A4 ownership, rules,
activity and budgets remain separate retained requirements. UI source/control
tests do not constitute visual or native interaction proof.

### M1 — Account model catalog and defaults

Expose a first-party `/models` experience for ChatGPT-connected users. The credential-owning runtime fetches `GET https://api.openai.com/v1/models` with that account's token, normalizes `models[]` using list visibility, slug and display name, and preserves upstream ordering. Backend GET `/models` requires an Orbyn session and returns only sanitized catalog metadata for the selected user-owned connection/executor; it never proxies arbitrary URLs or accepts a plan token. A device publishes an account-bound catalog snapshot through its authenticated executor channel. A missing/offline/expired snapshot is explicitly unavailable/stale, not a managed catalog mislabeled as ChatGPT. Persist default model by user + connection + ChatGPT account/workspace. Changing the account refreshes its catalog and restores that account's default. An unavailable saved model is shown as unavailable and requires a new choice; never silently replace it. Inference rechecks current model availability in the credential-owning runtime. Plugin calls cannot access this first-party preference API. Settings and composer share one selected/default state; model and connection switch cancel old loads. Tests include cross-user snapshots, invalid defaults, stale/offline catalog, account switching, revocation, reconnect and concurrent preference edits. [Official catalog contract](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).

### D1 — Markdown visualization parity

Use the VS Code built-in Markdown experience as a concrete baseline, with documented extensions rather than unlimited third-party extension execution. Keep Orbyn's structured blocks and canonical Markdown representation.

| Capability     | Required behavior and verification                                                                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CommonMark/GFM | Headings and anchors, paragraphs, hard/soft breaks, emphasis/strike, quotes, nested ordered/unordered/task lists, rules, escaped text, tables, links and images; import/edit/export round-trip fixtures, including embedded fences.                                             |
| Code           | Language-aware bundled syntax coloring, copy/source view, long-line scrolling contained within block, accessible fallback for unknown languages; no execution.                                                                                                                  |
| Mermaid        | Desktop and mobile flowchart, sequence, state, class, ER, gantt, pie, journey, mindmap and timeline fixtures; strict configuration, diagrams cannot override security or execute links/scripts; useful parse error + editable source; zoom/scroll/export without page overflow. |
| Math           | Inline/display LaTeX rendering, accessible source, consistent preview and export; malformed expressions do not break the page.                                                                                                                                                  |
| Extended text  | Existing callouts, highlights and footnotes; reference links, YAML frontmatter preservation and TOC/heading navigation. Raw HTML never executes; unsupported syntax is retained as source rather than discarded.                                                                |
| Preview        | Source and rendered view, desktop side-by-side with block/line mapping and scroll synchronization; mobile toggle in the same document; revisions/save status shared rather than competing drafts.                                                                               |
| Export/share   | Markdown source preserved; rendered HTML/PDF contain diagrams/math when supported; snapshot/publication respects authorization and current sources; no private resource links disclosed.                                                                                        |
| Media/security | Current file-store authorization, alt text and safe URL protocols; no remote scripts, iframe execution or diagram-driven external calls; malformed/huge diagrams bounded.                                                                                                       |

Existing desktop Mermaid and rich blocks are reused. Mobile's current flowchart-only renderer is insufficient for D1. Choose a bundled isolated rendering surface or authorized generated SVG with sanitized bounded output; validate Expo/native support before selecting the implementation. No renderer choice may turn private diagrams into publicly accessible assets. [VS Code baseline](https://code.visualstudio.com/docs/languages/markdown), [Mermaid security](https://mermaid.js.org/config/schema-docs/config-properties-securitylevel.html).

### U1 — UI synchronization and regression gate

#### ChatGPT reference and separate agent runtimes — user scope addition, 2 October 2026

**Agent profile and truthful availability — reference supplied 2 October:**
give Daytime/Background and Overnight separate profile panels built around the
person's existing Orbyn companion. Each shows its name, current state, last actual
activity, next scheduled run or trigger, recent work and outputs. Use the supplied
compact profile card as an information-hierarchy reference, expressed through
Orbyn's colors and controls. Provide equivalent entry points and actions on
web/Electron, iOS and Android, including narrow layouts and large text.

- Idle means no model run is in progress. An available worker may poll the queue
  without calling a model. Only a task, enabled schedule, or authorized automatic
  trigger begins a run; a continuously available service must not be presented
  as continuously thinking or working.
- Distinguish Idle/Ready, Scheduled, Working, Waiting for you, Paused/Disabled,
  Unavailable and Failed. Resolve status from persisted jobs, enabled schedules,
  approvals and fresh runtime health. A stale/offline worker cannot report Ready.
- "Active 18 minutes ago" must come from the person's actual job activity, never
  a worker heartbeat, page visit, polling request or animation. Show a truthful
  empty state before the first run and explicit scheduled times with timezones.
- Activity and outputs are permission-filtered, associated with the correct
  runtime and linked to the original task, run, review or artifact. Refresh,
  restart, completion, cancellation and permission loss must update both clients.
- Let people inspect the current task, answer an outstanding approval/question,
  stop a run, manage its schedule and open its outputs. Preserve the existing
  companion configuration and reduced-motion/static/hidden choices; idle agents
  should not animate as if they were processing work.
- Keep service availability, execution-device availability and agent activity
  distinct. Show an execution device only when Orbyn actually uses it. The
  reference's Call/computer controls do not add voice or computer-use features;
  connection actions appear only for working authorized integrations.

Acceptance requires real idle-to-running-to-completed and waiting/stop/recovery
transitions for both independent runtimes, persisted last-activity timestamps,
no provider calls while idle, permission-safe activity/output links, and actual
profile interactions on web and native mobile. A styled card or heartbeat alone
does not complete this requirement.

**Overnight reflection — explicit user addition, 2 October:** Overnight must be
able to reflect on recent work as a bounded, scheduled part of the night. Review
completed and unfinished tasks, failed/cancelled runs, questions and approvals,
and changes the person kept or undid. Produce a concise private reflection with
evidence links, lessons, unresolved questions and suggested next actions, visible
in the morning review and the Overnight profile's outputs on both clients.

Reflection uses the same per-night token/time budget, cancellation, checkpoint
recovery and permission checks as other night work. It must reach completion and
return to idle, with no unbounded self-triggering loop. Avoid repeated reflection
of the same source revisions through a durable receipt. Distinguish observed
facts from interpretations, and do not silently change agent rules, approvals,
source tasks or long-term memory on the strength of an inferred lesson. Proposed
durable changes follow their existing consent/review policy.

Useful findings may be handed to the Daytime agent through the durable bounded
collaboration channel, carrying source references, scope and provenance. The
receiving agent rechecks permissions and applicability before acting; a reflection
is not blanket authorization for follow-up writes. Test denied/deleted sources,
no new evidence, budget exhaustion, retries, restart without duplicate outputs,
and actual mobile/web access to the saved reflection and proposed follow-ups.

The user explicitly authorizes inspecting [ChatGPT](https://chatgpt.com/) on laptop
and mobile as a UI/UX reference and requires this direction to be part of the ADR.
Improve the whole Orbyn application to that level of visual consistency while
retaining Orbyn's palette, typefaces, identity and distinct character. Every
shipped behavior remains required on web/Electron and mobile. This addition
updates the earlier mobile-design preference: mobile may receive coordinated
layout improvements, with its existing useful interactions preserved.

**Observed reference, 2 October:** the actual desktop and 390 × 844 mobile web
interfaces were inspected, including navigation, composer and Settings. Desktop
uses a restrained navigation rail/sidebar, a clear content heading and generous
content spacing. Mobile collapses navigation into a drawer and places the composer
near the bottom. Settings has search, grouped destinations and a focused content
pane; on mobile, navigation and selected content occupy separate views. These
are observed layout patterns, not evidence about OpenAI's backend architecture
or native iOS/Android behavior. No ChatGPT preference or conversation was changed.

**Whole-application scope — explicit user clarification, 2 October:** this is
an application-wide UI/UX redesign. Assistant/chat improvements alone cannot
satisfy it. Apply the shared visual system and behavior requirements to every
user-facing surface and its native/mobile equivalent, including secondary flows,
empty/error/loading states, detail screens and overlays. Keep a per-surface
acceptance ledger rather than extrapolating from one redesigned screen.

| Surface group               | Required coverage                                                                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell and account           | Navigation/sidebar/drawer/tabs, search, profile/session loading, sign-in/onboarding, notifications, deep links and menus                                                                      |
| Daily planning              | Home, Agenda, My tasks, task/event details, Calendar, planning/focus/time tracking, goals, routines and lists                                                                                 |
| Workspace                   | Projects/stages, saved Views, Memory, Agent notes, Docs library/editor/comments/import/export and Study                                                                                       |
| Agent work                  | Interactive assistant, separate Background workspace, Overnight history/morning review, activity, approvals, rules, collaboration and companion customization                                 |
| Shared work                 | Teams/members/permissions, shared projects/pages, Booking, review/change history and published viewers                                                                                        |
| Settings and administration | Personal preferences, appearance, account/security/privacy/devices, connections/model defaults, workspace providers/embeddings, connected agents/plugins and every existing Admin destination |

Each group must pass a feature inventory, backend/client wiring and persistence
checks, layout/accessibility review and actual interactions on its supported
surfaces. Every shipped web/desktop behavior needs a functional mobile entry point.
Responsive web screenshots do not establish native acceptance. Existing rare
actions and error recovery must remain discoverable after simplifying the layout.
The whole-app scope does not reintroduce the explicitly excluded product features.

**Experience-level coverage — further user clarification, 2 October:** the
redesign includes Docs design and typing, Views, and all layouts and interactions.
Changing surface styling without improving these workflows is insufficient.

- **Docs:** library/search/create/open, reading and editing, typography and line
  spacing, title/body typing, formatting and Markdown/source/preview affordances,
  code/tables/math/Mermaid, comments, links, outline, import/export and sharing.
  Preserve stable block IDs, caret/selection, undo/redo, composition/IME and dirty
  drafts during refresh, collaboration, navigation and failed saves. Verify save
  status, retry/close flushing, long-document responsiveness, keyboard shortcuts
  and native keyboard/toolbar/sheet containment. Test actual typing/editing and
  persisted results; parser/export checks alone do not establish this experience.
- **Views:** discovery, creation/editing, saved filter/sort/grouping controls,
  columns/visibility, layout switching, row/card actions, selection and detail
  navigation across every supported list/table/board/calendar layout. Check long
  content, empty/error/loading states, density, horizontal/vertical scrolling,
  responsive equivalents and persisted view settings. Do not remove supported
  functionality to make a cleaner screenshot.
- **Every layout:** shell/content sizing, panes, headers/toolbars, form/list/detail
  alignment, resizing/collapse, sticky elements, menus/modals/sheets, focus return,
  touch targets, keyboard access and transitions between surfaces. Exercise both
  themes, narrow/wide screens and native large text/software keyboard.

Record visual quality, workflow behavior and persistence separately in each
surface's acceptance ledger, including defects reproduced and evidence after
the correction. This remains part of the full application deliverable.

**Orbyn design requirements:**

- Apply one hierarchy and spacing system across the shell and all U1 surfaces:
  navigation, headings, toolbars, forms, lists, cards, empty/error/loading states
  and overlays. Retain theme tokens, the radius scale and Orbyn controls.
- Keep primary content readable and give it room; align repeated controls and
  move secondary management actions into the established ⋯ menus.
- Desktop Settings uses a searchable category rail and a focused detail pane.
  Narrow web and native mobile use a category list with a clear return path,
  bounded scrolling and keyboard-safe detail screens. Replace long, competing
  accordion stacks where they obscure the current task.
- Make profile/session loading, refresh recovery, provider availability and
  retry states explicit. Preserve drafts and selections through failures.
- Preserve the new companion implementation on local main (`2eb34a5`, validation
  note `0749e6e`), including account-bound customization, assistant state and
  reduced/static/hidden motion. Reconcile it with the redesign; do not replace
  that work with an older branch's assistant or settings implementation.
- Distinct agent destinations use compact, accessible identity/presence marks
  inspired by the reference's simple dot vocabulary, expressed in Orbyn's own
  visual language. Labels, activity and status must remain understandable without
  color or animation. The character and presence marks have consistent roles.

**A4 runtime requirement:** Overnight and background agents collaborate, but must
not execute in the same runtime. UI separation alone does not meet this requirement.
The intended execution boundaries are:

| Destination | Responsibility                                                      | Runtime boundary                            | Web/mobile UI boundary                                              |
| ----------- | ------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------- |
| Chat        | Person-initiated conversation and its exact approval/question state | Interactive runner                          | Conversation, composer and current-turn controls                    |
| Background  | Agent tasks, ideas, goal check-ins and routines outside a night run | Dedicated background worker process/service | Background activity, queue, results, waiting decisions and controls |
| Overnight   | Jobs belonging to a night, including night tasks/goals/routines     | Dedicated Overnight worker process/service  | Tonight's status, history, morning review and unfinished work       |

Shared libraries, durable storage and authorized capabilities may be reused.
Each worker has its own claim filter, concurrency and resource limits, lifecycle,
health and shutdown path. Interactive capacity must remain available while either
automation lane is saturated. Restarting or stopping one automation runtime must
not stop the other. Production must not silently collapse them into the current
all-jobs runner or notifier fallback. Show when the required worker is unavailable
rather than presenting queued work as an active run.

**Current source evidence:** main `c1b3ffa` (PR #135) now classifies jobs into
immutable interactive/background/overnight lanes and starts dedicated automation
services. The original single-loop/eight-slot and notifier-fallback gap is closed
by that checkpoint, with independent-process recovery tests. Existing web
`OvernightView` and native `OvernightSheet` remain the morning review surfaces.
Separate background workspaces/profiles and durable collaboration are still
implementation gaps; runtime isolation alone does not complete their UI or
handoff contract.

**Collaboration contract:**

- Exchange durable handoffs/results through explicit references and recorded
  producer/recipient, parent work, owner, scope, revisions, status and provenance.
  Do not rely on shared process memory or inject automated runs into a person's
  current conversation. Each accepted handoff creates or associates distinct work
  for the receiving runtime; it does not transfer one active execution between them.
- Recheck current access, kept-out projects, agent rules, connection validity and
  budgets before accepting or consuming a handoff. Sharing results never grants
  new permissions or turns an unattended proposal into approval.
- Use idempotent receipts, finite handoff depth/count and bounded retries so
  duplicate delivery, a restart or reciprocal handoffs cannot create loops or
  duplicate changes. Completion acknowledgement and failure are durable.
- Coordinate source ownership so a task/routine/goal cannot run concurrently in
  background and Overnight. Preserve the existing lease fencing, checkpoint
  recovery, exact waiting IDs, approved mutations and undo history.
- Link both activity views to the same authorized handoff and result trail while
  keeping their run lists and controls separate. Morning review summarizes the
  collaboration without creating a push for every unattended job.

**Implementation order and completion gates:**

1. Preserve and qualify the current main UI plus pending parity checkpoints.
   Update the surface ledger from actual source and interaction evidence.
2. Implement shared lane classification and immutable job ownership, dedicated
   service entry points/deployment configuration, per-lane bounded claims and
   health/recovery/shutdown. Cover upgrades and queued legacy jobs explicitly.
3. Implement the durable collaboration/ownership contract and backend access,
   duplication, failure and budget checks.
4. Implement distinct Background and Overnight navigation/workspaces in both
   clients; then apply the unified shell and Settings patterns across U1.
5. Exercise actual desktop/web, mobile web and native iOS/Android interactions:
   separate views, long labels, both themes, large text, software keyboard, focus
   restoration, deep links, offline workers and nested overlays.
6. Prove runtime isolation with two real worker processes: competing claims,
   saturation, recovery after killing only one worker, a collaboration round trip,
   duplicate handoff, stale approval, access revocation and absence of duplicate
   writes or night pushes. Include service health and production configuration.
7. Run focused/full tests, workspace types/builds, migrations and exact compiled
   service smoke checks on stable source; commit and integrate ready checkpoints
   to main. A screenshot, passing unit subset or UI-only lane selector is not
   runtime delivery. Keep remaining provider/platform and preview gates explicit.

The broad ADR remains active and incomplete. Voice, computer-use product features
and the speculative Decisions adapter remain excluded; using browser/simulator
tools to inspect and validate this work does not add those product features.

#### Mandatory mobile parity — user scope clarification, 2 October 2026

Every feature implemented and shipped on web/desktop must also be implemented
on mobile. Track backend/shared behavior, web/desktop entry points, mobile entry
points, persistence and failure states, and acceptance evidence together for
each feature. Retaining mobile's visual design does not exclude any functionality
from this requirement. A shared helper, typecheck or Expo export is not native
interaction proof. Verify iOS and Android behavior as well as mobile web.

Platform eligibility and native callback limitations remain genuine release
gates; they do not remove mobile from the contract. Mark the affected feature
incomplete until an appropriate mobile flow and its acceptance evidence exist.
The private desktop ChatGPT executor, unmerged settings redesign and isolated
Mermaid source are foundations rather than completed cross-client features.

Current Docs HTML exports use one server renderer and the existing mobile
Download/Share menu already includes HTML. Source and automated save/share checks
must still be distinguished from actual mobile interaction and visual fidelity.

#### Web redesign and settings acceptance — user scope addition, 1 October 2026

Complete the existing ADR before declaring the release ready. The user authorizes a
full web redesign and requires a full settings UI/UX redesign. Preserve the existing
palette and typefaces; mobile's current visual design is retained. Mobile still
receives the connection, model and provider functionality required for parity.

The web audit covers the application shell, navigation, Home, Agenda, tasks,
calendar, projects, Docs, memory, agent notes, views, study, lists, assistant,
Overnight, teams, booking, notifications, review, settings and admin. Record each
surface's layout defects and delivery evidence. Correct hierarchy, density,
alignment, containment, loading/error/empty states and keyboard navigation;
shared components must be checked across their consumers. A settings-only change
does not satisfy the full web scope.

Settings must provide a clear navigation structure, searchable controls, readable
labels and descriptions, account/security management and an identifiable AI &
models destination. Separate personal connections and model defaults from
workspace-managed providers. ChatGPT must have a discoverable connection entry,
account/workspace selection, connection health, device availability, reconnect and
disconnect actions, and the actual account catalog/default selector. An MCP grant
to an outside ChatGPT agent is a different connection and must not be presented
as ChatGPT plan access. Show eligibility or platform constraints accurately;
never make an enabled connection button depend on an absent runtime.

Provider administration must support multiple saved connections, including
multiple connections of the same kind and custom compatible endpoints. Inventory
the existing twenty provider definitions before adding integrations. Validate each
adapter's actual supported request format and capabilities. Support independently
selected text-generation and text-embedding providers/models, credential testing,
catalog refresh and explicit manual model entry where discovery is unavailable.
Embedding settings must report capability, dimensions and indexing status;
changing embedding models must handle incompatible existing vectors safely.
The [embedding provider audit](embedding-provider-audit-2026-10-01.md) defines
the required mixed-version rollout, provider-bound consent, dimension validation,
document/configuration revision fences, conditional queue acknowledgement and
upgrade/race acceptance matrix. Its adapter checkpoints do not complete these
configuration and reindex requirements.
Do not assume every text provider supports embeddings or that a model catalog
implies ChatGPT plan entitlement. Persist selection and verify refresh, account
switch, revocation and unavailable-provider behavior in both clients.

Acceptance requires functioning backend/client wiring, focused regressions,
workspace typechecks/build and full tests, plus actual responsive web interaction
checks in both themes. Test long labels, large catalogs, search, validation,
keyboard focus, slow/offline loading and nested menus/modals. Record mobile
functional parity and native verification separately. Commit and integrate ready
checkpoints to main; do not report a visual mock or private helper as delivered.

Audit all affected current surfaces: Assistant/Overnight/reminder cards, Docs/editor/comment layers, settings/auth/model picker, navigation/deep links, plugin UI and public viewers. Test narrow phones, tablet widths and wide desktop, both themes, keyboard open/closed, large text, long labels/code/tables/diagrams, empty/error/loading states and overlay nesting. Menus/modals must remain within the viewport and have one focus owner. Restore/send/poll generations, live events, dirty editor saves, model switching and stale approvals must not overwrite newer state. Cover native iOS and Android interactions separately from mobile web. Typechecks/exports alone do not prove touch or visual behavior. Keep visual proof and feature-by-feature acceptance status in the ledger. Do not claim all prior UI defects are fixed without inspecting and reproducing their affected surfaces.

### Checkpoint policy

C0: this ADR/artifact revision (documentation only). C1: model/provider/connection contracts. C2: SIWC/catalog/defaults and device execution. C3: typed rules/agent ownership/activity/budgets. C4: Docs parity and UI regressions. C5: bound pages/publication/channels. C6: separate plugin backend/UI and access-gated security controls. Dependencies can change order, but every retained ledger row must finish. Each production checkpoint receives a scoped commit, main integration, current test/build/runtime evidence and explicit external-access limitations. Preserve user changes in the primary checkout.

### C1a foundation checkpoint — 2026-09-30

Implemented shared account-bound ChatGPT catalog parsing, explicit unavailable defaults,
and a separate device-side text Responses transport with fixed provider endpoints,
request allowlists, stream completion validation and bounded responses. This is the
contract/transport foundation: OAuth, secure token storage, persisted preferences,
backend identity verification, tool execution and `/models` UI remain open under C1/C2.
No real account inference or provider credentials were used for this checkpoint.

Follow-up contract review (1 October, local main checkpoint `1c44b40`): the plan transport now binds
credentials to the issued OAuth client ID as well as the account/workspace.
It rejects `dynamic_agent_client` as a saved registration and refuses a different
registration before making a provider request. All 17 transport tests passed;
these use fixtures, not a real OAuth or inference session. Identity verification,
protected token storage, model/default persistence and `/models` UI remain open.

Model-picker state foundation (local main checkpoint `1c44b40`): shared validated binding/preferences
and a credential-free controller now coordinate catalog/default loading for one
verified user, connection, issuer, subject and issued client ID. Settings and
composer can subscribe to one state. Versioned storage receipts are checked;
concurrent saves are rejected, failed loads disable stale choices, removed
defaults remain unavailable, and closing a connection fences late loads/saves.
Eight focused controller tests passed. Backend authenticated persistence/CAS,
OAuth verification, runtime storage, actual `/models` routing and both client
UIs remain open. No provider tokens or real account requests were used.

The contract checkpoint and cleanup-test checkpoint `2d35df6` were applied to
local main; all main workspace typechecks and 38 focused tests passed. The full
main suite passed all 1,778 tests with no failures or skips. The Mermaid implementation is still
outside main. None of these local commits establishes a production deployment.
Both checkpoints were pushed to origin main at `2d35df6`; the main production
build passed. Production rollout remains unverified.

Backend identity-verifier foundation: signature verification uses the
fixed OpenAI JWKS endpoint, issuer, issued-client audience, nonce, required
claims, a five-second clock tolerance and a ten-minute token age limit. Multiple
audiences require a matching authorized party. It returns only issuer/subject/
client ID and exposes generic errors rather than token/provider details. Four
tests using real RSA signatures cover valid identity and claim/signature/input
failures; backend typecheck passed. No real account or credential was used.
The worktree now also has ten-minute, exact-session challenges, atomic nonce
consumption and registration linking, owner-only listing/disconnect, challenge
invalidation on disconnect, and account/session rechecks after verification.
First-party `/ai/connections/chatgpt` endpoints reject API keys and connector
credentials; shared schemas/client methods reject plan tokens. Provider proof is
never stored, logs redact token fields, expired challenges have an hourly sweep
rule, and shipped Privacy text explains retained identity metadata. Connection
operations bypass the 24-hour idempotency cache, so expired/revoked sessions cannot
replay a cached connection result. OAuth callback/PKCE/device storage, provider
eligibility proof, actual eligible plan usage, executor integration and
authenticated `/models` remain open. This foundation is not a completed sign-in
flow. Focused route, identity, lifecycle, cleanup and capability-inventory tests
passed 26 checks; a subsequent regression run passed 35 checks, including the
final account-restriction race test and legal publication. The first broad run
failed three checks: the existing intermittent assistant sweeper assertion,
legal publication with a shipped date ahead of the server's UTC date, and stale
generated route counts. Legal versions now advance even when the clock moves
back; generated catalogs were refreshed. The sweeper's failure did not reproduce
in the focused rerun, so its cause remains unproven.

A new, independently marked disposable database applied the migrations and
passed the complete 1,805-test worktree suite with no failures or skips. All
workspace typechecks and the production build passed on the final source.
The connection checkpoint is committed as `c7824fb` in the implementation
worktree and integrated into main as `ed379a1`. That exact main checkout passed
all 1,796 tests with no failures or skips, all workspace typechecks and the
production build. The checkpoint and its evidence were pushed to origin main
at `a31071b`.
Production rollout is not verified; the preceding GitHub CI could not start
because of account billing/spending limits, and Deploy was skipped.
Mermaid implementation files were excluded from that
checkpoint and remain unmerged pending actual rendering/native verification.

Evidence: 16 focused tests passed; full backend suite 1,742 passed with no failures or
skips; all workspace typechecks and production builds passed; iOS/Android exports
passed; a fresh backend Docker build successfully imported both shared exports.
No UI behavior changed in this slice.

Release priority update: after C1a integration, investigate refresh-triggered HTTP 429
and audit missing desktop/web/mobile feature parity. Deliver tested fixes and main
checkpoints before resuming the remaining DevDay implementation sequence. Preserve
all retained ADR scope; record any external or native verification limits explicitly.

### D1 implementation progress — 2026-10-01 (unmerged)

The mobile flowchart-only preview has been replaced in the implementation worktree
by a full, locally bundled Mermaid 11.17.2 renderer. Native uses Expo-compatible
WebView 13.16.1; mobile web uses an opaque sandboxed iframe. Both receive bounded
source and theme messages, reject stale results, retain source on failures, and
offer zoom and SVG export. Configuration directives are rejected; the renderer
uses strict policy, blocks network resources through CSP, and removes executable
or external references from exported SVG. Existing authorized Orbyn node links
remain host actions. Generated renderer assets have a reproducible build command.

Evidence so far: nine source/protocol/security tests, ten neatness tests, all workspace
typechecks, and web/iOS/Android exports passed. Ten diagram-family fixtures are
prepared, but actual rendering and native layout/touch/export remain unverified.
Browser access to the local acceptance page was explicitly declined, so that
verification path was stopped. This change is not merged or production-ready.
Desktop renderer synchronization and the rest of the D1 acceptance table remain
open; source checks and bundle exports are not evidence of visual parity.

The protocol tests execute the actual message handler with a controlled Mermaid
engine and DOM boundary; they prove message fencing, strict pinned configuration,
size/directive/theme rejection, and rejection of escaped external CSS, imports
and image functions. SVG animation elements are excluded from export. A source
digest check rejects a stale generated renderer asset. The native surface keeps
its HTML source object stable to avoid reloads when rendered height changes.
These tests do not execute real layout or prove the ten-family render matrix.

The latest full suite completed with 1,776 passes and one sweeper fixture failure.
The fixture now asserts a completed sweep (with a bounded retry when the cleanup
lease is occupied) and checks the assistant-job rule's error result. A separate
test proves an occupied lease returns null. All 13 assistant-worker tests passed
in the focused rerun. A fresh complete suite is required before integration;
the occupied-lease test does not establish the cause of the earlier failure.

The complete rerun subsequently passed all 1,779 tests with no failures or skips.
The newly added model-picker file was outside that run's initial file list; its
eight tests passed separately. All workspace typechecks passed. Visual/native
renderer checks and the remaining application integrations are still open.

### C2 desktop OAuth/storage progress — 2026-10-01 (unmerged)

Private main-process helpers now implement bounded loopback OAuth callbacks,
fresh state/nonce/S256 PKCE, issued-registration validation, fixed-endpoint code
exchange and an encrypted account/server-bound credential vault. Callback scopes
cannot enable plan usage; token-response scopes are authoritative. Storage uses
atomic encrypted replacements, version checks and immediate disconnect fencing.
Reads use one descriptor, reject symlinks and bound allocation/read size even
when the path or file changes. These helpers are not wired into IPC or packaged
into the released app and do not constitute a usable sign-in flow.

Twenty focused OAuth/vault regressions passed, including a signed fixture ID
token through callback/exchange/verification/storage. Actual Electron 44.3 on
macOS encrypted synthetic credentials, restored them in a separate fresh process
and erased them. No real provider credentials or account calls were used. This
development executable proof does not cover signed releases, updates, native UI,
Windows or Linux. The prior combined regression set passed 48 tests and all
workspace typechecks; the added descriptor regression passed subsequently.

Registration metadata now has a private, account/server-bound store with a stable
host ID, atomic issued-client retention and optimistic revision checks. Four tests
prove restart persistence, an expired-code retry retaining its registration,
account/server isolation, corrupt/symlink rejection and concurrent-write fencing.
All 24 OAuth/registration/vault regressions passed. Metadata contains no codes or
tokens. Callers must use one main-process store per account/server and retain the
issued ID before exchange; orchestration is not wired yet.

Private sign-in orchestration now retains callback registration before exchange,
uses the exact server challenge nonce for local verification, compares local and
server identity metadata, and installs credentials only after both agree.
Cancellation fences every awaited phase and revokes a newly installing slot;
an already installed slot requires disconnect before replacement so cancellation
cannot erase older credentials. Five controlled orchestration tests cover ordering,
identity/account/backend mismatches, phase cancellation and replacement protection.
Concurrent attempts for one account/vault are rejected before any asynchronous
work. The attempt lock remains held after cancellation until pending adapters
have stopped, preventing a cancelled loser from revoking a later winner. A
controlled non-cooperative adapter regression proves both lock retention and
release after termination. The combined desktop-helper regression set passed
30 tests. Trusted adapters are
injected; production IPC, local verifier packaging and real-provider flow are absent.
Seamless reauthentication of existing credentials remains a separate open protocol.

Still required: trusted
main/preload entrypoints, account/session cancellation, local signature verification,
refresh rotation, real eligible provider proof, executor enrollment, catalog/default
persistence, `/models` and client integration. Repository metadata is private with
no recognized license; eligibility for the documented OSS flow remains unproven.
Do not infer website or mobile entitlement from the desktop helper.

GitHub's code-scanning API returned 403 because Advanced Security is disabled.
This is not evidence of Codex Security access or a completed security scan. Main
CI run `36769753341` could not start due to account billing/spending limits and
Deploy was skipped. Those external gates do not prevent continuing local work.

The complete worktree suite subsequently passed 1,835 tests with no failures or
skips, covering the thirty desktop-helper tests and the unmerged Mermaid checks.
Identity verification has now moved unchanged into the explicit
`@orbyn/api-client/openai-identity` entrypoint with its declared `jose` dependency;
backend reexports it and desktop orchestration uses it by default. The ordinary
client entrypoint does not import it. Added RSA/EC/shared-entrypoint regressions
and renderer digest checks passed in a forty-test focused run; all workspace
typechecks passed. No real OpenAI session or inference request was used.

The shared-verifier checkpoint `83a9074` is integrated into local main as
`6be8a81`. Exact-main typechecks, production build and all 1,798 tests passed
with no failures or skips, and the checkpoint was pushed to origin main.
Production deployment remains unverified. The private OAuth/store/orchestration files
and Mermaid implementation remain excluded from this checkpoint.

The private desktop IPC guard now binds credential operations to the designated
main window, its top-level frame and the exact local entry file, checking both
the invoking frame and the owning page's current URL. Destroyed windows, child
frames, sibling windows, remote/network-file URLs and navigated pages are denied
with generic errors. Three controlled guard tests and the combined 33-test
desktop-helper set passed. A separate Electron 44.3 macOS fixture invoked actual
IPC from two sandboxed/context-isolated windows: the designated main window was
allowed and the sibling was denied. This is fixture evidence, not a packaged
release or complete authentication UI check. The guard is not wired into app
handlers yet. The completed main validation is recorded above.

The private OAuth transport now supports the documented refresh grant at the
fixed token endpoint, using the saved issued client ID, refresh token and API
resource without sending a new scope. Omitted replacement refresh/ID tokens and
scope retain their saved values; explicitly reduced scopes remove plan permission.
Invalid grants have a distinct generic recovery error, malformed replacements
are rejected, and cancellation fences late responses. Five controlled refresh
tests and the combined 38-test desktop-helper set passed. This is transport only:
per-registration refresh serialization, replacement identity verification,
atomic vault rotation, session recovery and real-provider proof remain open.
The registration store now supports distinct validated registration slots under
one Orbyn account/server, preserving the existing primary slot's path and legacy
metadata. Issued clients remain separate across slots and copied records fail
the slot-binding check. Five registration tests and the combined 39-test desktop
helper set passed. Persisted slot listing/selection and
the actual account picker still remain open; this storage change is not UI proof.
[Refresh contract](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).

Shared host identity is now implemented for new registrations: one private
installation file is atomically published without replacing an existing ID.
Four separate Node processes converged on the same host ID; concurrent readers,
permissions and corrupt/symlink rejection also passed. Existing registration
records retain their original host IDs for returning sign-in compatibility.
All 42 desktop-helper tests and workspace typechecks passed. Listing/selection, picker UI, refresh
orchestration and production entrypoint wiring remain open and unmerged.

After pushing `6be8a81`, CI run `36793519501` could not start because of the
same GitHub account billing/spending limit; Deploy `36793529950` was skipped.
This confirms the external release gate persists, not a production rollout.

Registration listing is now available privately for the account picker adapter.
It scans at most 1,000 registration files, validates bounded file contents and
slot/filename binding, filters by current Orbyn owner/server, and returns only
slot ID, host ID, issued client ID, revision and an optional verified connection
binding. The vault is never read. Listing
does not create a registration; malformed or copied matching records fail with
a generic error. Tests cover empty listing, multiple slots, another owner and
copied-slot rejection. Persisted active selection, verified account labels,
production IPC wiring and actual picker behavior remain open.

Registration slots now retain the verified Orbyn connection binding after local
signed identity and backend identity agreement, before credential installation.
Owner/client mismatches, stale revisions and replacement with another identity
are rejected. The metadata read/list path does not decrypt credentials; an
identity record does not imply usable plan credentials. Seven registration tests
cover restart persistence, identity substitution and concurrent writes across
separate store instances. A shared per-file main-process queue serializes these
writes; multi-process metadata mutation is not supported. The native app's
single-runtime ownership must remain enforced at integration. Active selection,
account labels, UI wiring and refresh orchestration remain open.

Vault reads now perform a symlink/regular-file check before opening and compare
the opened descriptor's device/inode identity, supplementing `O_NOFOLLOW` on
platforms where that flag is absent. A regression replaces the path during an
asynchronous keychain availability check: the current read stays on its already
opened validated file, and a subsequent read rejects the tampered replacement.
All ten vault tests passed. These filesystem tests ran on macOS; they do not
establish native Windows/Linux storage behavior or complete the platform gate.

Active registration selection now persists per Orbyn owner/server with an opaque
revision. Selecting an unverified/missing slot fails, concurrent selections with
the same revision have one winner, stale changes fail, and clearing selection is
explicit. The shared main-process metadata queue now covers all slots for one
owner/server so separate store instances cannot race selection. Eight registration
tests cover persistence, competing choices and owner isolation. This is selection
metadata only: it does not prove credentials, entitlement or a server session are
live. Runtime account-switch cancellation, offline/revoked UI states and the native
account picker remain open, as do refresh orchestration and `/models` integration.

The private active-connection resolver distinguishes unselected, selected metadata
and unavailable saved registrations. It retains a missing registration's saved
ID/revision and never substitutes another slot. The expanded selection regression
checks resolved identity metadata, explicit clearing and a deleted selected slot
while another valid slot remains. The initial expanded test placed its stale-write
assertion after deleting that slot and received the expected missing-slot rejection;
the assertion was moved before deletion so both independent behaviors are tested.
Runtime credential/server availability checks and actual UI remain unimplemented.

The private registration store now persists a local model-preference cache bound
to its verified user/connection/issuer/subject/client identity. Concurrent writes
use an optimistic integer version; stale saves and different bindings fail, and
clearing is explicit. Preferences survive restart and a separate registration
starts unselected. Nine registration tests passed. This is local cache storage,
not completion of M1: authenticated backend persistence/CAS and synchronization,
fresh catalog entitlement validation, `/models` routing and both client UIs remain
open. A trusted catalog/controller adapter must validate the selected model before
calling this private cache writer; it must not be exposed as arbitrary IPC input.

A private desktop model-runtime adapter now connects the shared picker, bound
encrypted vault, live catalog transport and local preference cache. It checks
the selected registration/revision and a trusted live Orbyn connection callback,
rejects expired or non-sharing credentials, reloads the catalog before saving a
non-null default, and cancels catalog requests when closed. The issued client ID
is used only as the transport's registration/workspace consistency anchor, not
as a separately discovered workspace identifier. Three controlled adapter tests
cover live loading/default saves, removed models, changed selection, revoked
connections and expired credentials. No real OpenAI request was used. Backend
catalog/preference synchronization, IPC, model UI and full account-switch/save
race verification remain open. This adapter remains unmerged.

Runtime model saves now pass the captured selection revision and lifetime abort
signal into the local store. The owner/server queue checks the selected slot and
revision before mutation, and cancellation is checked before atomic publication.
Regressions prove a pre-cancelled save and a save queued behind an account switch
leave the prior preference intact. A controlled transport test also proves closing
the runtime aborts an in-flight catalog and prevents late picker publication.
This does not establish backend synchronization or the UI/platform switch matrix.

An integration regression now runs the actual shared picker/runtime adapter with
the real on-disk registration store. Switching selection while a default-save
catalog request is pending rejects the save and leaves the preference unselected
at version zero. A fresh runtime after reselecting the account saves the choice,
which a restarted store restores at version one. Provider and vault callbacks are
controlled fixtures; this proves local controller/storage composition, not a real
provider session, OS encryption, backend persistence or user-facing interaction.

Backend preference persistence has started with migration 200: one credential-free
model/version row per verified connection, safe-integer version bounds, model
syntax bounds and cascade deletion. The private read service rechecks the exact
live Orbyn session/account and connection ownership/revocation under transactional
locks, returns an explicitly unselected version-zero preference when absent, and
derives the response binding from server identity metadata. Twelve connection
tests passed on the marked disposable database, including two added preference
cases covering owner isolation, revoked connections, disabled/expired sessions,
database constraints and cascade cleanup. No HTTP preference route or write API
is exposed yet; executor catalog validation, optimistic writes, synchronization
and `/models` UI remain open. This migration/service slice remains unmerged.

The private backend preference writer now requires a trusted catalog-validation
callback, checks exact identity binding, and serializes compare-version writes
through the connection row. Session/account/connection state is rechecked after
the callback; revocation during validation prevents mutation. Concurrent writes
from the same version have one winner, clearing is explicit, and returning OAuth
to the same registration restores its persisted model/version. Fourteen connection
tests passed on the marked disposable database. This callback is not exposed as
HTTP input: the authenticated executor/catalog adapter and public preference API
remain unimplemented. These tests use controlled validators, not live entitlement.

Stale backend preference versions now fail before invoking catalog validation,
while the transactional version check still handles concurrent changes afterward.
An added regression disables the account, removes email verification or expires
the exact session during the validator callback; each pending write is rejected
and leaves no preference row. This extends the service-level race gate and does
not prove the still-unimplemented HTTP/executor integration.

Executor wire contracts have started in shared core: public Ed25519 SPKI
enrollment input, an exact-registration challenge, signature completion and
bounded catalog metadata with lease epoch and publication sequence. Strict
schemas reject provider tokens, arbitrary endpoints, duplicate models and extra
model fields. Two tests passed using real generated public keys/signatures and
invalid catalog fixtures. These schemas validate syntax only: server-side key/
signature validation, exact-session challenge consumption, replay/lease fencing,
authenticated publication and all runtime/platform adapters remain open. The
ongoing full-suite run started before these two tests existed; it cannot be used
as their execution evidence. Their focused run is recorded separately.

### Executor proof and preference checkpoint validation

The private executor verifier now validates canonical Ed25519 SPKI bytes and
signatures against the saved server challenge message. Three proof tests reject
changed messages, foreign keys, private keys, a same-size X25519 public key and
noncanonical public-key/signature encodings. Together with the two contract tests,
all five focused tests passed; all workspace typechecks passed afterward. This
does not establish enrollment authorization, challenge consumption or leases.

The previously running worktree validation completed with 1,864 tests passed,
zero failures/skips, and a successful production build. Its initial test list
excluded the five executor tests added afterward. The credential-free backend
preference migration/service and 15 connection tests were committed separately
as `d0f8ae6`, then integrated into local main as `4c5c909`. Exact-main typecheck,
build and full-suite validation is running before push. No preference HTTP route
is exposed: authenticated executor/catalog validation and the user-facing models
flow remain required. Other unmerged helpers and Mermaid work are outside this
checkpoint.

Private executor enrollment now persists five-minute exact-session challenges
with canonical public keys, server-generated proof messages and one-time atomic
consumption. Connection ownership and account/session state are rechecked under
parent-first locks. Enrollment renewals compare both epoch and registration ID,
so competing renewals or a deleted/recreated registration cannot accept an older
proof. Disconnect consumes pending device challenges and removes enrolled keys;
returning OAuth does not revive those proofs. Pending proofs are capped at five
per owner and registrations at twenty per connection, including completion-time
checks. The sweeper removes expired proofs and keeps live ones.

All 21 connection/enrollment tests passed on the independently marked
`orbyn_executor_enrollment_20261001_test` database. Four sweeper tests passed after
correcting a parameter-count error in the new test fixture. Workspace typechecks
passed for the service. Migration 201 and enrollment remain unmerged while their
full worktree validation runs. No enrollment HTTP routes, executor leases,
authenticated catalog publication or runtime enrollment adapters exist yet;
enrollment alone authorizes no provider call.

Catalog proof preparation now canonicalizes strict shared metadata, hashes it
with SHA-256 and verifies an Ed25519 signature in a separate catalog domain.
Seven focused contract/proof tests passed, including a thousand-model catalog,
property-order normalization, model-order tampering and changes to the account,
executor, lease or publication sequence. All workspace typechecks passed.
Neither a valid signature nor an enrolled key proves provider entitlement; lease
authorization and live catalog publication are still required.

The enrollment full run ended with 1,820 passes and four failures. One was the
existing assistant-worker retention assertion: both stale fixture jobs remained.
The same assertion failed in exact-main validation, then all 13 focused worker
tests passed without a source change. Its cause remains unverified; a complete
exact-main rerun is active before any push. The other three enrollment-run
failures were missing shared exports while new catalog helper source was edited
and package outputs rebuilt during that run. That run cannot establish the
current source state. Future full validation must use stable source/package
outputs without overlapping edits or rebuilds. The retention assertion now
records the actual sweep count and remaining-row eligibility to diagnose a
recurrence without weakening its expected deletions. Enrollment remains unmerged.

The exact-main rerun completed with all 1,803 tests passed, zero failures/skips.
Together with the successful exact-main typecheck/build, this validates the
private preference checkpoint `4c5c909`, now pushed to `origin/main`. The earlier
retention failure and its unverified cause remain recorded above; the rerun is
not evidence of a retention fix. Production deployment of this checkpoint is
unverified. Enrollment/catalog proof work is starting a fresh stable-source full
validation before integration.

### Validation follow-up and D1 dependency audit — 1 October 2026

The current enrollment/expiry full-suite run has reported a failed MCP matrix
assertion: two settings queries escaped the read-only transaction client.
The suite remains running; this is a failed gate, not a passing checkpoint.
Source inspection locates `cachedSettings()` in the context read capability.
When the ten-second settings cache expires, that accessor starts `settings()`
through the primary pool from inside the capability transaction. The two SQL
statements reported by the guard match the settings loader and legacy-key
expiry lookup. Reproduce with an explicitly invalidated settings cache before
choosing a correction; preserve the pool/network guard and cover expired-cache
behavior rather than accepting these reads as exceptions.

D1 is still incomplete. The shared document type and request schema accept only
heading levels 1–3, and Markdown parsing only recognizes those levels. Rich HTML
paste also clamps headings to 3. Extending the parser alone is insufficient:
update document schemas, outline and heading-link metadata, paste conversion,
web/native heading rendering, editor controls and HTML export together. The
export currently adds one to a block heading level to reserve h1 for the page
title; six-level support must never emit an invalid h7. Round-trip fixtures must
cover h1–h6, setext headings, closing hashes, anchors, paste, nested navigation
and rendered exports. Existing tests and build success do not establish this
parity. Keep source/preview synchronization, reference links, frontmatter,
math, code coloring, security and ten-family Mermaid verification in scope.

The completed main validation passed all 1,808 tests with no failures or skips;
workspace typechecks and build also passed. The worktree validation completed
with 1,881 of 1,882 tests passing, with the settings transaction guard as its
only failure. A deterministic new regression invalidates settings inside a
read-only transaction and waits for any asynchronous refresh. Against the old
accessor it fails with two pool reads; against the corrected accessor all 22
MCP matrix tests pass. The fix prevents background refresh within the read-only
transaction context; ordinary callers still refresh stale settings. MCP's
request boundary already awaits settings before capability execution.

The correction is committed as worktree dead110 and integrated into local main
as fc3bc53. New exact-main and worktree typecheck/build/full-suite pipelines are
running in separate disposable databases. Neither pending pipeline is recorded
as passed, and fc3bc53 has not been pushed as a production checkpoint yet.
Executor enrollment and its expiry corrections remain unmerged. The full ADR,
including model routes and UI, plugin separation and Docs parity, remains open.

### M1 next integration contract: executor leases and catalog publication

Enrollment is committed on the implementation branch as d65849f, with exactly
12 files. It is not yet integrated into main. This metadata proof does not
start inference, establish plan entitlement or expose models.

The next service must persist a lease per enrollment identity, recording the
current enrollment epoch, exact Orbyn session, monotonically increasing lease
epoch and server expiry. A renewed device key immediately invalidates leases
bound to its old enrollment epoch. Deleted/recreated enrollment identities
must receive new executor IDs; old signatures cannot become valid after an
ABA cycle. Session expiry and account restriction checks run after acquiring
locks, using current wall-clock time. Connection, enrollment and lease locks
must use a single order shared with disconnect/re-enrollment paths.

Lease claims require a server-generated, short-lived, one-use proof bound to
owner, exact session, connection, enrollment ID/epoch and expected lease epoch.
Never accept a renderer-supplied signing message. Concurrent claims have one
winner; late claims reject rather than overwrite a newer lease. Renewal and
catalog publication verify the enrolled Ed25519 key and bind the current lease
epoch. Publication accepts only the shared strict catalog schema and verifies
its canonical digest; sequences increase atomically. Reject wrong binding,
wrong key, stale epoch, reordered/tampered payload, expired lease, old sequence
and replay without changing the last accepted snapshot. Bound pending proofs,
host counts, request sizes and catalog size; sweep expired proof rows.

First-party GET /models uses a live Orbyn session and an explicit user-owned
connection/executor selection. Plugin/OAuth connector principals and API keys
are rejected. Responses are credential-free and no-store, distinguish ready,
offline and stale, preserve model ordering and include server-derived snapshot
age and account-bound default. Missing selection is explicit; never choose an
arbitrary host or account. The default mutation requires matching preference
version and a live catalog containing the selected slug; serialize its checks
with publication/revocation and retain unavailable defaults for display.
Disconnect removes/inactivates enrollment, leases and snapshots; stale
connection proof cannot revive them. Inference still checks entitlement at the
credential-owning runtime immediately before each provider request.

The runtime needs an actual encrypted device signing-key store, lease client,
heartbeat/reconnect controller and catalog publisher. Wire these into the
packaged Electron main process and guarded metadata-only IPC, then connect
settings and composer to one account/default state. Web/mobile consume the
same server state and show an unavailable executor explicitly. Existing
private fixture helpers are not evidence of this packaged integration. Cover
real app interactions and an authorized eligible provider account before
claiming the end-to-end model experience complete.

M1 lease/catalog implementation continues in managed worktree `/Users/anhdang/.codex/worktrees/devday-model-catalog/Orbyn`, branch `codex/devday-model-catalog`, based on main 6bdc26e. This checkout has independent workspace package outputs; it does not alter either running validation checkout. Shared external dependencies are linked without reinstalling or modifying their contents. The earlier implementation worktree retains private runtime helpers and Mermaid work. No host/provider feature is claimed complete by this split.

### Enrollment release and isolated lease service — 1 October 2026

Exact main at 6bdc26e passed all 1,823 tests with no failures/skips, workspace
typechecks and build. Enrollment 8478f19 and exact-upload fixture correction
6bdc26e were pushed to main. The earlier worktree rerun completed 1,882/1,883
passing; its sole failure was assistant-job retention. Diagnostics reported a
completed sweep, no errors, zero assistant rows deleted and two eligible failed
jobs remaining. This defect is still open; a green exact-main run does not
establish its root cause or a retention fix.

The isolated M1 worktree now contains migration 202, shared lease/proof/publication
contracts and a private backend service for one-use lease claims, two-minute
signed heartbeat leases and signed bounded catalog publications. Lease epochs
and publication sequences fence replay; exact sessions, connection ownership,
current enrollment keys/epochs, restrictions and wall-clock expiry are checked.
Re-enrollment invalidates old leases/proofs; disconnect cascades lease/catalog
metadata. A sweeper rule removes expired lease challenges. These additions are
uncommitted and are not exposed through HTTP or wired into a packaged runtime.

Seven database integration tests and three contract tests pass in the separate
orbyn_model_catalog_20261001_test database. A lock-wait regression failed on the
initial service: a proof expiring while blocked on its existing lease row was
accepted. The corrected service rechecks proof expiry after that lock wait;
the full ten-test focused run now passes. Catalog insertion also checks lease
expiry in its INSERT SELECT statement. Logs are /tmp/orbyn-lease-proof-expiry-before.log
and /tmp/orbyn-model-lease-service-tests-after.log. This proves these controlled
service cases, not provider entitlement, public /models, default mutation,
UI or real executor availability. Those requirements remain open.

M1 now has first-party GET /models and PUT /models/default routes, exact-session
executor enrollment/lease/publication routes, shared strict public schemas and
typed client methods. API routes are registered in the planner API service;
executor routes remain in the AI service. Defaults use one shared database
writer, with an availability check under the publication/disconnect connection
lock. Reads lock device sessions before their cascading children to match
sign-out ordering. Missing, offline and stale catalogs are explicit; removed
defaults are retained. Default responses and catalog reads are validated by the
client against the requested binding/selection, and presence reads bypass the
client cache. These additions remain uncommitted/unmerged pending full checks.

The catalog route shield verifies 401, 403, 400, 422, 429, no-store, rejection of
unexpected credentials and duplicate Idempotency-Key CAS rejection. Focused
catalog tests cover cross-device reads, cross-account denial, model removal,
stale/offline rejection, clearing and concurrent version updates. Shared
contracts/client tests also pass. An initial route-test attempt imported auth
before the asynchronous test-database setup and failed connecting to the default
local database; imports were made dynamic after setup, and the real disposable
route tests pass. This fixture correction does not constitute a production
connection fix. The packaged executor controller, account/default UI, native
interaction and authorized provider flow remain open.

### Retention concurrency correction and catalog inventory — 1 October 2026

The retention failure is now reproduced through the actual runSweep function,
not only inferred from timing. A transaction updates an eligible fixture row
while sweep deletion waits for its row lock. The old ctid-based DELETE reports
zero removed after the update commits; the row remains eligible. A direct
stable-ID comparison deletes it. The production regression uses a composite
primary key and also updates a selected row to ineligible, verifying that it
is retained and that unrelated rows sharing one key component survive.

The correction resolves each retention table's primary key from PostgreSQL,
deletes by that identity and rechecks the retention condition on the current
row. Missing tables remain skipped for older schemas; tables without primary
keys are reported as errors with data preserved. All 19 focused sweep/worker
checks and backend typechecking pass. The correction is local main 4e1c6bc
(worktree equivalents 9d14c7e and 151fc05); main validation is running before
push. Main's intervening CRDT checkpoints 3cbde3a and 4637bdf are preserved.

The catalog full run passed 1,839/1,840 tests, typechecks and build. Its only
failure was the capability route inventory: eight new first-party routes were
not classified. They are now explicitly excluded from connected-agent access
as credential operations, rather than marked pending or exposed as tools.
All 18 focused catalog/inventory checks pass after that correction. The catalog
worktree also contains the retention fix, and requires a fresh full validation.
No failed full run is recorded as a clean checkpoint.

The disposable database was removed externally between test runs: a subsequent
sweeper run failed connecting before any assertion. Only our named disposable
databases were recreated with the server-side test marker; existing orbyn_test
and orbyn_runs_test were preserved. This is distinct from the reproduced ctid
race and does not establish a database or Docker product fix.

### Reviewed action rules and producing-source checks — 2 October 2026

Scoped candidate `codex/assistant-rule-review` is based on current main `9e1a2c8`.
Three source checkpoints (`4ec8644`, `35d186f`, `185a9d7`) applied cleanly; no
model/settings/profile/reflection UI changes are included. This is a candidate,
not a completed A4 implementation or deployed change.

Typed action rules are revision guarded and loaded under the source grant lock.
Deny dominates ask/allow; existing permissions and unattended hard stops remain
upper bounds. Question/approval waiting identities remain required, and rule edits
invalidate prior approval cards and proposal reviews. Actual Review Inbox typed
changes and whole plans retain server-selected runtime/rule/connection authority.
The producing durable job and current job/chat dependencies are rechecked at
creation and approval. Unknown source coverage, missing jobs, restricted projects,
foreign owners and mismatched runtimes hold the suggestion without applying it.
Whole-plan action arguments cannot substitute an assistant connection or producer.

Source focused checks passed **43/43**, zero failure/skip/cancellation, and fresh
marked `orbyn_proposal_job_test` migrated from empty then passed **14/14** dedicated
checks. Source backend types and packages passed. Initial fixture-column errors
were corrected and the cohort rerun. These results do not qualify the combined
main candidate: its full tests, workspace types, production build and formatting
must pass before promotion. First-party rule editing routes/UI remain disabled.

Remaining scope includes typed agent ownership, permissions/rule editing on both
clients, reviewed source revision snapshots, notification restrictions, read and
external effects, durable budgets/reservations, receiving handoff authorization
and dispatch/recovery, actual model/executor and plugin acceptance, full Docs
parity, and whole-app web/mobile/native UI verification. The full ADR remains
active; voice/computer-use product features and speculative Decisions stay excluded.

The initial combined candidate **fc82170** completed its full local run:
**2,130 passed / 11 failed**, zero skips/cancellations, 555,674 ms. Types, build
and formatting passed; CI **36993742889** finished failed. All eleven local
failures were legacy Overnight test fixtures constructing new built-in proposals
without the required guard/job evidence. No qualification run was restarted or
candidate changed before local and CI terminal results.

Source **d8bf8d5** corrects those fixtures to create an owned chat and actual
Overnight job before filing the proposal, with server-equivalent lane/rule/action
checks and the producing identity. The protection stays intact. Source dedicated
checks passed **27/27**; scoped candidate cherry-pick **a610406** applied cleanly
and passed **55/55** combined Overnight/review/rules/whole-plan/agent-write checks,
zero failure/skip/cancellation. The corrected combined tree must finish a fresh
full local run and CI before merge. No release/deployment/cleanup occurred.

### Qualified rule/review checkpoint merged — 2 October 2026

PR **#143** merged to main as **9c344b8**. Exact frozen candidate **e58ed27**
passed **2,141/2,141** full local tests, zero failures/skips/cancellations,
549,434 ms, on a fresh marked database. Workspace types, production build and
full formatting passed. CI **36995158096** finished success for all four jobs.
Unchanged base **9e1a2c8**, fetched GitHub merge parents and resulting main were
verified; candidate and merge trees match
**a8f0bd5a54f60886e4b261378576f465b6daae70**. User mobile/app.json and unrelated
local files remain preserved. This is a merged backend checkpoint, not deployment.

Main now has typed rule persistence/current-write checks, stale approval fencing,
server-held Review runtime/connection/rule evidence, and producing-job/source
checks before proposal creation and approval. Public rule editor routes/UI remain
disabled. This is not complete agent ownership/rules UX, notifications/read/external
policy, budget reservations or collaboration. Source privacy follow-ups **977288c**,
**866e4c0**, **411935e** still require extraction and full current-main qualification.
The entire retained ADR, web/mobile parity, actual UI/model/plugin/Docs gates and
end-of-goal cleanup remain active. No release/tag/deployment occurred.

### Source privacy and parent deletion candidate — 2 October 2026

`codex/assistant-source-privacy` is a scoped candidate based on main **dabb770**,
after qualified PR #143. Source changes **977288c**, **866e4c0**, **411935e**
applied without conflicts as **a3f6e33**, **90bd749**, **52b8d01**. No unmerged
model/settings/profile/reflection UI is included; no public rule editor is enabled.

Migration 213 keeps deleted-target history permissions while preventing recreated
metadata for deleted owners/teams. Notification enqueue, inbox and delivery check
job-only dependencies as well as conversations. Review item/inbox/badge/outcome
and its saved in-app notification recheck separately stored producing-job sources.
Missing source/producer or owner/runtime mismatch hides generated content; source
cohorts preserve existing non-job behavior and actual worker cancellation sends
nothing after source exclusion. Source tests/types passed as recorded in handoff;
these do not yet qualify the combined main candidate.

Freeze this candidate and run fresh full local tests, workspace types, production
build, full formatting and exact-head CI before promotion. Full A4 policy/agent UX,
source revision snapshots, budgets and receiving collaboration, model/executor,
plugin, complete Docs and whole-app web/mobile/native UI gates remain required.
No deployment/release/cleanup occurred. Voice/computer-use product features and
speculative Decisions remain excluded.

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

### Current assistant authority candidate gate — 2 October 2026

Source **118f421** was extracted cleanly onto main **456e01a** as **d2484b5**.
Built-in principal construction now respects stored access, Personal/team scope
and outside-content restrictions. Every capability and generic read context
reloads its active owned grant; disabled/paused/expired grants stop before the
callback. Current and caller rights intersect, including team membership/role/
agent policy, toolsets, trust and approval exceptions. Reads consult the primary;
write checks hold the grant against changes. Typed rule revision fencing remains.

Four valid baseline regressions failed before correction. Source extended suite
passed **61/61**, backend types and scoped formatting/diff passed. These source
results do not qualify the combined main candidate. Freeze current candidate for
fresh full local tests, all workspace types/build/full format and current-head CI
before promotion. No public rule editor or other unmerged feature is enabled.

Receiving handoff identity/rules/connection/budget authorization, original
provider-read snapshots and complete replay/outcome source-authorization proof
remain open. Typed per-action read/external/notification policy and owner/editor
UI are unfinished. Full real model/provider/embedding/plugin, Docs/Mermaid and
whole-app web/desktop/mobile acceptance remains required. Saved web preview
denial still blocks required visual QA; permission request is pending. Preserve
character work and mobile parity. No deployment, cleanup or goal completion.

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

### Cached assistant result authority and targets — reviewed candidate, 2 October 2026

Extracted only backend replay and scoped visibility code/tests from source
c237cfb/afd8160 onto main7c08aa6, preserving current character and application
work. Cached assistant results bind effective owner/grant/lane/job/scope/team
role/policy/toolset/flags/trust/rule evidence. Changed or legacy-unbound authority
holds the answer without repeating the mutation. Current producing work/container
and recorded dependencies use effective caller scope. Typed targets and structured
resource links recheck current visibility across the32 produced receipt families;
synthetic receipts retain their intended Personal/team behavior. Names and set
ordering do not change the digest. Restored access permits the original retry.

Seven initial authority/producing-source regressions and two later target/scope
regressions failed before correction. Source focused cohort passed98/98, backend
types and scoped formatting/diff passed. Combined-CASE diagnostic was stopped for
measured planning cost; bounded per-family queries passed persistent positive/
foreign-owner fixtures and synthetic/team/link cases. Candidate is frozen for
fresh full local suite, all workspace types/build/full format and current-head CI.
Source results alone do not qualify this candidate for promotion.

Original provider-read versions, nested dependency closure, concurrent source
fences and other persisted replay paths remain open. This does not complete
read/effect/notice policy, ownership/editor, receiving handoffs/reservations,
real account-specific model defaults/execution, provider/embedding choices,
plugin host acceptance, Docs/Mermaid or whole-app web/desktop/mobile UI gates.
Preserve Orbyn palette/characters; no public rule editor, deployment or cleanup.
The complete M1/D1/U1 and C1–C6 ADR acceptance remains active.
