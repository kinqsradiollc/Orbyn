# ADR 005 technical review — round 1/3

Current decision: **approve the agreed ADR 005 scope, round 1/3**, on product
`4ff3bb6b780e5ca8df2dee7f0f30095d6df9c6a2`. Initial findings and evidence gaps
below are retained history; the final disposition is recorded at the end.
Candidate: `f39aad8ee2d6a6eea555c8017c92bb5c77c55cab`, baseline `9d604df6`,
branch `codex/docs-writing-redesign`, checkout
`/Users/anhdang/.codex/worktrees/c6-next/Orbyn`.
ADR 004's historical 2/3 counter is preserved; ADR 005 is the separately defined
workspace/rendering delivery unit. Reviewer inspected source and assertions only,
ran no tests/builds/browser actions/scans, and changed only this report.

## Findings for one correction batch

### W1 — P2: undo to last-good source does not cancel a pending stale render

Location: `scripts/latex-html-runtime.mjs:87`.

After source A renders successfully, source B schedules the 180ms parse. Undoing
to A before that timer fires takes the `lastSource` early return without advancing
the generation or cancelling the timer. B subsequently replaces the visible
output although the editor now contains A. Separately, A → invalid B → A leaves
the paused/error diagnostics visible because that same return skips recovery.

Track the latest requested source independently from the last successful source.
Every changed source request must invalidate pending work before any last-good
optimization. Returning to last-good source must restore its appropriate status
and diagnostics without replacing its DOM unnecessarily. Preserve theme-only
updates and same-source DOM retention. Add real bundled-runtime regressions for
rapid A/B/A and invalid-B/undo-A, asserting current output and cleared stale error.

### W2 — P2: desktop Docker build omits the new generator and dependency

Locations: `desktop/Dockerfile:15`, `desktop/package.json:15`, `package.json:35`.

Desktop prebuild now invokes `../scripts/build-latex-html.mjs`, but the Docker
build copies only the earlier PDF generator/runtime scripts. Its selected-workspace
`npm ci` excludes the workspace root, while `latex.js` is declared only at root.
The production image build therefore cannot execute the new HTML prebuild.

Copy the HTML generator/runtime into the builder and declare its dependency in
the selected desktop build dependency set, following the existing PDF generator
wiring. Tester should execute the exact desktop Docker target after correction;
a host Vite build cannot qualify this installation/context path.

### W3 — P2: last-good output belongs to the Note rather than selected TeX source

Locations: `desktop/src/features/docs/DocLatexPreview.tsx:37` and `:61`;
equivalent mobile provider; both `DocSourcePreview` source selectors.

The workspace renderer key includes account/document but not selected marked
source identity. A valid main source A followed by selecting an invalid or
unsupported secondary source B keeps A's HTML under B's source selection as the
last preview. Text-only draft updates cannot distinguish a same-source edit from
a change of owner. Source saving remains distinct, but displayed ownership is
incorrect and can mislead the author about the selected document.

Scope last-good output to the selected block's stable ID, with an explicit
positional fallback for unanchored content. Reset/clear on owner change or keep
separate per-owner cached output; preserve the host across edits of one owner.
Pass selection identity through both source adapters/providers. Cover valid A →
invalid B (A must not appear as B), valid B → invalid B (retain B), and source
switches that leave the other block unchanged. Combine provider ownership and
actual runtime assertions; a stub whose only attribute is source text misses
last-good DOM retention.

## Evidence and remaining acceptance

The actual bundled-parser tests meaningfully exercise the default starter,
prose/math/list rendering, unsupported commands and last-success retention.
Mounted web/Expo host tests cover stable iframe/srcDoc and source/theme messages.
Explicit export tests execute the source adapter and prove request-only compile,
snapshot capture, failure retention and unmount/account cancellation with a
deterministic compiler. These are useful scoped assertions, not full workspace,
actual download/compiler, Docker or rendered-design evidence.

Review inspected the restrictive iframe sandbox/CSP and resource cleanup,
source-selection operations and existing save/conflict/departure guards. No
additional actionable defect was identified in those inspected boundaries.
Formal Tester and Visual reports were not yet available at this report cutoff.
Final decision requires their exact refs/results and the correction receipts.
Do not reuse ADR 004 pixels as workspace acceptance, or claim native, external
provider, production or delivery evidence from this source review.

## Same-round source closure — a844c8b9

Inspected correction freeze `a844c8b9c595f879e697c086fa2037cca9c80a10` and
the initial Tester report committed as `126606f0`. Initial qualification records
78/78, both client types, desktop build and generated-runtime provenance on
`f39aad8e`; it does not supersede that candidate's source or visual failures.
Initial Visual report `8739ab94` records W-V1–W-V5: offscreen source controls,
Note source chrome leakage, viewport/outer scrolling, permanent mobile secondary
sections, and duplicated/crowded mobile actions. Unperformed cases remain open.

W1 is source-closed: every source delivery advances generation and cancels the
queued timer before the last-good optimization. The optimization restores the
saved status/details. The real bundled-runtime regression executes rapid A/B/A
and invalid-B/undo-A while retaining the original successful DOM.

W2's source wiring is corrected: the desktop Docker builder copies both HTML
generator/runtime scripts, and desktop/mobile declare the pinned generator
dependency in their selected workspace dependency sets. Exact Docker execution
remains required and assigned to Tester before closure of its build evidence.

W3 is source-closed: both providers now expose the selected source identity,
using its stable block ID or ordinal fallback, and include that identity in the
workspace host key. Both adapters publish their selected ordinal with draft
source. Same-source edits retain their host; a changed selected owner gets a
fresh last-good state. Provider regressions verify keyed identity, and the real
runtime regression distinguishes initial invalid-owner output from that owner's
later retained success. Arbitrary rearrangement of unanchored sources retains
the documented positional-fallback boundary.

The visual correction source scopes the caption separately from the flex-fill
source body, removes superseded legacy split/hide rules, explicitly hides source
in Note, and moves mobile comments/history into contextual surfaces. Duplicated
mobile assistant/source actions are removed while error/recovery status remains.
These changes address the reported mechanisms; actual layout and design remain
with Visual's affected recheck and finite unperformed batch.

No additional actionable source finding emerged in this correction. Decision:
**source corrections accepted; final evidence pending**, round **1/3**. Await
the corrected Tester results, exact Docker build and final actual workspace
design report. Reviewer changed only this uncommitted report and performed no
tests/builds/browser actions/scans. No new full review round is initiated.

## Interaction correction source review — 4ff3bb6b

Inspected `a844c8b9..4ff3bb6b780e5ca8df2dee7f0f30095d6df9c6a2`, initial
correction qualification `0807e5de`, and corrected-candidate Visual `36eb6e16`.
W2 is now evidence-closed: Tester executed the exact desktop Docker target at
`a844c8b9`, including selected-workspace install and both runtime generators,
and recorded the resulting image ID. Formal 81/81, both types, package/desktop
builds and generated asset/provenance checks qualify that correction freeze.

Visual closes W-V1/W-V2/W-V4 and the principal W-V5 duplication/density failure,
while preserving W-V3 outer footer overflow and new W-V6 pointer resize, W-V7
silent export feedback and W-V8 Library Close semantics. It independently
exercised realistic HTML prose/math/lists, continuous representative updates,
last-good repair, distinct selected sources, independent scroll, narrow format
retention, and comments/history/assistant entry. Actual provider execution and
disk delivery were not inferred.

The final source batch addresses each retained interaction mechanism:

- Footer hiding is scoped to an open authenticated document workspace.
- Web and Expo divider handlers track the owned pointer on window; iframe
  pointer interaction is temporarily suppressed and restored. Listeners stop on
  up/cancel/blur/unmount. Mounted tests force unavailable capture and check
  movement/cleanup; actual dragging remains a Visual gate.
- Successful explicit export retains a source/selection/account-matched ready
  action while preserving the HTML host. Web auto-download uses an attached
  temporary anchor; mobile web delays URL revocation. Blob URLs are cleaned up
  on replacement/unmount. Existing revision/access and owner-cancellation paths
  remain. Unit download callbacks do not prove a file reached disk.
- Mobile Library Close returns from navigation locally, preserving the open
  document; source captions/actions are consolidated without removing error or
  recovery paths.

No additional actionable technical finding emerged. Source corrections accepted,
**final evidence pending**, same round **1/3**. Await exact `4ff3bb6b` formal
qualification and the targeted actual closures; no broad repeated sweep is
requested. Reviewer again changed only this report and executed no checks.

## Final acceptance — 16 October 2026

**Approve**, round **1/3**, exact product
`4ff3bb6b780e5ca8df2dee7f0f30095d6df9c6a2`. Reconciled formal Tester
`12a8bb0c`, Visual `9dc8853b` with clarification `4806f7bc` and final zoom
limitation `d3841f54`. Subsequent product/test source drift is absent; the
remaining changes are report and decision-history maintenance. W1–W3 and
W-V1–W-V8 have no remaining material finding in the agreed delivery unit.

### Basis

- Exact-freeze formal qualification: 97/97, package builds, desktop/mobile
  types, desktop production build, HTML/PDF/Mermaid asset preparation, ten
  Mermaid fixtures, source-digest/provenance and desktop/mobile parity checks.
  Exact Docker target `orbyn-adr005-web:4ff3bb6b` passed with image
  `sha256:dba1ed9ba8680f6eaa2f738b2bc138cb6e424e66bc4f286f3fff8dc6c234899a`
  (`linux/arm64`). Overlapping earlier counts are not a unique-test total.
- Actual web and Expo evidence evaluates the new design: readable realistic
  prose/math/lists, long independent source/result scrolling, persistent
  controls, ordinary Note writing, collapsible library, compact remaining
  workspace, phone Source/Preview draft/format retention and both themes.
  This supersedes the failed workspace observations without erasing them;
  ADR 004 pixels are not used to qualify this new experience.
- Actual incomplete/unsupported source retains the correct owner's last-good
  result and recovers after repair. Distinct secondary source was edited,
  repaired and restored without changing the other marked content. Mounted
  and bundled-runtime evidence separately closes undo and owner-switch races.
- Final pointer movement crosses the iframe boundary and changes pane sizes;
  release restores iframe interaction, and keyboard resizing still works.
  At both 1440×900 and 900×500, root scrolling remains zero and app controls
  stay visible; the authenticated footer no longer displaces the workspace.
- Explicit export shows progress then a source/account-matched ready/manual
  download action on web and Expo, preserving source and HTML workspace.
  The owner supplied an actual downloaded two-page A4 PDF; parent independently
  parsed/rendered it and recorded 15,037 bytes and SHA256
  `be66302946bc7f002468c896acbc695ed4c035702b1c5d7bb8a74da601d15109`.
  This is attributed owner-artifact/parent-inspection evidence, not a successful
  automatic browser download observer. The observer timeout remains recorded.
- Contextual comments/history and assistant instruction entry remain reachable;
  the source and retained contract qualification support unchanged approval,
  version, conflict, draft/departure and account authority. No fresh generated
  assistant approval execution is claimed for this browser batch.

### Limits and delivery

Native apps, native font scaling, actual Chrome text/reflow zoom (including
200%), external providers, production deployment and simultaneous two-app-pane
browser behavior remain unverified within this batch. The 1.25 page-scale
observation is magnification only. Supported keyboard zoom did not change the
measured viewport; the final native-shell attempt could not target the owned
QA tab and stopped without changing a personal window or bypassing restrictions.
These are explicit evidence limits, not passes or newly expanded acceptance gates.

Original Markdown equality/IDs and Saved state were confirmed, owned drafts and
requests cleared, viewports restored and fixture returned. The historical
closed-comment-panel Keep editing usability observation remains nonblocking;
it neither loses draft content nor bypasses authority. No unrelated C6 change
is included in this report.

No further test run or visual sweep is required for the agreed scope. Builder
may update the current ADR/ledger disposition and proceed with accepted
integration. Merge, remote push and deployment remain distinct delivery facts.
ADR 004's historical 2/3 review/acceptance is preserved in its archive, while
ADR 005 closes its separately justified delivery unit in round 1/3.

Reviewer inspected code, assertions and receipts, wrote only this report, and
performed no tests/builds/browser actions/scans or product/test-source writes.
