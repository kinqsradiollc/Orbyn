# ADR 003 — final bounded visual batch

**Status: partial; blocked by one reproduced Docs editor crash.** Visual execution began on the frozen product source `3f7cd319d7a23842d5c78f14159daf17fdaf5667`. The current checkout later advanced to `77b679bc503f18fcc15c053fa7cbb875bb8381bc`; the only product-range differences from `3f7cd319` are review-document updates. Shared web and API processes point to the assigned worktree. No source or test files were changed by Visual Check.

## Runtime and capture provenance

- Shared web process: PID 65174, cwd `/Users/anhdang/.codex/worktrees/c6-next/Orbyn/desktop`, port 5174. API: PID 21290, cwd `/Users/anhdang/.codex/worktrees/c6-next/Orbyn/backend`, port 8008. Expo web: PID 75113, cwd `/Users/anhdang/.codex/worktrees/c6-next/Orbyn/mobile`, port 8083.
- At setup, `/health`, `/app`, and the Expo root each returned HTTP 200 through local requests. The browser used the existing handed-off QA tab at `http://localhost:5174/app`; the authenticated display name was **U1 Disposable QA**. The page's Vite module URLs also identify the assigned worktree.
- The initial Home view displayed “Rate limit exceeded, retry in 59 seconds,” and browser logs showed 429 responses for planner reads. After waiting and navigating to Docs, its document list loaded successfully. This was recorded as an observed transient Home/API state, not treated as the Docs crash or as a confirmed continuing backend failure.
- Wide CSS viewport was set and measured at **1440×900**, DPR 0.8 (browser override 1152×720). The original Light appearance was changed to Dark for the wide check and restored to Light in a clean QA tab. The temporary tab was closed. The crashed Docs tab was left open without reload so its pending editor state was not discarded.
- Browser screenshots were captured and inspected inline through the supported screenshot API. That API exposed no local save path. **No local screenshot files or paths are available**; no shell screenshot or alternate-browser route was used.

## Findings

| Surface | View and action | Observed result | Evidence |
| --- | --- | --- | --- |
| Docs library | Web, 1440×900, dark; opened the existing empty synthetic page `U1 QA fixture page 2026-10-12` | Library and editor fit the pane. The page showed the single Note/Markdown/LaTeX mode group, Editing/Suggesting/Viewing controls, comments and page actions. | Inline browser screenshot captured; no local path. |
| LaTeX source and Note | Web, 1440×900, dark; switched to Viewing, then LaTeX | Source opened inline beside the original Note. One source visibility control (“Hide source”) was visible; there was no duplicate Source/Split/Preview group or second PDF iframe. The Note remained mounted. The empty fixture showed `\null` in the source, “Live preview” status and a blank Note with 0 words, but no visible PDF page. Because the fixture had no standalone LaTeX block or document content, actual compilation, live PDF appearance, persistence, zoom and page-state retention remain unverified; this is not recorded as a rendering defect. | Inline screenshot captured; no local path. |
| Note block menu | Web, 1440×900, dark; returned to Note, activated Add a block, then pressed `/` in the empty block | The page rendered blank. Browser console reported: `Error: Element type is invalid: expected a string (for built-in components) or a class/function (for composite components) but got: undefined. You likely forgot to export your component from the file it's defined in, or you might have mixed up default and named imports. Check the render method of SlashMenu.` React's error followed from the slash-menu render. This blocks further Docs editing checks. | Black/blank screenshot captured inline; no local path. Console entry timestamp `2026-10-15T09:10:41.803Z`, Vite React runtime. |
| Expo entry | Existing handed-off tab was at `http://localhost:8083/` and showed Chromium `ERR_CONNECTION_REFUSED`. Attempted the assigned `http://127.0.0.1:8083/` in that same tab. | The browser tool rejected navigation with `Blocked browser navigation by Browser Use URL policy` while the current document was the generated `data:text/html` connection-error page. This is an actual current tool restriction; no retry, alternate browser, or other port was attempted. Expo UI is unverified despite the local HTTP 200 check. | No application screenshot; the tab showed a browser connection error. |

## Remaining batch

The Docs crash is reproducible and should receive a focused fix/retest. The page was blank afterward; no page content was typed or knowingly saved. No reload or further action was taken on that tab.

The following prepared cases were **not run**: remaining four-parent Docs/Markdown/LaTeX interactions and toast, navigation/typography at narrow sizes, paired tabs, Chat/Work, Activity, Tasks/Agenda/Focus, Calendar, Projects/library, Views, Teams, Settings/connections/Admin, secondary families, auth/public/booking, and all Expo cases including R7's measured pane-width behavior. No broad pass or full redesign acceptance is claimed. Resume the finite plan in `adr-003-final-visual-plan.md` after the affected fix and an allowed Expo navigation path are available.

## Final execution continuation — product source `239ce769`

This is a final acceptance execution continuation, **not a pre-freeze design research handoff**. The parent dispatched the finite web batch against frozen product source `239ce76918258f33c28fda5d7e6d1cf31316591d`. Checkout HEAD was `7225f0d76ede645545ed48c210ecf9b19d7c0aa5`; `git diff --stat 239ce769 HEAD` contained only Tester/Reviewer report updates. During execution, Builder began the reproduced PDF correction; a subsequent HMR reload interrupted paired-pane persistence. At Builder's explicit request, all new UI interactions then stopped. Affected and interrupted cases require the next freeze; unaffected observations below remain valid.

### Session and viewport provenance

- This fresh worker's `127.0.0.1:5174` session was authenticated as **Anh Dang**. No application action or mutation was made in that account. The existing handed-off **`http://localhost:5174/app`** session was recovered as **U1 Disposable QA**, and every synthetic edit below used it. This was session selection, not a workaround for a blocked origin.
- Browser: supported Codex in-app browser CUA controls. CSS sizes were measured in page state: **1440×900**, **900×800**, and **320×740**, DPR approximately 0.8. The viewport capability needed overrides 1152×720, 720×640 and 256×592 respectively. Its override was reset at the end.
- Runtime listener PIDs remained web 65174, API 21290, Expo 75113, matching the assigned worktree provenance recorded above. No production, native app or host integration checks were performed.
- Screenshots were inspected inline through the supported API. No local save path was exposed, so there are no local screenshot files. No shell capture, browser switch or policy bypass was used. The current worker did not retry mobile after the parent reported a repeated policy rejection; **Expo remains blocked**.
- QA tab was marked for handoff. It remains in the synthetic task's Focus overlay. No timer was started and no task was completed. The temporary public booking tab was closed.

### Reproduced findings for the correction batch

| ID | Surface and exact action | Observed failure | Boundary / next check |
| --- | --- | --- | --- |
| V2 | Web legacy Docs, 1440×900 light. Entered a nonempty standalone document with `Visual acceptance`, ordinary prose, and `E=mc^2`; waited for Saved / Live preview. | Common Note contains one `LaTeX note` iframe with a blob URL, but its page is visibly blank white. AX reports `about:blank`; no PDF text, page or zoom controls are visible. No console warning/error was reported. Hide/show preserves the same iframe URL; repairing malformed source produces a new blob URL, still blank. | **Visible PDF acceptance failed.** Compiler state and a blob iframe are not evidence of a usable preview. Browser-plugin support versus renderer behavior was not conclusively isolated. Builder is replacing reliance on the built-in PDF plugin. |
| V3 | Web legacy Docs, same wide size. Changed valid source to an undefined TeX command. | Source adapter rows stretch far apart: Saved / Hide source, then Live preview / Retry / Ask, then textarea much farther down. “Live preview” remains beside compile failure; error and Retry also repeat in Note. | Compact control grouping and a single clear error state need correction. The source and last iframe remained present. |
| V4 | Web normal Note, 320×740 light, existing title `U1 QA fixture page 2026-10-12`. | Title wraps to a second line, but the lower part of that second line is visibly clipped before the following document heading. | Resize the title to its wrapped content; recheck narrow and long titles. |
| V5 | Agent notes, 900×800 dark. Opened from sidebar. | Identical `Agent notes` H1 appears twice: outer screen heading, then collection toolbar heading below Browse. Memory does not duplicate it. | Remove the redundant page heading while retaining collection navigation. |
| V6 | Public booking form, 320×740 dark, synthetic `/book/visual-acceptance`. | Form primary “Book this time” and card accent remain muted green, unlike the blue redesign controls. | Apply the agreed shared palette. Recipient, timezone and form fields fit; no booking was submitted. |
| V7 | Home, 900×800 dark. Activated Start focus from the lower Home “Up next” section. | Focus overlay opens at an inherited scrolled position: screenshot begins midway down the timer/buttons; task heading and Leave focus mode are above the viewport. AX still exposes them. | Check overlay initial scroll/focus ownership. No timer started. This was the last action before Builder's stop request, so no corrective interaction/retest occurred. |

### Completed and partial observations

| Prepared family | Actual actions / result | Qualification boundary |
| --- | --- | --- |
| Slash menu | Re-entered `/` in the old synthetic block; all entries including Heading 1–6 rendered without blank-screen failure at 1440×900. Escape returned to the editor. | **Previous V1 crash no longer reproduced** on frozen source. Mobile menu not checked. |
| Note / Markdown / LaTeX | All three direct format controls discoverable. LaTeX opened inline alongside common Note; one Hide source action and no Source/Split/Preview selector. Changed nonempty source, saw Unsaved → Saved and Live preview. Malformed source retained draft and last iframe with inline error / Retry; repaired source reached Saved. Markdown mixed heading, prose, display equation and marked TeX block rendered the normal heading/prose/equation. At 320px, source and Note switch without duplicating the document. | Legacy web only. Actual PDF failed V2; its zoom/page state cannot be qualified. Structured editor, second marked TeX block, assistant proposal accept/reject and failed-save departure remain unrun. |
| Toast | Copy link in normal Note displayed a compact `Link copied` row with Dismiss beside it; screenshot inspected. | **Owner toast defect passes wide representative case.** Narrow toast not separately checked. |
| Navigation / sidebar | Brand and single collapse control fit wide/medium; narrow drawer exposes normal destinations with no Background/Overnight sidebar duplicates. Keyboard Right changed width 200→210; drag changed it to260; Left to250; intentional reload restored250. | Drag cancellation/bounds not exhaustively exercised. Width persistence verified independently after the HMR interruption. |
| Paired tabs | Opened Booking alongside: two distinct working panes and tab strips, independent Booking subviews. At900px, First/Second selectors plus visible nav/search were present with Second selected. | HMR reloaded before a draft/pane ownership action; Second nav/search routing, query retention, cross-pane editor keys, failed-save guarding and narrow320 fallback remain **unverified**, not passed. |
| Chat / Work | At320px light, new composer centered. Work stays in assistant and exposes Choose project. Typed eight lines: input grows to roughly four visible lines, then scrolls internally. Cleared the unsent synthetic text. | No paid request sent. Active response, history rename/pin, project history, device metadata and lane control interactions unrun. |
| Activity | At900px light, account → Activity loaded totals0, daily grid, completion-history start date and Daily details. Details showed0 since history start and `—` for unavailable older completion days, with rows fitting the scrollable dialog. Close returned to workspace. | No nonzero grid fixture. AX focus after close was document root, not a verified opener return. |
| Tasks | Long synthetic task title fully wraps in detail drawer. Edit details opens focused form; Cancel returns focus to Edit details, closing drawer returns focus to task row. | No save-error fixture injected; no native alert seen. Focus entry found V7; completion feedback unrun. |
| Calendar | At900px dark, month/calendar-set/view controls fit. Selected16Oct, opened New item, opened Due picker with calendar and time list; Escape dismissed picker, Cancel closed form. | No event or block saved; no unrelated data discarded. Narrow day/block edit unrun. |
| Projects / library | At900px dark, project list/search and New project form fit. Cancel returns; existing project detail shows linked synthetic page, New chat and Chats. | No new project saved. Existing Docs search/list fit; failed-save departure and project chats unrun. |
| Views | Created disposable `Visual task view`. Opened Filters and sort; controls wrap at900px. Table's long title is fully visible. Double-clicked Estimate, entered45, Return; observed Updating results, disabled completion control, then45min and matching footer total. | Happy-path cell commit verified. Failed-refresh Retry and pending dismissal lock supplied by Tester only; not visually injected here. |
| Teams | Created disposable `Visual planning team`; member/permission sections, availability/week controls, meeting budget and workload rows loaded. Scrolled full page without overlap in observed900px dark layout. | One-person fixture only. No budget/week change, pending read/write failure, long roster or narrow team planning check. |
| Settings / Admin | Account settings categories/search, theme choice, Connections collection/search and folded sections fit at900px. Changed only local QA theme Light→Dark for distributed coverage. Admin Overview and AI provider-empty state fit; section picker opens and selects AI. | Long-list last-option picker and error Retry unrun. No permission, credential, provider or security changes. |
| Secondary families | At900px dark inspected Study, Lists, Memory, Agent notes, Notifications and Review. Empty states/actions readable without overlap in screenshots. Agent notes V5 recorded. Home also loaded hubs, goals/routines, agents and upcoming-task sections. | Only representative empty states, not every populated/recovery state. |
| Public / auth | Created disposable local booking page `Visual meeting`, slug`visual-acceptance`. At320px dark, public recipient U1 Disposable QA, timezone Australia/Melbourne, selected16Oct9:00–9:30 and displayed name/email/note form fit. | No booking submitted, avoiding mail effects. Confirmation, login/consent and auth recovery unrun. Public palette V6 recorded. |

### Synthetic fixture receipt and remaining work

- Existing page content now contains heading `Visual note`, one ordinary paragraph, `E=mc^2`, and marked standalone TeX source rendering `Orbyn restored preview.` Its original title is unchanged. The source was repaired after the malformed compilation case.
- Created saved view `Visual task view`, team `Visual planning team`, and local booking page `Visual meeting` / `visual-acceptance`. Existing synthetic task estimate changed to45min. These belong to the disposable QA account; no owner account data was edited, removed or transmitted.
- Preserve V1 history and this failed PDF evidence. Resume **affected Docs/title/menu** plus V5–V7 correction rechecks and the specifically unrun interaction states after the next complete freeze. Do not repeat unaffected completed observations as a fresh full sweep.
- All Expo/mobile cases, native checks, auth/consent, live-provider/host integrations and production remain unverified. This report is **partial acceptance with concrete defects**, not full ADR003 completion.

## Mobile access continuation — frozen product `6044fddf`

The following is **parent-reported runtime evidence**, not a child visual pass.
After the owner's permission change, the parent successfully navigated its supported
IAB to the exact assigned `http://127.0.0.1:8083/`. The previous policy Block no
longer prevented that navigation. The parent initially observed cached C5 Home,
then API failures. The private QA server CORS configuration included
`localhost:8083` but omitted the exact `127.0.0.1` origin. Builder added
`http://127.0.0.1:8083` and `http://127.0.0.1:5174` to that private QA environment
and restarted the same candidate API on8008, PID82858. Product source remains
`6044fddf`; no product code or environment template changed for this runtime fix.

After reload, mobile correctly showed authentication because its cached token had
expired. **No authenticated mobile acceptance is claimed.** The child attempted
the same IAB binding and then the parent's exact tab2/browser4 binding; both
reported that the browser was unavailable in the child's tool session. This is
session isolation, not evidence of a continuing site-policy Block. No alternate
browser, origin or port was used to work around a restriction.

The parent will operate its available IAB for the remaining finite cases. Source
and UI execution remain on hold until Tester hands the fixture back. Earlier
failures, completed observations and unverified cases above remain preserved.
