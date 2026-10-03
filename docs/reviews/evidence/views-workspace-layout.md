# Views workspace layout checkpoint

## Changes

Web keeps layout and context-specific date/column controls in its main toolbar.
Group/sort and filters share one labelled disclosure, matching mobile's existing
arrangement. Source-specific groups, custom fields and autosave are retained.
Headers wrap and title/rail widths are bounded on narrow screens. Table overflow
is a labelled keyboard-focusable region. Mobile library removes the repeated
intro, uses concise empty copy and lets long row names shrink beside icons.

## Evidence and limits

- Focused view/search/definition/layout checks30/30, terminalexit0:
  `/tmp/orbyn-views-workspace-focused.log`. Layout checks inspect source/CSS wiring;
  they do not measure rendered bounds or exercise browser interaction.
- All workspace typechecks, production build and full formatting passed. Full exact-head tests and CI required before main promotion.
- Owned web preview now serves this checkout on existing5174; HTTP200 confirmed
  for `/app` and API health. No denied browser UI access was bypassed.
- User manual web review, signed-in native/Android layouts, large text, keyboard,
  themes, persisted edits and cross-device synchronization remain required.
- Full C1–C6/M1/D1/U1 goal remains active; no deploy or cleanup.
