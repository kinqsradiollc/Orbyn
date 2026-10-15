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


## Targeted final closure — exact product `d44c4cdf`

Resumed after Tester `94188184` handback:69/69, desktop/mobile types and desktop
build passed; host writes finished. Only affected findings were rechecked.

- **DW-V1 closed:** at Expo320dark, title is now a multiline field whose complete
  long value is visible in four lines. Edited `the next discussion` to
  `our next discussion`; actual Unsaved→Saved appeared and the new title showed
  in the library and web afterward. This is actual edit/save evidence.
- **DW-V2 closed:** web Finish editing block1 now restores actual focus to a DIV
  with aria-label `Block 1` and tabindex0. AX also identifies focused Block1.
  No content mutation was needed for this focus recheck.
- **DW-V3 closed:** selected legacy Viewing, then More→Page info. Actual Info
  panel appeared immediately with location, storage, versions and connections;
  mode picker stayed Viewing. No switch back to Editing/Suggesting was required.
- **DW-V4 closed:** at320light, structured toolbar has a cohesive back/status/More
  row and a format row; no isolated back/More rows remain. Title starts around286
  (previous330), prose406(previous486). The recovered80px of prose space is a
  material improvement to the writing task, not simply no overflow. Legacy
  toolbar likewise groups its back/mode/action controls without orphan rows.
  Long titles and prose retain clear leading and natural wrapping.
- **Wide Expo proportion recommendation addressed:** Note title/parent measure
 760px at1440. Optional Markdown still uses1108px available split workspace,
  source546px; Hide source returns the bounded Note. The reading and editing
  column now has a useful measure instead of stretching across1060+px.

Light web and dark Expo were represented in this focused closure. Existing
actual PDF/source/save passes above are retained; they were not repeated as a
new broad sweep. No additional blocking finding arose in the affected recheck.
The minor closed-comment-panel Keep editing observation remains a nonblocking
usability note; no unsent synthetic draft remains.

Final proof:

- `/private/tmp/orbyn-adr004-final-note-light-wide.jpg` — clean Note top, complete
  toolbar/title/prose/equation/visible PDF, no active edit or menu.
- `/private/tmp/orbyn-adr004-corrected-structured-light-320.jpg`
- `/private/tmp/orbyn-adr004-corrected-legacy-light-320.jpg`
- `/private/tmp/orbyn-adr004-corrected-mobile-dark-320.jpg`
- `/private/tmp/orbyn-adr004-corrected-mobile-dark-wide.jpg`

All temporary device metrics/viewports reset, tabs online and preserved. Fixture
ownership returned to parent. This closes the assigned bounded visual acceptance
batch for `d44c4cdf`; delivery/merge/deployment and native coverage are separate.


## Paired-editor targeted batch — `09d17c2c` (interrupted for correction)

Resumed after parent reports66/66, types and desktop build, with host writes
finished. Wide web LaTeX now places sourceLEFT (x540,width408) and NoteRIGHT
(x964,width408). Actual visible PDF contains the synthetic short article text;
it is not blank/loading/error. The short text on an almost-empty page explains
the apparently blank appearance, without resolving editing usability by itself.
Proof: `/private/tmp/orbyn-adr004-paired-latex-light-wide.jpg`.

Direct Block3→Edit text now displays code and the same PDF side by side rather
than hiding it. However, **DW-V5**: using PDF Next page/Zoom while editing blurs
the source field and immediately closes the editor/pair. AX Edit block3
vanishes; only rendered PDF remains. Reopened the editor with page2/zoom already
selected to capture `/private/tmp/orbyn-adr004-inline-pair-light-wide.jpg`.
No source/content mutation was made during this batch. Builder confirmed source
onBlur calls Done for iframe focus, and requested immediate handoff for a
correction retaining code edits until explicit Done/Escape (normal prose blur
unchanged). Per that hold, no superseded state/save test or Expo batch ran.
These are still unperformed on the paired-editor candidate, not promoted from
previous layout evidence. Fixture handed back before product edits.


### DW-V5 corrected / DW-V6 transition finding — `6673f912`

After formal handback and host-write completion, actual PDF Previous→Next→Zoom
while direct code editing left Edit block3 visible. Appended one harmless source
comment; autosave reached Saved and recompiled. Page2 retained with exact same
paired-layout canvas468×661.8828125px before/after. DW-V5 is closed for this actual
web path. Proof `/private/tmp/orbyn-adr004-fixed-inline-pair-light-wide.jpg`.

Parent additionally requested the direct active-inline→LaTeX transition. **DW-V6
reproduced:** switching format leaves both visible source editors. DOM shows
LaTeX sourceLEFT408px and Edit block3 inside NoteRIGHT156px, creating a nested
source/PDF split within the Note half. Screenshot:
`/private/tmp/orbyn-adr004-duplicate-source-transition.jpg`. This materially
crowds the preview and creates duplicate edit surfaces. Per the parent instruction,
held further actions and handed fixture back for correction; remaining Expo,
phone stack/source-hide and prose checks have not run on this superseded pair
candidate. The harmless comment is saved, no content discarded.


### Single-source correction / remaining Expo flow — `8cde9352`

Formal handback `41fb7890` reports57/57 and both client types; no host writes.
**DW-V6 closed web:** switching the still-active inline code editor to LaTeX
removed Edit block3, leaving only the format LaTeX source. SourceLEFT408px,
NoteRIGHT408px; Hide source restored ordinary Note. Clean final format proof:
`/private/tmp/orbyn-adr004-final-paired-latex-light-wide.jpg`.

Wide Expo at1440 displays direct sourceLEFT and same PDFRIGHT within the760px
Note column. Actual PDF Next/Zoom leaves source visible. Appended harmless
`% expo paired state retained`; Saved/recompiled retained page2 and exact
405×572.78125px same-pair canvas before/after. At320 pair stacks source abovePDF,
source/iframe bothx16,width240, page scrollWidth320 equals viewport320; no
horizontal loss. Block3 sheet→Done works. LaTeX source mode uses its existing
single-pane phone treatment; Hide source returns Note with page2 retained.
Ordinary prose click replaces its rendered line with one Edit block1 field,
without a duplicate copy; Done returns it normally. No prose mutation made.

**DW-V7 presentation finding:** Expo paired source field is only52px high,
scrollHeight234 (wide348px source) and shows about2lines beside a tall PDF. At320
it remains52px high,width240. This unnecessarily limits source context while a
large paired area is available. Proof:
`/private/tmp/orbyn-adr004-final-inline-pair-dark-expo-wide.jpg`.
Builder accepted correction to size only paired code source240px while ordinary
prose remains natural. Per hold, functional flows above are complete and retained;
only targeted paired source height/internal-scroll visual remains. Fixture handed
back, no further product/UI changes by this worker.


### Final DW-V7 closure — `94a56717`

Resumed only the targeted Expo source-height check after parent handback:
Tester7/7 and mobile types passed, desktop unchanged, host writes complete.
At1440dark actual paired source measures348×240px, clientHeight240,
scrollHeight260 and overflow auto. A native pointer scroll moved internal
scrollTop from0 to20 and exposed the final existing comment without increasing
editor height. No extra source text or test draft was needed. At320 actual input
is240×240px, scrollHeight286; document scrollWidth320 equals viewport320. Source
stacks above the same visible PDF without horizontal loss. Returned via Done.

DW-V7 is closed. Final actual paired proof:
`/private/tmp/orbyn-adr004-final-paired-source-height-dark-wide.jpg` and
`/private/tmp/orbyn-adr004-final-paired-source-height-dark-320.jpg`.

All retained functional results (PDF navigation/save/zoom, source ownership,
format Hide source, normal prose replacement) remain valid and were not rerun as
a new sweep. Historical DW-V5/DW-V6/DW-V7 failures remain above. The assigned
paired-editor batch is complete with no remaining blocking finding in scope.
Temporary viewport/device metrics reset; online tabs preserved; fixture returned
to parent. No new content edits, external calls, security scan or native result.
