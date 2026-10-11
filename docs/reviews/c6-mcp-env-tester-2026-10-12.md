# C6 MCP environment Tester receipt — 12 October 2026

**Candidate:** `b636deb9e17972146280246746d7a26b6e1493ea`

**Checkout:** `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`

**Branch:** `codex/c6-file-viewer`

**Review cycle:** round 2/3; bounded environment retest, not a new full review round
**Scope:** frozen `.env.example` candidate and its Compose/deploy preflight behavior.

## Results

| Check | Result |
| --- | --- |
| `node scripts/check-env-examples.mjs` | Exit 0 — environment templates cover 131 backend/Compose variables and both clients. |
| `docker compose --env-file "$fixture" config --quiet` with the example default (`MCP_WORKSPACE_AI_ENABLED=false`) | Exit 0. |
| `ENV_FILE="$fixture" ./scripts/deploy.sh --check` with the example default | Exit 0; `Preflight: OK`, and the plan leaves integration auxiliaries disabled. |
| The same Compose config check with `MCP_WORKSPACE_AI_ENABLED=true` and `COMPOSE_PROFILES=plugin` | Exit 0. |
| The same deploy preflight with the enabled-worker fixture | Exit 0; `Preflight: OK`, and the plan includes rolling out the isolated MCP integration worker. |

The Compose and deploy checks used temporary copies of `.env.example`. Only
those disposable fixtures received dummy `SECRETS_KEY`, `POSTGRES_PASSWORD`,
and 32-plus-character `DOC_PDF_KEY` values required by configuration/preflight
validation. The private `.env.production` was not used as input. Preflight
reported the expected template-only warnings for remaining `TODO`/`change-me`
values and an unset optional `FILES_SECRET`; neither prevented validation.

## Redacted private-configuration receipt

A read-only parser of the primary checkout's ignored `.env.production` printed
no values. It confirmed that the file is present, `MCP_WORKSPACE_AI_ENABLED`
has one active assignment set to `true`, the canonical MCP URL matches the
example, the legacy plugin recipient is nonempty and distinct, and the
`plugin` Compose profile is enabled. Builder's separate before/after parity
record claims that only the flag value changed; this Tester check confirms the
current redacted invariants and does not independently establish that private
file's full before/after equality.

## Limits and disposition

Candidate source/runtime remained unchanged; the commit changes only
`.env.example`. `--check` and `docker compose config --quiet` did not start
services, apply a deployment, or access a database. No test suite, build,
browser check, security scan, or live inference was run. The requested
configuration checks passed; this receipt does not qualify runtime behavior or
production deployment.
