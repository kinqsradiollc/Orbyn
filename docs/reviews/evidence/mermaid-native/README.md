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

## Visual correction continuation

The remaining six fixture families were opened and rendered on iOS: class, pie,
Gantt, journey, mindmap and timeline. Screenshots exposed poor pie contrast,
overlapping Gantt dates, invisible journey section text and black mindmap nodes.
Shared core palette rules now feed web/desktop and mobile. Actual native rechecks
show distinct pie segments, readable Gantt endpoint/intermediate labels and the
Morning journey heading. Mindmap nodes gained palette fills and outlines, but
its root text alignment and faint connectors still need correction. Fit-scale
text in timeline/journey is also too small for comfortable phone reading;
remaining viewport/zoom/fullscreen design is not accepted yet.

Gantt measurement initially lost DOMRect getter fields through object spread.
A failing non-enumerable-coordinate regression reproduced it; explicit field
reads fixed it. Current mobile SVG export serializes the adjusted SVG rather
than exporting the original overlapping axis. Journey used the same generated
class for rectangles and text; scoped owned CSS restores text color while SVG
text placement retains the existing foreignObject restriction.

The journey-readable screenshot includes a development provider-error toast
from the synthetic account's unset AI configuration; it is not a production
provider failure. The toast was dismissed for mindmap layout inspection.

Native evidence does not qualify web/desktop, Android, light theme, large-font,
malformed/large-content or complete Docs acceptance. The saved browser denial
remains respected. These changes are not merged or deployed.
