# Settings modal and administration layout checkpoint

## Scope

Settings now opens over the current web/desktop workspace rather than changing
its view. The document/chat remains mounted. The dialog has category navigation,
search, independent content scrolling, viewport/keyboard bounds, focus return,
Tab containment and nested-overlay ownership. Recovery codes block exit until
acknowledged. Native Settings already uses its existing page sheet.

Administration uses a grouped desktop rail or compact narrow selector; native
Admin uses one section selector instead of eleven wrapping tabs. Its action menu
scrolls with Cancel outside the list; long labels wrap. Night budget and embedding
setup use disclosures. Empty assistant facts and inactive actions are hidden;
Add provider sits by the collection heading. Palette and existing permissions
are retained.

Budget writes now have a dedicated, conditional endpoint. An opaque settings
snapshot includes exact SQL epoch precision. Saving the cap cannot rewrite the
provider/model; stale writes and legacy bundled budget writes receive409.

## Current evidence

- Final UI controls21/21: `/tmp/orbyn-ui-layout-controls-final.log`. Includes actual
  component callback tests, focus/overlay/exit guards and source wiring checks.
- Real budget HTTP tests3/3: `/tmp/orbyn-modal-budget-combined-focused.log`,
  combined12/12 with navigation/modal tests. Includes401/403/400/422/429, legacy
  rejection, preserving another admin's model and concurrent200/409.
- Workspace typechecks, final production build and owned-file formatting pass.
  Final combined focused suite24/24 passes in `/tmp/orbyn-settings-layout-final-regressions.log`. Full exact-head suite and CI remain
  required before main promotion.
- Native iOS test admin signed-in Home and Admin inspected. Screenshots:
  `settings-modal-layout/ios-admin-before.png`,
  `settings-modal-layout/ios-admin-overview-after.png`,
  `settings-modal-layout/ios-admin-section-menu.png`. The last shows all11 choices
  and Cancel without overlap at the inspected default portrait size.
- First preview AI request500 was missing migration218; applying the marked test
  database's migrations made the native retry load its real unavailable/off state.
- Dev reloads produced a planner429:189 requests preceded it within a minute,
  against the180 default shared address limit. Normal observed traffic was27/min.
  Limits were not relaxed. Compose trusts the gateway; gateway replaces XFF. This
  evidence does not prove the user's production refresh issue resolved.

## Remaining acceptance

Web/desktop visual acceptance is delegated to the user's screenshots/test server
under the latest instruction; Browser Use still rejects the saved localhost
permission, and no workaround was used. Native AI budget expansion, keyboard,
landscape/large text, both themes, Settings interactions, nested confirmations
and Android remain required. Browser history and all existing secret/draft exit
paths need acceptance alongside the new modal. Whole C1–C6/M1/D1/U1 stays active.
No deployment or worktree/branch cleanup. User preview files are preserved.

## Qualification repair — 4 October

Frozen head5b204e97 failed CI37129494450: the new budget endpoint lacked its
explicit admin-only route classification, and the navigation assertion still
required the old direct tab setter. The endpoint is now classified and generated
catalog files regenerated. The navigation assertion now requires the guarded
callback, retaining category and search checks. Focused checks23/23 pass in
`/tmp/orbyn-settings-modal-repair-focused.log`; all workspace typechecks pass.

The old full local run was cancelled after those CI failures and an agenda child
stalled during cleanup for over35minutes. Its log and cancellation result are
preserved; it is not passing evidence. Agenda isolation13/13 now exits normally
in `/tmp/orbyn-settings-agenda-isolation.log`. A corrected frozen head requires
fresh full local and CI qualification before merge.

Native Settings opens as a sheet over the workspace; its close control, profile,
search and grouped rows are visible in `settings-modal-layout/ios-settings-sheet.png`.
Searching connections exposes the ChatGPT connections and models entry. This
portrait inspection does not establish landscape, keyboard, large-text or Android
acceptance. A repeated planner429 remains visible in the local preview and needs
further investigation; it has not been dismissed as solved.
