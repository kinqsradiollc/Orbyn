# Views and Review available-width layout — 6 October 2026

Status: implementation candidate; not merged or visually accepted.

## Source findings and repair

Views and Review had window-only900px breakpoints. A wide window with expanded
navigation/panels could leave a narrow page in the two-column state. Both pages
now measure their own mounted element, including after loading and panel resizing.
Widths below900px stack their sections; small-page controls respond at640px for
Views and520px for Review. Existing window rules remain the fallback. No sizing
container or transformed ancestor is added around viewport-owned dialogs.

The observer measures on mount, ignores unrelated entries, normalizes invalid
widths to0, disconnects when the node changes/unmounts and removes its window
fallback listener. The React callback ref handles pages that mount after loading.

Views gallery columns cannot be wider than the page. Review metadata and actions
wrap, its before/after table has bounded column sizing, and long labels can wrap.
Native Review actions and change headers also wrap, with flexible widths for long
approval labels and text. Palette, controls, proposal selection and authorization
contracts are preserved.

## Evidence and remaining gates

18 focused observer/source/layout tests pass with zero failures/skips:
`/tmp/orbyn-page-width-focused.log`. These exercise actual observer callbacks and
cleanup and check client bindings/styles. They do not prove rendered layout.
All workspace typechecks, web production build and full formatting pass:
`/tmp/orbyn-page-width-*.log`. Native rendering and screenshots are still required.

Browser Use again explicitly rejected5174 due to saved permission and prohibited
workarounds. Native Simulator selection again timed out -10005. No screenshot or
visual/native acceptance is claimed. Verify expanded/collapsed navigation,
320/390/640/900/1280px available widths, long labels and large text, Review selection/
approval races, Views toolbar/filter/table/gallery, and dialog/popover ownership
on real web/desktop/iOS/Android before closing U1. Complete page-by-page U1 and the
full C1-C6/M1/D1/U1 ADR scope remain open. No deployment, Docker restart or cleanup.
