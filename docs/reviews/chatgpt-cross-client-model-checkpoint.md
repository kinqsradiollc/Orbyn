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

## Mobile parity gate

The user explicitly requires every shipped web/desktop feature on mobile. The
current source implements these settings operations in both clients; this table
does not substitute for interaction acceptance.

| Operation                                                        | Web implementation                                                             | Native mobile implementation                                          | Current acceptance                                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Discover owned devices and choose one explicitly                 | `ChatgptRemoteModels` custom device select                                     | `ChatgptModelsSection` contained device radio list                    | Route guards, owner fences and actual handler tests pass; visual/touch gates open.          |
| Search the complete catalog                                      | Name/ID filter and custom model select                                         | Name/ID filter; at most 50 rendered rows, search reaches later models | Both handler trees exercised; keyboard/large-text proof open.                               |
| Save or clear the bound default                                  | Model select includes no-default choice                                        | Model rows plus clear-default action                                  | Shared CAS/controller tests pass; real eligible account and actual native interaction open. |
| Handle expiry, offline devices, failed saves and account changes | Shared controller plus web lifecycle hook                                      | Same controller plus native lifecycle hook                            | Timeout/expiry/cancellation/StrictMode tests pass; live device acceptance open.             |
| Connect a new ChatGPT account                                    | Desktop private OAuth runtime; website eligibility gated                       | Native callback/storage flow still incomplete                         | Required parity gap; not a shipped complete feature.                                        |
| Start assistant execution with the chosen account/model          | Private runtime has controlled inference tests; composer/job wiring incomplete | Native execution/composer delivery incomplete                         | Required parity gap; catalog/default settings do not prove execution.                       |

Native entry is Settings → AI connections & models and the shared settings search
destination. Both actual root settings components mount their respective model
controls. The desktop native runtime rereads the persisted default before each
new turn; a running turn retains its captured model. These source checks and
test fixtures do not prove a real provider connection on any platform.

## Evidence

The first full run on `acc5c59` finished with 2,097/2,099 passing, two failures
and no skipped tests (`/tmp/orbyn-chatgpt-remote-full-tests.log`). The private
device-discovery route lacked its required capability exclusion, and the phone
settings inventory fixture did not include the newly mounted child section.
Commit `24419a9` corrects both. Its 37 focused inventory/UI tests passed with no
failures or skips (`/tmp/orbyn-chatgpt-remote-inventory-tests.log`). A fresh full
run on frozen source `24419a9` stopped with exit 7 during host disk exhaustion,
before the terminal TAP totals (`/tmp/orbyn-chatgpt-remote-24419a9-full-tests.log`).
The independent QA API also reported `ENOSPC`. Neither run is acceptance. The
temporary task-owned simulator was shut down and deleted, recovering about
1.6 GiB. PostgreSQL and Docker became unresponsive; no shared Docker restart or
unrelated container/volume deletion was attempted. Full-suite acceptance needs
a fresh marked database and terminal passing totals after environment recovery.
After external recovery, the test container is healthy and available disk is
about 8.1 GiB. No agent Docker restart was performed. Frozen source `24419a9` is
now rerunning against fresh marked `orbyn_models_24419a9_full_test`, log
`/tmp/orbyn-chatgpt-remote-24419a9-recovered-full-tests.log`; acceptance is pending.

The production backend Docker image `orbyn-chatgpt-remote:24419a9` built
successfully, log `/tmp/orbyn-chatgpt-remote-24419a9-docker-build.log`.
The earlier `acc5c59` compiled smoke passed actual schema, signed-out controller,
401 route and malformed-JSON 400 checks; that smoke does not cover the newer
capability exclusion. Its exact `24419a9` replacement also passed strict schema,
capability exclusion, signed-out 401/no-store and malformed-JSON 400 checks with
an actual completion marker (`/tmp/orbyn-chatgpt-remote-24419a9-docker-smoke.log`).
Image/build evidence is separate from native UI evidence.

After the environment failure, all 48 checks that run without Docker passed on
`24419a9`, with no failures/skips: shared remote store, actual cross-client
hooks/handler trees, private model runtime, picker, API catalog client and
settings layout. Log: `/tmp/orbyn-chatgpt-remote-24419a9-unit-tests.log`. No DB
integration or full-suite result is inferred from this independent run.

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

Disk space temporarily fell below 300 MiB, then recovered to about 7 GiB.
Five completed task-owned test logs were losslessly gzip archived, with original
paths retained as pointer files. No unrelated worktree, dependency, Docker volume
or cache was deleted. A new task-owned iPhone 17 simulator, fresh marked database
`orbyn_mobile_models_24419a9_test` and loopback API at 8027/Metro at 8087 were
used for native verification. Metro's IPv6 bind versus manifest mismatch was
resolved with its advertised localhost hostname. The native authentication
screen rendered; the settings flow was not reached. Host disk exhaustion then
stopped the isolated API. The temporary simulator was deleted and the task-owned
Metro stopped; about 1.6 GiB recovered. Preserve the QA database and logs until
Docker recovers. Existing character-worktree previews at
8018/8083 are preserved and are not evidence for this source. Native settings
interaction and actual provider-account acceptance are still pending.
