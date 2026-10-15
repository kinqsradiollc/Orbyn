> Historical accepted U1 delivery. The owner requested a new full redesign on
> 12 October 2026: [ADR 003](../adr/003-product-ui-ux-redesign.md) and
> [current redesign ledger](ui-ux-redesign.md). This receipt does not qualify that new scope.

# U1 implementation and acceptance

Started 12 October 2026 at main `9d786412`. Builder checkout:
`/Users/anhdang/.codex/worktrees/c6-next/Orbyn`. C6 is closed under its accepted
scope; historical Visual report changes are preserved and excluded from U1.

## Delivery scope

Apply the approved [surface map](u1-acceptance-map.md), UI design and content
skills across shared web/desktop and Expo web. Preserve existing authorized
native, hosted OAuth, live channel and C6 host exclusions. No security scans.
Complete the source batch before a bounded final Visual Check, then Test →
Review; maximum three review rounds for this new U1 checkpoint.

## Source audit and fix batch

| Area              | Finding / intended change                                                                                                                                                                                                | Evidence                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Dialogs           | Docs/custom AI and security use browser prompts; mobile native Alert and confirm no-op/browser prompts remain on web. Replace with app-owned dialogs without changing native behavior.                                   | Source-confirmed; rendered verification pending                 |
| Navigation/panels | Narrow peek becomes a modal with focus containment, dismissal/return and load retry. Project cards stack at actual pane width. Assistant already measures its remaining width and permits one secondary panel.           | Source + new dialog runtime coverage; pixel review pending      |
| Compact content   | Sheet headers use flow layout instead of a title squeezed between 124px absolute gutters; reduce header padding. Developer copy distinguishes optional Workspace AI. Verification-load failure stays unknown with retry. | Source audit; no user content or essential consent removed      |
| Surface parity    | Named families reconciled below. Shared dialogs replace remaining native-browser prompts/no-op web alerts.                                                                                                               | Source equivalence bounded to U1 diff; prior deferrals retained |

## Surface reconciliation

Baseline is `9d786412`; unchanged means unchanged by this U1 batch, not universally
visually qualified. Earlier reports retain their original candidates and limits.

| Family / current owners                                                            | U1 disposition and retained evidence                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation/Home: `app/App`, `components/Sidebar`, `overview/Home`, `peek/SidePeek` | Narrow peek focus, backdrop, retry and companion-pane resize changed; bounded preview required. Existing Home/navigation layout reports retained only for unchanged Home/Sidebar implementation.                                                        |
| Tasks/Lists/Views: `task/TaskDetail`, `views`, mobile task/list/editor screens     | Existing task cancellation modal remains; other confirmations route through shared web host. `task-options-ui` and `views-workspace-layout` regressions requested. No data model/draft changes.                                                         |
| Calendar/Agenda/planning/Focus                                                     | Existing toolbar wrap, narrow layouts and timer display retained. Mobile confirmation imports and Sheet header change only; representative Sheet preview covers the shared header, not native scheduling.                                               |
| Assistant/inbox/review: `assistant/AssistantView`, mobile `AssistantScreen`        | Actual-width ResizeObserver threshold 1280 and mutually exclusive panel state retained. Mobile alert routing changed. Retain assistant context/layout and authority tests; no new run semantics.                                                        |
| Background/Overnight/identity                                                      | C3 authority/activity acceptance retained; implementation unchanged by U1. No setup moved back into interactive chat.                                                                                                                                   |
| Settings/connections                                                               | Prompted password/passkey label now app-owned; 2FA load error has retry and no false Off status. Mobile Sheets/alert host changed. Final preview includes nested dialog/category picker. C1/C2 usage/provider evidence retains hosted OAuth exclusions. |
| Docs/Projects/Memory/notes/Study                                                   | Custom AI prompt and History restore use owned dialogs. Project cards use actual-width container query. Structured draft, revision, Markdown/Mermaid/export implementation unchanged; C4 deferred interactions remain explicit.                         |
| Teams/replies/publication                                                          | C5 reply/version/permission behavior unchanged; mobile alerts use host. Reuse C5 functional evidence, without widening its live-channel claims.                                                                                                         |
| Booking/public pages                                                               | Public read-only behavior unchanged. Authenticated mobile booking confirmations route through host; no recipient or booking-authority change.                                                                                                           |
| Admin/auth/legal/status                                                            | Provider management confirmations now work in Expo web; tests retain affirmative gating. Auth/legal/status content unchanged. Recovery-code warning remains visible. Developer overview now accurately names separately authorized Workspace AI.        |
| MCP/plugin/files                                                                   | U1 does not change host resources or authority. C6 bounded production acceptance retained; no renewed live calls/upload/visual gate.                                                                                                                    |

The final visual batch is limited to material changed risks plus the prior
assistant panel complaint; it is not an every-screen sweep. Functional
regressions cover the named shared primitives and affected call sites.

## Qualification

Source candidate frozen at `3b488b51` (parent `4050e321`) (baseline `9d786412`). Builder development
checks: 38/38 focused dialog/provider/task/assistant/settings/view checks and
web/mobile typechecks passed, terminal exit 0. These are diagnostics, not formal
acceptance. Tester owns formal execution and the disposable preview fixture;
Visual Check has one finite changed-risk assignment at 320×740, wide/intermediate
web and representative themes. Reports: `u1-tester-r1.md` and `u1-visual-r1.md`.
Review round 1/3 is assigned for the full source batch and formal Tester evidence;
Visual Check’s final report is pending and must be assessed before approval. No rendered pass is inferred from source or
previous checkpoint test counts. Production deployment remains owner-managed.

Before the rendered pass, `3b488b51` names the Expo dialog on its modal element
and keys it by request identity, preventing focus reuse between queued dialogs.
Formal Tester receipt: 45/45 focused checks, workspace typechecks/package builds
and desktop web production build passed on `3b488b51`. The port-8081 historical
signup failure is outside the current candidate-backed preview pair; it remains
an unverified observation. Reviewer owns `u1-review-r1.md`; no approval yet.

## Round 1 correction batch

`ad1a5dde` supersedes `3b488b51`. U1-R1 now keeps passkey naming Cancel (`null`)
distinct from an accepted empty name; no registration or success message follows
cancellation. U1-R2 shares higher-overlay ownership between peek focus and keys;
closing a higher dialog restores focus to the surviving peek, including after
wide-to-narrow resize. Mounted tests cover both scenarios; Builder 6/6 passes.
Tester retest on `ad1a5dde6987db74c2cbf994d8d9d5fd39dae8cd` passed 6/6
dialog regressions, desktop typecheck and production web build (terminal exit 0).
The unchanged mobile and other focused checks retain their original receipts.
Corrected-candidate authenticated visual evidence and final review acceptance
remain pending. Same round 1/3; source is not merged or pushed to main.

## Bounded visual correction batch

Visual inspected web at 320×740, 900×740 and 1280×900 CSS pixels and Expo web
at 320×740, including long titles and AlertHost deletion cancellation. It found
two further focus/keyboard defects: TaskDetail dismissed underneath Search, and
SidePeek's removed palette opener could leave focus on the body.

`c2cefbe77ab525cfa30db29853ce289a3622a10e` fixes both with shared modal ownership
and a stable Search focus fallback. Actual TaskDetail keyboard-effect coverage
and mounted removed-opener coverage were added. Tester retest, only two affected
visual rechecks and Reviewer closure are requested within round 1/3. Retained
visual limits are listed in `u1-visual-r1.md`; no native or vendor checks were added.

## Acceptance

Final source `e0997ae434cb8cee9bb783ce524a8519aede34a7` also resolves U1-R3:
retained panels choose one keyboard owner by positioned layer z-index and DOM
paint order. The regression executes both actual keyboard effects together and
verifies ownership returns after the top panel closes.

Reviewer approved U1 and main integration in round **1/3**; all three findings
are closed. Tester passed 7/7 dialog regressions, desktop typecheck and web build
on this exact source, retaining applicable original functional/type receipts.
Visual confirmed TaskDetail/Search dismissal order and SidePeek return to Search
at 900×740. The preceding bounded web/Expo checks remain applicable to unchanged
layout and mobile source. Reports retain unverified cases and earlier exclusions;
none are represented as passes. Source was fast-forwarded and pushed to main at
`e0997ae434cb8cee9bb783ce524a8519aede34a7`, confirmed by the remote main ref.
The evidence/tracker documentation commit follows without runtime changes.
Deployment remains user-owned and broader goal completion is separate.
