# ChatGPT model management across clients — local checkpoint

## Implemented behavior

Web and mobile now discover this person's enrolled ChatGPT devices through a
first-party metadata endpoint. Discovery returns only executor, connection and
host identifiers, excludes revoked connections and expired device sessions,
requires a live verified Orbyn session, rejects agent/API principals and applies
rate limits. No provider token, signing key, session identifier or user-agent/IP
is returned.

Both settings surfaces use the same API-client controller. The person explicitly
chooses a device; the controller reads its live `/models` catalog and saves the
exact account-bound preference version. Search covers the catalog; native model
rows are capped at 50 with search reaching later results. Offline, stale,
expired and unavailable devices cannot authorize a model. Failed saves discard
the observed revision until refresh. No paid/provider/model fallback is selected.
The shared settings index now exposes the ChatGPT destination on mobile.

The controller cancels old operations and fences results across session changes,
device changes and unmount. Reads/writes have a 30-second UI lifetime even when a
transport ignores cancellation. The earliest catalog/lease expiry updates model
availability without another API read; suspended timers cannot permit a save.
Both app hooks hide old data before account-change effects run and recreate their
controllers during React StrictMode setup/cleanup/setup.

The desktop private executor refreshes the saved preference before a new turn,
so a default changed on web/mobile is used without waiting for its periodic
catalog refresh. Completed preference reads update the desktop picker. A running
turn retains its captured model. Foreign, stale or failed preference reads prevent
inference instead of falling back to cached state. Concurrent fresh reads converge
on the same bound preference.

## Evidence

Frozen source for this checkpoint passed 69 focused checks and workspace
core/API/backend/web/mobile typechecks. The focused set includes real route and
service guards, strict fresh API-client parsing, controller races/timeouts/expiry,
actual app hook lifecycle callbacks and actual UI handler trees with mocked
platform/control islands, private inference with controlled transport and the
existing settings navigation tests. These VM/handler tests are not visual proof.
Logs: `/tmp/orbyn-chatgpt-remote-final-focused.log` and
`/tmp/orbyn-chatgpt-remote-types.log`.

The web production build and native iOS/Android Metro exports passed. Logs:
`/tmp/orbyn-chatgpt-remote-web-build.log` and
`/tmp/orbyn-chatgpt-remote-native-export.log`. Native metadata SHA-256:
`87fd0415aea647fd40d28fc9036be89ab972bf36eeb6924d724d8c1d09388a62`.
Web index SHA-256:
`11d72222f6ba474d1e267374456bebe316970359086cbc44c861025375e559f4`.
The shared Friday exam fixture correction was brought from main; its actual
integration suite passed 21/21, log `/tmp/orbyn-chatgpt-remote-nudge-tests.log`.

Earlier attempts exposed extra host metadata passed to a strict selection schema,
an incorrect malformed-GET-body expectation, a preview consumer requiring a
backward-compatible empty owner prop, and the older settings fixture that excluded
mobile. These were corrected and the full focused set rerun. Passing portions of
failed attempts were not substituted for the final set.

## Remaining acceptance and scope

This is local source, not main integration, deployment or a completed A1 feature.
The full local suite and exact-main integration must pass before promotion.
Responsive web preview remains blocked by its saved Browser Use permission;
actual native interaction and large-text/keyboard/overlay acceptance remain open.
Native bundles do not prove touch behavior. New native ChatGPT sign-in remains a
required mobile deliverable, with platform/eligibility constraints retained as
release gates. The UI accurately explains the current desktop connection path.

Real eligible-account catalog/default/inference acceptance, signed job assignment
and results, composer routing, and complete device executor delivery remain open.
This metadata/default feature does not itself start an assistant job or prove
mobile sign-in. Settings redesign and the wider ADR remain incomplete.

Disk space fell below 300 MiB after verification. The new generated web/native
outputs occupy approximately 34 MiB, so they do not explain the wider space drop.
No unrelated worktree, dependency, Docker volume or cache was deleted. Additional
large image builds need sufficient space; current results remain scoped to the
source and outputs named above.
