# Settings layout implementation review

Status: local, unmerged implementation. The governing contract is
[the web and settings redesign](web-settings-redesign-2026-10-01.md), U1 and M1.

## Implemented locally

- Eight destinations share one category registry with settings search and
  command destinations: Account, Appearance, Planning, Notifications, AI & models,
  Connections, Security, and Privacy & data.
- A category rail serves wide screens. Narrow screens open a native modal
  category menu with contained scrolling, Escape dismissal, focus restoration
  and keyboard navigation. Runtime browser verification remains pending.
- Container queries adapt the rail, field grids and connection rows to narrow
  app panes as well as narrow viewports; a resize observer closes the category
  modal when its owning pane becomes wide.
- Theme, reading and layout controls moved to Appearance. Tags join Planning.
  Reminder and chat delivery controls moved to Notifications. Sign-in methods,
  sessions and devices have individual sections under Security. Import/export
  joins Privacy & data. Phone destinations retain their existing section/sheet
  mappings and visual design.
- The old tags destination resolves to Planning and focuses Tags. Existing
  search IDs remain stable; initial deep links mount their intended category
  immediately. ChatGPT connection/model controls have a searchable AI destination.
- Controls initially remain visible rather than requiring repeated accordion
  expansion. Sections use spacing and dividers instead of competing card fills.
  Their headings contain the disclosure button with valid heading semantics.
- Settings styles use theme and radius tokens. Menus are allowed outside section
  bounds rather than being clipped by the old accordion overflow rule.

## Evidence and limits

The first focused settings run passed 31 of 32 tests; its only failure was a
CommonJS test harness encountering Vite's `import.meta.env.DEV`. The harness now
applies Vite's production flag substitution, and all 32 focused tests passed.
Those checks cover the shared destinations, phone index compatibility, renderer
store, actual layout category mounts, initial deep links and legacy tags.
Network-owning child controls are explicit stubs in the layout test.

The markup/containment refinement passed all 32 focused tests. Workspace
typechecks and the production build also passed, including the category menu's
keyboard isolation. The first combined full run failed 3 of 1,957 checks:
the added settings command lacked its person-only policy mapping, and two
security lead-ins violated the existing single-sentence copy rule. Both source
defects were corrected without weakening tests; all 45 focused settings/policy
checks then passed. The container-width refinement passed workspace typechecks
and the production build; 48 focused checks now also cover the actual menu's
keyboard, selection, modal lifecycle and resize handlers with controlled DOM
fixtures. These handler fixtures do not verify native browser modal behavior.
The subsequent full run passed all 1,960 tests, zero failed or skipped, against
the disposable local test database. This validates the implementation worktree;
main has additional concurrent document changes and requires separate integration
validation. Docs work is saved separately as local commit `866003c`.
No browser or native interaction is claimed from static markup tests.
The browser tool's saved local-preview permission still rejects access
despite the user's approval; no alternate access route was used.

## Release gates still open

Verify the actual screen at narrow, tablet and desktop widths, both themes,
large text and long labels. Exercise search, category navigation, section
collapse/reopening, menu bounds, modal focus/Escape, saves and nested overlays.
Run full regression validation on the final combined source, then validate the
exact main integration before pushing a production checkpoint.

Complete real ChatGPT authorization and inference, web/mobile executor/default
controls, provider administration and separate embedding configuration. The
eight-category layout does not complete M1, U1 or the full web redesign.
