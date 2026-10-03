# Saved-view library discovery — 3 October 2026

Scoped follow-up on combined UI candidate e8dbcd7b. This is one part of the
whole-application U1 contract; it does not complete Views acceptance.

## Implementation

- Both clients use shared `searchSavedViews` for saved-view names, team names,
  content types and layouts. Whitespace-separated words all match; case and
  combining accents are normalized. Empty search preserves order and references.
- Library search does not change selected view, saved definitions, row filters,
  autosave or permissions. It only filters already-authorized library results.
- Web retains personal/team groups, stars, pins and creation. Its desktop library
  scrolls independently within the viewport; narrow layouts retain ordinary page
  scrolling. Long view headings wrap.
- Mobile retains grouped rows and creation, offers the same labelled search,
  distinguishes no matches from an empty library, and allows selecting a result
  while the keyboard is open.

## Evidence and limits

Focused library, grouping and saved-view checks: 26/26 pass, zero skips/failures.
Log: `/tmp/orbyn-views-library-regressions.log`.
All workspace typechecks and production build completed with exit0. Logs:
`/tmp/orbyn-views-library-typecheck.log` and `/tmp/orbyn-views-library-build.log`.
Owned formatting and `git diff --check` pass. Exact-head full suite and CI remain
required.

Web screenshots are delegated to the user's manual preview because the saved
Browser Use denial remains enforced. No workaround was used. Native result
selection with keyboard, long names, large collections and Android remain open.
Source assertions establish wiring and CSS intent, not rendered geometry.

Views' full create/edit/filter/sort/group/columns/layout/row actions/persistence,
loading/error/detail navigation acceptance remains required by U1.
