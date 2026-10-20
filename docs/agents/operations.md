# Architecture and operations

Read current source and deployment configuration before using historical service
names, defaults or incident reports. Keep runtime changes within the user's
requested environment and delivery scope. Repository changes are not deployment.

## Locate the owning contract

| Concern | Source |
| --- | --- |
| Environment parsing | `backend/src/config/env.ts` |
| Authorization | `packages/core/src/rbac.ts` |
| Data/API design | `docs/architecture.md`, `docs/api.md` |
| Deployment | `docs/deployment.md`, `deploy/` |
| Scale and queues | `docs/scalability.md` and the owning worker |
| Request diagnostics | `backend/src/lib/request-log.ts` |
| Record retention | `backend/src/lib/sweep.ts` |
| Imports | `packages/core/src/imports.ts`, `backend/src/modules/imports/` |
| Legal/privacy copy | `packages/core/src/legal.ts` |

Trace service boundaries, persistence, retry/idempotency rules and recovery before
changing APIs, jobs or connectors. Keep secrets out of logs, screenshots and
reports. Capture non-secret request IDs and failure reasons where available.
Adding a growing table requires an explicit retention plan, not an unrelated
periodic delete job. Preserve migration ordering and existing advisory locking.

## Operational boundaries

- Inspect environment examples and schemas; preserve local credentials/config.
  Do not run production migrations, change infrastructure or restart services
  without applicable authorization. Do not connect checks to a normal user DB.
  Authorized database tests follow [development](development.md).
- Match mocks and fixtures to their actual claim. A simulated provider response
  is not live-provider evidence; a local build is not deployment or OAuth renewal.
- Keep assets first-party and respect analytics opt-out. New personal-data
  collection or third-party sharing needs matching privacy text and appropriate
  consent. Admin visibility must not expose file contents or credentials.
- Inspect import storage/expiry and the cheapest extraction path first. Preserve
  source provenance and flag uncertain equations. Do not build heavy `formula`
  or `ocr` images locally. Optional provider engines stay optional.
- Preserve user approvals for assistant proposals, study edits and revision plans.
  A workflow document cannot authorize externally visible messages or publication.
- For packaged-app or native investigation, read [tooling](tooling.md). Copying
  REA source does not install its engines, register MCP or authorize target runs.

Record what was changed, the commands actually run, remaining manual checks,
rollback/recovery considerations and exact delivery state. Report denied actions
rather than bypassing host restrictions.
