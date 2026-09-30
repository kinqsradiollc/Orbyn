# Docker build repair — 30 September 2026

## Failure and cause

The server's build of `7f81aaf` failed with TS2307 for `@orbyn/api-client` in `reminder-actions.ts`, followed by inferred-parameter errors. Local monorepo builds had already compiled the API client; the backend Docker build copied and compiled only core and backend. The reminder-action module imports executable code from the API client, so this is also a production runtime dependency.

## Repair

- Backend image explicitly installs, copies and compiles the API client after core and before backend.
- Production dependency installation includes the API client, and the final image contains its manifest and compiled distribution.
- Backend manifest and lockfile classify the API client as a runtime dependency.
- Docker context excludes the local cleanup recovery directory.

## Verification

- Removed the old disposable test PostgreSQL container and recreated it. Its data is tmpfs; the recreated database had zero public tables and the required test marker. Removed the stopped obsolete planning test container as well. Application database containers and data were retained.
- Final backend and desktop images built with `docker build --no-cache` successfully. The PostgreSQL test service uses the stock `postgres:17-alpine` image and has no Dockerfile to compile.
- The production backend image imported both `@orbyn/api-client` and the compiled reminder-action module successfully.
- Container migration applied to a separate empty disposable database, creating 145 public tables including `assistant_action_receipts`; rerunning migrations succeeded.
- Rebuilt production API image returned successful `/health` and `/live`; rebuilt web image returned HTTP 200.
- Root typechecks, iOS/Android exports, JSON formatting and Git whitespace checks passed.
- Full backend suite using IPv4: **1,726 passed, zero failures and zero skips**, 458.5 seconds.

The initial full-suite attempt stalled on an IPv6 loopback connection whose local and remote address were both `[::1]:55434`, with no active database query. It was interrupted and rerun with `TEST_DATABASE_URL` pointing at `127.0.0.1`, matching the test container port binding. The interrupted run is not counted as a pass.

Container checks ran locally on Linux ARM64. No server deployment, production migration, real provider, SMTP or OS push delivery was performed. Native UI evidence remains in the R1–R10 verification artifact; this packaging repair did not change UI behavior.
