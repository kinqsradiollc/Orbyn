# ADR 003 V2–V7 scoped source review

Review counter: 1/3. Delegated Reviewer inspected the full frozen product
`6044fddfa71b92315743f4202d6bee3cbf4a5804`, owning runtime/store code,
regression assertions and build wiring. This record summarizes its returned
review; Reviewer ran no tests/builds/browser actions or scans.

One P2 source finding: desktop's download URL was temporarily null after a new
compiled blob, causing Note to unmount and remount the PDF viewer. This loses
page/zoom. Render from owned PDF state and let the download URL catch up without
resetting the viewer. Preserve account/document/canonical-owner resets. Add an
actual provider same-block recompilation identity regression and final browser
page 2/zoom retention check. Mobile mounts from PDF state already.

No further actionable source defect was found in V3–V7. Source review does not
establish rendered compactness, successful generated browser bundle execution,
mobile behavior, or full ADR acceptance. Formal Tester results, desktop Docker
build path, booking API behavior and remaining finite web/Expo checks stay
required. R1–R7 and V1 retain their previous disposition. Follow-up source
closure of the mounted-viewer correction is pending; no whole-ADR approval.

## Scoped source closure — e942a1a0

Delegated Reviewer inspected the fix and returned P2 source closure, with no
additional actionable finding. Mounting now follows preview.pdf; only the pending
download link waits for its URL, so a blob replacement reaches the existing
viewer. Both-client same-block regression retains canonical-owner replacement
and cleanup assertions. Formal Tester and actual browser page/zoom retention
remain pending. Reviewer executed no checks and changed no files; this parent
record preserves its returned assessment. Round remains 1/3.
