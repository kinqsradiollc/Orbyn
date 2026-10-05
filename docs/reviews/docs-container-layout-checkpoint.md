# Docs available-width layout checkpoint — 6 October 2026

Status: implemented candidate; full qualification and visual acceptance remain open.

## Changes

Docs comments, history and Info now respond to the editor container's available
width. App navigation and the Docs library can leave a narrow page inside a wide
window; viewport media rules alone did not handle that state. Below900px the
rail stacks; anchored comment cards return to document flow and discard reserved
height. Info appears above the page. The existing1060px outline threshold remains.

The observer measures on mount, follows container resizing, ignores unrelated or
empty records, and disconnects on unmount. A window-resize fallback handles
runtimes without ResizeObserver. Widths that are missing or nonfinite use the
narrow state. Palette, controls and radius tokens are retained.

Mobile already presents Info in a sheet and dismisses it before opening history;
this checkpoint preserves that existing feature arrangement. It does not claim
that every native overlay or whole-app layout has been accepted.

## Evidence and limits

- Twelve focused layout cases pass, including the real observation helper in an
  isolated DOM harness and existing app/view layout contracts:
  `/tmp/orbyn-doc-container-layout-focused-final.log`.
- Owned package builds, desktop types/build and full formatting pass:
  `/tmp/orbyn-doc-container-layout-packages.log`,
  `/tmp/orbyn-doc-container-layout-types-final.log`,
  `/tmp/orbyn-doc-container-layout-build.log`,
  `/tmp/orbyn-doc-container-layout-format.log`.
- Initial types used stale built shared declarations after integrating PR210;
  rebuilding owned packages corrected the environment. Original failure log
  `/tmp/orbyn-doc-container-layout-types.log` is retained.
- Full local suite/CI qualification remains required. CSS/source assertions and
  an isolated helper harness do not prove rendered geometry or native appearance.
- Saved Browser5174 Block and Simulator timeout -10005 remain recorded; there
  are no new screenshots for this checkpoint. User manual preview acceptance,
  narrow/collapsed/keyboard/large-text states and the full U1 matrix remain open.

Reference-title PR211 is qualifying separately. Preserve the full C1–C6/M1/D1/U1
scope, user/character changes and final integration/cleanup requirements.
