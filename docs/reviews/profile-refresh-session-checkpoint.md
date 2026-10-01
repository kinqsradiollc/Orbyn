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
