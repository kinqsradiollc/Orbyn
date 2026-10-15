# ADR 003 parent-operated visual continuation

Product freeze43923346; formal qualification in adr-003-tester.md; source review
in adr-003-v2-v7-review.md. Actual supported Codex IAB,15October2026. Root operated
these cases because child IAB scope cannot see root tabs. Native excluded.

## Provenance and safety

Mobile exact127.0.0.1:8083 now allowed after user permission change. Private QA
CORS corrected for this exact origin, API8008 restartedPID82858 from same candidate
worktree; no public/service configuration changed. Mobile authenticated normally
with fresh guarded `UI Preview` disposable fixture. Protected loginJSON0600 at
/private/tmp/orbyn-ui-final-login.json; values withheld. Created legacy/structured/
unanchored synthetic documents through normal localAPI for fixture preparation.
Web localhost5174 session independently verified U1 Disposable QA; real owner
127.0.0.1:5174 session untouched. No paid/provider/production request was made.

Mobile actual CSS390×844,320×740,1000×800 and1400×900,light. Web actual CSS1440×900
and320×740,dark; web retained its existing80% zoom, so viewport overrides1152×720
and256×592 supplied those actual dimensions. Screenshot rendering scale differs
from CSS viewport; dimensions were read from the live page.

## Actual results

- Mobile legacy Note visibly rendered a PDF heading/prose/equation, with page and
  zoom controls. Second marked TeX block retained its own distinct source.
  Changed source, observed Unsaved→Saved, returned toNote and retained page2.
  Malformed source kept lastPDF/disclosure and showed Preview unavailable plus
  one full error/Retry inNote; repairing source reachedSaved/Livepreview.
- V8 failed beforefix because outer600px column prevented split. After374258c5,
  library300px and actualwide source/commonNote split both visible; structured
  editor likewise showed split.320px source controls wrapped/readable; Note switch
  retained page2. Inline screenshots inspected.
- V9 failed first-edit structuredunanchored case beforefix. After43923346, fresh
  unanchored fixture first sourceedit retainedPDFduringUnsaved, automatically
  saved/recompiled and kept page2. Canvas width627.5px before andafter confirms
  retained zoom geometry in unchanged pane. AttemptingSave after autosave found
  it disabled; this was a locator timing mismatch, not a productfailure.
- Web V2 now displays actualPDF in commonNote. Set2pages,selectedpage2,Zoomin,
  changedsource, observedSaved/Livepreview: retainedpage2 and578.75px canvaswidth.
  Page text disclosure returned correctsecond-page text.
- Web V3 controls remain groupedatTop. Malformed source shows Saved/Preview
  unavailable, exactlyone fullalert/Retry andlastPDFpage2. Repairedsource afterwards.
- Web V4 longtitle fullywraps withoutclipping atactual320px. Math/prose andPDF remain.

Screenshots: /private/tmp/orbyn-adr003-web-live-note.png and
/private/tmp/orbyn-adr003-web-error-retained-note.png (0600). Other mobile captures
were inspectedinline only. These are actualparentcases, not delegatedinspection.
Exactvisualacceptance ofallremainingfamilies remains in final-visual plan/report;
no wholeADRcompletion,merge,push,productionornativeclaim ismade.

## V10 / V11 correction batch

Mobile Connections now starts with seven named, folded groups. Nested agent
preferences fold independently; opened groups retain drafts when folded, and
pending operations disable their group controls. Messaging operation state reaches
the enclosing sheet through both Slack and Teams components. Essential sharing
and permission explanations remain inside the relevant task.

The fresh-session LaTeX failure (V11) was reproduced as a QA runtime setup defect:
the manually launched older image lacked an init process, accumulated 53 orphaned
sandbox processes and reached its 64-process limit. Production Compose already
sets `init: true`. Recreating the owned QA container with Docker `--init`, keeping
its isolation flags, restored three consecutive valid compilations (HTTP 200,
28,972-byte PDFs) with 13 processes. Image and Kubernetes startup now explicitly
wrap Node with Tini, including custom launches. New-image qualification remains
required; the three recovered requests used the existing image with Docker init.
No new environment variable is introduced.

Development test failures remain in the private QA logs: the first batch was
29/32 and the second 30/32. They exposed stale exact-copy assertions and a stale
hook-fixture slot; these were corrected without claiming complete screen testing.

### Actual paired navigation and shortcut ownership at a7facf6a

Root used a separate U1 Disposable QA account in IAB (no UI Preview mutation).
At actual 900×800 CSS pixels, First Home's scroll position of 481.875 survived
Second Docs→First; the unsent reflection remained and was then cleared. At320px,
Second→navigation→My tasks changed only Second, and First still showed Home.
Restoring1440×900 displayed both independent panes. A failed attempt to click the
narrow-only Second pane selector after widening was a no-match; the wide view
correctly had both panes visible.

In Second's actual legacy editor, opening Share, pressing Cmd+Shift+R and then
Escape left Editing unchanged, dismissed only Share, and returned focus to its
Share button. Focusing First Home's reflection then Cmd+Shift+R also left the
Second editor unchanged. These are actual parent interaction checks, not a
claim that every source-mode failure or keyboard shortcut has been executed.
Screenshots: `/private/tmp/orbyn-adr003-paired-mobile-width.png` and
`/private/tmp/orbyn-adr003-paired-final.png` (private synthetic QA only).

V10/init scoped source review accepted a7facf6a in round1/3, with no actionable
findings. It explicitly retained the limits of structural busy-wiring assertions
and the brittle hook fixture; actual new-image process qualification is pending.

### Actual legacy failed-save departure and recovery

In U1's second-pane legacy Markdown editor, root used the supported tab CDP
network controls to set only that QA tab offline. Entered a synthetic Markdown
draft and attempted Calendar navigation. The page stayed in the editor, retained
the draft and displayed “Couldn’t save. Changes remain in this document” and
“Not saved”; no native alert appeared. Restored normal networking, restored the
synthetic mixed-content note (prose, equation and canonical two-page TeX block),
and chose Note. The editor reported Saved. A subsequent Calendar navigation
succeeded in Second while First Home remained. Network emulation was reset and
Network disabled afterward. Recovery screenshot:
`/private/tmp/orbyn-adr003-failed-save-recovered.png`. This proves the actual legacy
parent's failed-save guard; structured/native equivalents are not inferred.

## V12 / V13 owner-reported action correction

The owner independently reported native-looking Edit/Comment buttons. A source
inventory found1,566 web button elements across217 files, including158 without
an explicit class. Many are styled by their owning menu or toolbar; absence of a
class alone is not a defect. The shared stylesheet now supplies themed border,
radius, background, padding, hover and appearance defaults at zero specificity,
so existing feature controls retain their overrides. Every structured editor
button also names an app action class; per-block actions share the text-button
style and spacing. This is source coverage, not1,566 rendered checks.

The same final visual pass reproduced saved unanchored text failing before an
assistant instruction could open. Web and mobile now name the exact saved block
on demand through the existing authorized anchor API, refresh its saved identity,
and then open the request. The helper refuses ambiguous/copied positions, dirty
or conflicting drafts, and account/page changes; it never guesses among repeated
passages or overwrites a newer draft. Existing anchored blocks avoid a new write.
The API remains authoritative for scope and optimistic proposal acceptance.

Development focused tests:19/19 passed. First workspace typecheck exposed a
mobile-only stale history-ref name in the correction; fixed to its actual page
owner guard. Final qualification and affected visual recheck remain required.

### V13 review correction: concurrent duplicate reorder

Scoped Reviewer found that matching only local index/text could still name the
wrong identical passage after a remote reorder. The anchor request now includes
the captured saved version. The backend locks the page row, validates that version
before naming any leaf, and returns409 on mismatch. Existing link callers may
omit the version; saved assistant selections always send it. A helper regression
asserts stale-version refusal, and a guarded API regression shifts identical
paragraphs before anchoring, expects409 with no content/revision change, then
checks successful anchoring at the fresh revision.20/20 focused development unit
checks passed after the correction. API execution remains assigned to Tester.
No environment variable or migration is added.

The first actual request after3a97163c exposed an implementation error in the
version check: the new request version name was shadowed by the transaction's
existing returned-version variable, causing a temporal-dead-zone500 before the
assistant dialog. The request at11:14:40 UTC in local QA was preserved in the API log.
Renamed the captured request field to expectedVersion; the new real API test
and typecheck remain required before acceptance. The failed live attempt is not
a passing assistant check.

### V14 mobile secondary TeX contrast

The final mobile proposal acceptance succeeded and rendered its changed canonical
PDF, but the distinct secondary TeX source used a plain React Native Text without
a theme foreground. It appeared black on a dark surface. That fallback now uses
the shared foreground and monospace font, remains selectable, and keeps its own
source rather than duplicating the canonical PDF. The existing four mounted
provider tests now assert its actual rendered color/font in the mobile fixture;
4/4 development checks passed. One targeted dark recheck remains required.

## Finite final interactions and V15

At product509462e6, actual sidebar keyboard Home/End exposed200/400px limits;
double-click reset224. A supported CDP pointer drag changed224→284; Escape and
release restored224. An owned Admin provider form was cancelled without creating
its draft, then an unused local Control preview provider was saved through the
in-app Apply change confirmation. Active Visual fixture remained selected. An
offline connection test showed a concise error; online Test connection retry
reported Connected and the stale error cleared. Screenshot:
`/private/tmp/orbyn-final-admin-provider-recovery.png`.

Scheduled one synthetic45-minute calendar session, opened Change time, entered30
and cancelled; the original22:45–23:30 block remained. Public booking at320×740
validated an empty required name, then confirmed a synthetic booking with recipient
and Australia/Melbourne zone visible before submission. Confirmation had no
horizontal overflow. Guarded test DB was checked and SMTP was disabled: no real
email delivery is claimed. Screenshot:
`/private/tmp/orbyn-final-booking-confirmation-320.png`.

Visual Check completed stable Markdown Reject/Accept, mobile LaTeX decisions,
V14 dark secondary-source recheck, retained scrolling comment input and bounded
mobile composer/20-paragraph local response. Its structured offline-save case
reproduced V15: draft retained but Save disabled and no usable explicit save retry.
The store now exposes explicit retrySave, preserving source-invalid/conflict/busy
fences; autosave still stops on errors. Both structured parents expose Retry save
for a retained valid draft, with concise transport-error copy.23/23 focused
development tests passed, including failure→retry without a new edit, invalid
source refusal and conflicting-draft preservation. Formal qualification and an
actual V15 recovery recheck remain required.

## V16 — owner correction: oversized, inconsistent actions

The owner rejected the earlier button fix's density. It removed browser styling
but retained inconsistent per-feature sizes. Routine actions now share32px desktop
and44px phone/coarse-pointer minimums,13px/15px labels and a20px line box. Segmented
controls include their border/padding in the outer size. The source audit replaced
56 unconditional routine action rules in28 stylesheets, plus named document
menu/source actions. Public hero/consent, Focus and presentation controls retain
their deliberate larger layouts. Long values can wrap and grow.

The owned PDF renderer receives a bounded compact/touch control mode from its
parent. Theme/size updates happen before its unchanged-document return and do
not reload the PDF or reset page/zoom. Desktop resends on an actual size-mode
change, rather than every resize event. Expo/native default to touch sizing.
Both generated assets are updated. Mobile PDF download text uses the13px scale.
No environment variable or migration changes.

The first expanded development batch passed54/58: one new size-token allowlist
needed updating, an earlier mobile PDF download used14px off the shared scale,
and two source assertions depended on old whitespace/exact rail callback text.
Those failures remain in the private TAP. The corrected batch passed65/65 across
button fallback/sizing, editor modes, redesign controls, workspace layout,
typography, settings grid, PDF runtime and canonical viewer tests. Actual density,
size comparison, touch recheck and formal qualification remain required.
