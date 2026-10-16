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

## Final targeted closure — `4ff3bb6b780e5ca8df2dee7f0f30095d6df9c6a2`

Both assigned URLs refreshed. This batch rechecked only the remaining findings;
the completed rendering/writing/recovery evidence above remains valid. No content
edits, external providers, native builds or production operations were needed.

| Finding | Actual final observation |
| --- | --- |
| W-V3 closed | At1440×900, root scrollTop0/scrollHeight900 and footer display:none. At900×500, root scrollTop0/scrollHeight500. Switching to Preview and clicking its actual HTML main focused the iframe while root remained0; app bar stayed visible. No footer focus jump. |
| W-V6 closed | Actual CDP pointer press at measured divider x892,y400, move/release at1012,y400 crossed into the preview. Value55→65; source width664.4→785.2 and preview543.6→422.8. After release iframe pointer-events returned auto; clicking its main focused IFRAME. Keyboard ArrowLeft65→60 still works. This is actual pointer movement, not a programmatic value change. |
| W-V7 observable result closed | Web Export PDF visibly showed Exporting PDF… then PDF ready with a retained Download PDF link. Clicking the manual link succeeded as UI action; the supported download observer timed out15s, so this worker does not infer disk delivery from that click. Expo320 Export PDF reached PDF ready and Save PDF; clicking Save PDF retained the HTML/source workspace and ready action. |
| W-V8 closed | Expo320 Note→Document library→Close returned the same current Note and original title/content, rather than exiting Docs to Home. |
| Source-tool density closed | Web wide source starts y202,h690, compared with prior y275,h617. Selector/actions share a wrapping tools row; optional help remains folded. With the ready result shown and a676px-wide remaining workspace at900×500, tools wrap naturally and source retains267px height to y492. Expo320 removes redundant source caption; before ready row the textarea starts272,h528. Essential controls remain readable and distinct. |

### PDF delivery evidence from the owner, separately attributed

Parent received the owner's actual downloaded file
`/Users/anhdang/Downloads/document (1).pdf` and independently inspected it with
pypdf and Poppler. Parent reports15,037bytes, two A4 pages, SHA256
`be66302946bc7f002468c896acbc695ed4c035702b1c5d7bb8a74da601d15109`.
Page1 contains “A clearer preview.” and page2 “Second page retained.”; both
rendered without blank/clipped content. The pages are sparse because the synthetic
source is short. Render proofs are
`/private/tmp/orbyn-adr005-pdf-review/tmp/pdfs/download-1.png` and `download-2.png`.
This is owner-supplied delivery evidence verified by parent, not a successful
automated download capture by this worker.

### Final design assessment and proof

The remaining chrome no longer displaces the workspace or produces an outer
scrollbar. Source and HTML result occupy the available canvas, pointer resizing
works across the iframe boundary, and phone source retains a useful continuous
editing area. Source tools now have a clear hierarchy and export has an observable
result. Combined with the retained realistic-content evidence above, the bounded
ADR005 visual batch is accepted; it is not a claim of native or live-provider
acceptance. The short final screenshot shows deliberately sparse original text,
not a missing/blank rendering.

- `/private/tmp/orbyn-adr005-final-workspace-wide.jpg` —1440×900 dark source/result,
  persistent app/document bars, visible PDF ready/manual download.
- `/private/tmp/orbyn-adr005-final-workspace-short.jpg` —900×500 dark Source mode,
  compact wrapping tools and no footer/root overflow.
- `/private/tmp/orbyn-adr005-final-phone-source-320.jpg` —320×800 light Expo source,
  visible PDF ready/Save PDF and useful editing space.

Exact original Markdown baseline equality confirmed, including original IDs;
both clients returned to Note and full AX snapshots confirmed Saved. No pending
owned draft/comment/request. Device metrics and viewport overrides cleared,
both local QA tabs marked for handoff, fixture returned to parent. Existing
unobserved native/assistant-execution/two-app-pane boundaries remain unchanged.

### Modest browser enlargement boundary

The final source workspace was additionally observed through supported CDP
pageScaleFactor1.25: visualViewport.scale1.25, visible CSS viewport1382.4×741.6,
root scrollTop0, source still717px high. Toolbar/source text stayed readable;
the pinch-style visual viewport crops the far-right result, as expected for
magnification without layout reflow. Proof:
`/private/tmp/orbyn-adr005-final-browser-scale-125.jpg`.
Page scale restored1, returned Note/Saved and tabs preserved. Chrome keyboard
zoom shortcuts did not change measured width/DPR, so they are not counted as a
successful browser text/reflow zoom check. This is modest page magnification
evidence only, not native font scaling or200% text/reflow acceptance.

One bounded native Chrome-shell follow-up was attempted at parent's request.
The native app binding selected a personal window; its Window menu listed only
three personal windows, with no Docs·Orbyn/Orbyn QA window. The Mac runtime does
not expose `cua.listWindows`, and its app inventory supplies no window IDs for
Chrome. The separate supported Chrome tab controls still address the correct QA
tabs, but cannot select Chrome's native View menu specifically for those tabs.
No personal window zoom was changed; the inspected Window menu was dismissed.
Actual Chrome text/reflow zoom remains unverified because the available native
surface cannot safely target this QA tab. No alternate browser/origin or DOM/CSS
injection was used, and no additional zoom attempts were made.
