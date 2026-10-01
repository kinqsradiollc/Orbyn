# Session-bound profile refresh checkpoint

Both planner hooks now capture the active session before a manual profile refresh.
They discard late profiles and errors after logout or account switch. Session
reset, adoption and authentication paths update the session ref synchronously so
late promises cannot exploit the gap before the next React render.

Twelve semantic source-control checks passed, exercising the actual callbacks
extracted from both hooks: current profile, logout, account switch, stale error,
current error and signed-out refresh. Workspace typecheck and diff checks passed.
Evidence: `/tmp/orbyn-profile-refresh-session-tests.log` and
`/tmp/orbyn-profile-refresh-session-types.log`.

These are callback/session checks, not browser or native interaction proof. The
broader settings/Docs web build passed before this hook change
(`/tmp/orbyn-settings-docs-web-build.log`); that build is not post-change evidence.
Visual review, other mutation callbacks, account-switch cache handling and the
broader UI synchronization audit remain open. This checkpoint does not establish
that every profile or session race is fixed.

Web's storage-session callback now clears root account data before adopting a
different tab's token: profile, items, notices, teams, maintenance and error.
It invalidates pending refresh sequences and the cached planner snapshot so
matching new data can repopulate the cleared screen. Logout also invalidates
the sequence and snapshot. Three additional checks execute the actual storage
callback and cover changed session, unchanged session and logout delegation.
Together with profile checks, 15/15 passed and workspace typecheck passed.
Evidence: `/tmp/orbyn-session-tab-data-tests.log` and
`/tmp/orbyn-session-tab-data-types.log`. Nested view caches and other mutation
callbacks remain outside this checkpoint's proof scope.

Both mutation wrappers now capture their starting session and ignore a late
error after it changes. Mobile also checks the session before resetting UI after
its asynchronous unauthorized-session cleanup. Current-session error handling is
preserved. Eight actual-callback checks cover 401/503 with and without a session
switch; together with earlier guards, 23/23 passed and workspace typecheck passed.
Evidence: `/tmp/orbyn-mutation-session-error-tests.log` and
`/tmp/orbyn-mutation-session-error-types.log`. Busy-state ownership, successful
mutation setters, persisted-session storage races and nested caches remain open.
This local checkpoint must not be conflated with the active main full-suite run,
which predates these changes.

The web email-reminder preference mutation now captures its session and discards
late successful profile responses after logout or account switch. Four additional
actual-callback checks cover current, changed and signed-out sessions. Combined
session checks passed 27/27 and workspace typecheck passed. Evidence:
`/tmp/orbyn-preference-session-tests.log` and
`/tmp/orbyn-preference-session-types.log`. Other successful mutation setters and
busy-state ownership remain open; these checks do not prove visual behavior.
