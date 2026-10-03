# Settings workspace layout — 3 October 2026

## Scope

Web/Electron settings changes from a row of tabs over long content to a category
rail beside bounded content. At narrow widths the rail becomes wrapping controls
above content, avoiding horizontal scrolling for category discovery. Search stays
in the navigation area. Categories, section focus and setting actions are retained.
Native mobile's existing settings destinations and flows remain available; this
layout introduces no web-only provider/account capability. Full Settings/U1 and
ADR acceptance remain incomplete.

## Behavior and accessibility

Named ordinary buttons support native keyboard activation, indicate the current
category and identify the controlled content region. The active region is labelled
by that category. Existing search selects its destination, clears the query and
opens the matching section. Theme tokens and radius scale are preserved. Grid
content uses minmax(0,1fr), long category labels can wrap, and narrow navigation
wraps rather than depending on an overflowing tab strip.

## Evidence and limits

- Final combined focused checks:20/20, terminal exit0; six settings checks include
  actual SettingsNavigation rendering/action callbacks and actual SettingsView
  category selection plus search selection. Child settings panels/hooks use
  isolated mocks, so this does not prove saved settings or network delivery.
  Log:/tmp/orbyn-settings-workspace-regressions-retry.log.
- Initial source check caught a still-used ShieldCheck icon removed during import
  extraction and stale shared package declarations. Icon restored; own packages
  built and checkout-local @orbyn aliases installed. Final desktop typecheck
  /tmp/orbyn-settings-workspace-types-owned-aliases.log terminated0. Backend and
  mobile typechecks also terminated0.
- First interaction search test incorrectly expected ChatGPT under Connections;
  the canonical search catalog places account models under Account. Corrected
  fixture starts on Privacy then verifies the actual Account destination and
  ChatgptConnections content. Production catalog was not changed to fit the test.
- Production build67804 and formatting92919 terminated0. Final evidence formatting
  and exact committed-head full suite/CI remain required.
- No current rendered web geometry claim: same-URL retry was rejected by saved
  Browser Use permission. User owns web preview review. Wide/narrow/both-theme/
  keyboard/zoom screenshots and native full-flow acceptance remain open.

## Ownership and next step

Based on frozen combined509ded3c (PR184) in codex/settings-workspace-layout.
Original frozen candidate branches preserved. No main merge, deploy/release or
cleanup. Qualify exact committed head, serve it for user visual review, then
integrate as a scoped checkpoint when the remaining acceptance permits it.
