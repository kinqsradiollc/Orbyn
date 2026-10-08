# Full C1 candidate handoff

Cycle `C1-full-2026-10-08`, 8 October 2026. Builder has completed the current
local implementation pass over the full retained C1 scope. This is candidate
admission for Test, not full C1 acceptance. Follow `checkpoint-workflow.md`.

## Source and ownership

Checkout: `/Users/anhdang/.codex/worktrees/c1-perplexity-embeddings/Orbyn`.
Branch: `codex/c1-full-completion`. Freeze the commit containing this handoff;
Tester must record its exact HEAD before executing. Product changes since main
`4735e714`: provider reload lifecycle fencing, persistent list recovery on both
clients, configured embedding exact-search status, and duplicate test-receipt
latency correction. The rest of C1 is retained main implementation, not excluded
from qualification. Builder stops application/test edits during formal testing.
Tester owns test fixtures and test execution; Reviewer has not started round1.

## Full contract coverage

| Requirement | Implementation and existing coverage | Qualification required now |
| --- | --- | --- |
| Managed/BYO/personal recipient | Immutable snapshots, explicit fallback, all first-party entrypoints; `c1-entrypoint-recovery-matrix.md` | Whole authority/recovery suite; permitted live and installed recovery separately |
| Multiple saved connections | All20 kinds, duplicate kinds, custom endpoints, encrypted credentials, revision-bound catalog/test routes | Full saved connection CRUD/default/catalog/test matrix and both clients |
| Catalog/manual model choice | Pagination/native catalogs, manual deployment/model preservation, stale-result and list-lifecycle fences | Large/slow/empty/error catalogs, keyboard, refresh/account/permission changes |
| Generation wire formats | Responses, Messages, compatible/Azure/Matilda, Zen and Perplexity protocols | Full adapter/protocol/inventory tests; vendor/model proof separate |
| Reasoning/cache | Model-aware supported values, persistence, request mapping, fixed evaluator | Entire control/cache suite; authorized real OpenAI cache/latency/cost/quality evidence |
| Usage | Observed counters, unknowns, personal exclusion, owner-only receipts | Current-source positive/large/unknown/loading/error/retry and installed acceptance |
| Embedding recipient | Independent saved provider/model, displayed revision and consent | Actual setup/security/revalidation and browser consent/selection; authorized live recipient separate |
| Dimensions/replacement | Flexible vectors, validated dimensions, replacement/requeue, exact strategy reported | Operational vector/dimension/search tests; no truncation or inherited generation choice |
| Consent/source/access races | Document/configuration/queue/provider generation guards and post-response visibility | Operational races including revoke/delete/keep-out/source edit; recover without restoring authority |
| Migration/worker deployment | Fail-closed legacy flag, repeated migrations, independent measuring profile | Fresh legacy upgrade, separately prepared late-extension fixture, shutdown/restart/mixed-version checks |
| Indexing failure/retry | Sanitized persistent backoff, newer-work fencing and status | Operational failures/recovery and actual enabled/error/loading clients |
| Cross-client acceptance | Web/desktop/mobile code parity, compact settings and nested controls | Browser narrow/wide/themes/keyboard/enlargement; installed Electron/iOS/Android separately |

The authoritative acceptance contract remains the retained ADR, embedding audit
and C1 completion table. This table is an index, not a scope reduction.
See `c1-full-2026-10-08-qualification-plan.md` for Tester execution/fixture rules.

## Development evidence, not formal qualification

- Provider lifecycle17/17: `/tmp/orbyn-c1-full-client-lifecycle-focused-20261008.log`.
- pgvector operational30/30: `/tmp/orbyn-c1-full-vector-dev-20261008.log`, terminal
  `/tmp/orbyn-c1-full-vector-dev-terminal-20261008.json` (exit0, signal:null).
- Provider receipt20/20: `/tmp/orbyn-c1-full-provider-test-copy-20261008.log`.
- Backend, desktop and mobile typechecks and packages/backend build pass before
  the final receipt-only correction. Tester must qualify the frozen final source.
- Previous full4322/4322 belongs to earlier product sourcefed13851; it does not
  qualify these new edits. No full C1 review round has been consumed (0/3).

## Runtime and fixture isolation

- API8008 on stock QA DB55436; web5174/mobile8083 are owned development previews.
  Compiled API source is98b82af6 until its next documented rebuild/restart;
  final latency correction is not yet reflected there. Client source tracks branch.
- Retained pgvector container `orbyn-c1-embedding-20261008` restored on55437.
  Builder development DB `orbyn_c1_full_dev_20261008_test` must not be reused
  for fresh upgrade/late-install or reset while its owned checks are active.
  Development runs are now terminal; create independently named marked fixtures.
- Preserve QA DB `orbyn_ui_preview`, original providers, primary mobile/app.json,
  character/user changes and unrelated containers/worktrees.
- Inert provider18089, marked saved row2b7a6d20-92e2-42ed-bb0b-82077203a067,
 250-model catalog and fixed ping only; never select as managed/embedding default.
  Builder coordinates fixture mode and owns cleanup after Visual Check finishes.
- Visual Check is gathering current development catalog/management evidence.
  Reports must record source, actual viewport/theme and export limitations.
  Do not mutate its active fixture or independently duplicate browser sessions.

## Explicit remaining prerequisites

Checked local/production env files contain no configured managed OpenAI evaluation
key/model. Matilda's prior six-call baseline cannot prove OpenAI caching. Do not
invoke another paid provider or infer supported models/plan/cost from fixtures.
Live accepted embedding recipient proof also remains open. Genuine text enlargement
and installed-client acceptance remain unverified; browser review and exports do
not substitute for them. Tester records each unavailable gate and exact required
evidence. Do not mark C1 complete, merge an unqualified full checkpoint, advance
C2/M1 or pause as if C1 finished while required acceptance remains open.
