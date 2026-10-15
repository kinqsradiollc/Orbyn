# Document writing visual review

ADR: 004. Initial frozen product `a0ac3ba0`, branch `codex/docs-writing-redesign`.
Checkout: `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`.
Status: partial execution, held for one correction batch; no acceptance claim.
Fixture: existing local UI Preview disposable account, web localhost5174 and Expo
127.0.0.1:8083. Credentials were not output. No external provider call, production
operation, native build or source edit was performed by this worker.

## Initial structured web observations

At1440dark, normal Note has a plain title field and contextual block actions,
without the repeated Edit/Comment rows from the rejected ADR003 experience.
Actual prose click replaced its block with an inline field. Typed
`Writing should feel calm, with clear prose and useful space.` Escape returned
focus to the block; Enter then reopened its field. Add text appended a new inline
field; typed `A second paragraph added in the writing canvas.` and Save reached
Saved. The long synthetic title `A calm writing space for workshop notes and a
clear plan for the next discussion` was entered and subsequently autoSaved.
Reopen/persistence verification has not yet run.

Keyboard Return on Block1 actions opened Edit text, Comment and Ask assistant.
Ask assistant was disabled while dirty and enabled once saved; no call was made.
Comment opened the anchored comment draft. Entered a local unsent review draft
and closed the panel; reopening/retention has not yet been verified. No comment
was posted.

Optional Markdown showed the current prose, appended paragraph and unchanged
math/two distinct TeX blocks beside the same Note. Switched to LaTeX and Hide
source; Note returned and PDF stayed page2/2. Canvas widths adapted from425px
split to875px full Note, so this alone does not prove exact zoom preservation.
The canonical codeblock in-place edit/Done state case has NOT run. Builder paused
execution because source audit found renderer unmounting could reset that PDF;
this is a source-reported correction risk, not a browser-reproduced failure.

## Evidence and remaining boundaries

Before image: `/private/tmp/orbyn-v16-docs-dark-wide-top.jpg` (rejected historical
ADR003 layout; not qualification for this redesign).
Initial after capture: `/private/tmp/orbyn-adr004-structured-dark-wide.jpg` is
scrolled to the PDF and is not adequate proof of the complete writing layout.
A fresh context capture is required after the correction freeze.

Legacy, Expo,320px, light theme, reopen persistence, More/mode picker and final
PDF/draft preservation remain unperformed in this batch. All browser mutations
stopped at Builder's hold; existing observations above remain bounded evidence.


## Corrected execution — `c58c91b8`

Formal handback `62865551` reports51/51, both client types and desktop build green.
Browser execution resumed only after host writes finished. Results below are actual
parent UI observations, not a source-code inference or native acceptance.

### Findings for one correction batch

| Finding | Actual evidence | Effect |
| --- | --- | --- |
| DW-V1: Expo structured title clips at320 | Full saved title exists in a single-line text field; screenshot shows only `A calm writing space for w…`, with horizontal editing rather than wrapping. Light and dark both reproduce. | The page cannot display its complete name while reading. |
| DW-V2: web Finish editing loses focus | Clicked first prose block, then Finish editing block1 without changing content. Actual `document.activeElement` is BODY, no label/tabindex; AX focus returns root. Escape on the same component previously restores block focus. | Keyboard continuation loses its place after the explicit Done action. |
| DW-V3: legacy Page info is ineffective in Viewing | Selected Viewing, More→Page info; menu closed, no Info panel in AX or screenshot. Switching Suggesting afterward revealed the Info panel. History and Copy link work immediately in Viewing. | A visible secondary action silently does nothing in reader mode. |
| DW-V4: phone web chrome occupies excessive space | At320, Browse library aroundy98, isolated back aroundy162, format rowy212, isolated More aroundy262, separator293; structured title starts330 and prose486. Legacy title376/prose438. Both themes reproduce. | Several detached rows delay the actual writing surface; compact mode labels alone do not make the narrow layout calm. Combine back/format/status/More into fewer cohesive rows and reduce intervening margins. |

Expo at1440 also expands prose/equation/PDF across1060+px, compared with the web
reading column around724px. This is a proportion recommendation rather than a
functional failure: consider a bounded wide mobile-web writing column.

### Functional passes

- Reopened the structured document from All documents after saving. Long title,
  replaced first paragraph and appended web paragraph persisted. Mobile replaced
  first prose with `Writing stays readable on the phone as well.`, added
  `A phone paragraph added and saved.` through Add text, saved and reopened it.
  Both additions appeared in web afterward as well. Mobile native-index clicks
  on an offscreen Add text did not activate it; the supported visible Playwright
  action did. This was not classified as a product failure.
- Web canonical PDF sequence: page2+Zoom in → Block3 actions → Edit text → append
  harmless TeX comment → Finish editing → Saved/recompiled. Page2/2 retained and
  exact same-layout canvas875×1237.4921875px before/after. The hidden mounted
  renderer correction works in this actual case; no browser failure was claimed
  for the pre-correction source risk.
- Expo320 canonical sequence: selected page2+Zoom in, opened Block3 action sheet,
  Edit text, appended a harmless comment, reopened its sheet and Done. Saved
  preview retained2/2 and exact270×381.8515625px canvas before/after. A stale
  initial compile error from the earlier open tab cleared on one actual Retry
  preview; no repeat compile failure occurred during the sequence.
- Web keyboard Enter on focused prose starts editing; Escape restores that block.
  Return on its contextual trigger opens Edit text/Comment/Ask assistant. Dirty
  assistant entry disables and saved entry enables; no external request made.
- Mobile action sheets expose Edit text/Done, Comment and Ask assistant. Normal
  prose replaces its rendered line while editing. Repeated Edit/Comment rows are
  gone on both structured clients.
- Anchored web comments open from the block menu. Closing an unsent synthetic
  draft then attempting to start a new anchor triggers the in-app Discard unsent
  comment guard; Keep editing retained the guard state. Discarded only that owned
  synthetic draft afterward; no comment was posted. Comments are reachable, but
  Keep editing after a closed panel returns to the block rather than reopening
  the input, a minor recovery usability observation.
- Markdown displays saved prose, math and both distinct TeX blocks. LaTeX is
  optional; Hide source returns the same Note. Page2 stayed through the original
  web source-toggle check. Narrow sources use source-only view and return Note;
  no source corruption observed. Exact zoom state for source toggles across
  different layouts is not inferred from changing canvas widths.
- Legacy web mode picker activates Viewing (read-only prose/title), Suggesting
  (editable controls restored) and exposes all three modes compactly. More opens
  Page history with real saved versions and Copy link gives concise feedback.
  Info's Viewing limitation is DW-V3. Legacy mobile Page options→Edit this page
  exposes direct prose editing and the existing formatting toolbar. Actual
  `Legacy writing remains editable on a phone.` edit saved and appeared on web.

### Visual assessment and proof

Wide web writing is materially improved: a plain wrapping title, quiet toolbar,
clear prose leading and context-specific tools create a readable canvas. It is
not accepted solely because controls fit. DW-V1/DW-V4 remain visible obstacles to
reading and writing on a phone, and DW-V2 interrupts keyboard continuation.

Before: `/private/tmp/orbyn-v16-docs-dark-wide-top.jpg`.
After proof on this candidate:

- `/private/tmp/orbyn-adr004-structured-dark-wide.jpg`
- `/private/tmp/orbyn-adr004-structured-light-wide.jpg`
- `/private/tmp/orbyn-adr004-structured-dark-320.jpg`
- `/private/tmp/orbyn-adr004-structured-light-320.jpg`
- `/private/tmp/orbyn-adr004-mobile-title-light-320.jpg`
- `/private/tmp/orbyn-adr004-mobile-dark-320.jpg`
- `/private/tmp/orbyn-adr004-mobile-dark-wide.jpg`
- `/private/tmp/orbyn-adr004-legacy-light-320.jpg`
- `/private/tmp/orbyn-adr004-legacy-mobile-dark-320.jpg`

No source edits, provider calls, production writes or native tests. This batch
covered both themes and wide/narrow representative writing surfaces, not every
Cartesian combination. Existing valid ordinary web passes were retained. Further
mutations are held for one correction batch; no full redesign acceptance yet.
