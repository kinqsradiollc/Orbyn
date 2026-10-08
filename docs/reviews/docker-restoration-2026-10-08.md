# Docker restoration and Orbyn container cleanup

8 October 2026. The user authorized restoring Docker and removing unused Orbyn
containers. This is local infrastructure recovery, not production deployment or
completion of C1.

## Verified outcome

| Item | Evidence |
| --- | --- |
| Docker engine | Docker 29.7.2 reports ready after recovery |
| Unused containers | 21 old stopped Orbyn containers removed by verified IDs, without force |
| Persistent data | All four volumes attached to removed containers verified present before/after; no volumes or images deleted |
| Unrelated containers | Three containers from another project retained |
| Qualification fixtures | Current stock PostgreSQL and pgvector fixtures retained; stock fixture recreated with original settings |
| Preview database | Disposable orbyn_ui_preview recreated; migrations exit 0 |
| QA account/API | Health 200, registration 201, authenticated profile 200, admin role; credentials remain in the private local QA file |
| ADR candidate | Clean d672fc50 unchanged; 31 focused checks, desktop types and web build pass |

## Recovery sequence

The normal `docker desktop restart --timeout 45` failed because its processes did
not stop. Only revalidated Docker Desktop application processes received SIGTERM;
the remaining hung backend process received SIGKILL. Docker Desktop reopened and
its engine reported ready.

The retained stock test fixture then exited on an empty stale PostgreSQL socket
lock. Its database is tmpfs, with no persistent/writable mounts. Recreating only
that disposable fixture with its original image, environment, read-only init
script and localhost55436 binding restored PostgreSQL readiness. The temporary
preview data was lost; migrations and the same approved disposable admin were
recreated. No historical usage fixtures were reseeded.

The API's restart guard refused an executable-path mismatch before changing its
process. The original API process 18378 subsequently recovered after database reconnect;
health returned 200. No API restart was required.

## Removed containers

- orbyn-embedding-test-20261001
- orbyn-gateway-1
- orbyn-desktop-7, orbyn-desktop-8
- orbyn-converter-1
- orbyn-files-1
- orbyn-notifier-4
- orbyn-status-4
- orbyn-realtime-1, orbyn-realtime-2
- orbyn-ai-7, orbyn-ai-8
- orbyn-mcp-1, orbyn-mcp-2
- orbyn-api-7, orbyn-api-8
- orbyn-pgbouncer-1
- orbyn-postgres-1
- orbyn-postgres-test-1
- orbyn-migrate-1
- orbyn-mailpit-1

Retained fixtures: orbyn-adr-qualification-20261007 and
orbyn-c1-embedding-20261008. The latter remains stopped until its embedding tests
need it. The removed Compose containers can be recreated using Compose with
their retained volumes.

## Receipts and outstanding acceptance

Private local metadata receipts contain no printed environment credentials:
`/tmp/orbyn-docker-cleanup-inventory-20261008.json`,
`/tmp/orbyn-docker-cleanup-receipt-20261008.json`, and
`/tmp/orbyn-c1-preview-docker-recovery-account-20261008.json`.

Fresh full d672fc50 regression completed4262/4262, exit0, signal:null, zero
failures/skips/cancellations,794219ms, in its own marked test database:
`/tmp/orbyn-c1-settings-escape-full-20261008.log`. Orbyn Visual Check is assigned to
resume QA-030 using fresh sign-in and the unchanged candidate. That resumed
internal-browser recheck now accepts the scoped Escape/Close correction and
normal-scale containment/help spot-checks; root reviewed the delegated report.
The qualified Settings product is merged as7260db93. Remaining C1 acceptance
is still open.
Earlier38558c8a4260/4260 is not a full-suite result from d672fc50.
