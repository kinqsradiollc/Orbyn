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

Candidate not frozen. Test/Review not started. Visual Check will receive one
stable-candidate batch covering concrete layout/dialog/content risks, web and
Expo web, narrow 320×740 and wide counterparts, both themes where relevant.
No rendered pass is inferred from source or previous checkpoint test counts.
