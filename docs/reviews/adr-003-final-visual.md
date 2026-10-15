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

## Parent-operated mobile continuation — e942a1a0

Child session isolation prevented access to the parent's IAB. Builder therefore
operated the same supported IAB directly after the final source/types/build
checks, using a fresh guarded disposable `UI Preview` account. Normal visible
sign-in succeeded; skipped optional onboarding. Credentials remain only in
`/private/tmp/orbyn-ui-final-login.json` (0600). No personal account was changed.

At actual CSS390×844, light, legacy `Live preview` opened with direct
Note/Markdown/LaTeX controls. LaTeX showed source; Note displayed an actual PDF
page with visible heading, prose and equation, page/zoom controls and download.
The distinct second TeX block remained its own source. Selected page2 and Zoom
in, changed source, observed Unsaved→Saved, returned to Note: page2 remained.
Page text disclosure exposed the correct second-page text. Zoom was operated;
its exact numeric persistence was not measured and remains a targeted check.

Malformed saved TeX retained the last valid page2 and disclosure, showed
Preview unavailable in source, and one full error/Retry in Note. Repaired source
reached Saved/Live preview. Inline screenshots were inspected; no local screenshot
path is available. This is actual legacy Expo-web evidence, not native evidence.
Structured/mobile and remaining families remain unrun.

At CSS1000×800 and1400×900, an additional width defect was reproduced: the outer
Docs sheet kept the editor inside its shared600px column. Measuring the editor
correctly could therefore never enable a900px split. Library also grew beyond
its intended300px width. At1400, DOM measurements confirmed editor600px within
910px remaining pane. This is V8; Builder is correcting the containing width,
then will recheck actual wide split and narrow fallback. Source mode buttons
also used a solid selected action unlike the shared soft mode controls, and the
mobile PDF download inherited a raw browser link style. These are included in
that same scoped correction. New UI actions stopped during the HMR correction.

### V8 affected recheck and V9 discovery — parent IAB

At actual1400×900 after374258c5, light, the library measured300px and the legacy
editor showed source beside the original Note/PDF, with one visibility action.
Both panels and the comments below fit. Structured preview likewise showed its
mixed prose, canonical PDF and separate second TeX source in the wide split.
The source choices now match the soft selected mode styling. Download still
inherited the browser serif font, so Builder is changing it to fonts.regular.

In structured mobile, selected PDF page2 and Zoom in; measured canvas627.5px wide,
887.46px high. Changed the source and returned through Note, which saved the
valid structured draft. The preview immediately disappeared while editing, then
returned on page1: **V9**. The fixture used valid preexisting unanchored blocks.
Core's source helper assigned an ID on the first replacement, changing the
preview owner from positional fallback to that ID. Reviewer confirmed preserving
the existing optional ID is correct; only insertion should generate a new ID.
Builder is fixing that behavior and adding both-client anchored/unanchored
provider cases plus nested operation tests. This case is not a persistence pass.

Structured toolbar also repeated Saved above the adapter's Saved. The parent
retains status ownership; the source-only adapter status will be suppressed in
both structured clients. Actual remaining checks continue on the next freeze.

## Chrome final mobile continuation — product `43923346`

The parent handed back final execution after formal Tester qualification. At
start, HEAD`18d85f07` differed from product`43923346` only in review reports.
Chrome was explicitly authorized; the old IAB policy rejection had already been
lifted and navigation succeeded in the parent. This was a supported browser for
remaining execution, not an alternate route around an active Block.

### Account and capture boundaries

- Created only temporary own Chrome tabs at local `localhost:5174/app` and exact
  `127.0.0.1:8083/`. Production Chrome tabs were not opened or changed. The web
  origin was already signed in as Anh Dang; no account mutation or signout had
  occurred when this batch paused. The parent later authorized replacing those
  local sessions, but the web signout still awaited fixture handback.
- Expo initially showed an unknown cached account's updated-terms gate, then
  naturally returned to Create account after the stale authentication resolved.
  No terms were accepted for that account and no signout was performed. Chose
  Sign in and used the registered disposable **UI Preview** credentials through
  visible email/password fields. Read the protected JSON into tool memory without
  printing credentials; no token/storage injection. Authentication succeeded.
- Measured actual CSS **320×740, DPR1**. Screenshots were captured and inspected
  inline. No local screenshot paths were exposed. This is Expo web in Chrome,
  not native phone evidence. Theme changed Light→Dark only for the disposable
  local QA preview as part of the authorized matrix.

### Actual results

| Case | Observed interaction and outcome | Boundary |
| --- | --- | --- |
| Mobile auth and Home | Create-account/sign-in fields, material consent links and buttons fit320px. Normal registered sign-in reaches greeting `Hello, UI.`. Bottom navigation and quick-add fit. Hubs scroll horizontally. | No new account/terms acceptance or recovery reset performed. |
| Task / Focus | Created synthetic long-title task with45min estimate. Task list and detail wrap the complete title. Focus opens at top with close/title/timer/rhythm reachable. Mark done shows `Task completed`, task status Done and100%; returned without starting timer. | Actual completion feedback verified; no elapsed focus time fabricated. |
| Calendar | Day heading, date navigation and Day/Week/Month/Agenda controls fit. New task→Event exposes Start/date input. Closed dirty form: in-app Discard changes / Keep editing sheet appeared, then discarded only this unsaved synthetic event. | No native alert. No event saved or unrelated draft discarded. |
| Chat / Work | Work exposes Choose project in assistant; Chats and more shows New chat, Background and Overnight within the chat drawer, alongside Memory/Agent notes. No chats yet is explicit. | No paid request sent. Populated session rename/pin and active response remain for deterministic fixture. |
| Projects | Created `Workshop planning`; detail tabs/sections fit narrow screen. Project Chats opens named history with search and explicit empty state; closing returns focus to Chats. | Populated project history pending. |
| Activity | After synthetic completion, Activity reports1 task completion,0h0m focus,1 active day, highlighted grid day. Daily details show1 on current day,0 on other recorded days,`—` before history start. Full values wrap into stacked rows. | Actual nonzero grid and unavailable-versus-zero presentation verified. |
| Views | Created `Workshop tasks`, chose Table via searchable layout sheet, changed Status toAny. Horizontal scrolling reaches Estimate. Opened45min cell, entered50, Save→Updating results with disabled completion→50min and50min total. | Actual successful edit/refresh verified; deterministic failed-refresh Retry remains pending. |
| Teams | Created `Workshop group`. Narrow member identity wraps; week controls and horizontally scrollable capacity grid are reachable. Meeting budget/workload and permission consequences are present. | One-member fixture only; no role/privacy permission changes, week/budget save or injected recovery. |
| Settings / secondary | Categories and focused Planning destinations work; theme switched locally toDark. Memory empty collection and actions fit. Planning Working hours exposes inline time field and Save action at bottom. | Long populated collection picker pending fixture. Native-looking Expo time input is observed, not proof of a custom long-list picker. |
| Structured Markdown | Opened existing Structured preview; changed only ordinary Markdown to add display equation`a^2+b^2=c^2`, preserving both TeX blocks. Note mode saved and rendered prose/equation; second distinct TeX block remained source. | Canonical valid PDF unexpectedly showed compile error in this fresh session; see V11. Root's earlier V8/V9 PDF evidence remains separate. |

### Remaining findings

- **V10 — mobile Connections density:** Settings→Connections→Connected apps opens
  one long sheet containing expanded Agent channels, connected agents, Night
  shift, reminders, agent identity/profile, context, instructions/rules, API keys,
  webhooks, feeds, subscriptions and CalDAV. At320px the entire initial viewport
  is occupied by Slack/Teams status and only the start of connected agents. The
  accessibility tree also repeats `Agent identity` and `Standing rules` headings.
  This reproduces the owner's long-settings concern; grouped focused destinations
  or disclosures are needed. No credentials/permissions were changed.
- **V11 — structured valid preview error, investigation pending:** preexisting
  valid canonical source in Structured preview displays `Couldn’t compile LaTeX.
  Check the source or try again shortly.`; one Retry did not recover during this
  observation. The canonical source was unchanged. Parent reports compiler
  health200 and is inspecting the API/runtime. Do not classify this as malformed
  source or a confirmed renderer defect before that investigation.
- Browser console repeatedly logged `Unexpected text node: . A text node cannot
  be a child of a <View>.` while the mobile app remained usable, timestamps
  2026-10-15T10:37:37Z–10:38:20Z. Source bundle was the assigned Expo8083 origin.

### Fixture handback / hold

At the parent's request, mobile UI mutations stopped before the V10 correction.
Current mobile tab is back at Docs library. Parent explicitly received **UI
Preview fixture ownership** for25-project long-picker preparation and a bounded
loopback-only assistant proposal fixture; this worker will not mutate that
account until handback. No paid provider, production or native operation ran.
Remaining successful assistant decisions, populated chat history, long picker,
structured web, V7 Chrome render and deterministic failure states are unverified;
this continuation does not mark ADR003 complete.

## Affected and residual final execution — product `a7facf6a`

The parent returned the UI Preview fixture after preparing25 synthetic projects
and a bounded loopback-only provider at127.0.0.1:18001/v1, model`visual-fixture`.
No external provider was called. This worker made one project-chat request and
two source-proposal requests. Chrome temporary tabs used the same assigned local
origins; no production tab was touched. Normal LOCAL localhost5174 Account→Sign
out replaced its previous Anh Dang authentication session, as explicitly
authorized by the parent, then normal visible email/password Sign in reached UI
Preview. No owner data or settings changed; the parent's separate IAB127web
session was untouched. No token/storage injection occurred.

### Completed affected and remaining cases

| Case | Actual outcome |
| --- | --- |
| V10 Connections,320×740dark | **Pass.** Initial sheet shows all seven named folded groups in one viewport. Connected agents has folded Overnight schedule, Reminders, Agent identity, Agent context, Instructions and Standing rules. Repeated headings removed. Opened API keys, entered an unsent label, folded/reopened: label retained. Cleared it without creating a key. Pending-request folding guard remains formal Tester evidence, not a visually injected pending request. |
| V11 structured valid PDF | **Recovered after runtime fix.** Fresh structured Note displays actual PDF page1/2 with page/zoom controls and Download, alongside existing prose/display equation. Parent diagnosed old QA compiler without init accumulating zombies against its PID limit, recreated the same isolated service with`--init`, then reported three valid compile200 and stable process count. This worker personally verified the visible recovered PDF; the prior failure remains preserved above. |
| Mobile long picker,320dark | **Pass.** Work Choose project lists26options. Scrolled visibly to final Workshop planning option, selected it, full selected label displayed. Reopened, searched`project 25`, list reduced to Visual project25. Closed without selection: Workshop planning remained selected. |
| Populated mobile Work history | **Pass.** Sent a short synthetic project prompt to the local provider, saw completed response with`Orbyn default · visual-fixture · completed`. Opened Chats and more, pinned the new session, renamed it`Workshop planning recap`, then opened project→Chats. The renamed row and Unpin action appeared in that project's populated history. No retention/sweep settings changed. |
| V7 Chrome render | **Not reproduced in Chrome.** Created synthetic task`Check focus entry from Home`, refreshed saved Home suggestion, scrolled Home to body scrollY821 at measured1440×900DPR1, activated Up next→Start focus. Screenshot shows Focus label, task heading, close, timer/rhythm and actions at the top. Leave focus mode measuredtop16, focusedtrue, visibletrue. Closed without starting timer or completing task. Earlier IAB crop is capture uncertainty, not a confirmed continuing product failure. |
| Structured web mixed source/Note | Actual1440light view shows common Note with prose, equation, canonical rendered PDF and separate second TeX source, beside Markdown. Source modes are direct and one Hide source remains. Raw action styling fails V12 below. |
| Anchored web LaTeX assistant decisions | **Actual UI pass.** Opened LaTeX→Ask assistant, entered synthetic instruction, saw Before/After proposed change; Reject removed proposal and left source intact. Repeated request, Accept changed only canonical TeX. Other prose/equation and distinct second source remained; actual refreshed PDF visibly rendered`A clearer preview.` with1/2pages. These were two local-provider requests, not mocked parent callbacks. |

### New source findings before the next hold

- **V12 — unstyled structured web actions:** Back, More, block Edit/Comment and
  Markdown Ask assistant use raw browser-like rectangular gray controls, visibly
  inconsistent with shared rounded controls such as Hide source. Screenshot at
  actual1440light confirms this across toolbar and block rows. The owner also
  independently reported the same styling; Builder is batching the correction.
- **V13 — assistant rejects saved unanchored content:** Structured preview,
  UI Preview document`3e7556af-8a68-492c-9fcc-e9ac898da0b3`, has an unanchored
  saved first paragraph`Visual note with ordinary prose.` and unanchored math.
  Toolbar says Saved and Save is disabled. Markdown→Ask assistant immediately
  shows generic`Something went wrong. Try again.` without an instruction modal.
  Console gives`Save this text before asking the assistant.` in
  `StructuredDocEditor.askForBlock`. Canonical anchored TeX
  `bmv9e0ibqw8yy6b` successfully completed the same assistant flow above. No
  provider failure was inferred: V13 fails before the request modal.

At Builder's request, document mutations stopped after the anchored LaTeX case.
Temporary viewport override was reset; both disposable Chrome tabs were marked
for handoff. Web remains on the saved structured Markdown/Note split after the
accepted canonical proposal. Mobile remains in project chat history. Normal-note
and Markdown successful assistant decisions, actual mobile proposal decisions,
and unperformed injected failure/reader/Suggest states are still explicitly
unverified. Root's independent paired-pane evidence belongs in its own receipt;
this worker does not claim it as personal execution.

## V12/V13 affected checks — `c5ae33fa` / `3a97163c`

- **V12 passes wide light and narrow dark.** Structured toolbar Back/More and
  block Edit/Comment now use the themed action treatment and spacing; no raw
  browser rectangles remain in the inspected normal-note flow. The narrow
  disabled/Retry recovery controls also use that treatment during the actual
  API restart. Supported Chrome screenshot bytes were saved directly as JPEGs:
  `/private/tmp/orbyn-final-structured-controls-light.jpg` (1440×900 light) and
  `/private/tmp/orbyn-final-structured-controls-dark-320.jpg` (320×740 dark).
  These captures show context and contain no populated authentication fields.
- A transient429 at resumption was allowed to expire; an actual Page unavailable
  during the planned API restart recovered through Retry to Saved. Neither was
  silently counted as product success or a permanent defect.
- Saved unanchored **normal-note Ask** on`c5ae33fa` now opens the instruction
  dialog, creates a real local-provider Before/After proposal, and **Reject**
  preserves the paragraph. After the version-contract restart at`3a97163c`,
  normal-note **Accept** updates the intended paragraph. Existing equation,
  canonical PDF and second distinct TeX block remain.
- **Markdown still failed in that runtime:** after saving a distinct first
  paragraph`Draft workshop note. ^bmv9ftxh0jfvazb`, Saved with Save disabled,
  Ask triggers POST`/docs/3e7556af-8a68-492c-9fcc-e9ac898da0b3/anchor`500 before
  instructions. Request`61ec8fb4-2773-4530-b387-c08414dff9a5`, timestamp
  2026-10-15T11:14:40Z. Parent diagnosed request-version shadowing the transaction's
  returned version (TDZ), fixed in`e911672a`, and requested a brief API restart
  hold. The500 receipt is preserved pending actual recovery.
- Independent **mobile legacy LaTeX proposal** on Live preview opened the actual
  instruction sheet and Before/After approval card at320dark. **Reject** retained
  the original canonical source. A second local proposal was requested for Accept
  immediately before the API restart hold; no acceptance action had run when
  requests paused. The pending proposal belongs to the disposable UI Preview
  account; no external provider or production mutation occurred.

Per the parent handoff, this worker will finish this bounded proposal batch after
the listener confirmation. The parent owns the separately reconciled residual
failed-save/reader/Suggest/comment, paired-shortcut, long-composer, calendar,
Admin/connection and public-booking cases; they are not implied by these receipts.

### `e911672a` runtime continuation

After confirmed API restart PID58338/health200, the pending mobile legacy LaTeX
proposal **Accept** succeeded. Actual390×844dark common Note shows preserved
ordinary prose, visible PDF`A clearer preview.` with1/2pages, Download and the
distinct second source. Mobile Reject and Accept paths are now both actual UI
evidence. Capture saved through supported screenshot API:
`/private/tmp/orbyn-final-mobile-proposal-accepted-dark.jpg`.

That capture exposed **V14**: the second marked source renders black on the dark
background. Read-only source confirmation: `mobile/src/screens/docs/DocLatexPreview.tsx`
noncanonical fallback returns `<Text accessibilityLabel="LaTeX source">` without
theme/font styling. Builder received the exact path; no source changed by Visual.

Web Markdown Ask now opens instructions after the TDZ fix. Both subsequent
attempts to submit were interrupted by DOM-resolution timeouts/full app reload
while formal package builds were ongoing. Parent confirmed those builds can
trigger Vite HMR even with frozen source and explicitly held this final request
pair until qualification completes. No duplicate requests were submitted after
the hold; successful Markdown Reject/Accept is **not yet claimed**. Normal-note
Accept on the final version contract remains a valid completed observation.

## Stable handback — `509462e6` / `e911672a` runtime

After all package builds finished, a new temporary Chrome tab retained the
authenticated UI Preview session. **Final Markdown Reject and Accept both pass**:
Saved first paragraph`Draft workshop note.`→Ask instructions→local-provider
Before/After; Reject preserved it. A second bounded request→Accept changed only
that paragraph. Display equation, canonical two-page TeX and second distinct TeX
source remained. Earlier500 and HMR interruptions are preserved as prior receipts,
not silently removed. No repeated LaTeX or page/zoom sweep ran.

### V14 recheck

At390×844dark, the second marked source is now visibly light monospace against
the dark page. Computed text colour`rgb(244,244,245)` and monospace family support
the inspected screenshot. Actual capture:
`/private/tmp/orbyn-final-mobile-secondary-source-dark-fixed.jpg`.
**V14 is closed visually.**

### Remaining finite Docs/composer results

- **Structured valid unsaved mode change passes:** edited Markdown first paragraph
  to`Mode change save checked.`, observed Unsaved / Save available, selected Note.
  It saved, showed Saved / disabled Save, and rendered that exact paragraph with
  the other equation/TeX blocks retained.
- **Normal-note comment draft passes:** mobile legacy comment accepted16 synthetic
  lines, fixed clientHeight58 versus scrollHeight688, overflowYauto, resize none.
  Markdown→Note retained all16 lines. Keyboard move exposed line16 with internal
  scrollTop630 while the field stayed58px; screenshot inspected. Cleared the
  unsent draft afterward; no comment was posted.
- **Mobile long composer and response pass:** at390dark,12-line draft stayed104px
  high; native pointer scrolling moved internal scrollTop168 with total272px.
  Cleared draft, sent exact local fixture trigger`visual-long-response`. Observed
  `Orbyn is thinking…` and disabled Chat/Work controls; completed response contained
  all20 planning paragraphs and provider/model/completed metadata. Scrolled to
  paragraph20 and back through the answer while the composer stayed reachable
  below it. No text overlapped the composer; no external provider call occurred.

### V15 — structured failed-save recovery

Using supported tab-scoped CDP offline controls, edited structured Markdown's
first paragraph to`Offline draft must stay.` and selected Note. A real failed
fetch left Markdown / Unsaved with the complete source intact. Calendar departure
was correctly blocked with`Save this draft before leaving the page.` Every offline
operation restored connectivity in`finally`; the tab was online afterward.

However, **recovery failed**: Save remained disabled (actual isEnabledfalse), no
Retry action existed, and clicking Note after restoring connectivity did not save
or leave. Only Discard draft was offered beside raw`Failed to fetch`. This is
V15, confirmed by Builder as an intentional store error guard without an explicit
retry path. The failed draft was preserved without further editing/discarding.
Builder is adding explicit Retry save on both clients and concise error copy,
then will qualify it before one affected recovery recheck.

Per Builder's hold, no further structured UI mutation ran during that fix. The
single Viewing/Suggesting interaction remains unperformed by this worker; the
current mobile tab is assistant, not already in the legacy editor. Root owns its
separate residual family checks. These results do not establish whole-ADR
acceptance until the V15 recovery and the agreed residual evidence are closed.


## Final affected handback — `2bc81bd1`

Builder handed back this frozen candidate after Tester report `3b092636`: 23/23
focused tests, API-client/desktop/mobile types, root build and guarded anchor
compatibility 2/2. This worker performed browser checks only.

### V15 recovery passes

The host package reload had returned the tab to the saved library baseline; the
previous failed draft did not survive that development interruption. It was not
silently treated as the preserved old draft. Reopened Structured preview and
reproduced one effective offline edit+Save using the current tab's supported CDP
capability. Preliminary attempts using an obsolete capability did not produce a
failure and were not counted. The effective attempt retained the full Markdown
source headed `Final retry save recovery checked.`, displayed Unsaved, an enabled
**Retry save**, and `Couldn’t save this page. Your draft is still here.` Every
network emulation was restored online in `finally`.

With connectivity restored, clicked **Retry save without another edit**. The
actual parent UI changed to Saved, ordinary Save became disabled, and the local
failed-save copy disappeared. Switched to Note: the new paragraph, display
equation, rendered PDF page 1/2 and distinct secondary TeX source were all present.
Calendar navigation then succeeded. V15 is resolved for this actual web recovery
path; invalid/conflict guard qualification belongs to Tester's separate tests.
Screenshot: `/private/tmp/orbyn-final-retry-save-recovered.jpg`.

### Remaining legacy Viewing/Suggesting interaction passes

On the disposable Live preview document, selected Viewing. The actual title
became a heading; editable textareas, block actions and Add a block were absent.
Clicking the prose did not open an editor. Selected Suggesting, opened the first
prose block, entered `Suggested workshop prose for review.`, then blurred it.
The saved prose remained `Visual note with ordinary prose.` and a separate
**1 proposed change** card showed Before/After and Withdraw/Reject/Accept, with
`Suggested. It waits for someone to take it.` The proposal was rejected through
the actual UI: the card disappeared and original prose remained. Returned the
fixture to Editing. No comment was posted and no pending proposal remains.
Screenshot: `/private/tmp/orbyn-final-suggesting-review.jpg`.

This closes this worker's assigned finite residual batch. Prior valid passes and
historical failures remain recorded above. Native app builds, production, live
providers/hosts and the parent's separately owned residual checks are not claimed
by this worker. Both QA tabs are online, temporary viewport override reset, and
preserved for handoff. UI Preview fixture ownership is returned to the parent.
