# C1 acceptance ledger

## Qualified managed authority checkpoint — 7 October 2026

Frozen afd18161 full backend regression is terminal green: 4012 passed, zero
failures/skips, exit 0, 846953 ms. Protected complete log:
`/tmp/orbyn-adr-full-afd18161-20261007.log` (session 78103, terminal).
The 15 scoped main product/test files match the frozen commit byte-for-byte;
main adds only the managed authority export, excluding unrelated Docs/native
candidate exports and migration 253. Prepared main passes 61 focused cases,
all backend/web/mobile types, shared package and backend builds. The web production
build and Home prerender also pass after restoring incomplete existing locked
local Mermaid/Iconify dependencies; package manifests and versions are unchanged.
Log: `/tmp/orbyn-main-authority-web-build-restored-20261007.log`. Actual compiled
main fixture probes pass healthy durable tools, post-response revocation and the
legacy NULL-snapshot recovery contract with zero external requests.

Jobs now preserve the queued managed provider/model and generation revision
across dispatch, resume and consented fallback. Agenda, recording and hosted-page
work retain their source and personal-choice checks alongside managed authority.
Provider changes stop stale work rather than selecting a new default. Permanent
page-provider changes fail once instead of requeuing indefinitely. Plugin grants
and private ChatGPT credentials stay separate.

Deployment note: migration 254 leaves old job snapshots unverified. Legacy queued
managed work and old hosted origins need review and a fresh request/update;
current configuration is never substituted as proof of old intent. Completed
historical results remain available. The user deploys main manually.

This closes the managed authority implementation checkpoint, not the whole C1
stage. Next implement supported reasoning/cache controls and usage/evaluation,
then remaining multi-provider/embedding and both-client acceptance. Real provider
inference, installed native acceptance, C2-M1 through C6/D1/U1 and final cleanup
remain open. User/character files are preserved.


## Independent main-scope qualification — 7 October 2026

C1 authority files fromafd18161 are prepared on main24cc5607, not committed or
pushed. Only the managed authority export was appended to the main core index;
unrelated candidate Docs/native exports are excluded. User mobile/app.json and
untracked files remain untouched. Backend/web/mobile typechecks, shared package
builds and backend build pass. The first root checks exposed missing declared
WebView13.16.1 and a wrong-platform local esbuild installation. Restored the existing
WebView package and selected the known macOS esbuild binary for the rerun; no
manifest/dependency version changes. The failed environment run stays recorded.

Prepared-main focused tests pass61/61, zero failures/skips,10751ms:
`/tmp/orbyn-main-managed-authority-focused-fixed-20261007.log`.
Actual compiled main healthy and revoked Responses probes both pass with zero
external requests. Healthy work completes and clears its durable state; revoked
work stops after one provider request before any returned tool checkpoint.
Logs: `/tmp/orbyn-main-authority-healthy-20261007.log` and
`/tmp/orbyn-main-authority-revocation-20261007.log`.
Actual old-schema-upgrade NULL job also rejects with the distinct fixed legacy
reason, zero dispatch: `/tmp/orbyn-main-authority-legacy-contract-20261007.log`.

Frozen afd18161 full regression is still live as session 78103 on its own database;
this qualification does not replace its terminal result. Keep checkpoint open and
main uncommitted until that result is inspected. No production deploy or real
provider acceptance is claimed. No next product checkpoint started.


## Managed authority candidate — 7 October 2026

The C1 enqueue/dispatch/recovery repair is implemented locally and awaits a fresh
full frozen regression before main promotion. Jobs capture an immutable,
credential-free managed provider/model identity with monotonic selection/provider
revisions. Default and explicitly consented fallback retain that identity; changes
before dispatch, after response or on recovery reject rather than retarget. Agenda,
transcription and hosted page updates compose the same guard with existing source,
personal-choice, lease and budget checks. Plugin permissions stay independent.

Migration254 leaves legacy job snapshots NULL rather than inventing old intent.
Those runs stop with a fixed recovery message; users must review saved work and
start a fresh request. Hosted origins without verified capture also require a fresh
update. Permanent provider-choice changes fail once instead of deferring forever.
Label and night-budget changes do not invalidate generation authority.

The integrated focused cohort passed151/151, zero failures/skips,32308ms:
`/tmp/orbyn-managed-authority-254-permanent-stop-20261007.log`. A later distinct
legacy-error follow-up first passed20/23: three revocation assertions incorrectly
expected the new missing-identity reason. They now retain the provider_changed
expectation; the corrected contract/privacy-message cohort passes23/23, zero
failures/skips,1955ms:
`/tmp/orbyn-managed-authority-final-contract-fixed-20261007.log`.

Actual old-schema upgrade preserved a legacy NULL snapshot and rejected retargeting.
Compiled fixture probes pass healthy durable tools and stop a revoked provider's
response before a tool checkpoint. These intercept provider traffic; no real
provider inference is established. Prior3990/3990 full evidence covers the preceding
Responses scope only. Main remains24cc5607; this candidate is not deployed.


## Qualified Responses checkpoint — 7 October 2026

This scoped main checkpoint promotes the managed native Responses tool repair:
selected model preserved, exact call_id output pairing, encrypted reasoning
retained through serialized durable checkpoints, malformed/incomplete/ambiguous
calls refused and oversized context stopped before tool execution. Custom
compatible/Azure and private-plan JSON transports retain their separate paths.

Frozen8a11d03b full backend regression completed3990/3990 passes, zero failures
and zero skips, terminal exit0,829536ms (session53125). Complete protected log:
`/tmp/orbyn-adr-full-8a11d03b-20261007.log`. Main's exact three promoted code/test
files match that frozen commit byte-for-byte. Its additional candidate Docs/native
changes are not promoted by this scope; this is not a claim that main is identical
to the entire frozen candidate tree.

Prepared main passes49 focused protocol/graph/wire/output/style checks, scoped
formatting, backend/desktop typechecks and backend build. Candidate mobile
checks pass. Main's compiled API/database probe passes with selected model,
encrypted checkpoint, exact tool output and completed-state cleanup:
`/tmp/orbyn-main-c1-compiled-responses-audit-20261007.log`. Both compiled probes
intercept provider requests; neither is real OpenAI inference.

The separately promoted mainc2476119 confirmation typography correction passed
builder inspection of320/390 mobile-browser screenshots. No complete C1 stage,
whole ADR, production deployment or installed native acceptance is claimed.
Next: managed-provider enqueue/dispatch/recovery authority across all audited
entry points, then supported reasoning/cache controls and remaining provider/
embedding qualification. Historical failures and earlier pending status below
are retained as evidence and superseded by this terminal result.


Updated 7 October 2026. C1 is active. This evidence index supplements the full
contract in `devday-2026-implementation-review.md`; it does not reduce that scope.
Complete C1 before moving to C2/M1. A check means a scoped check passed, not that
the entire row or stage has shipped.

## Current checkpoint

Candidate `fc613153` repairs the managed native agent's Responses tool protocol.
It preserves the selected model, exact function call/output identity and bounded
encrypted reasoning context through serialized checkpoints. Backend build and
all three client/backend typechecks pass. It is not yet on main.

The first frozen full run terminated with 3988 passes, one failure, zero skips,
exit1 (794931ms). The complete-log retry on unchanged frozen source reproduced
exactly one failure: `neatness.unit.test.ts` rejected
`mobile/src/components/MoreMenu.tsx:255` because its confirmation message used
font size14 rather than the shared scale. Retry totals:3989 tests,3988 passes,
one failure, zero skips, exit1 (769079ms). Protected log:
`/tmp/orbyn-adr-full-fc613153-retry-20261007.log` (session38118, terminal).

The candidate fixes that message to15 and adds a regression proving oversized
encrypted Responses context stops before tool execution. Combined protocol,
graph, wire, output-limit and neatness checks now pass49/49, zero failures/skips
(812ms): `/tmp/orbyn-c1-neatness-responses-20261007.log`. The 39-case protocol
cohort independently passed. This focused result does not replace a full run on
the corrected candidate. Main promotion and mobile screenshot inspection remain
pending.

A disposable, server-marked database probe also exercised the compiled API's
actual queue and durable job checkpoint with intercepted provider fixtures:
two Responses calls, selected model preserved, encrypted context persisted before
continuation, exact function output identity, done result and cleared final run
state. External requests:zero. Log:
`/tmp/orbyn-c1-compiled-responses-audit-20261007.log`.
This proves the compiled/DB path with fixtures, not real OpenAI inference. The
first probe harness incorrectly expected completed jobs to retain run_state;
the corrected harness checks persisted context during continuation and verifies
clearing at completion. No product change was needed for that correction.

Future Orbyn Visual Check assignments capture images and a concise manifest only.
This session inspects screenshots and records findings; historical review reports
remain evidence for the states they actually captured.

Additional existing configuration/provenance/embedding/private-error/client-choice
unit checks pass 34/34, zero failures/skips (1562ms), log
`/tmp/orbyn-c1-config-audit-20261007.log`. These execute current fixtures and client
callbacks; they do not establish real provider or browser/native acceptance.

## Requirements and evidence

| Requirement | Current evidence | Still required |
| --- | --- | --- |
| Managed/BYO/plan connection distinction | `providers/user-choice.ts` resolves an immutable job choice; the private plan route uses `textTransport` and structured JSON, not managed credentials. The new isolation fixture passes. | Reconcile the connection-kind discriminator across schemas, persisted state and clients; qualify all managed conversation and automation paths. |
| Selected connection/model preserved | `providers/resolve.ts` resolves the saved provider/model; Responses fixtures retain legacy/current model names. Custom-compatible and Azure fixtures retain chat protocol. | Confirm complete model capability validation, disabled/deleted/revised connection behavior and actual supported-model availability. |
| Native Responses tools | Candidate protocol validates output, refuses incomplete or ambiguous calls, retains encrypted reasoning, and uses `call_id`. Before/after-tool serialized restart fixtures pass without repeated provider/tool work. | Frozen regression and scoped main integration; actual permitted provider probe. Deterministic checkpoint interruption is not a process-kill/live-provider test. |
| Explicit fallback and provenance | `providers/user-choice.ts` checks `fallback_to_default`, queues private calls and records fallback operations; provenance has a dedicated test. | Reconcile current authority, uncertainty, pre-stream eligibility, selected connection/model and receipts for every entry point; prove no silent paid fallback under recovery and revocation. |
| Sol catalog and capability validation | Twenty named provider definitions exist in `@orbyn/core`; OpenAI advertises Responses routing. | Explicit model capabilities/catalog defaults and supported reasoning-value validation. A generic model-name regex is a routing rule, not a complete capability contract. |
| Reasoning controls | Current managed `ResolvedAi.options` and persisted provider option schemas expose only Azure `apiVersion`. | Implement model-aware reasoning settings, unsupported-value rejection, backend/shared/web/mobile persistence and request mapping. |
| Prompt caching controls | No managed reasoning/cache request controls were found in the inspected adapters and provider schemas. | Stable instruction/tool-prefix handling, documented cache controls, cache hit/write/input/output usage, plus permitted cost/latency/quality evaluation against baseline. |
| Multiple saved providers | `ai/admin.ts` stores independent provider rows; both `AdminAi` clients support provider management and per-row model selection. | Current duplicate-kind/custom-endpoint, credential testing/catalog refresh/manual-entry and both-client interaction acceptance. A form/source implementation is not live provider acceptance. |
| Independent embeddings | `resolveEmbedding` binds accepted provider revision and model separately from generation; existing embedding audits and adapter/configuration/race tests are retained. | Reconcile all consent, dimensions, document/configuration fences, conditional queue acknowledgement, mixed-version upgrades/reindex and actual provider/UI gates against current source. |
| Budgets/team/MCP compatibility | Existing managed resolution and capability authorization remain in place; MCP is a separate grant boundary. | Full current provider/automation/team/MCP regressions and per-path authority/budget evidence. Detailed budget reconciliation remains C3, without waiving the C1 compatibility gate. |
| Client parity and UI acceptance | Both provider administration clients and embedding controls exist; prior sampled browser checks are recorded separately. | Assign the exact C1 provider/embedding flows to Orbyn Visual Check; review desktop/web and mobile browser, loading/error/long-catalog states, themes, overlays and native functional parity. |
| Production checkpoint | Managed Responses candidate committed; main integration pending. | Terminal qualification, scoped main commit/push, and evidence that clearly distinguishes merged from manually deployed. |

## Next implementation sequence within C1

1. Qualify and integrate the bounded managed Responses repair; retain external
   provider limits explicitly rather than declaring A3 complete.
2. Repair the confirmed managed enqueue/resume authority gap below, preserving
   explicit captured provider/model/revision and rejecting changed authority.
3. Implement the missing model capability/reasoning/cache configuration contract
   with shared/backend and both-client wiring together, then qualify that scope.
4. Reconcile independent embeddings and multi-provider configuration against their
   complete upgrade/race and UI matrix; fix every confirmed remaining defect.
5. Complete the C1 managed/BYO/plan authority, fallback, usage and evaluation
   matrix. Record real permitted probes separately from fixtures.
6. Only after C1 exit conditions are proven, start C2/M1.

## Confirmed managed authority defect

A database reproduction on current candidate58645cee used the separate marked
`orbyn_c1_provider_audit_test`, with no provider requests. It configured a fixture
managed model A, inserted a queued job (capturing the person's default choice),
resolved the job, changed the managed settings to model B, checked the original
resolved authority, then resolved the same job again. Observed:

```json
{"before":"fixture-model-a","resumed":"fixture-model-b","existingAuthority":"allowed","providerRequests":0}
```

`resolveUserAi` rereads `resolveAi()` on resume. Its default-route authority checks
the person's provider choice, whose snapshot has primary=default and null
connection/executor; it does not compare the managed provider/model/revision.
Migration231 captures that personal choice, not the selected managed setting.
Consequently, a global settings change can retarget an existing job and the
already-resolved configuration is not revoked by that change. This contradicts
C1's explicit selection/authority acceptance and remains unfixed. The script is
`/tmp/orbyn-c1-managed-authority-audit.mts`; it statically imports the verified test
setup before dynamically importing DB/provider modules. Its first invocation
incorrectly imported the pool before setup completed and failed to connect; no
SQL ran in that failed invocation. The corrected invocation exited0 and produced
the result above.

Next repair needs a credential-free enqueue-time managed provider/model/revision
snapshot, immutable ownership and live dispatch/recovery checks. Include ordinary
managed calls and explicitly consented fallback, disabled/deleted/key-edited
providers, legacy jobs, settings races and both preserved/rejected model paths.
Do not silently treat an unprovable legacy snapshot as current consent.

## Caching reference update

The current official guide uses `prompt_cache_options` for GPT-5.6 and later,
with implicit/explicit modes, content-block breakpoints and a currently supported
30m TTL. Earlier-model `prompt_cache_retention` is a separate contract. Track
`usage.input_tokens_details.cached_tokens` and `cache_write_tokens`; unknown
usage must not be reported as zero. Implement current model-specific controls,
not an unconditional legacy24h setting. Source:
[Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

## C1 browser review — scoped observations

Orbyn Visual Check completed the assigned provider/embedding browser batch at web
1280/768/390 and mobile390/960 in sampled light/dark states. Its authoritative
Markdown report is
`/Users/anhdang/.codex/visualizations/2026/10/07/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/review-tracking.md`.
Both clients distinguish generation and embedding configuration, show unavailable
database/measuring prerequisites, and contain inspected long Azure/Matilda drafts.
Two local saved compatible fixtures expose enabled/disabled and duplicate-kind
identity without changing the generation selection or making provider requests.

- QA-010 P3: web narrow saved-provider actions are crowded; rare Edit/Delete need
  a management menu and separated primary actions.
- QA-011 P3: mobile expanded saved-provider identity still truncates a long name;
  reveal the full connection name without moving the enabled switch off-screen.

The implementation owner viewed the long web edit-form and mobile embedding
unavailable screenshots directly. These observations do not establish successful
connection testing, catalogs, model persistence, embeddings, OAuth or native
behavior. No real provider key was entered by the reviewer in this batch.
Keep both findings in C1; repair and recheck after the active backend checkpoint
and managed authority repair. Unrelated Docs findings remain queued under C4.

## Provider reference evidence

The official [function calling guide](https://developers.openai.com/api/docs/guides/function-calling)
defines Responses function call/output identity and continuation. The official
[endpoint/model table](https://developers.openai.com/api/docs/guides/your-data#api-endpoint-tool-and-model-support)
lists Responses support for legacy GPT-3.5/GPT-4 snapshots as well as current
models. These references support protocol decisions; they do not prove this
installation's model entitlement or successful inference.

The official [GPT-6.1 Sol model page](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
lists low, medium, high, xhigh and max reasoning efforts and explicitly excludes
none/minimal. Existing managed provider options currently cannot represent this
configuration. This confirmed gap follows the managed authority repair within C1
after the active Responses repair qualifies.

## Corrected qualification and builder screenshot inspection

Frozen candidate `8a11d03b` is running a fresh full backend regression on the
isolated marked `orbyn_full_8a11d03b_test` database, session53125; complete protected
log `/tmp/orbyn-adr-full-8a11d03b-20261007.log`. Await the terminal result before
claiming a green full run. Main's scoped Responses integration working tree passes
49 focused protocol/style checks, scoped formatting and backend typecheck/build;
the candidate mobile typecheck passes. Responses promotion is pending this run.

Builder inspected QA-012's 320x567 and390x844 light screenshots personally. The
confirmation message wraps inside the sheet with padding, and Cancel task/Keep
task are both visible without overlap or clipping. Capture manifest records safe
Keep task dismissal with the existing task still To do. This qualifies the shared
message font correction for these mobile-browser states, not native keyboard,
large-text or all-theme behavior. Screenshots and manifest:
`/Users/anhdang/.codex/visualizations/2026/10/07/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/QA-012-capture-manifest.md`.

## Next C1 checkpoint: complete managed dispatch authority

Implement this after the Responses checkpoint qualifies and is promoted. The
confirmed model-retarget reproduction remains unresolved. Source inspection also
identifies adjacent entry points that must participate in the same contract:

| Path | Existing boundary | Required repair/acceptance |
| --- | --- | --- |
| Agent and first-party feature jobs (`user-choice.ts`, `feature-call.ts`, `agenda-call.ts`) | Immutable personal provider choice; default/fallback still resolves current managed settings | Credential-free immutable enqueue snapshot of managed provider identity, model and monotonic authority revision; validate live snapshot before dispatch, after response and on recovery. |
| Explicit ChatGPT fallback (`user-choice.ts`) | Consent and durable operation reservation prevent unapproved fallback/retry | Resolve only the captured managed fallback; configuration changes cannot silently select a different model/provider. Preserve cached known results and reject uncertain completion. |
| Default Agenda summary (`agenda-brief.ts`) | Source and personal-choice checks surround direct managed completion | Compose those checks with managed provider authority; do not overwrite its guard. Prove revocation during awaited work yields no usable completion. |
| Recording transcription (`recording.ts`) | Checks source and personal choice, but calls `transcribe` directly with resolved managed credentials | Fence managed provider/key/options/enabled state around transcription and all awaited source reads. Preserve text-plan/audio capability separation. |
| Hosted maintained pages (`maintenance-model.ts`, `maintenance-runs.ts`, `maintained-pages.ts`) | Hosted model_origin captures personal-choice version; worker later hashes current provider/model and fences that hash | Capture managed identity at enqueue as well as during dispatch; do not infer an old queued run's original model from current settings. Retain page authority, source/lease and budget guards. |
| Plugin inference (`plugin/inference-broker.ts`) | Independent managed permission already captures provider/model/revision and checks live rows under locks | Preserve the separate broker and authority; reuse a shared managed identity primitive without converting MCP/plugin permission into personal provider consent. |

Configuration identity must include a monotonic managed-selection revision, so
switching model A→B→A still invalidates old work. Provider credential, endpoint,
options, kind, enable/disable and deletion changes must invalidate the captured
connection. Never persist keys/tokens/secret hashes in job snapshots, backfill a
legacy job with invented enqueue evidence or make unrelated embedding/night-budget
changes silently alter the generation model.

Regression matrix: unchanged managed request succeeds; owner/personal choice
mismatch fails; model/provider change before first dispatch and after checkpoint
fails; A→B→A fails; provider disable/delete/key/endpoint/options edit fails; valid
explicit fallback uses captured model; no consent produces zero managed calls;
unknown prior completion is not retried; legacy missing capture fails closed;
queued-with-no-provider cannot later adopt a newly configured provider. Cover
actual trigger insertion/immutability, source and managed-setting races, durable
before/after-tool recovery, direct Agenda/audio and hosted page paths. Existing
plugin permission and independent embedding suites must remain passing.

This table is an implementation/verification plan derived from current source;
its adjacent rows are audit gaps, not claimed runtime reproductions or fixes.
Mainc2476119 contains only the qualified typography checkpoint. The Responses
working-tree integration remains uncommitted until the live full run finishes.

## Next controls reference refreshed — 7 October 2026

Read-only preparation while the authority checkpoint qualifies; no controls are
implemented by this note. Official [GPT-6.1 Sol model contract](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
supports low/medium/high/xhigh/max effort, excluding none/minimal; native tools
require Responses. Use explicit model capability validation rather than sending
every effort to every catalog entry.

The fetched [prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)
uses prompt_cache_options mode/ttl for5.6 and later, with30m currently supported.
Explicit-only mode without breakpoints produces no cache writes. Top-level
instructions cannot hold an explicit breakpoint; reusable developer content needs
a supported input text block. Retain older-model retention as its own capability.
Keep stable tools/instructions first, dynamic source material later, and separate
cache accounting by opaque user/workspace identity. Cache hits are not guaranteed.

After authority promotion, implement shared/backend/web/mobile controls and
unsupported-value refusal together. Preserve generation revisions when options
change. Cover direct completion and native tool requests, durable replay and
explicit fallback without introducing personal-plan or plugin authority sharing.
Capture observed input/output/reasoning/cache-read/cache-write usage; absent fields
stay unknown. Evaluate representative workflows for cost, latency and quality
against baseline with a permitted real provider probe; fixtures do not prove hits
or billing savings. Obtain exact-flow screenshot captures and inspect both clients
before declaring the controls checkpoint complete.
