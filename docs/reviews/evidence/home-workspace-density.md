# Home and task workspace density — 3 October 2026

## User review and scope

The user supplied screenshots of the signed-in companion card and task toolbar,
identified excessive repeated copy/oversized controls, and reiterated that the
ADR requires a full application redesign. These changes address those specific
surfaces. U1 and the full ADR remain incomplete.

## Changes

- Signed-in Home: 40px companion, compact header, two short agent rows and
  explicit activity/help actions. Detailed timing, results, pause conditions and
  examples appear only after opening the guide. All character presets remain
  available through Companions. Both clients share the same short descriptions.
- Guide controls precede expandable content, so opening a long guide does not
  push the only collapse action below that content.
- Public Home: brief agent descriptions; request examples, workflow and result/
  pause explanations remain within their expandable sections.
- Tasks: compact responsive toolbar, integrated search field, short filter label;
  narrow saved-view/progress icon buttons retain accessible names. Existing
  layouts, filters, progress and saved-view behavior are retained.
- Shared empty state: No tasks yet / Add a task or event. Web provides Add task
  when a creation callback is available; mobile keeps its existing add action.

## Evidence

- Focused real-component disclosure/identity/cache, shared copy and toolbar wiring
  tests passed 17/17, terminal exit 0:
  `/tmp/orbyn-home-density-final-all-regressions.log`.
- All workspace typechecks passed. Final action-order desktop (38458) and mobile
  (39467) typechecks, production build (86801) and full formatting (57203) each
  completed with exit 0. Logs: `/tmp/orbyn-home-density-final-actions-desktop-types.log`,
  `/tmp/orbyn-home-density-final-actions-mobile-types.log`,
  `/tmp/orbyn-home-density-final-build.log`, `/tmp/orbyn-home-density-final-format.log`.
  Exact committed-head full suite and CI remain required.
- Native iPhone SE iOS18.5: actual HomeCompanions with real theme/fonts/character
  renderer in an isolated fixture. Fonts reported loaded. Default summary,
  guide open/close and character expansion were observed; labels/controls did not
  overlap in inspected screenshots.
- Screenshots: `home-density/native-compact.png`, `native-guide.png`,
  `native-characters.png`. The fixture mocks account identity and activity modal;
  this does not establish signed-in activity/backend output delivery. Lower
  gallery scroll attempt had no visible movement, so scrolling remains unproven.
- Actual web preview is served on5174 for manual user review, as authorized.
  Saved Browser Use denial remains enforced; no browser workaround was used.
  User supplied before screenshots; current rendered web geometry still needs
  their acceptance. Native tasks, Android, large text, both themes and complete
  U1 per-surface interaction/persistence acceptance remain open.

## Integration

Based on Views181 ae6d11e7. Combined18285b8b227 remains frozen and passed its own
2,502/2,502 full local suite. These newer Home/task changes require separate
qualification and integration before a main checkpoint. No main merge, release,
deployment, original-work cleanup or change to the retained ADR scope occurred.
