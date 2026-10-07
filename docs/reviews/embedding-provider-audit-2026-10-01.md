# Embedding provider and reindex audit

Status: historical audit plus current verification ledger. Independent
configuration/reindex foundations and migration256 are on main. Persistent
failure/retry checkpoint and migration257 are also merged/pushed as `d4da3d41`;
full3786/3786, focused47/47 and scoped web/mobile browser review passed.
The earlier local/pending status below records historical progression, not
current delivery. Full C1
embedding/provider acceptance remains incomplete; see the current section below.
The original defects below describe the pre-correction source, not current main.
Required by the accepted settings/provider redesign. No voice or computer-use
product feature is introduced.

## Confirmed source defects

| Issue                                                  | Evidence                                                                                                                                                                      | Required correction                                                                                                                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Embeddings use the generation connection               | `search/semantic.ts` calls `resolveAi()` for both measuring and query embeddings; `providers/resolve.ts` reads `ai_settings.provider_id`.                                     | Resolve a separately selected embedding provider. Disabling or changing generation must not redirect embeddings.                                                         |
| Consent is not bound to that connection                | `/ai/settings/semantic` stores only model and acceptance; generation/provider edits can preserve acceptance while changing the destination.                                   | Bind consent to embedding provider identity/revision, model, verified dimensions and configuration generation. Provider edits invalidate that consent until revalidated. |
| Model replacement can retain incompatible measurements | The setup route queues documents but does not delete old embeddings. The worker considers a quote current solely when its text matches; nearest search does not filter model. | Invalidate derived vectors and queue permitted pages when configuration changes. Filter every write/read by configuration generation and provenance.                     |
| Dimensions are fixed at 1,536                          | Migrations 041 and 101 create `vector(1536)`. The adapter only checks response count.                                                                                         | Verify actual dimensions, validate vectors, and support the chosen model's dimension without silently truncating it.                                                     |
| A concurrent page edit can disappear from the queue    | The worker reads content, awaits the provider, then deletes the queue row unconditionally. A newer trigger timestamp can be removed by that delete.                           | Capture queue identity and document revision; commit only the captured revision and conditionally dequeue its timestamp. Retain newer edits.                             |
| Disable/reconfigure can race an in-flight worker       | Disable deletes measurements, but the worker can subsequently insert a response generated under the former configuration.                                                     | Recheck and lock current consent/configuration before committing a batch; reject obsolete results.                                                                       |
| The enabled path lacks regression coverage             | `semantic.test.ts` exercises stock Postgres and the disabled path; it does not validate real vectors, model replacement or worker races.                                      | Add an isolated pgvector test database and deterministic provider fixtures alongside the stock-image checks.                                                             |

These are source-proven paths, not reports of observed production requests or
data disclosure. The worker races require controlled reproduction before a
correction is claimed verified.

## Implementation contract

1. Add a separate embedding provider selection, verified dimensions, provider
   revision and configuration generation to the shared API and persistent
   settings. Preserve generation provider/model fields and encrypted credentials.
   Plan credentials cannot serve backend embeddings or plugin calls.
2. A provider probe sends fixed non-personal text after explicit administrator
   consent. Reject unsupported adapters, malformed output, inconsistent dimensions,
   non-finite values and invalid response indices. Match indexed response rows
   to their input passages; do not assume an arbitrary response ordering.
3. Move vector storage to a dimension-flexible contract, retain provenance, and
   replace the recurring `ensure_vectors()` definition. Updating only the table
   would leave its unconditional HNSW creation incompatible with later migrations.
4. Reconfiguration invalidates old vectors atomically and queues currently eligible
   pages. In-flight results must pass configuration and document revision checks
   before writes. A later page edit remains queued. Search uses only current
   verified vectors and retains ownership/source visibility predicates.
5. Expose provider, model, measured dimensions, consent, indexing progress and
   failure state in Admin AI. Refresh/search model catalogs while retaining an
   explicitly entered deployment/model when discovery is unavailable. Show
   generation and embedding choices separately.
6. Existing enabled semantic configurations need a deliberate revalidation path:
   legacy consent cannot prove which provider revision received authorization.
   Retain the selected values and document content; require renewed acceptance
   before resumed provider calls. Record this behavior in the release artifact.

## Dimension and adapter evidence

pgvector supports a dimension-flexible `vector` column. Its storage and HNSW
limits differ; high-dimensional models must not be rejected merely because a
particular approximate index is unavailable. Use a supported index or exact
search and report the selected mode. Verify this against the installed extension,
not only its latest documentation. [pgvector documentation](https://github.com/pgvector/pgvector).

The OpenAI embedding contract identifies each output's input index and supports
float output. Validate the actual vector length rather than inferring dimensions
from the model's name. Azure and other adapters require their own endpoint tests.
[OpenAI embedding reference](https://developers.openai.com/api/reference/resources/embeddings/methods/create).

## Validation gates

- Stock Postgres: migration/no-extension behavior and ordinary search remain valid.
- pgvector: migration twice, later extension installation, model/provider changes,
  different dimensions, provenance filters and actual nearest-neighbor results.
- Fixtures: indexed/reordered outputs; duplicate/missing indices; wrong count;
  empty, mixed-length, non-finite and invalid numeric vectors; denied credentials;
  unsupported adapters; provider failures and bounded timeouts.
- Races: disable and provider edit during measurement; page edit while a response
  is pending; obsolete configuration cannot write or erase a newer queue entry.
- API security: unauthenticated, forbidden, malformed input, rate limits and
  version conflicts. Recheck provider visibility/enabled state after the probe.
- UI: independent saved choices, consent for the actual destination, offline
  catalog/error states, long labels and contained controls. Preview and exact-main
  integration validation remain required before a production checkpoint.

## Response validation progress

The adapter now validates finite float32-compatible, nonzero vectors; bounds
dimensions and enforces consistent/expected lengths; and restores indexed
responses to passage order. Duplicate, missing, fractional and out-of-range
indices are rejected. Position-only legacy replies retain their existing
ordering contract. Diagnostics exclude provider payloads and credentials.

All six new unit checks passed, including the actual adapter with controlled
responses. The combined provider, stock semantic-search and new validation suite
passed 15 tests, zero failed or skipped. Workspace typechecks and build passed.
These checks do not validate configuration replacement or worker races.

An isolated container `orbyn-embedding-test-20261001` now exposes a marked test
database on loopback port 55435. It uses the already present pgvector image,
extension version 0.8.3. Migrations ran twice successfully; the current application
table remains `vector(1536)`, while a direct SQL probe confirmed 3,072-dimensional
vectors are supported by this installed extension. No existing container or
production database was reset. The configuration migration is still required.

Primary main also contains `202_doc_updates.sql`, absent from the model-catalog
implementation worktree; it was preserved during integration.

## Main checkpoint evidence

The response-validation commit `54618ab` was integrated as main `cb30c13`.
The exact combined main code passed all 1,963 tests, zero failed or skipped;
workspace typechecks and the production build also passed. The backend image
`orbyn-embedding-validation:cb30c13` was rebuilt from main using its dependency
cache. With networking disabled, that image imported its compiled validation
and adapter modules and correctly restored indexed vector order.

No schema migration is included in this checkpoint. Configuration isolation,
reindex races, UI acceptance and actual provider authorization remain open.
The later Azure endpoint correction is separate local work and is not covered
by these main results.

## Azure adapter checkpoint (local)

Azure embedding calls now use the selected embedding deployment and configured
API version, with the existing API-key header. Native Anthropic connections and
Azure connections missing an API version fail before any passage is sent.
Empty batches make no provider request. OpenAI-compatible requests retain their
existing endpoint and model field.

The combined provider/stock-semantic/adapter suite passed 17 tests. Backend
typecheck and build passed. The explicit opt-in test
`backend/tests/embedding-pgvector.integration.ts` also passed against the marked
database on port 55435: a mock Azure server returned indexed vectors out of
order; the adapter restored their order, and PostgreSQL stored and cosine-ranked
3,072-dimensional vectors correctly. Duplicate response indices were rejected
without changing stored rows. The test creates only a temporary table and rolls
back its transaction; it does not change the application's fixed-dimension table.

The first database test attempt exposed eager imports loading database settings
before the asynchronous test guard. Dynamic imports after that guard corrected
the harness; the final run passed. This is adapter/storage evidence, not a live
Azure authorization test or proof of the semantic worker's reindex safety.
Independent embedding configuration and worker race protection remain open.

## Required rollout contract for independent embeddings

The migration must protect mixed-version deployments. Simply adding an embedding
provider ID while retaining `semantic_search = true` permits an older measure
process to send page text through the generation provider. The new configuration
therefore needs a separate enable flag; the legacy flag must remain false and
must be constrained against re-enablement. The API can retain its public
`semantic_search` response name while deriving it from the new flag. Old clients
must receive an explicit setup conflict rather than silently authorizing the
generation provider. Migration preserves selected metadata but requires renewed
provider-bound consent before measuring resumes.

The configuration transaction must bind provider ID, provider revision, model,
verified dimensions, acceptance actor/time and a new generation UUID. A provider
edit invalidates that revision. Setup probes use fixed non-personal text after
explicit acceptance; they must finish outside database locks, then compare the
captured settings/provider revisions before committing. Changing generation
settings cannot change the embedding destination.

Storage must accept verified dimensions without truncation. Replace
`ensure_vectors()` as part of the migration so later extension installation and
repeated migration runs produce the same schema. Persist generation and document
version with each passage. Select the index strategy explicitly; storage support
for 3,072 dimensions does not prove an HNSW `vector` index supports that size.

Workers capture the queue's complete timestamp token and document version before
calling the provider. Afterward, under a short transaction, they recheck enabled
configuration, provider revision, document revision and assistant visibility.
Writes and queue acknowledgement must be conditional on those captured values.
A newer edit stays queued; a disable or provider/configuration replacement
cannot be undone by an old response. Search filters by current generation and
current document version and preserves existing read-access restrictions.

Acceptance requires both stock-Postgres and pgvector upgrade paths, repeated
migrations, extension installation after initial deployment, provider/model and
dimension replacement, generation-provider independence, consent invalidation,
document edits during provider calls, disable during provider calls, malformed
responses, and permission changes. Admin and client controls need explicit
provider/model selection, validation status, consent destination and reindex
progress. This contract is an implementation requirement, not completed evidence.

## Azure checkpoint on main

Azure adapter commit `c1e7cc6` was integrated as `4db8089`. Main's full rerun
passed 1,965 tests, zero failed or skipped. Workspace typechecks and production
build passed. The image `orbyn-azure-embeddings:4db8089` rebuilt successfully;
with networking disabled, its compiled adapter rejected an unsupported format
before making a provider request. Main's explicit pgvector adapter/storage test
also passed against the marked database on port 55435.

The first full run failed in the Node test runner with "Unable to deserialize
cloned data" for `doc-editing.test.ts`; it reported 1,948 passing tests and one
file failure. That file passed all 39 checks on its isolated rerun, followed by
the complete successful 1,965-test rerun. No failed run is counted as passing.

Independent configuration, the schema/worker foundation and client controls are
separate local work and are not included in these main validation results.

## Current main integration candidate — 3 October 2026

The preserved independent configuration/schema/worker/client implementation has
been extracted onto main3ee0fa16 in codex/embedding-settings-state. Migration218
replaces the candidate's old203 number. Historical candidate checks above are
not substituted for current qualification. Current pgvector21, stock17 and two
separate late-install/legacy-upgrade checks pass; full/CI and actual provider/UI
acceptance remain open. Evidence and limits are recorded in
`evidence/independent-embedding-main-integration.md`.

## Current reviewed-destination consent correction — 8 October 2026

Source audit reproduced a remaining pre-click race: settings generation did not
change when the selected provider changed, and setup carried no reviewed provider
revision. A request based on the earlier recipient was accepted with HTTP200.
The disposable local-fixture reproduction passed5/6 and failed the new invariant;
log `/tmp/orbyn-c1-embedding-consent-before-20261008.log`.

Candidate `d4cd4273` exposes the independent embedding revision to admins and
requires `expected_provider_revision` before any validation probe. Missing/stale
values return409; refreshed explicit consent can validate. The post-network
revision and settings-generation checks remain. No migration or private ChatGPT
credential use is introduced. Old clients must reload the updated setup before
turning semantic search on; turning it off remains available.

Both clients send the displayed embedding revision, clear acceptance when its
revision/enable state changes and disable setup if the server supplies no token.
Generation control revisions remain separate. Callback tests cover exact request,
consent reset and missing-token disabled controls.

| Requirement                            | Current evidence                                                                                                                                     | Remaining                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Independent provider/model and consent | Local HTTP fixtures cover generation independence, explicit acceptance, pre-click and in-flight revision changes, A→B→A, renewed consent             | Real authorized embedding account and live provider matrix             |
| Reindex and vector provenance          | Application pgvector tests cover3072 dimensions, replacement cleanup/requeue, old document/configuration results discarded, queue revision preserved | Larger operational/native matrix                                       |
| Visibility                             | Project/team keep-out tests block later batches and storage; nearest retains readable-document predicates                                            | Complete permission/ownership race matrix                              |
| Response/storage                       | Indexed Azure local fixture stores/ranks3072 vectors; malformed/zero/dimension checks retained                                                       | Live Azure/OpenAI/other adapters                                       |
| Stock database                         | Corrected stock search/client suite20/20, zero skips                                                                                                 | Wider enabled/error/native matrix                                      |
| Current focused regression             | pgvector cohort48 passed, zero failed; one stock-only test skipped and independently passed on stock                                                 | Wider enabled/error/native matrix                                      |
| Client visuals                         | Capture-only task sent to Orbyn Visual Check for web/narrow/mobile OFF prerequisites                                                                 | Root must inspect returned originals; enabled/error/native states open |

Logs: `/tmp/orbyn-c1-embedding-consent-final-20261008.log`,
`/tmp/orbyn-c1-embedding-stock-corrected-20261008.log`.
Shared/backend builds and desktop/mobile types pass. API8008 is healthy with the
compiled candidate; preview provider settings/credentials/consent are unchanged.
No inference or real-provider probe was run for this correction.

The initial stock/full commands used the wrong container database username.
Stock result16/17 failed authentication; the owned full process tree was stopped.
Neither is accepted evidence. The corrected full run uses fresh marked stock DB
`orbyn_c1_consent_20261008_test`, session87929, log
`/tmp/orbyn-c1-embedding-consent-full-corrected-20261008.log`.
Source is frozen at candidate `d4cd4273`; documentation may advance separately.
The corrected frozen full regression completed3781/3781, zero failures,
cancellations or skips, exit0,900795ms (terminal session87929). Later commits
change documentation only. QA022 web wide/narrow and mobile320/390 OFF controls were inspected and
contained. Web production build passes. Merged and pushed as43fa8f57; wholeC1 completion remains unclaimed.

### Additional rollout checks — 8 October 2026

Pre218 legacy-consent upgrade passes1/1 on a fresh marked pgvector fixture;
late extension installation passes1/1 against a migrated stock17 fixture restored
into the dedicated vector16 database. Both use current frozen source; each runs
migrations twice. Consent remains off, migration history is retained and existing
pages are queued with dimension-flexible storage. The restore removes only PG17's
unsupported `SET transaction_timeout = 0` for the PG16 fixture. No production or
preview data is used. Logs:
`/tmp/orbyn-c1-embedding-upgrade-20261008.log` and
`/tmp/orbyn-c1-embedding-late-corrected-20261008.log`.
The first late-install attempt used an empty database rather than the required
restored fixture and failed on missing `docs`; it is not accepted evidence.

### Remaining C1 embedding acceptance requirements

At the consent checkpoint on main, the measuring loop logs provider failures but Admin shows heartbeat
and queue counts only. A healthy heartbeat and pending count do not prove
successful indexing. The retained contract requires a truthful failure state;
trace and qualify persistent, sanitized failure/retry reporting after this consent
checkpoint is merged. Do not substitute running heartbeat for successful work.

The live embedding provider matrix, enabled/error visual states, wider ownership
and permission races, installed-native behavior and permitted OpenAI cache
benchmark remain required. Existing local fixture and browser results do not
complete those gates. Continue C1 in order before C2/M1.

### Failure/retry checkpoint implementation order

After reviewed-destination consent is promoted:

1. Reproduce one failed queued page followed by a healthy page with deterministic
   local provider replies. Current `measureQueued` propagates the first provider
   failure, aborting the page loop; `runMeasurer` catches it and waits60seconds.
   No persisted failure, retry due time or per-page failure count is exposed.
2. Persist only bounded, sanitized failure categories, attempt count and retry due
   time bound to queue revision and embedding generation. Do not store passage
   text, credentials or raw provider errors. A later document/configuration change
   must invalidate the prior retry result; disabled/kept-out pages remain excluded.
3. Keep a failed page queued, schedule bounded backoff and permit healthy later
   pages to proceed. Recheck consent/provider/document/visibility before every
   request and every failure/success acknowledgement. No automatic retargeting.
4. Expose truthful failed/waiting/indexed counts and retry information to admins
   on both clients. Distinguish worker liveness from successful indexing. Confirm
   turn-off/revalidation behavior and retain word-search fallback.
5. Qualify failure→retry→success, poison-page isolation, provider/configuration
   changes, new page edits, keep-out/revocation and process restart; repeat stock,
   pgvector and late-install/mixed-version gates where schema changes require it.
   Route all web/mobile screenshots through Orbyn Visual Check; root owns review.

This ordered checkpoint was implemented in qualification freeze `d77c1b76`,
with focused47/47 and stock/upgrade/late-install checks passing. Subsequent
qualification completed full3786/3786 and scoped browser acceptance, then
promoted as `d4da3d41`. See the C1 acceptance ledger for the exact frozen source,
logs and capture boundaries; wider live/native acceptance remains open.
Current consent checkpoint source remains frozen; regression87929 completed successfully.

### Preview harness correction

The first mobile capture showed offline/provider-load errors. Root verified local
API health200 but cross-origin OPTIONS404: the API restart preserved singular
`CORS_ORIGIN`, while the canonical environment key is `CORS_ORIGINS`.
The preview-only process was restarted as PID60704 with the actual web5174 and
mobile8083 origins; the same database, credentials/settings and compiled source
were preserved. Read-only preflight now returns204 with the matching allowed
origin. No product source or production environment change was required.
Original offline images remain harness evidence; refreshed mobile controls were
inspected by root and accepted for containment at320/390 CSS widths.

Capture-only manifest: `/Users/anhdang/.codex/visualizations/2026/10/07/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/QA-022-search-by-meaning-capture-manifest.md`.
Root inspected all accepted web/mobile originals; agent design findings are not
used as acceptance. Enabled/error/native and whole-page quality remain open.
Web production build log: `/tmp/orbyn-c1-embedding-web-build-20261008.log` (exit0).

Main delivery: `43fa8f57` includes the reviewed-revision fix and qualification docs.
No production deployment is verified. Continue failure/retry checkpoint next.
