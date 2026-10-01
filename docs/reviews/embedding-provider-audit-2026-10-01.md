# Embedding provider and reindex audit

Status: source audit and implementation contract; response validation integrated
into main, configuration/reindex corrections incomplete.
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
