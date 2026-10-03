# Combined ADR candidate — 3 October 2026

## Inputs and ownership

Branch `codex/adr-release-qualification`, dedicated managed worktree. Starts at
Views ae6d11e7 (combined Home/models/Docs e8dbcd7b), merges native source keyboard
6220f1c1 and independent plugin transport bc381226. Current main1100ca98 is already
an ancestor. Original branches, worktrees, root user files and character work are
preserved. No cleanup, main promotion, deployment or release has occurred.

Merge conflicts were limited to append-only documentation. Both sides were
retained in ADR, deployment instructions and task handoff. No product source
conflicts occurred. The typed catalog was regenerated and produced no drift.

## Candidate evidence

- Combined affected library/source/plugin checks: 37/37, zero failures/skips.
  `/tmp/orbyn-adr-release-regressions.log`.
- Backend and desktop typechecks pass. Initial mobile typecheck could not resolve
  the already-installed react-native-webview package; this new worktree was
  missing the local dependency link. No source workaround was introduced. Mobile
  retry completed with exit0 in `/tmp/orbyn-adr-release-mobile-typecheck-retry.log`.
- Production build and full formatting completed with exit0:
  `/tmp/orbyn-adr-release-build.log`, `/tmp/orbyn-adr-release-format.log`.
- Recovered frozen UI e8dbcd7b full suite: 2,474/2,474, terminal0, no skips or
  failures. `/tmp/orbyn-adr-ui-integration-e8dbcd7b-recovered-full-tests.log`.
- Recovered frozen plugin bc381226 full suite: 2,204/2,204, terminal0, no skips or
  failures. `/tmp/orbyn-plugin-transport-bc381226-recovered-full-tests.log`.
  CI37092219802 all four jobs successful.
- These separate full runs do not qualify this combined head. Its own full suite,
  CI and runtime acceptance remain required.

## Remaining full-scope acceptance

All C1–C6/M1/D1/U1 requirements remain active. Real ChatGPT account/executor,
managed/BYO plugin provider and hosted entry-point acceptance are still required.
Plugin asynchronous job/result events, reconnect cursors and launch schemas remain
unfinished. Existing MCP task reads bind grant/expiry but do not explicitly recheck
current tool policy or rescope a stored result; do not reuse them for plugin job
results without adding and proving those authorization checks.

User owns web visual review on the preview/test server because saved Browser Use
denial persists. Current preview serves Views ae6d11e7 with combined Home/models/
Docs, same API8027 and recreated admin account. No denied-browser workaround.
Native source keyboard fixture proof remains distinct from actual editor/server
saves, persisted revisions, Android and full screen acceptance. Full per-surface
interaction/geometry/persistence coverage, agent reflection/collaboration and
remaining ADR requirements are not complete.

## Frozen PR182 result and Home correction successor

PR182 head85b8b227 completed full local tests 2,502/2,502, terminal exit0 with
no skips/failures; all four CI37093448880 jobs passed. It remains frozen, draft
and unmerged. Those results apply to that head only.

The successor `codex/adr-home-integration` retains those inputs and merges
Home/task correction4c6e045d (PR183). Current origin/main1100ca98 remains an
ancestor. Only ADR/task append conflicts occurred; both histories and the full
remaining delivery pipeline were retained. No product source conflicts occurred.

Home correction passed 17 focused checks, workspace/final client typechecks,
build and formatting. Its exact-head full suite and CI37094807284 are live.
Actual component screenshots and fixture limits are recorded in
`home-workspace-density.md`. The preview serves the corrected Home/task source
at5174; user web visual review and remaining native/runtime acceptance are open.

This successor must pass fresh combined focused/type/build/format/full/CI checks
before promotion. Prior green tests are not proof of this merged head or the full
ADR. No cleanup, release, deployment or main promotion has occurred.
