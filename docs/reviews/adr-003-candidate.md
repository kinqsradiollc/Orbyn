# ADR 003 complete implementation candidate

Scope: [ADR 003](../adr/003-product-ui-ux-redesign.md), including all owner refinements.
Checkout: `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`.
Branch: `codex/c6-file-viewer`. Baseline: `c7b3bdb7`.
Candidate: `7dfd1b9f` (initial full implementation `f7899149`; test correction `7039a77b`).
Phase: Tester qualification and correction retests. Review counter: 0/3.

This candidate submits the full redesign for qualification. It is not accepted,
merged, deployed or proof that every requested interaction works. Earlier source
inspection rows are historical; qualification covers the integrated candidate,
including the latest departure, import and document mutation corrections.

## Requirements and acceptance map

| Requirement | Implementation / evidence to inspect | Required qualification |
| --- | --- | --- |
| Neutral light/dark palette, restrained blue, compact readable content, reduced ornamental motion | Shared presentation, global CSS, mobile theme/motion; surface inventory | Types/builds and final representative family rendering; preserve semantic/user colors |
| Compact navigation, aligned brand, one collapse action, resize and remembered width | Sidebar, SidebarResizer, App shell, workspace layout | Pointer/keyboard resize, bounds/cancel/reload, narrow fallback |
| Useful tabs and two independent panes | App, tabs store/strip, scoped page commands | Separate drafts/scroll/selection; focused shortcuts/search; hidden-pane inactivity; close/cancel and narrow switching |
| Chat/Work in one workspace, centered initial composer, bounded growth, project chat history | Assistant workspace/composer, ProjectChats, chat store | New and active conversations, same initial height then internal scroll, project selection/history/pins and unchanged sweep exemptions |
| Background/Overnight inside chat, no duplicate sidebar destinations | Navigation/assistant lane source | Open existing work and controls; preserve execution/approval identities |
| Planner surfaces and every screen family redesigned | Surface inventory and delivery ledger | Representative Tasks, Calendar, Focus, Projects, Views, Study, Teams, Settings, Admin, auth/public flow; failures and long values where changed |
| Personal Activity reflects actual planner history | Migration 267, activity-summary, focus/activity, Activity web/mobile | Marked test DB migration and API: timezone/day boundaries, unavailable history vs zero, visibility/privacy, completion/focus counting, no invented history |
| Three document modes and assistant support | Legacy/structured editors, DocSourcePreview/Ask, doc-latex, private latex service | Normal note, Markdown/equations, exact standalone TeX/PDF; hide source and constrained fallback; reviewable assistant changes; comments fixed height; drafts/history/conflict/recovery |
| Owned overlays and retained drafts across destinations | Page commands, root modal owners, editor guards, SettingsEditor | Keyboard/search/sidebar/tab/deep-link routes; failed save/cancel retains work; pending close and account teardown reject late responses |
| Compact connection collections and safe transfers | Settings, connection detail flows, PortabilitySettings/imports | Search/bounded rows/full values/permission states; exact-input preview, returned error retention, same-input retry receipt; no duplicate commit after response loss |
| Views/project/team interaction continuity | ViewDraftStore, Views sheets/layouts, project fields, team planning/budgets | Definition/row save vs queue vs confirmed refresh; cell modal lock; pending team/week locks, read Retry, meeting query identity |
| Clear decisions, skills and deployment documentation | ADR index/archive, UI/content skills, env example, compose/private compiler docs | Changed-document links, env coverage, private compiler service limits/network; preserve secrets |

## Tester handoff

Tester owns formal execution and the report `docs/reviews/adr-003-tester.md`.
Confirm exact commit and a clean product source tree before checking. Do not edit
product/test source. Report defects with a reproduction and expected behavior.
Use the existing test suites that exercise these contracts; choose meaningful
runtime checks for new Activity/compiler/import receipt behavior. Build shared
packages before tests importing generated exports. Use the guarded disposable
PostgreSQL test database from setup, including the `_test` name and database test
marker. Keep failures and setup limitations explicit. Do not run Codex Security.

Suggested checks: complete workspace types/build; focused redesign/layout/tabs,
source/editor/session/store and import regression suites; backend integration
coverage for changed Activity, compiler and import contracts. Inspect actual
assertions before choosing suites. Add runtime acceptance where a unit test only
checks source or mocked calls. No native builds or redundant full-suite reruns.

Existing QA backend is on 8008 and web preview on 5174, both from this checkout.
Protected QA env: `/var/folders/j4/_l7jsdmj24j2vdmvyd1f9qk80000gn/T/orbyn-u1-qa-8wlwnjlc/qa-server.env`.
Read it locally only; never include credentials in output or reports. Do not use
that runtime DB for tests unless its guard is independently verified. The private
compiler QA container is `orbyn-u1-latex-qa`; inspect its actual state before use.
Coordinate fixture ownership and record authoritative source/runtime provenance.

## Reviewer and visual handoff

Reviewer starts after the Tester report. Review the complete diff and test
quality/results, then give Builder prioritized fixes and verification guidance.
Reviewer does not edit code or run tests. Maximum three full rounds; verified
closure may finish the current round.

After code/test findings settle, send one bounded final batch to Orbyn Visual
Check for shared web and Expo web. Cover 320px, medium and wide sizes across the
representative families above; include both themes, an open selector, modal,
paired panes, long composer and three document modes. Assign cases across sizes
rather than a Cartesian sweep. Inspect density, reachable actions, focus and
actual task completion. Record viewport/theme/source and screenshots. Fix only
reproduced findings and request affected rechecks. Native builds are excluded.

Builder integrates accepted work, records main/push separately, and updates the
ADR/index and tracker only when the evidence proves the agreed requirements.
Production deployment remains user-owned.
