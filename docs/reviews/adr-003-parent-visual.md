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
