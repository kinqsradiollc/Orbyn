# ChatGPT desktop runtime checkpoint

## Implemented

- Electron main process owns browser authorization, loopback callbacks, encrypted credential storage, refresh, disconnect and executor signing keys.
- Returning authorization preserves the issued client and host identity. Refresh is serialized across resolvers; revocation failure is reported after local disconnect.
- Model catalogs and versioned defaults are bound to the verified Orbyn user, ChatGPT connection and selected registration. Switching accounts stops the previous executor and fences late results.
- A guarded main-window bridge accepts typed connection commands. Provider tokens, private keys and raw provider errors are excluded from renderer metadata. First-party Orbyn session initialization uses a separate channel.
- The renderer store handles account changes, out-of-order events, cancellation and unconfirmed remote revocation. It is shared by settings and future composer integration.
- Native build configuration comes from the build's absolute `VITE_API_URL`, defaulting to `http://localhost:8008`. Relative web proxy URLs require a separate native build with an absolute API URL.

## Evidence

The focused connection suite passed all 147 tests, including offline-default preservation and identity-only consent. The full model-worktree suite passed all 1,942 tests against its disposable database. Workspace typechecks and the production build passed. Main integration requires its own validation because it also contains concurrent CRDT work.

The runtime was integrated on main as `d9bfb50`. That exact combined code passed all 1,957 repository tests against the disposable test database, workspace typechecks and the production build. The separate settings UI changes and its startup-retry refinement remain local work awaiting preview verification.

An unsigned macOS arm64 directory package was produced. Its own Electron binary successfully imported the archived core schemas, API client, identity verifier and private manager. The first packaging attempt exposed a locally missing `jose` installation: Node had resolved it from a parent directory, while the packager omitted it. Installing the already-declared dependency inside this checkout corrected the package. A clean dependency installation remains required for release builds.

Tests use fake provider responses and disposable local data. They do not establish successful authorization with a real eligible ChatGPT account, native UI behavior, Windows/Linux packaging, or plan inference.

## Remaining acceptance

- Settings connection controls are implemented locally but visual inspection is blocked by declined browser preview permission. They remain outside this runtime checkpoint until preview verification is allowed and passes.
- Complete the credential-owning inference/job runner, capability receipts and composer wiring. Catalog access alone does not provide assistant responses.
- Expose and verify device availability and model/default controls for web and mobile.
- Verify real account authorization, cancel/reconnect/restart, native secure storage and provider responses through the shipped UI.
- Complete the wider web/settings redesign, provider inventory UX and separate embedding configuration with safe reindexing.

The overall ADR remains active. This checkpoint does not complete M1 or the web redesign.
