# Native Mermaid verification — 2 October 2026

Owned iOS 18.5 narrow simulator, synthetic account, source worktree
codex/devday-model-catalog at 3cb6604 plus the accompanying runtime fixes.
Metro on 8088 and owned API on 8028 used a marked test database. No production
account or browser permission bypass was used.

- flowchart.png: actual bundled engine rendered Start → Finish after removal
  of only the two exact stock keyframe bodies. Unknown/external CSS stays rejected.
- sequence-fit.png and sequence-refit.png: Alice/Bob and Hello/Ready fit within
  the narrow viewport; Zoom in enlarged it and Fit restored containment.
- svg-handoff.png: Export SVG created a 23 KB diagram and opened the iOS share
  sheet. No recipient or save destination was selected. The first dismissal
  failed because the native window handle became unavailable; rebinding the
  simulator and invoking its exposed Cancel action dismissed it safely. This proves file
  creation/system handoff, not completed file delivery.

Corrected before-fix regression failed for deferred native dependencies. The
combined runtime/download cohort then passed 25/25, with mobile/backend
typechecks passing. State and entity relationship fixtures also rendered. State exposed omitted
24px host padding; the height now includes it and state-fit.png proves its final
node is fully visible. ER exposed pale default attribute rows; validated surface
tokens now pin rowOdd/rowEven and er-theme.png proves readable attributes.

Remaining diagram families, malformed/large fixtures,
both themes, Android, web/mobile-web and complete Docs acceptance remain open.
