# U1 review — round 1/3

**Final decision: APPROVE `e0997ae434cb8cee9bb783ce524a8519aede34a7` for U1
acceptance and main integration within the agreed scope, round 1/3. U1-R1,
U1-R2 and U1-R3 are closed.** Exact-candidate Tester and final targeted Visual
supplements have been assessed. Earlier decisions
and findings retain their original candidate provenance.

Candidate `3b488b51332d8cf46d25de913bd89dbe71bce428`, baseline `9d786412`,
parent `4050e321`; checkout `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`,
branch `codex/c6-file-viewer`.

**Decision: changes required.** Source/test review found the two
corrections below. Visual Check's completed attempt is blocked before the
required authenticated cases, which remain evidence pending. This is the existing full U1
round **1/3**, not a new round. Builder owns all product/test fixes.

## U1-R1 — P2: Cancel still saves a passkey

Location: `desktop/src/features/settings/PasskeysSettings.tsx:33–41`.

The new owned prompt presents Cancel and Save passkey, but `(await prompt(...))
|| ""` collapses cancellation (`null`) into an accepted empty name. Cancel,
Escape or backdrop dismissal therefore still calls `registerPasskey` and
reports “Passkey added.” The old browser prompt also collapsed these values;
the replacement now explicitly promises a Save/Cancel decision, so retaining
that behavior does not satisfy this changed flow's cancellation contract.

Builder: keep the returned value distinct and return without registration or a
success message when it is `null`. An explicitly submitted empty label may
still save if unnamed passkeys are supported. Do not move the WebAuthn browser
ceremony in a way that loses its required user activation merely to fix naming.

Verification: stub the WebAuthn response and run the actual add flow with a
cancelled prompt; assert zero registration calls and no success outcome. Also
check an explicitly submitted empty label and a named label each register once.
The generic prompt test proves `null` delivery, not this caller's interpretation.
No real passkey enrollment or hosted-auth test is required for this correction.

## U1-R2 — P2: narrow peek steals focus from the command palette

Location: `desktop/src/features/peek/SidePeek.tsx:134–139`; compare its
`anotherModal` keyboard check at lines 159–162.

With a narrow peek open, Cmd/Ctrl+K can still open CommandBar: the app command
handler permits modifier shortcuts while a modal is open. CommandBar uses
`.command-backdrop` with `aria-modal=true`, not `.modal-backdrop`. SidePeek's
new focusin listener therefore treats the command input as escaped focus and
immediately focuses Close the peek. Every attempt to focus/type into the
palette is redirected, while SidePeek's keyboard listener correctly defers to
that same other modal. The same mismatch can occur after resizing an already
open wide peek and palette to narrow width.

Builder: use a consistent top-overlay ownership decision for both focus and
keyboard containment; recognize the command palette and other supported higher
layers, not just `.modal-backdrop`. Preserve background inertness while the
peek remains modal, and restore focus to the surviving peek when the higher
layer closes. Do not disable focus containment globally.

Verification: extend the mounted-component test with the actual command overlay
shape (or render CommandBar), focus its input above a narrow peek and assert it
retains focus. Close that overlay and assert containment returns to the peek;
include the wide-to-narrow transition with the overlay already open. This is a
targeted regression, not a request for another screen sweep.

## Source and test assessment

- Reviewed the full changed-file batch. Most mobile screen changes only redirect
  Alert imports. Native calls forward original arguments; web uses a shared
  queued host, IDs prevent stale settlement and account changes clear callbacks.
  Shared confirmation/restore flows now reach an owned dialog in Expo web.
- Desktop prompt queue, one-settlement guard, cancellation results, inert-state
  restoration and unmount settlement are covered by executed JSDOM assertions.
  Expo queue tests exercise the store, not a rendered React Native Web Modal;
  the pending Visual report must supply that interaction evidence.
- SidePeek loading/retry and wide/narrow role changes have mounted tests, but
  their isolated fixture has no higher overlay and misses U1-R2.
- Project container queries, flow-based Sheet header, truthful two-factor load
  failure/retry and Workspace AI copy match the intended scope. No new data or
  authority semantics are introduced by those changes. Final rendering remains
  delegated to Visual Check.
- Tester reports 45/45 focused checks, workspace types/package builds and desktop
  web build passing on this exact candidate. Those results do not establish the
  missing caller cancellation or nested-overlay scenarios. The reported Vite
  chunk warning is advisory. The separate port-8081 signup/Terms failure is
  preserved as unverified, not asserted to be a regression in this batch.

## Acceptance limits and next owner

Preserve the U1 surface map and its native, hosted OAuth, C4, external-vendor/
channel and C6 bounded-scope exclusions. No every-screen visual qualification,
new scan, native build or paid-provider test is requested. Reuse unchanged
surface evidence only within its original scope.

Await/reconcile `u1-visual-r1.md`; Builder then batches confirmed corrections,
freezes one revision and obtains affected Tester evidence. Reviewer closes
findings within this same round when satisfied. Reviewer has not edited product
or test source, executed tests/builds, operated a browser or run a scan; only
this report was added, preserving other writers.

## Visual evidence reconciliation and final round-1 disposition

Read [u1-visual-r1.md](u1-visual-r1.md) after its completion. It identifies the
same exact candidate and reports only public home/sign-in rendering. Browser
navigation to the protected credential file was rejected by URL policy;
authenticated cases were not reached and no screenshot was captured. This is
an access blocker, not a demonstrated application login/password-entry defect.
No bypass or alternate credential transport is prescribed by this review.

The assigned web nested Settings/focus, narrow SidePeek and pane-width,
Assistant panel/composer, and Expo Sheet/confirmation/theme cases all remain
unverified. They remain the bounded changed-risk scope; no new all-screen,
native or enlarged-text matrix is added. Resume through Visual Check only after
the documented authorized sign-in/access prerequisite is resolved, coordinating
the corrected frozen candidate with Tester so the fixture stays stable.

**Final disposition for `3b488b51`: changes required (U1-R1 and U1-R2), with
required bounded visual evidence pending.** Builder batches both fixes and
appropriate regressions. Tester runs affected checks; unchanged successful
type/build and functional evidence may be reused where justified by the final
diff. Visual Check completes the finite assignment when access is available.
Reviewer can close within this same **round 1/3** after those receipts. No main
integration approval or completed-U1 claim is issued for this candidate.

## Same-round correction closure — `ad1a5dde`

Inspected `ad1a5dde6987db74c2cbf994d8d9d5fd39dae8cd` against original
`3b488b51332d8cf46d25de913bd89dbe71bce428`, and read the exact-candidate
supplement in [u1-tester-r1.md](u1-tester-r1.md). HEAD matched the correction.
The change is limited to the two desktop components and their regression file.

| Finding | Decision and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1-R1   | **Closed.** The prompt result now returns early only for `null`, before registration/reload/success. The regression executes the actual Add callback extracted from the source, with a stubbed ceremony: cancellation registers zero times and produces no success; explicitly empty and named labels register once. Browser ceremony ordering remains unchanged.                                                                                                            |
| U1-R2   | **Closed.** Focus and keyboard containment now use the same modal predicate, including CommandBar's `aria-modal` surface. Inert/hidden surfaces and the peek itself are excluded. A scoped-lifetime observer returns focus to the surviving peek after the higher dialog is removed and is disconnected on cleanup. The mounted regression checks command-input focus, keyboard delegation, closure restoration and wide-to-narrow transition with the command overlay open. |

Tester reports **6/6 dialog regressions**, desktop typecheck and production build
passed, each exit 0. Tests inspect the real callback/component behavior rather
than merely matching source strings. The CommandBar case uses its modal/input
shape, not a rendered full CommandBar, and JSDOM is not visual acceptance. Those
limits are appropriate for source-finding closure; real focus/layout behavior
remains in the existing bounded Visual assignment.

The original 45/45 batch and root workspace type/package-build evidence retain
their unchanged-scope applicability; do not add overlapping counts or call the
whole batch rerun. No mobile/shared source changed in this correction. No further
source correction identified in the inspected diff.

**Final disposition at this point: evidence pending, not changes required for
U1-R1/U1-R2.** Both findings close within **round 1/3**. Authenticated web/Expo
Visual Check remains required and pending; no full U1 acceptance or main
integration approval is issued yet. Preserve original exclusions and the prior
access-blocked attempt. Reviewer performed no tests/builds, product/test edits,
browser actions or scans and updated only this review report.

## Visual correction candidate — `c2cefbe7`

Inspected `c2cefbe77ab525cfa30db29853ce289a3622a10e`, parent `ad1a5dde`,
and the completed bounded observations in [u1-visual-r1.md](u1-visual-r1.md).
The report now covers calibrated web 320/900/1280 and Expo 320, Settings category
navigation, Assistant panel exclusivity/composer, long titles, and actual Expo
AlertHost Delete → Cancel retaining the task. This supersedes the earlier
blocked-only visual status. Pixel inspection is delegated to Visual Check,
not personally performed by Reviewer; screenshot export was unavailable.

The report identifies two further observed issues: TaskDetail closes underneath
Search on Escape, and SidePeek focus falls to body after its palette opener
unmounts. This candidate adds keyboard deferral to TaskDetail and a stable Search
trigger fallback to SidePeek. Its tests execute TaskDetail's actual keyboard
effect, use the actual shared helper, and mount Peek with a removed opener.
Those are relevant targeted regressions. The fallback addresses the specific
removed-opener scenario; it is not proof of every possible focus-return target.

### U1-R3 — P2: two retained panels both surrender keyboard ownership

Location: `desktop/src/lib/dialogLayers.ts:2–15`, used by both TaskDetail and
SidePeek in this candidate.

`hasHigherDialog` detects any separate visible modal, without comparing layer
order or identifying one active owner. A reachable case is a narrow read-only
task peek that is pinned, followed by its Open full action: the peek remains
mounted by design while TaskDetail opens. Both are outside `.shell`, both expose
`aria-modal=true`, neither is made inert by the peek's `.shell/.sidebar` loop,
and each helper call sees the other. Both keyboard handlers therefore return
before handling Escape or containing Tab; Peek's focus containment also yields.
Two visible panels now mutually defer instead of the top one owning input.
This is source-established behavior, not a separately executed browser finding.

Builder: resolve a single actual topmost active dialog, using an explicit layer
owner/stack or consistent rendered-layer ordering and inertness. Alternatively,
make opening the full task explicitly suspend the retained narrow peek while
preserving its pinned state and recovery. Do not replace the helper with a test
that merely checks for any other modal. Keep CommandBar precedence, handled-key
protection and the corrected focus fallback intact.

Verification: mount both retained panel shapes/handlers together, exercise
pinned narrow Peek → Open full, and assert exactly one top layer handles Escape
and contains Tab. After it closes, the remaining layer must regain ownership.
Also retain the command-palette and resize regressions. A focused component test
is appropriate; this does not add an all-screen visual requirement.

### Current disposition and bounded evidence still due

**Changes required for U1-R3; existing round 1/3.** The source changes address
the two individually observed visual cases, but their shared ownership predicate
needs the correction above before acceptance. Matching Tester supplement and
the two already-requested visual rechecks remain pending at this inspection.
Do not treat tests for isolated panels as verification of the combined case.

Retain exclusions exactly: no forced API failure is requested in Visual (retry
is covered by mounted tests); the empty document prevented reaching the custom
instruction prompt, with runtime prompt/focus evidence retained; no authentication
factor enrollment or native checks. Preserve C4, external-vendor/channel and C6
scope limits. No broad visual rerun or source edits/tests/builds/scans by Reviewer.

## U1-R3 correction inspection — `e0997ae4`

Inspected frozen `e0997ae434cb8cee9bb783ce524a8519aede34a7`, parent
`c2cefbe7`. Only the shared layer helper and regression file change.
**U1-R3 source correction accepted; matching execution evidence remains pending.**
No additional source change requested on this diff.

The helper now compares the nearest positioned numeric-z layer and uses DOM
paint order for equal z. This matches the affected Orbyn shapes: TaskDetail's
fixed `.drawer-backdrop` at z4, SidePeek's fixed panel at z4, and CommandBar's
fixed backdrop at z9. Equal-layer retained panels no longer symmetrically defer;
the later painted panel owns input. Existing hidden/inert exclusions and
handled-event guards remain. This is an implementation for these known layers,
not a general claim to model every possible nested CSS stacking context.

The added regression installs the actual extracted TaskDetail and SidePeek
keyboard effects with the real helper. It checks opposite ownership results
for two retained z4 panels, top-panel Tab wrap, exactly one Escape callback,
and the remaining drawer's Escape handling after Peek removal. Existing
command-overlay, resize, removed-opener and passkey assertions are retained.
The combined fixture uses simplified panel DOM; the layer-wrapper relationship
was additionally inspected in source/CSS. This is adequate targeted regression
design for the reported issue, subject to Tester's execution receipt.

At inspection the latest saved Tester supplement still names `c2cefbe7`; it
cannot qualify the changed helper at `e0997ae4`. Await the exact-candidate
supplement and the two already-requested visual correction rechecks before
final U1 approval. Preserve all agreed preview/native/vendor exclusions and
reuse unaffected bounded observations. This remains **round 1/3**; Reviewer
performed no tests/builds, coding, browser actions or scans.

## Final U1 acceptance — round 1/3

**Approve frozen `e0997ae434cb8cee9bb783ce524a8519aede34a7` for main
integration. U1 is accepted within its agreed scope and exclusions.** No further
correction requested. HEAD matched that candidate and there was no uncommitted
diff in desktop, mobile or backend tests at final inspection.

Read the final [Tester supplement](u1-tester-r1.md): **7/7 dialog regressions**,
desktop typecheck and desktop production build all passed, exit 0. The combined
TaskDetail/SidePeek test executes both real keyboard effects, verifies one owner
at equal z and restores ownership after removal. This closes U1-R3's remaining
execution gate. Earlier original 45/45 and full-workspace types/package-build
evidence remain valid for unchanged portions; overlapping runs are not summed.
U1-R1 and U1-R2 remain closed by their earlier source/execution evidence.

Read Visual Check's exact-`e0997ae4` final recheck at calibrated **900×740 CSS**:

- TaskDetail → Search: first Escape closes Search and returns focus to Close
  task panel; the drawer stays open. Second Escape closes the drawer and returns
  focus to the task's Open button.
- SidePeek → Search: palette input retains focus; Escape returns to Close the
  peek. Closing Peek then returns to Search or ask rather than body.

These close the two observed visual correction cases. Retain the prior bounded
web/Expo results for unchanged layout, Settings, Assistant and AlertHost paths.
The combined retained-panel pair is qualified by source and behavioral test,
not a new claim of rendered combined-panel verification. Visual observations
are delegated; Reviewer did not personally inspect pixels or operate a browser.

### Preserved limits

- No forced API-error visual check; mounted retry evidence remains the basis.
- Custom instruction prompt was not reached in the empty document fixture;
  runtime prompt queue/focus evidence is retained. No authentication-factor
  enrollment was performed; passkey cancellation is verified with a stubbed
  ceremony and the real callback.
- Native desktop/iOS/Android, C4 deferred interactions, hosted OAuth and live
  vendor/channel cases remain excluded/unverified as previously agreed. C6's
  bounded closeout limits remain intact. No every-screen or formal contrast/
  enlargement certification is claimed.
- Historical port-8081 legal/signup failure remains an unverified external
  observation, not a pass or a demonstrated regression of this candidate.
- Existing build-size advisory and unavailable screenshot export are disclosed
  in the owning reports; neither supplies evidence of an unresolved scoped
  defect.

Builder may integrate the exact accepted candidate and owned review/handoff
records under existing delivery authorization. Actual merge, push, production
deployment and any broader goal completion must be recorded separately; this
review performs none of them. All corrections and closure finished within
**round 1/3**, with no counter reset. Reviewer changed only this report and ran
no tests/builds/scans, browser actions or product-source edits.
