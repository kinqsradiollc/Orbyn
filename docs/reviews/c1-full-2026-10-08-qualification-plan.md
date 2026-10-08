# Current scope override — 8 October 2026

The user explicitly removed iOS builds and Android-specific verification. Do not
execute or require native iOS/Android packaging, device installation or Android
interaction jobs from the historical plan below. Missing native mobile capacity,
watchOS runtime and Android execution targets no longer block C1. Preserve shared
mobile source/type checks and mobile-browser acceptance. Follow the compact
`AGENT.md` and linked role/workflow guides. Live OpenAI/cache and accepted live embedding measurements are user-approved
follow-ups; use the existing Matilda baseline and deterministic/runtime receipts
for C1 without fabricating vendor/cost results. Counter remains1/3, not the historical
0/3 below. Wait for the consolidated complete candidate handoff.

# Full C1 qualification plan

Prepared 8 October 2026 by Orbyn Tester. Cycle: `C1-full-2026-10-08`.
Status: preparation only; implementation ongoing, review counter **0/3**.
No formal tests, database changes or vendor requests executed for this plan.

## Contract and candidate admission

Authority: `AGENT.md`, `checkpoint-workflow.md`, `adr-execution-order.md`,
the C1 completion table in `adr-current-state.md`, the retained ADR in
`devday-2026-implementation-review.md` (A2/A3 and independent embeddings),
and `embedding-provider-audit-2026-10-01.md`. Historical receipts in
`c1-acceptance-ledger.md` remain evidence for their own sources only.

Builder's announced implementation checkout is
`/Users/anhdang/.codex/worktrees/c1-perplexity-embeddings/Orbyn`, branch
`codex/c1-full-completion`. Its final commit is **pending**. This plan was
prepared from primary checkout `main` at
`4735e714d296bb2ca5b50bc5124b13709d704c16`; that is not the candidate.

Before execution, obtain the exact committed full candidate, changed-file list,
complete requirement/evidence matrix, run instructions, preview source mapping,
known gaps, database ownership and sole write owner. Check checkout, branch,
HEAD and dirty files; preserve unrelated local work. Re-read candidate-local
instructions, scripts and fixtures. Freeze application/test source through the
run. Arrange exclusive fixture/run ownership with Builder; do not duplicate its
development checks or mutate its active fixture. Source changes require a new
candidate and an explicit rerun decision.

## Execution and evidence

Run from the frozen candidate. Save protected logs under `/tmp` with cycle,
commit and attempt identifiers. Never print connection strings, credentials,
tokens or raw private payloads. Use securely supplied `TEST_DATABASE_URL` per
fixture; never use the application's database. Each disposable database must
end in `_test` and carry server-side `orbyn.environment = 'test'`.

| Gate | Planned commands / proof | Acceptance |
| --- | --- | --- |
| Dependencies and packages | Verify Node >=22, npm >=10 and matching installed dependencies; `npm run build:packages` | Both shared packages compile from candidate; dependency installation only if necessary |
| All workspace types | `npm run typecheck` | Shared build plus backend, desktop and mobile typechecks pass |
| Production builds | `npm run build` | Shared packages, backend and desktop/web builds pass |
| Mobile packaging | Candidate-local CI equivalent, including iOS/Android Expo exports; record exact command and output directory | Both platforms package; exports do not prove installed interaction |
| Full regression | `npm test`, with exclusively owned marked stock test DB | Terminal exit 0, zero failures/cancellations; account for every skip. Historical baseline 4322 passes; require current discovered inventory, not a fixed count or a reduced selection |
| Focused C1 contract | Candidate-specific authority, connections/catalogs, wire protocols, reasoning/cache, usage and embedding cohorts selected from the full acceptance matrix | Assert success and 400/401/403/429, not-found, catch/recovery, revocation and uncertainty paths; enumerate commands and case totals |
| Operational pgvector | Explicit cohort below, after backend build | Real PostgreSQL/vector storage/search and worker/recovery evidence; zero unexpected skips |
| Legacy migration | Separate empty marked pgvector DB; explicit upgrade fixture below | Real pre-218 schema/data upgrades twice, invalid legacy consent/vectors rejected; never pre-migrate this DB |
| Late extension | Separate fresh stock fixture restored into its own marked pgvector DB before extension installation | Existing page queued, consent remains off, migration timestamps retained and repeated migration safe |

Operational cohort follows the dedicated job in `.github/workflows/ci.yml`:

```sh
npx tsx --test --test-concurrency=1 \
  backend/tests/embedding-access-races.integration.ts \
  backend/tests/embedding-schema.integration.ts \
  backend/tests/embedding-setup.integration.ts \
  backend/tests/embedding-retry.integration.ts \
  backend/tests/embedding-pgvector.integration.ts \
  backend/tests/perplexity-embeddings.integration.ts \
  backend/tests/embedding-vectors.unit.test.ts \
  backend/tests/embedding-controls.unit.test.ts
```

Run independently, each with its own fixture URL:

```sh
npx tsx --test --test-concurrency=1 backend/tests/embedding-upgrade.integration.ts
npx tsx --test --test-concurrency=1 backend/tests/embedding-late-install.integration.ts
```

Builder reports owned container `orbyn-c1-embedding-20261008` on loopback
55437 restored. This is not freshly verified by Tester and is not permission to
reuse Builder's active DB. Agree named independent test databases before use.
Stock QA database on 55436 remains untouched. Provision a separate stock test
fixture for full regression and late-install source preparation.

For late-install setup, migrate that fresh stock DB, seed exactly the fixture
page `Late embedding fixture`, and confirm vector/embedding queue absence.
Restore schema/data and migration history into a separate empty pgvector DB
without creating vector first. Validate the server-side test marker after
restore and run only the late-install fixture there. Match PostgreSQL versions
where possible; record any narrowly necessary dump compatibility adjustment.
Do not erase schema/data or migration history to make an assertion pass.

## Full contract coverage

| C1 completion row | Required verification |
| --- | --- |
| Managed/BYO/personal authority | Schema/persistence/client connection discriminator; every conversation, scanner, Agenda/page, task/goal/routine and Overnight entrypoint; immutable provider/model/revision across enqueue, dispatch and restart; disabled/deleted/revised authority and legacy capture fail closed; consented fallback preserves provenance and billing separation, with no replay after uncertain execution |
| Multiple saved connections | Duplicate provider kinds and custom destinations remain independent; Save/Edit/Test/Load/Delete and enable/disable; credentials never leak; stale callback/account/revision cannot overwrite current state; redirect/recipient fencing |
| Catalog/manual/default | All supported provider kinds and actual available models; pagination, large/slow/error catalog, manual drafts and unavailable saved models; account/connection switches cancel stale loads without silent replacement |
| Generation protocols | Native Responses/Messages, Zen, Perplexity Agent and compatible/Azure/Matilda request contracts; selected model/capabilities; tool-call identity, encrypted restart, bounded/incomplete output and no duplicate tool work |
| Reasoning/cache | Supported model-aware values persist on both clients and map to correct wire fields; unsupported values rejected; stable instruction/tool prefix; cache hit/write/input/output observations; actual permitted benchmark below |
| Usage | Owner-only counters, unknown/overflow/loading/error/retry and expiry/deletion; managed vs private separation; no inferred plan bill or fabricated usage |
| Embedding recipient | Independent accepted provider/model/revision, displayed destination and explicit consent; change/reconnect invalidates old authority; live accepted recipient proof separate from local HTTP fixtures |
| Dimensions/replacement | Authorized model dimension matrix, flexible vector storage and search; incompatible results rejected; replacement/reindex queues current pages and cannot serve old-provider/model vectors |
| Consent/source races | Pre-click/in-flight provider change, A→B→A, edit/delete, disable, keep-out, ownership/team visibility revocation and conditional queue acknowledgement; recovery cannot restore lost permission |
| Migration/worker | Legacy and late-install fixtures above; mixed-version writes fail safely; idempotence, independent worker profile startup/readiness/shutdown and restart/recovery; no notifier fallback bypass |
| Failure/status/retry | Sanitized persistent error/backoff, newer-work fencing, healthy-page progress and explicit retry; actual client enabled/error/loading flows |
| Cross-client | Equivalent web/Electron/mobile flows, keyboard, themes, narrow/short layouts, nested overlays and enlarged text; installed evidence distinct from browser/export evidence |

Keep budget/team/MCP regressions in the C1 compatibility matrix; detailed C3
work remains queued. C2/M1 and other ADR stages cannot be advanced by this plan.

## Browser, native and external gates

All visual requests go to **Orbyn Visual Check** once direct user messaging
authorization is available. No cross-chat request is sent by this plan. Supply
exact candidate/preview source, route, account/role, fixture states and required
flow; obtain Markdown evidence with actual viewport/theme, screenshots or export
limitations and findings. Builder reviews visual evidence before UI acceptance.

Cover provider management, selected connection/model, catalog/manual selection,
reasoning/cache controls, usage and embedding consent/status/retry/reindex.
Exercise wide expanded/collapsed panels and 320/390 narrow layouts, short-height
landscape, Light/Dark, large labels/catalogs, loading/503/retry, nested overlays,
keyboard selection, Escape/Close focus return and safe dismissal. Genuine 200%
text enlargement must be demonstrated; pinch zoom is insufficient. Historical
QA033/035/036 states may inform cases but do not qualify the new candidate.

Installed Electron, iOS and Android require candidate builds, device/OS/source
identification and actual management/model switching, keyboard, secure-storage
and restart/revocation recovery interactions applicable to C1. Browser checks,
typechecks and Expo exports cannot close these gates. Full SIWC delivery remains
C2/M1; preserve its boundary without waiving C1 installed recovery requirements.

Live provider/model and accepted embedding probes require available authorized
accounts, supported models, reviewed destinations and permission for any paid
requests. Never extract or display credentials. Local HTTP/mock provider tests
remain fixture evidence. For the permitted OpenAI caching benchmark, predeclare
model/options, stable prompt/tool prefix, baseline, repetitions, output-quality
rubric and spend bound; record actual cache/input/output usage, latency and cost
with pricing basis/date. Compare equivalent workloads; report missing or unknown
metrics honestly. No benchmark result is inferred from prices or mock counters.

## Pending prerequisites and reporting

Pending: frozen commit/handoff and complete coverage inventory; exclusive test
DB/run ownership and verified fixtures; candidate preview mapping/accounts;
direct user authorization for cross-chat visual coordination; genuine text
enlargement capability; installed builds/devices; authorized live provider and
embedding access and cache benchmark spend/measurement setup. Record each missing
gate as open or blocked with its concrete reason; do not waive it.

Publish `c1-full-2026-10-08-test-r1.md` after qualification with exact checkout,
branch/commit, source freeze checks, environment/fixture identities, commands,
terminal exit/status and test counts, protected log paths, failures/skips,
visual/native/vendor evidence, requirement verdicts and unresolved gates.
Append retries/retests with source and reason; retain failed attempts. Return
failures to the sole write owner; revised commits need Tester verification before
review. Testing does not consume a review round. Reviewer persists rounds 1/3,
2/3 or 3/3 and closes findings under the shared protocol. Unresolved gates keep
C1 open, including after round 3. Main merge, confirmed push and user-owned
deployment remain separate facts. After full C1 acceptance, honor the requested
pause before C2/M1.
