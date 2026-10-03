# Independent embedding integration on current main

## Implementation

Extracts preserved commits3cc85189/2076d07c/6b0af63a/bcae4297/940af290
onto current main3ee0fa16 without the broader draft lineage. Migration218 avoids
number collisions. Legacy semantic_search is constrained false; new explicit
provider-bound consent, provider revision, dimensions and generation own all
embedding work. Provider validation uses fixed non-personal text outside locks,
then compares current settings/provider revisions before committing.

Worker batches and final writes recheck configuration, document version, queue
revision and current AI visibility. Search requires current generation/version.
Exact cosine storage supports verified dimensions without truncation; no claimed
HNSW support for large vectors. Provider edits invalidate validation. Both clients
select independent provider/model, reset acceptance on changes, show verified
dimensions and indexed/pending counts. Native readiness text wraps beside icons.

## Current evidence

- Current pgvector schema/setup/client controls21/21 terminalexit0:
  `/tmp/orbyn-embedding-current-final-focused.log`. Uses mocked provider transport
  and real PostgreSQL/HTTP routes, including401/403/400/429 and races.
- Stock PostgreSQL semantic/provider/vector adapter17/17 terminalexit0:
  `/tmp/orbyn-embedding-stock-correct-focused.log`.
- Stock fixture restored onto pgvector, late extension/backfill1/1 terminalexit0:
  `/tmp/orbyn-embedding-late-current.log`; retains recorded migrations and no consent.
- Real pre218 migrations with legacy consent and1536-dimensional vector, then
  upgrade/repeat1/1 terminalexit0: `/tmp/orbyn-embedding-legacy-upgrade.log`.
  Legacy consent cleared, model metadata retained, unproven vectors removed and
  stale legacy workers cannot re-enable or overwrite new storage.
- All workspace types, production build and owned-file formatting pass, including
  final types after integration guard and regression changes.
- Full current-head local tests and CI still required before promotion.

## Remaining acceptance

Actual authorized provider probes, model discovery/manual-entry usability,
production-scale exact-search performance, signed-in web/native/Android controls
and complete C1–C6/M1/D1/U1 remain open. No deployment, credentials in artifacts,
Docker engine restart or worktree cleanup. Existing user preview files preserved.
