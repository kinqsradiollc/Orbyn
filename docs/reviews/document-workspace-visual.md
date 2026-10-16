# ADR005 document workspace visual review

## Provenance and boundary

Initial product: `f39aad8ee2d6a6eea555c8017c92bb5c77c55cab`.
Checkout `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`, branch
`codex/docs-writing-redesign`. This is ADR005's new batch; ADR004 acceptance is
historical and does not qualify the workspace. Web `http://localhost:5174/app`,
Expo web `http://127.0.0.1:8083/`, existing UI Preview disposable fixture. No
credentials printed, no production/provider/native/security operations.

Initial phase: findings handed back for one correction batch. Parent explicitly
capped execution after representative Expo observations because desktop source
layout was unusable. Unrun acceptance cases below remain untested, not passed.

## Runtime setup interruption

The first single document open hit backend429. API health also429. No browser
retry loop: waited, checked health once200, used actual Try again and opened the
fixture. Parent restarted private QA API with local-only general limiter disabled;
no product/env template change. The stale banner was dismissed. Expo initially
showed the prior bundle's PDF renderer; explicitly reloaded the same assigned8083
URL to load this candidate before making any new mobile observation.

## Prioritized actual findings

| ID | Priority | Finding and reproduction | Evidence |
| --- | --- | --- | --- |
| W-V1 | P1 | Web1440×900 LaTeX initially shows blank left pane except LaTeX source label. Controls at y900 and textarea y1022/h654 are below viewport. Source becomes visible only by focusing its offscreen field; ordinary pointer pane scrolling moves outer page instead. A supposed writing workspace must show its editor immediately. | `/private/tmp/orbyn-adr005-source-below-viewport.jpg` |
| W-V2 | P2 | Web Note selection leaks a Markdown source pane label beside prose, plus hidden/offscreen source controls in AX. Note should not expose optional source chrome. Parent source audit confirmed missing pane hide. | Actual Note screenshot in tool receipt; source pane AX exists while Note selected. |
| W-V3 | P2 | Outer web page scrolls app topbar out of view; persistent doc toolbar shifts to y0 and footer becomes visible while source/root heights overflow. The design is not yet fully viewport-owned with independent pane scrolling. | Source focus/scroll receipt and realistic content screenshot. |
| W-V4 | P2 | Expo390 Source uses only around200px source field under roughly350px of header/tool controls; Page comments/composer/History always occupy bottom roughly266px. Preview also leaves those secondary sections visible. Writing space is not prioritized; comments should be a contextual surface rather than a permanent bottom section of this source task. | `/private/tmp/orbyn-adr005-expo-source-390.jpg`, `/private/tmp/orbyn-adr005-expo-preview-390.jpg` |
| W-V5 | P2 | Expo Source shows two Ask assistant actions: one beside Source/Preview, another inside source controls. Hide source, source choices, Web preview and Export PDF wrap into multiple equal-weight rows. Consolidate secondary actions in the persistent toolbar and shorten chrome before reducing text. | Same source390 screenshot. |

Parent separately identified source-only issues for batched correction: stale
undo rendering, Docker asset wiring, invalid secondary source inheriting another
source's last-good output, and legacy narrow `.doc-layout` hide conflict. These
were not repeatedly reproduced by this worker or promoted to actual UI findings.

## Valid observed behavior and design assessment

- Library Hide action removes the second sidebar and materially frees task width.
  Reopen/narrow dismissal are not yet tested.
- Despite W-V1, focusing the real offscreen textarea brought it into view. Entered
  a realistic synthetic full article with section/subsection, paragraph, two-item
  list and inline fraction/exponent math. HTML output was immediately readable,
  properly spaced and did not resemble a tiny full-page PDF. This is a meaningful
  improvement to the preview architecture, but does not qualify the broken editor
  placement. Proof `/private/tmp/orbyn-adr005-realistic-html-light-wide.jpg`.
- Changed one sentence from one to two examples; output updated in the same
  iframe host (`srcdoc` unchanged). No loading/PDF flash was observed during this
  representative edit. Broader continuous typing/last-good/error repair remains
  untested, not inferred from formal tests.
- Restored the exact primary source captured before the test; actual Saved was
  observed afterward. Existing block IDs, title, ordinary prose, secondary source
  and other content were untouched. No unsent owned test draft remains.
- Expo390 Source and Preview buttons switch the current LaTeX mode, source and
  correct HTML sentence visible. No source mutation was made on mobile. It is
  usable at this representative width, but W-V4/W-V5 make task space too cramped.

## Unperformed cases retained for corrected final candidate

Ordinary Note title/long typing/toolbar persistence; Markdown source/result;
complete primary/secondary LaTeX selection; pointer/keyboard divider; long source
and result independent scroll; wide dark/short height/narrow app split; library
reopen/phone close; Expo320 and wide source split; draft/format retention through
phone Source/Preview; incomplete/unsupported source last-good/error repair;
explicit PDF export and failure return; comments/assistant approval entry without
provider execution. Parent asked not to exhaust unreachable paths before fixing
the known blockers. These remain required within the assigned finite scope.

Device metrics/viewports reset, tabs online and preserved. Fixture ownership
returned to parent before source corrections. Report edits only; no source edits.


## Corrected completed-candidate batch — `a844c8b9c595f879e697c086fa2037cca9c80a10`

Both assigned URLs explicitly refreshed before execution; Expo stale bundle was
not treated as current. Root held source while this worker owned UI Preview.
Browser input had one dispatch timeout while opening the library; a state read
showed focused document button, and keyboard Return opened it. No retry loop.

### Design findings and disposition

- **W-V1 closed:** actual web1440×900 source startsy275,height617,width604 after
  library collapse. It is immediately visible and useful. No focus trick needed.
- **W-V2 closed:** Note no longer exposes Markdown source chrome/AX pane. It is a
  clean writing column with contextual tools and direct HTML code results.
- **W-V3 partly open:** ordinary Note long-content scroll belongs to
  `.document-note-content` (scrollTop212.5), root0 and toolbar y65.5. Source/result
  independently scroll too, but focusing a result heading moves outer root49px,
  hides the global app bar and reveals the authenticated footer. At900×500 root
  scrollHeight598; the remaining outer overflow violates full viewport ownership.
  Parent source diagnosis confirms footer contribution; final correction planned.
- **W-V4 closed in current Expo:** permanent comments/composer/History footer is
  gone. Actual390 Source now has useful continuous editing space; at320 source
  clientHeight434, scrollHeight488. Comments and History are contextual sheets.
- **W-V5 largely closed:** duplicate Ask assistant/Hide source removed. Still
  four desktop source-header rows (caption/actions/help/selector) consume168px;
  this is unnecessary short-window chrome. Parent accepted consolidation into
  one wrapping source-tools row. Expo phone Source has a redundant caption when
  Source is already selected; parent planned to remove that phone-only caption.
- **W-V6 pointer divider unresolved:** keyboard ArrowRight changes50→55.
  A native pointer drag and exact measured CDP mouse drag did not change55.
  No repeated attempts. Parent accepted source diagnosis that capture loses path
  over iframe, and plans scoped pointer/iframe handling regression correction.
- **W-V7 explicit export result not observable:** valid saved primary document,
  Export PDF clicked; no progress/result/error, new tab or supported download
  event (20s observer). HTML workspace stayed intact. Parent private API logs
  independently show compiler200; this worker does not claim a disk file was
  delivered. Parent accepted explicit ready/manual-download feedback correction.
- **W-V8 Library Close semantics:** from mobile Note→Document library, inner
  Close exits entire Docs to Home. Reopen Docs returns Library; parent Back then
  restores current Note. No data/context destruction, but unnecessary return
  steps and ambiguous close semantics. Parent will make Close match Back.

No further source mutations ran after handback; these remaining findings were
sent as one correction batch, not accepted as a final design.

### Actual interaction evidence retained

| Case | Observed result and limits |
| --- | --- |
| Ordinary Note writing | Entered16 realistic review paragraphs in first block, Escape rendered content, Saved; internal Note scrolled while toolbar/title stayed. Restored exact prose. Multi-paragraph plain text inside a paragraph block collapses blank-line spacing in rendered prose; long structured/Markdown paragraph rhythm was assessed separately. |
| Full realistic LaTeX | Full article with section/subsection, prose,2-item list, fraction/exponent math rendered readable HTML in light and dark. It has useful human-scale content rather than a tiny PDF page. Same iframe AX host/srcdoc remained across representative updates; no PDF/loading flash observed. |
| Long independent scroll |20 review subsections rendered. Source pointer-wheel scrollTop700 while result independently atReview20; headings/prose remain readable. Doc controls stay reachable; outer footer issue is W-V3. |
| Incomplete/unsupported recovery | Missing section closing brace and unknown command each paused preview with last-good output and Preview details. Repair restored correct article. A tikz package declaration alone was ignored/rendered, not treated as a reproduced error. |
| Distinct source ownership | Selected Document2, rendered its original distinct text; replaced temporarily with complete Secondary notes article, then unknown command. Last-good remained Secondary notes, not primary Workshop plan. Repaired/restored exact secondary text. |
| Markdown | Added realistic heading/list and12 review sections to original source; actual heading/list output appeared. Narrow Preview shows them; Source retains complete draft. Restored exact baseline, preserving existing IDs/content. |
| Short/narrow task width |900×500 with224px app nav leaves676px workspace. It switches Source/Preview instead of tiny nested panes; source326.5px high before tool consolidation, readable and reachable. This is a narrow remaining pane simulation, not two simultaneously open app panes. |
| Library | Wide reopen works; at narrow it overlays content instead of shrinking writing to a sliver; Hide library dismisses it. Mobile Document library opens, Back returns Note. Close issue is W-V8. |
| Expo390/320 | Realistic full article entered390; immediate Preview transition while Unsaved retained source and LaTeX format;320 Preview renders readable headings/prose/list/math without horizontal loss. Back to Source retained exact article. |
| Expo wide |1440 sourceLEFT/resultRIGHT uses remaining width, no permanent library/footer. Keyboard divider50→55. No native touch/keyboard or installed-app result claimed. |
| Comments/history/assistant | Web block Comment opens anchored editor; mobile Page actions→Comments opens separate sheet and History shows real versions. No comment submitted. Web Ask assistant opens instructions/selected-source disclosure with disabled empty submit; no provider execution. No new generated proposal/approval card was created, so actual approval execution is untested; existing formal/runtime authority evidence remains separate. |

### Screenshots and design judgment

The corrected workspace is substantially more usable: one collapsible secondary
library, persistent document tools, full-size source and readable HTML result.
It no longer uses miniature PDF pages as routine writing preview. Both themes
have readable hierarchy and a clear source/result relationship. Ordinary writing
and long result content have useful text measure. This is a material design
improvement, not acceptance based on dimensions alone. Remaining outer scroll,
pointer resize, silent export and source-header density prevent final closure.

Proof files:

- `/private/tmp/orbyn-adr005-corrected-source-light-wide.jpg`
- `/private/tmp/orbyn-adr005-realistic-dark-wide.jpg`
- `/private/tmp/orbyn-adr005-long-scroll-light.jpg`
- `/private/tmp/orbyn-adr005-short-narrow-workspace.jpg`
- `/private/tmp/orbyn-adr005-corrected-expo-source-390.jpg`
- `/private/tmp/orbyn-adr005-realistic-expo-preview-320.jpg`
- `/private/tmp/orbyn-adr005-realistic-expo-wide.jpg`

### Handoff and exact remaining scope

Current Markdown compared equal to the exact baseline captured before this ADR005
batch, including all original marked source IDs; Saved confirmed in a full AX
snapshot. No unsent owned comment/request/proposal. Both tabs online, temporary
metrics/viewports cleared and tabs preserved. Fixture returned to parent before
correction edits. Report only, no source edits.

Targeted closure needed for W-V3/W-V6/W-V7/source-tool density/W-V8. No broad sweep
or repeated renderer/source tests needed. Native behavior, actual generated
assistant approval, disk delivery of PDF and simultaneous two-app-pane behavior
remain outside this worker's observed evidence. No production/provider/security
operation occurred.
