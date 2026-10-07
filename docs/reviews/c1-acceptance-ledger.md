# C1 acceptance ledger

## Independent embedding discovery candidate — 8 October 2026

Local checkpoint1941fe13 adds a purpose-specific catalog route using the
displayed embedding revision before and after network I/O, independent of
generation controls. It preserves server-side credentials, manual models,
assistant settings and explicit semantic consent. Exact native OpenRouter uses
its separate embedding catalog; custom destinations preserve their saved origin.
Compatible catalogs are labelled unclassified candidates, not embedding proof.
Azure deployment names remain manual; native Anthropic embedding setup remains
excluded. All20 saved kinds have adapter fixtures.

Corrected focused cohort122/122, zero failures/skips/cancellations, passes:
`/tmp/orbyn-c1-embedding-discovery-focused-20261008.log`.
Final workspace typecheck, backend and web builds pass. Original initial
typecheck/VM-harness failures are preserved in the candidate review document;
they are not represented as passing runs.

Combined frozen source5466bc1c adds the pending exact-match mobile search fix.
Its full regression is running, not completed, in the new marked database
`orbyn_c1_embedding_discovery_full_20261008_test`:
`/tmp/orbyn-c1-embedding-discovery-full-20261008.log`.
The source tree remained unchanged until that run authoritatively terminated.
It exited7 without a final TAP summary;18 existing component-harness tests failed
resolving the new hook import. Its last output is the native-page clock case.
The whole native-page file independently passes10/10; the termination cause is
not established. Free disk fell below500MiB; recovered space is requested before
another full run.

Test-only correction15301fbd adapts that component harness, with real-hook tests
retained and12 additional read-only/loading/error/manual UI cases. Corrected
combined cohort154/154 passes, zero failures/skips/cancellations:
`/tmp/orbyn-c1-embedding-discovery-corrected-cohort-20261008.log`.
No full-suite pass is claimed. Captures still target the unchanged5466bc1c
product UI;15301fbd changes only tests and documentation.

Owned API/web/mobile previews now serve5466bc1c at the existing8008/5174/8083
ports. Authenticated discovery against the inert local provider returns200,
unclassified250-model catalog and matching embedding revision; semantic search
staysOFF. No page text was sent, consent granted or real provider selected.
Chrome was unavailable to Visual Check; the human has now confirmed restored
availability. Corrected mobile and embedding UI originals are requested and await
root inspection. Neither feature is promoted to main, and C1 remains active.
The requested pause applies after full C1 completion, before C2/M1.

## Credential-test checkpoint delivered — 8 October 2026

Frozen source47d35a07 completes full regression4083/4083, zero failures/skips/
cancellations, exit0,847542ms on a fresh marked stock-Postgres database:
`/tmp/orbyn-c1-credential-full-20261008.log`. The preceding focused49/49 and27/27,
workspace typechecks and backend/web builds also pass. Fast-forward merged and
pushed to main as47d35a07; primary main/origin match and unrelated mobile/app.json
SHA1dacd602172347441f2fd92f16d8772b3ba1ef7a8 is preserved. This qualifies the
generation/model-bound credential-test wiring, not remaining visual or full C1
acceptance. Browser capture is still blocked; installed-native and production
deployment are unverified.

Main's earlier CI run37656656011 is terminal successful in all five jobs.
Corrected embedding job112913998033 is confirmed53/53, zero failures/skips/
cancellations, from the inspected remote log:
`/tmp/orbyn-c1-embedding-ci-remote-fixed-20261008.log`.

## Perplexity native embedding candidate — 8 October 2026

[Perplexity's current embedding contract](https://docs.perplexity.ai/docs/embeddings/standard-embeddings)
uses `/v1/embeddings` with base64 signed-int8 vectors. The saved native root
formerly requested `/embeddings` and rejected the string response. An inert
compiled fixture reproduces both defects:1/3 before,3/3 after. Custom compatible
endpoints retain their saved path and float-vector contract.

The candidate recognizes only the exact native HTTPS origin and its root or v1
base, requests `base64_int8`, strictly decodes signed coordinates and validates
the reviewed full1024/2560 widths. Unsupported native models and incompatible
accepted dimensions fail before sending text. Binary/malformed/zero/mismatched
vectors, count/index errors and upstream400/401/403/429/500 remain rejected or
sanitized. Generation and catalog routing are separate audit work.

Adapter/vector cohort37/37 and saved-row/provider/storage cohort67/67 pass,
zero failures/skips/cancellations. Actual pgvector measuring/search preserves
signed coordinates and rejects old vectors during1024→2560 model replacement.
The native recipient is mocked, not an authorized live Perplexity account.
Backend build passes. Logs:
`/tmp/orbyn-c1-perplexity-embedding-before-20261008.log`,
`/tmp/orbyn-c1-perplexity-embedding-after-20261008.log`,
`/tmp/orbyn-c1-perplexity-embedding-cohort-20261008.log`,
`/tmp/orbyn-c1-perplexity-vector-runtime-20261008.log`,
`/tmp/orbyn-c1-perplexity-embedding-build-20261008.log`.
The native vector fixture is added to the dedicated CI job. Matching combined
vector cohort54/54 passes, zero failures/skips/cancellations:
`/tmp/orbyn-c1-perplexity-vector-combined-20261008.log`.
Full regression and main delivery are pending; no full C1 completion is claimed.

Credential source remains frozen at47d35a07 in its separate live regression;
this candidate's source changes do not alter that running checkout.

## Credential-test authority candidate — 8 October 2026

An actual local HTTP fixture reproduced a saved provider changing while its
credential test was in flight: the old response still reported a successful
connection. Before correction0/1; after correction1/1. The protected test route
now fences dispatch and accepted results to the saved generation, and binds both
positive and negative receipts to that generation and model. Both clients reject
stale/missing receipts and hide results when the model draft changes. An empty
model or missing displayed generation disables testing. Legacy API calls remain
accepted; new clients require the explicit receipt before displaying a result.

Focused route/control cohort49/49 and client callback/render/API cohort27/27 pass,
zero failures/skips/cancellations. Workspace typechecks and backend/web builds
pass. Logs: `/tmp/orbyn-c1-credential-authority-cohort-20261008.log`,
`/tmp/orbyn-c1-probe-client-cohort-20261008.log`,
`/tmp/orbyn-c1-credential-types-20261008.log`,
`/tmp/orbyn-c1-credential-backend-build-20261008.log`,
`/tmp/orbyn-c1-credential-web-build-20261008.log`.
Full regression, current browser interaction captures and main delivery remain
pending. Visual Check has the capture-only handoff; the saved permission/native
capture refusal remains unresolved. No live provider, installed-native or full
C1 completion is claimed. The user requested a pause after completing C1, before C2.

The corrected embedding CI job112913998033 in run37656656011 is confirmed
successful. Exact remote test log count is not yet inspected because the overall
run is still in progress; the matching local cohort is53/53.

## Embedding CI prerequisite correction — 8 October 2026

Remote run37655804028 embedding job112910042159 finished52/53, one failure.
The retry fixture launches actual compiled code in a separate process; the new
CI job built only shared packages, so `backend/dist/db/pool.js` was absent.
This is a missing CI build prerequisite, not a skipped test or backend defect.
The failure log is `/tmp/orbyn-c1-embedding-ci-remote-failure-20261008.log`.

Add `npm run build -w backend` before the vector cohort. Current backend build
passes and the matching cohort passes53/53, zero failures/skips/cancellations:
`/tmp/orbyn-c1-embedding-ci-build-fix-20261008.log`,
`/tmp/orbyn-c1-embedding-ci-build-fixed-20261008.log`. Product source is unchanged.
Scoped formatting/diff checks pass; corrected remote-job acceptance is pending.

## Embedding access races and continuous qualification — 8 October 2026

Six new real pgvector/local-HTTP fixtures verify that semantic query results are
withheld after in-flight team membership revocation, team keep-out and private
ownership transfer. Measuring does not store responses after Trash, document
hard deletion or embedding-provider deletion. Trash intentionally removes queued
work; restoring requeues the page and subsequent measuring succeeds. Each fixture
asserts the intended mutation actually ran exactly once and that the recipient
handler succeeded, preventing a failed mutation/HTTP500 from faking a pass.

Initial result5/6 exposed an incorrect test expectation that Trash retains its
queue row, contradicted by migration218. Corrected fixture6/6 passes without a
product-source change. Logs: `/tmp/orbyn-c1-embedding-access-races-20261008.log`,
`/tmp/orbyn-c1-embedding-access-races-corrected-20261008.log`.

Regular CI used stock PostgreSQL and did not execute the separate pgvector
integration files. The dedicated embedding job now marks an isolated PG16/vector
database and explicitly runs configuration/schema, storage/search, retries,
access-race, vector validation and client callback checks. Its matching local
cohort passes53/53, zero failures/skips/cancellations on a fresh marked database:
`/tmp/orbyn-c1-embedding-ci-cohort-20261008.log`. Scoped formatting and diff checks
pass. Delivery: `c5dcc19c` is published on main. Four normal Git push attempts returned
Internal Server Error, including an existing workflow-scoped CLI credential.
GitHub Git Data API publication verified all four blob hashes, the full tree and
exact original commit SHA, rechecked the remote parent, and updated with
`force:false`. Fetch confirms local main/origin match; unrelated primary changes
and mobile/app.json hash are preserved. No credentials were printed or persisted
in source. The remote GitHub job result remains unverified. This test/workflow-only
checkpoint does not change backend source or add its count to the terminal
4044/4044 stock regression; no live provider, UI/native or full C1 completion.

## Zen selected-model transport — frozen candidate 8 October 2026

Candidate `890d42ce` resolves reviewed Zen model IDs through Responses, native
Messages or native Gemini content instead of assigning Chat Completions to every
model. Exact IDs come from the official Zen endpoint table and Models.dev metadata
used by OpenCode; unknown IDs retain the existing compatible contract without
family-name guessing. Jev models fail explicitly because their custom transport
is not implemented. Catalog and embedding resolution remain independent.

Gemini uses the existing provider-neutral JSON agent tool protocol, including
resumed native-mode jobs; this is not a claim of native Google function calling.
Native auth/system/history/output decoding, private-transport precedence,
post-response authority, cancellation, truncation and usage-once guards are
covered. Unknown usage fields remain unknown, thought output is not displayed.

Before: direct/agent/JSON protocol fixtures0/15 pass. Expanded cohort335/335 now
passes, including118 independently captured model metadata assignments and
HTTP400/401/403/429/500 sanitization. Backend build passes. Compiled actual durable
loops complete for Responses, Messages and Gemini at their expected saved URLs.
The initial compiled fixture omitted Responses completed status and was rejected;
correcting the fixture produced three passing loop cases without a source change.

Logs: `/tmp/orbyn-c1-zen-transport-before-20261008.log`,
`/tmp/orbyn-c1-zen-expanded-cohort-20261008.log`,
`/tmp/orbyn-c1-zen-final-build-20261008.log`,
`/tmp/orbyn-c1-zen-compiled-20261008.log`.
Full frozen regression13419 is terminal exit0 on a fresh marked database:
4044/4044 passed, zero failures/skips/cancellations,847821ms.
`/tmp/orbyn-c1-zen-full-20261008.log`. Subsequent edits are documentation only.
Scoped formatting and diff checks pass. Fast-forward merged and pushed as
`2186dcb9`; main/origin matched. Primary unrelated changes are preserved, including
mobile/app.json SHA1dacd602172347441f2fd92f16d8772b3ba1ef7a8.
No live vendor inference, UI change, production deploy or complete C1 acceptance.

The user requests a pause after **all C1 acceptance**, before C2/M1. Remaining
C1 runtime/client/embedding/cache gates are retained rather than waived.

### Additional Zen qualification and visual boundary

Current web production build passes:
`/tmp/orbyn-c1-zen-web-build-20261008.log`. Current-source pgvector cohort47/47
passes with zero failures/skips on a fresh marked database, including setup,
schema/revision/keep-out races, retry fences, Azure storage/search, vector
validation and web/mobile callbacks. Log:
`/tmp/orbyn-c1-zen-embedding-current-20261008.log`. This separately executed
cohort is not added to the full stock regression count.

Current workspace typechecks pass for shared packages, backend, desktop and
mobile: `/tmp/orbyn-c1-zen-workspace-types-20261008.log`. Public Zen catalog
snapshot86 IDs is independently compared with118 reviewed metadata records:
84 current IDs are covered; the remaining two are explicitly unsupported Jev
models. This is snapshot coverage, not certification of future model additions.

Root inspected QA026 mobile heading-metrics and screenshot-mode originals.
Computed headings are18px with contained320px DOM bounds, scale/zoom1; the
320px and later390px capture pixels nevertheless show roughly double-size
text and crop the right side. Alternate documented screenshot modes do not
resolve the discrepancy. Do not classify it as a repaired product defect or
accept that320px layout from DOM measurements alone. Earlier normal390px and
scoped web picker captures remain sampled evidence only.

Native capture of the authenticated Codex browser was denied by Computer Use:
`Computer Use is not allowed to use the app 'com.openai.codex' for safety reasons.`
The visual session's direct human no-alternate-browser instruction prevents its
Chrome retest of that flow after the denial. No permission was bypassed, no
credentials were exposed, and no further target screenshot was obtained. This
capture gate remains open; Zen's backend transport checkpoint makes no UI change.
Manifest:
`/Users/anhdang/.codex/visualizations/2026/10/07/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/QA-026-provider-picker-screenshot-mode-follow-up-manifest.md`.

## Together array catalog — merged checkpoint 8 October 2026

Frozen source `8d83fb01` normalizes Together's documented top-level array only
for its saved kind and compatible protocol. Common ID validation, bounded
record count, error redaction, sorting/deduplication and revision fencing remain.
Initial adapter reproduction45pass/1fail; repaired46/46. Saved-provider route
cohort63/63 includes a real saved Together row, unchanged configuration,
malformed partial catalog rejection and in-flight connection mutation409.
Independent all20-kind inventory61/61 now uses Together's array response.
Backend build and compiled adapter check pass; no live vendor call or UI change.

Logs: `/tmp/orbyn-c1-together-unit-before-20261008.log`,
`/tmp/orbyn-c1-together-unit-after-20261008.log`,
`/tmp/orbyn-c1-together-cohort-20261008.log`,
`/tmp/orbyn-c1-together-inventory-20261008.log`,
`/tmp/orbyn-c1-together-build-20261008.log`,
`/tmp/orbyn-c1-together-compiled-20261008.log`.
Full frozen regression session23362 is terminal exit0 on a fresh marked database:
3894/3894, zero failures/skips/cancellations,764252ms.
`/tmp/orbyn-c1-together-full-20261008.log`. Later commits change documentation
only; scoped formatting and diff checks pass. Fast-forward merged and pushed
as `22f24742`. Primary checkout's unrelated changes remain preserved.
No live vendor call, UI change or full C1 completion is claimed.

## Anthropic JSON fallback — merged 8 October 2026

Actual durable-loop reproduction requested `/messages` then `/chat/completions`
and failed404 after native tools were rejected. Initial targeted suite5pass/5fail
also exposes resumed history, truncation and post-response authority gaps.
Repair routes Anthropic JSON protocol through the shared native Messages text
adapter, which owns auth/system shape, usage, truncation and authority. Managed
usage is recorded exactly once; private transport keeps precedence and no
managed observations. Expanded cohort145/145 covers13 fallback cases and existing
protocol/model controls/Responses/private recovery/all20 provider kinds.
Backend build passes. Compiled actual loop now requests `/messages` twice and
completes, with inert content/tools and no DB access or live vendor request.
Logs: `/tmp/orbyn-c1-anthropic-json-loop-before-20261008.log`,
`/tmp/orbyn-c1-anthropic-json-suite-before-20261008.log`,
`/tmp/orbyn-c1-anthropic-json-cohort-20261008.log`,
`/tmp/orbyn-c1-anthropic-json-build-20261008.log`,
`/tmp/orbyn-c1-anthropic-json-compiled-20261008.log`.
Full regression on frozen `d09fa409`, session80296, is terminal exit0:
3880/3880, zero failures/skips/cancellations,756874ms. Fresh marked test
database; log: `/tmp/orbyn-c1-anthropic-json-full-20261008.log`.
Scoped source formatting and diff checks pass. Subsequent changes only update
documentation. Fast-forward merged and pushed as `eb493433`; primary checkout's
unrelated changes and mobile/app.json hash were preserved. No live Anthropic
request, UI change, production deployment or full C1 completion is claimed.

## Anthropic pagination and saved-provider inventory — merged 8 October 2026

Candidate `cee9219e` fixes the reproduced first-page-only Anthropic catalog.
Before:19pass/1fail; after:34/34 adapter checks. Catalog authority/provider cohort
passes49/49, including concurrent mutation during the second page. Both pages
share one timeout signal; opaque cursors stay on the saved endpoint; malformed,
cyclic, endless or later-failing catalogs never return partial models.
Backend types/build pass. Full source-frozen regression32029 is terminal exit0:3806/3806, zero failures,
skips or cancellations,804189ms
(`/tmp/orbyn-c1-pagination-full-20261008.log`). Backend source still matches
`cee9219e`; later changes are tests/documentation only. Scoped Prettier and
diff checks pass.

Separate saved-row runtime inventory tests pass61/61 across all20 kinds:
resolver → direct completion/catalog/embedding/durable agent starting mode.
They use mocked HTTP responses and were added after the full runner started.
Their evidence is independent; they do not establish live vendor capability.
Logs: `/tmp/orbyn-c1-pagination-before-20261008.log`,
`/tmp/orbyn-c1-pagination-after-20261008.log`,
`/tmp/orbyn-c1-pagination-cohort-20261008.log`,
`/tmp/orbyn-c1-pagination-types-20261008.log`,
`/tmp/orbyn-c1-pagination-build-20261008.log`,
`/tmp/orbyn-c1-runtime-inventory-20261008.log`.
Scope and remaining gates: [provider runtime inventory](c1-provider-runtime-inventory.md).
Qualified checkpoint merged/pushed to main as `07edbcc5`. Root mobile/app.json
SHA1 remains dacd602172347441f2fd92f16d8772b3ba1ef7a8; unrelated changes are
preserved. WholeC1 remains open.

## Active embedding consent checkpoint — 8 October 2026

Reviewed-provider consent raced a pre-click connection edit; reproduced HTTP200
where409 was required. Candidate `d4cd4273` fences the explicit embedding revision
before dispatch and retains post-probe generation/revision checks. Both clients
submit the reviewed revision and reset acceptance after connection changes.
Focused pgvector48 pass/one stock-only skip; corrected separate stock20/20.
Shared/backend builds and both client types pass. Full frozen run87929 passes
3781/3781, zero failures/cancellations/skips, exit0,900795ms. Root inspected
QA022 wide/narrow web and mobile320/390 OFF controls. The capture-only manifest
confirms source/viewport/zoom; root inspected every accepted original. Controls
are contained, prerequisite labels accurate and consent/validation disabled.
Web production build passes (terminal46430). Merged/pushed as43fa8f57;
no enabled/error/native or wholeC1 acceptance is claimed.
See [the embedding audit](embedding-provider-audit-2026-10-01.md) for matrix,
logs, failed harness commands and rollout behavior. WholeC1 remains open.

## Model catalog inventory and revision checks — 8 October 2026

Catalog decoding now validates provider responses and redacts error details.
Web catalog refresh preserves the saved/manual model. Both clients invalidate
revised/removed catalogs and send the displayed connection's exact generation.
Mobile follows saved model changes only when its local field is clean.
Server catalog dispatch rejects stale generations before calling the provider,
then re-reads generation after the network result. Endpoint/key/options/enabled
changes, A→B→A and deletion reject409 without returning old model ids. Same-kind
connections remain independent; metadata/no-op edits preserve valid catalogs;
legacy calls without a requested revision still receive the post-fetch check.
No provider row is locked across network I/O. No migration is required.

Qualification: frozen inventory implementation full3767/3767, exit0,878544ms;
later revision route/client cohort50/50; shared/backend builds and both client
types pass. Compiled local fixture proves409/no stale catalog/external requests0.
The first revision cohort49/50 had a test expecting400 for schema validation;
corrected to established422 and added malformed JSON400 coverage. Re-run50/50.

Logs: `/tmp/orbyn-c1-inventory-full-20261007.log`,
`/tmp/orbyn-c1-catalog-authority-after-fixed-20261008.log`,
`/tmp/orbyn-c1-catalog-revision-compiled-20261008.log`.
Root inspected QA020 hero/footer and verified narrow Admin zoom100 originals;
QA021 wide provider controls and mobile320×740/390×844 originals. Both clients
retain unsaved `qa-manual-model` after one catalog metadata request. No visible
error appeared; web displayed the catalog selector, but options were not opened.
This proves visible draft preservation, not catalog completeness or inference.
Provider controls are contained. Wide full-page sticky-header/sidebar compositing
artifacts do not establish whole-page acceptance. Earlier clipped/magnified files
remain invalid. Capture manifest:
`/Users/anhdang/.codex/visualizations/2026/10/07/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/QA-021-c1-catalog-capture-manifest.md`.
Scoped checkpoint merged by fast-forward and pushed to main as `8ab6c822` on8October2026. Unrelated root changes, including mobile/app.json, are preserved. Production deployment is unconfirmed; wholeC1 and all remaining ADR stages stay open.
Installed-native acceptance remains open.
All visual requests go through Orbyn Visual Check for originals/manifest only.

## Matilda steering and compatible usage correction — 7 October 2026

The user configured an enabled Matilda (Maincode) provider and selected `matilda`
in the local preview. Existing fixed admin Test succeeded863ms before this
correction, but no usage was returned because the compatible adapter discarded it.
The scoped correction normalizes Chat Completions usage through the existing
nonnegative safe-integer/subset guards, records response identity and preserves
missing counters as unknown. Error envelopes do not create observations; truncated
answers retain reported usage. Authority checks and private ChatGPT transport
isolation remain intact. Schema source: [OpenAI Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

Backend build passes. Focused normalization/adapter tests pass29/29; log
`/tmp/orbyn-c1-compatible-usage-focused-20261007.log`. Rebuilt single-process API8008
preserves the preview DB/config and user-selected provider. One fixed OK/ping
Matilda probe succeeds815ms and returns provider-reported input0, output0,
reasoning0, cached input0, cache writes unknown. Evidence:
`/tmp/orbyn-c1-matilda-live-usage-20261007.json`. These zero counters do not establish
measured cost, cache savings, general quality or ChatGPT-plan entitlement. No
workspace content was sent. The OpenAI-specific cache benchmark cannot qualify
Matilda cache controls. New adapter product code needs refreshed full regression;
prior66f7a5f2 result remains valid only for its previous freeze.

Root inspected QA016 original images: wide/light desktop controls through Save,
provider management menu and zero-usage Settings are readable without observed
overlap in those captured states. Mobile390x197 shows scaled desktop content and
is rejected for requested390x844 acceptance. Visual Check was instructed to
correct capture viewport and capture narrow/dark/mobile states; capture-only
manifest workflow remains. User explicitly authorized disposable local QA Terms
acceptance and same-account sign-in. No entire C1/UI stage acceptance claimed.

Follow-up audit extends the same usage mapping to compatible/Azure native-tool
steps; The Matilda JSON path was not covered by that follow-up. Focused checks pass31/31
in `/tmp/orbyn-c1-compatible-native-usage-focused-20261007.log`; backend rebuild
passes. Initial full run `/tmp/orbyn-adr-full-main-d9621ac7-20261007.log` failed
because TEST_DATABASE_URL was omitted. It is terminal and provides no product
qualification. The corrected run must explicitly set both test/app URLs to the
fresh marked fixture; no preview database is used.

## Durable JSON and Anthropic usage audit

The first compiled Matilda/JSON fixture completed its run but returned zero owner
observations. Log `/tmp/orbyn-c1-compatible-compiled-usage-20261007.log` retains
that failed runtime evidence. Source inspection disproved the earlier assumption
that jsonStep delegates to complete(): it sends independently. The JSON route now
records compatible usage, except when a private textTransport is used.
Anthropic direct/native requests now also record usage; their uncached input,
cache writes and cache reads are disjoint and are summed only when all three
valid counters are supplied. Missing/overflowing total input stays unknown; no
reasoning count is inferred. Schema: [Claude prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

All adapter/control unit checks pass35/35 and backend rebuild passes. Log:
`/tmp/orbyn-c1-all-adapter-usage-focused-20261007.log`. The correctly configured
3e69c7ef full runner was intentionally stopped after the JSON runtime gap was
identified; its terminal exit1 is not a product pass. Preserve its log
`/tmp/orbyn-adr-full-main-3e69c7ef-20261007.log`. Refresh regression on the final
adapter scope; do not restart an old result or claim the earlier freeze covers it.

## Final adapter freeze and responsive evidence follow-up

Product freeze bf3dfef1 includes Responses, compatible direct/native/JSON, and
Anthropic direct/native usage recording, keeping private transports separate.
The compiled compatible JSON rerun passes with one provider fixture request,
one persisted owner observation, correct input/output/cache-read/reasoning
counts, unknown cache writes and cleared completed job state. External requests0.
Log `/tmp/orbyn-c1-compatible-compiled-usage-fixed-20261007.log`.
Fresh full regression is running as session79617 against marked
orbyn_c1_bf3dfef1_test, with both TEST_DATABASE_URL and DATABASE_URL explicitly
set. Log `/tmp/orbyn-adr-full-main-bf3dfef1-20261007.log`; no terminal pass yet.

Root inspected QA017 actual320/390 mobile and390 narrow web originals. Light
narrow web controls through Save/menu and zero-usage Settings are contained.
Mobile model/chip/control portions are readable but lower controls/usage require
scroll captures. Dark narrow usage screenshot shows Appearance rather than
the requested usage card and is rejected for that state. Dark narrow Admin
provider text shows through translucent pinned header. Scoped CSS switches
topbar to the existing opaque surface token in both themes; no palette change.
Preview source is patched; recapture requested before visual acceptance.
Both-client types, web production build and scoped CSS formatting pass. Logs:
`/tmp/orbyn-c1-adapter-client-types-20261007.log`,
`/tmp/orbyn-c1-controls-header-web-build-20261007.log`. Backend/full-suite source
remains unchanged from bf3dfef1 during this CSS/documentation follow-up.
No main promotion or entire-stage/native acceptance claimed.

## Mobile provider management follow-up

QA017 lower controls exposed inline Edit/Delete actions on mobile. Those rare
actions now use the existing provider-title MoreMenu, matching web management.
Load/Test/Use remain primary. Source audit also found provider deletion and
assistant shutdown used Alert.alert, which is a no-op in React Native Web. Both
now use the existing cross-platform confirmAction helper: native alert on installed
clients, browser confirmation on mobile web. No mutation occurs before approval.
Five executable UI/confirmation checks pass in
`/tmp/orbyn-c1-provider-management-ui-20261007.log`. They evaluate the actual JSX
callbacks/menu actions and the platform helper, not just source-string presence.
Initial typecheck rejected the optional edit icon; it was removed, and corrected
mobile typecheck passes in
`/tmp/orbyn-c1-provider-menu-mobile-types-fixed-20261007.log`. Old failed typecheck
and blank QA018 crash capture remain historical evidence; refreshed menu capture
is required before acceptance. Full bf3dfef1 backend regression is still running;
these separately executed frontend checks do not substitute for its terminal result.

Root inspected corrected QA017 mobile320 Light usage and390 Dark full usage: all
zero-request/unknown-counter explanations and Refresh are visible and contained.
Root inspected390 Light/Dark lower controls through Save: contained, remaining
inline actions led to this follow-up. QA018 narrow dark header no longer shows
provider text through Admin navigation, and narrow light menu stays within viewport.
Remaining dark/narrow usage,320 lower controls and refreshed provider sheet
captures stay explicit. No installed-native or whole-stage acceptance claimed.

## Controls/usage checkpoint ready for main — final qualification

Full backend regression for adapter freeze bf3dfef1 is terminal green3736/3736,
zero failures/cancellations/skips, exit0,901157ms; session79617 is closed. Log:
`/tmp/orbyn-adr-full-main-bf3dfef1-20261007.log`. Current backend module source
is byte-identical to that freeze. Later changes add a separately executed
provider-menu test, mobile management/confirmations, pinned-header CSS and
privacy/API wording. Final47/47 focused legal/version/management/adapter checks
pass with zero skips/failures in
`/tmp/orbyn-c1-final-privacy-ui-focused-20261007.log`. Shared packages rebuild
passes; previously recorded both-client types and web build pass.

User-selected Matilda fixed baseline passes6/6 exact-marker/arithmetic/state
checks with latency899,526,794,776,715,519ms. Evidence:
`/tmp/orbyn-c1-matilda-baseline-20261007.json`. It sends fixed non-personal text,
not workspace data. Provider reports zero input/output/reasoning/cache-read
counters and unknown cache writes. This establishes those six output checks
and latency only; no general model quality, costs/cache savings, plan/billing or
OpenAI cache-control qualification is claimed.

Root inspected refreshed QA018 web390 Light/Dark pinned-header/menu images,
Dark Settings full usage, mobile320/390 Light/Dark management sheets and lower
controls. Captured controls/actions/zero-usage text remain within the viewport;
header no longer shows provider text through it, mobile rare actions live in a
contained sheet, and the invalid-icon crash no longer reproduces after refresh.
The zero-usage and observed fixture API paths are qualified; installed-native,
positive/overflow/error visual matrices and general whole-app acceptance remain
open in retained C1/U1 scope. The Matilda baseline does not waive OpenAI cache
economics or the remaining multi-provider/embedding stage requirements.

Privacy wording now explicitly distinguishes changed embedding connection/model/
credential/transport (renewed consent) from chat-only reasoning/cache settings
(consent preserved by migration256). API docs reflect all managed response
formats and Claude's disjoint input counters. Scope is ready for main promotion
as a tested implementation checkpoint; entire C1 stage remains incomplete.

## Main promotion — 7 October 2026

Qualified controls/usage checkpoint9a869240 was fast-forwarded from main3c8feb40
and pushed to origin/main. Main's unrelated mobile/app.json content hash and
complete pre-existing tracked/untracked status were verified unchanged. No
production deployment performed; user deploys main manually. Full3736/3736 and
final47/47 evidence, compiled owner usage, migration/pgvector and root-inspected
responsive captures qualify this checkpoint, not the entire C1 stage.

Visual Check completed consolidated QA018 capture manifest at
`/Users/anhdang/.codex/visualizations/2026/10/07/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/QA-018-capture-manifest.md`.
Root inspected the original images listed above; its suggested fixes are not
used as acceptance authority. The missing-icon failure is retained historically
and corrected captures show contained provider sheets in all four mobile
size/theme combinations. Next C1 checkpoint is connection/model inventory and
remaining provider/embedding qualification. No stage reorder/cleanup claimed.

## Historical qualification — migration256 controls freeze

### Current visual-gate revalidation

Orbyn Visual Check completed QA014; root inspected original images directly.
Desktop1440x900 contains the updated Terms gate for version
2026-10-07-managed-usage: accepted as blocker pixel evidence only. Mobile image
is390x232 despite a requested390x844 CSS viewport and shows signup: rejected for
layout acceptance and cannot establish a signed-in C1 review. Local web5174,
mobile8083 and API8008 each return200. No account/legal/provider action performed.
Capture manifest:
`/Users/anhdang/.codex/visualizations/2026/10/07/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/QA-014-capture-manifest.md`.
Fresh explicit local Terms/sign-in confirmation requested under Computer Use's
legal agreement restriction. Managed evaluation credential/model still absent
from the process and production variable names; no secret values printed.

Exact main-based66f7a5f2 full backend regression completed3723/3723,
zero failures/cancellations/skips, terminal exit0,883745ms. Session88045 is
terminal; complete log `/tmp/orbyn-adr-full-main-66f7a5f2-20261007.log`.
This supersedes the earlier3722-case run for the migration256 product scope.
Later qualification commits change only documentation and the two separately
executed embedding integration files, outside the normal tests/*.test.ts suite.
Product source and normal full-suite files remain identical to the freeze.

Fresh focused29/29, backend types, compiled runtime/aggregation probes and
separate pgvector12/12 are green. Main remains3c8feb40; no production deployment
or current-checkpoint main promotion claimed. Signed-in web/mobile screenshots,
permitted live cost/latency/quality evaluation and remaining C1 multi-provider/
embedding acceptance stay required. Historical live/failed states below are
superseded only for their corresponding scope; the entire C1 stage remains open.

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

## Historical Responses checkpoint

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

| Requirement                             | Current evidence                                                                                                                                                                                                     | Still required                                                                                                                                                                                |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Managed/BYO/plan connection distinction | `providers/user-choice.ts` resolves an immutable job choice; the private plan route uses `textTransport` and structured JSON, not managed credentials. The new isolation fixture passes.                             | Reconcile the connection-kind discriminator across schemas, persisted state and clients; qualify all managed conversation and automation paths.                                               |
| Selected connection/model preserved     | `providers/resolve.ts` resolves the saved provider/model; Responses fixtures retain legacy/current model names. Custom-compatible and Azure fixtures retain chat protocol.                                           | Confirm complete model capability validation, disabled/deleted/revised connection behavior and actual supported-model availability.                                                           |
| Native Responses tools                  | Candidate protocol validates output, refuses incomplete or ambiguous calls, retains encrypted reasoning, and uses `call_id`. Before/after-tool serialized restart fixtures pass without repeated provider/tool work. | Frozen regression and scoped main integration; actual permitted provider probe. Deterministic checkpoint interruption is not a process-kill/live-provider test.                               |
| Explicit fallback and provenance        | `providers/user-choice.ts` checks `fallback_to_default`, queues private calls and records fallback operations; provenance has a dedicated test.                                                                      | Reconcile current authority, uncertainty, pre-stream eligibility, selected connection/model and receipts for every entry point; prove no silent paid fallback under recovery and revocation.  |
| Sol catalog and capability validation   | Twenty named provider definitions exist in `@orbyn/core`; OpenAI advertises Responses routing.                                                                                                                       | Explicit model capabilities/catalog defaults and supported reasoning-value validation. A generic model-name regex is a routing rule, not a complete capability contract.                      |
| Reasoning controls                      | Current managed `ResolvedAi.options` and persisted provider option schemas expose only Azure `apiVersion`.                                                                                                           | Implement model-aware reasoning settings, unsupported-value rejection, backend/shared/web/mobile persistence and request mapping.                                                             |
| Prompt caching controls                 | No managed reasoning/cache request controls were found in the inspected adapters and provider schemas.                                                                                                               | Stable instruction/tool-prefix handling, documented cache controls, cache hit/write/input/output usage, plus permitted cost/latency/quality evaluation against baseline.                      |
| Multiple saved providers                | `ai/admin.ts` stores independent provider rows; both `AdminAi` clients support provider management and per-row model selection.                                                                                      | Current duplicate-kind/custom-endpoint, credential testing/catalog refresh/manual-entry and both-client interaction acceptance. A form/source implementation is not live provider acceptance. |
| Independent embeddings                  | `resolveEmbedding` binds accepted provider revision and model separately from generation; existing embedding audits and adapter/configuration/race tests are retained.                                               | Reconcile all consent, dimensions, document/configuration fences, conditional queue acknowledgement, mixed-version upgrades/reindex and actual provider/UI gates against current source.      |
| Budgets/team/MCP compatibility          | Existing managed resolution and capability authorization remain in place; MCP is a separate grant boundary.                                                                                                          | Full current provider/automation/team/MCP regressions and per-path authority/budget evidence. Detailed budget reconciliation remains C3, without waiving the C1 compatibility gate.           |
| Client parity and UI acceptance         | Both provider administration clients and embedding controls exist; prior sampled browser checks are recorded separately.                                                                                             | Assign the exact C1 provider/embedding flows to Orbyn Visual Check; review desktop/web and mobile browser, loading/error/long-catalog states, themes, overlays and native functional parity.  |
| Production checkpoint                   | Managed Responses candidate committed; main integration pending.                                                                                                                                                     | Terminal qualification, scoped main commit/push, and evidence that clearly distinguishes merged from manually deployed.                                                                       |

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
{
  "before": "fixture-model-a",
  "resumed": "fixture-model-b",
  "existingAuthority": "allowed",
  "providerRequests": 0
}
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

| Path                                                                                           | Existing boundary                                                                                                     | Required repair/acceptance                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent and first-party feature jobs (`user-choice.ts`, `feature-call.ts`, `agenda-call.ts`)     | Immutable personal provider choice; default/fallback still resolves current managed settings                          | Credential-free immutable enqueue snapshot of managed provider identity, model and monotonic authority revision; validate live snapshot before dispatch, after response and on recovery.      |
| Explicit ChatGPT fallback (`user-choice.ts`)                                                   | Consent and durable operation reservation prevent unapproved fallback/retry                                           | Resolve only the captured managed fallback; configuration changes cannot silently select a different model/provider. Preserve cached known results and reject uncertain completion.           |
| Default Agenda summary (`agenda-brief.ts`)                                                     | Source and personal-choice checks surround direct managed completion                                                  | Compose those checks with managed provider authority; do not overwrite its guard. Prove revocation during awaited work yields no usable completion.                                           |
| Recording transcription (`recording.ts`)                                                       | Checks source and personal choice, but calls `transcribe` directly with resolved managed credentials                  | Fence managed provider/key/options/enabled state around transcription and all awaited source reads. Preserve text-plan/audio capability separation.                                           |
| Hosted maintained pages (`maintenance-model.ts`, `maintenance-runs.ts`, `maintained-pages.ts`) | Hosted model_origin captures personal-choice version; worker later hashes current provider/model and fences that hash | Capture managed identity at enqueue as well as during dispatch; do not infer an old queued run's original model from current settings. Retain page authority, source/lease and budget guards. |
| Plugin inference (`plugin/inference-broker.ts`)                                                | Independent managed permission already captures provider/model/revision and checks live rows under locks              | Preserve the separate broker and authority; reuse a shared managed identity primitive without converting MCP/plugin permission into personal provider consent.                                |

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

## C1 reasoning/cache controls candidate — 7 October 2026

Local, uncommitted checkpoint on `codex/docs-owned-editor-activation`; not shipped.
Shared capability validation and managed Responses controls are wired to web and
mobile provider forms. Provider saves support an expected saved revision; omitted
fields derive from the locked row. Model selection locks settings before the
provider and validates that saved pair, preventing concurrent option edits from
committing an unsupported active configuration. The shared API client now carries
these controls and the optional revision.

Fresh marked database `orbyn_model_controls_20261007_test`: controls integration
and unit cohort passes 19/19, zero failures/skips, terminal exit 0. Evidence:
`/tmp/orbyn-c1-controls-integration-final-20261007.log`. Cases include 401/403,
malformed JSON 400, strict option rejection 422, rate limit 429, persisted controls,
active model refusal, reset, stale save 409, secret omission and pre-dispatch
refusal. Initial test incorrectly expected schema validation 400; Orbyn's active
schema contract is 422. Corrected that assertion and separately covered malformed
JSON 400; original failed log retained. No external provider was called.
Shared packages build and backend/web/mobile typechecks pass. Browser preview
5174 responds 200; mobile browser 8083 is currently unavailable and needs restart.
Visual acceptance is outstanding, including provider action crowding and long
provider identity. Durable per-job usage/reporting and real permitted
cost/latency/quality evaluation remain outstanding; observed fixture token counters
prove parsing only. Full regression and main promotion remain pending.

### Controls follow-up: usage display and embedding separation

Both admin clients now display observed test input/output/cached-input/cache-write/
reasoning counters through one shared formatter. Unknown stays unavailable, zero
stays zero, and no token totals, costs or plan limits are invented. This is test
usage only; durable job accounting remains open. Generation options no longer
block embedding connections sharing the same provider: embedding resolution
retains connection fields and excludes generation-only controls, while generation
continues to refuse unsupported combinations. Regression covers both behaviors.

Latest provider/control/managed-authority/Responses cohort passes 59/59 with zero
failures/skips, exit 0: `/tmp/orbyn-c1-controls-provider-cohort-20261007.log`.
Latest packages build and web/mobile types pass. Mobile preview restored on 8083;
API8008 and web5174 respond. QA-013 capture-only request dispatched to existing
Orbyn Visual Check session; builder inspection pending. Disabled OpenAI QA fixture
contains only a fake key; no catalog/test/inference calls authorized for captures.
Mobile provider identity now uses two collapsed lines and fully wraps when expanded;
visual acceptance remains pending rather than inferred from source/typechecking.

### Durable saved-assistant usage candidate

Migration255 introduces content-free owner/job counters with 30-day sweeper
retention, deletion cascades and hashed response deduplication. Default managed
and explicitly consented managed fallback wire the recorder. Privacy opt-out
prevents new collection. Response counters are recorded before result acceptance,
including reported incomplete output; no result/tool authority is weakened.
Missing provider identifiers receive unique observation identities, not a false
claim of retry equivalence. Aggregates stay unknown when any response lacks a
counter or a sum exceeds JavaScript's safe integer range. No prompts, replies,
raw provider response IDs or credentials enter this table.

Authenticated `/ai/usage` is owner-only; on-demand workspace-provider usage
controls are implemented in web/desktop and mobile Settings. Account/token changes
abort requests and hide earlier-account measurements. Privacy source and API docs
describe the scope and limits. Legal default revision updates to
`2026-10-07-managed-usage`; custom workspace policy acceptance remains governed by
existing legal-settings behavior. These are saved-assistant managed Responses
measurements, not other feature totals, ChatGPT-plan limits or billing.

Durable controls/usage/authority cohort passes44/44, zero failures/skips:
`/tmp/orbyn-c1-controls-durable-usage-20261007.log`. Additional incomplete-output
unit cohort passes20/20, zero failures/skips:
`/tmp/orbyn-c1-controls-incomplete-usage-20261007.log`. Latest backend/web/mobile
checks pass (mobile refreshed after its SmallAction required prop correction).
Full combined regression and usage UI acceptance remain pending.

Root inspected QA-013 wide controls and narrow dark cache-selector screenshots.
Controls were present, but saves failed because preview API still held the old
loaded schema. Mobile sign-in was blocked by missing loopback CORS, not a proven
product authentication failure. Owned preview API restarted against current
candidate; migration255 applied to local `orbyn_ui_preview`; mobile CORS OPTIONS
now returns204 with the correct allowed origin. QA-013b viewport-only/save/reload/
mobile/usage captures requested. Sticky full-page compositing and tiny narrow
captures are insufficient to prove overlap acceptance; no broad visual pass claimed.
This whole checkpoint remains uncommitted/unmerged pending its remaining gates.

### Combined qualification and remaining visual evidence

Updated combined C1 controls, durable usage, provider authority, Responses, owner
UI and evaluation-harness cohort:69/69 pass, zero failures/skips, terminal0.
Log `/tmp/orbyn-c1-controls-combined-20261007.log`. Shared packages and all three
client/backend typechecks pass. Usage UI executes real component hooks in the
harness: on-demand loading, unknown counters/opt-out presentation, account switch
and delayed old-session response rejection on both apps (4 cases).

Exact generation `controls_revision` now fences new UI saves, avoiding millisecond
Date serialization collisions. Older clients retain timestamp revision support.
Integration forces identical displayed timestamps with changed options and proves
that the generation-based stale save receives409. Omitted fields still preserve
locked current configuration. Empty base URLs normalize to the documented default.

Fixed-text evaluation harness exercises off/implicit/explicit caching twice each
and records observed usage, latency and a minimal exact-output verdict. The CLI
requires explicit EVALUATION_MODEL/EVALUATION_OPENAI_API_KEY/EVALUATION_OUTPUT and
sends six managed requests. Its two mocked cases pass and do not prove real cache
hits, billing savings or general quality. No live provider call performed; real
permitted measurements and broader quality/cost acceptance remain open.

QA-013b manifest records successful web save/reload and restored mobile login,
but original saved JPG metadata contradicts adequate viewport evidence: 1440
capture is702x810 and 320 capture156x180. Root inspected examples; controls/actions
are clipped or unreadable. QA-013c requests original readable pixels and reports
actual pixel size separately from CSS viewport. Do not mark broad visual acceptance
from the small captures. Provider Edit/Delete now use an owned Popover management
menu; narrow Model cell occupies full row width with wrapping primary actions.
These layout edits still need screenshot acceptance. Full regression/main promotion
remain pending; C1 and the whole ADR stay active.

### Candidate freeze for full regression

All listed controls/usage/evaluation/UI edits are being committed as a candidate
freeze so full regression can run against immutable Git source. This is not a main
promotion or visual acceptance. Latest provider-layout source cohort passes5/5:
`/tmp/orbyn-c1-provider-layout-20261007.log`. QA-013c readable screenshots remain
pending. Real permitted latency/cache/cost/quality evidence remains an external
acceptance gate; mocked harness output is not that evidence. Main stays3c8feb40.

### Frozen61aae46f qualification — terminal failure

Candidate37-file checkpoint committed as61aae46f; frozen integration worktree
fast-forwarded to that commit with generated untracked Watch/widget assets kept.
Full regression started against fresh marked `orbyn_full_61aae46f_test`,464 files:
`/tmp/orbyn-adr-full-61aae46f-20261007.log`, session73833 is terminal, exit1. Full regression finished4042 passed,1 failed,
zero skipped (4043 cases,787186ms). The sole failure is route inventory:
GET /ai/usage was not classified. No full pass claimed. Frozen packages/backend build and web/mobile types pass.
Candidate web build and Home prerender pass.

Existing clean release-qualification worktree reused on a new
`codex/c1-controls-main-qualification` branch from main3c8feb40. Only61aae46f's
scoped patch applied; core export added separately to exclude unrelated candidate
Docs/native exports. Main checkout/user files remain untouched. Fresh marked
`orbyn_main_controls_61aae46f_test` applies main migrations254/255 without253.
Focused cohort74/74 passes, no failures/skips, exit0; packages/backend/web/mobile
types and backend/web production builds pass. Missing locked local
react-native-webview13.16.1 was restored from the existing installed exact version;
no manifest/lockfile edits. Main production build retains its large-chunk warning.

Actual compiled prepared-main runtime probe passes two-step Responses read/tool
recovery, selected high reasoning and explicit prefix breakpoints, encrypted
checkpoint/cleared completion, and owner-only persisted usage matching both fixture
responses. Evidence `/tmp/orbyn-main-controls-compiled-probe-20261007.log`;
requests2, done, measured responses2, external requests0. No fixture output proves
real provider cache hits, pricing, plan eligibility or installed-native acceptance.

Root inspected readable dark390 cache menu: bounded within the viewport, labels
and selection visible. OtherQA-013c PNGs still clipped relevant controls despite
larger file dimensions; requested unclipped physical pixel capture with CSS
viewport, DPR/scale and actual dimensions. New local legal acceptance screen now
blocks mobile recapture; user confirmation requested for that disposable account.
The agent must not accept pending consent until the user answers. Main promotion
and whole checkpoint acceptance remain pending.

### Usage route boundary correction

The missing inventory entry is classified as an account route, preserving its
first-party owner-only scope. The route now explicitly checks session principal
before reading usage, and integration coverage refuses personal API keys without
returning measurements. Focused controls, route inventory and API-key regression
pass20/20, zero failures/skips, exit0; backend typecheck passes. Evidence `/tmp/orbyn-c1-usage-boundary-20261007.log`. This follow-up is
a candidate correction and is not promoted to main. Full regression must be rerun on the new freeze.

### Correction qualification and preview provenance

Frozen31111112 is under fresh full regression on its own marked database, live
session96838, `/tmp/orbyn-adr-full-31111112-20261007.log`. Previous61aae46f run is
terminal failed and was not restarted. Prepared-main patch independently passes
20/20 controls, API-key and inventory cases, zero skips/failures,5774ms:
`/tmp/orbyn-main-usage-boundary-20261007.log`. Main remains3c8feb40.

Both listeners on8083 were owned Expo processes from the candidate mobile directory.
Stale localhost-onlyPID31340 was stopped to remove ambiguous bundle provenance;
currentPID92851 remains. Agent instructed to reload127.0.0.1:8083 and wait for user
confirmation of updated local Terms. No provider calls or legal acceptance made.

### Documented model completeness follow-up

Official docs fetched7 October2026 confirmgpt-5.6-sol andgpt-5.6 alias use
none/low/medium/high/xhigh/max reasoning and modern caching. Both were absent
from the controls allowlist despite being documented. Candidate adds both exact
identities and the same per-model contract tests; no selected default changes.
Sources: https://developers.openai.com/api/docs/models/gpt-5.6-sol and
https://developers.openai.com/api/docs/guides/prompt-caching . Live provider access
or entitlement is not established by these docs. Frozen31111112 full run remains
unchanged; this follow-up passes24/24 model-controls/evaluation cases, zero failures/skips,
exit0; shared package builds pass. Log:
`/tmp/orbyn-c1-model-completeness-20261007.log`. A later full freeze is required.

### Usage retry/cancellation qualification

Prepared-main latest documented-model follow-up passes24/24 model/evaluation
checks and complete workspace typechecks, exit0. Logs:
`/tmp/orbyn-main-model-completeness-20261007.log` and
`/tmp/orbyn-main-controls-latest-types-20261007.log`.

Both real usage components now have additional hook-harness cases for rejected
loads, refresh clearing stale errors, renewed requests and cancellation when
collapsed. Eight usage UI cases pass, zero skips/failures:
`/tmp/orbyn-c1-usage-ui-errors-20261007.log`. Product UI source is unchanged by
this test-only follow-up. Migration255 owner/job cascades, bounded nullable
counters and the fixed30-day sweeper match the saved-assistant privacy paragraph.
This source audit does not replace live-provider or visual acceptance.
Frozen31111112 full regression continues; latest observed completed case1448.

### Prepared-main scope inspection

33 promoted product/test files match the latest candidate byte-for-byte.
Three broader files deliberately differ: capabilities exclusions omits the
unrelated native refresh-identity endpoint; API docs omits pending P-256/native
receipt contracts; API client omits pending native identity refresh and unrelated
profile freshness changes. The main core index adds only ai-model-controls;
no migration253/native OAuth or unrelated Docs implementation is introduced.
Prepared-main usage UI regression also passes8/8, zero failures/skips,912ms:
`/tmp/orbyn-main-usage-ui-errors-20261007.log`.
Frozen31111112 remains live; latest completed case2655, no reported failure yet.
No terminal full pass or main promotion is claimed.

### Catalog correction after terminal regression

Frozen31111112 full regression finished4043 passes,1 failure,zero skips,
exit1,814973ms. The sole failure is mcp-catalog generation: the new account-route
exclusion raised the excluded route count. Generated catalog and MCP docs had not
been refreshed. Tools/grants/request schemas are unchanged. Candidate regeneration
changes excluded290 to291 and passes4/4 catalog cases.

Exact-main0f446664 has the same stale-count issue (excluded289 must become290).
Its full run was deliberately terminated after confirming that mismatch; last
completed case829, runner terminal exit1. No full pass or complete failure count
is inferred from the interrupted TAP log. Generated files were refreshed only
after termination. The corrected main catalog/model/evaluation/usage UI cohort
passes36/36, zero failures/skips, exit0,1628ms:
`/tmp/orbyn-main-c1-catalog-contract-20261007.log`. Candidate catalog4/4 log:
`/tmp/orbyn-c1-catalog-refresh-20261007.log`. A new exact-main full freeze is required.

Exact0f446664 backend/web builds and Home prerender pass (existing chunk warning).
Rebuilt compiled API probe passes401/403 usage access, two-step durable Responses,
encrypted checkpoint/completion and owner counters with zero external requests:
`/tmp/orbyn-main-controls-0f446664-compiled-probe-20261007.log`.
Compiled aggregation probe independently passes overflow unknowns, anonymous
observation identity,30-day exclusion and job deletion cascade:
`/tmp/orbyn-main-controls-0f446664-aggregate-probe-20261007.log`.

### Corrected exact-main run and preview alignment

Release qualification is frozen atc082d93e on main3c8feb40 with regenerated
catalog counts. Fresh full regression is live as session29017 against
orbyn_full_main_c082d93e_test,442 files; complete protected log
`/tmp/orbyn-adr-full-main-c082d93e-20261007.log`. Last observed completed case715;
no terminal result or full pass claimed. Both preceding runners are terminal.

Preview provenance was checked from actual listener/CWD. OwnedAPI8008 retained
older loaded source although its working directory was the candidate. SIGTERM
closed the listener but the process failed to exit in the bounded wait, so the
first guarded replacement aborted. After verifying the same owned process and
empty port, it was terminated and rebuilt compiled releaseAPI started with the
same orbyn_ui_preview database and settings. NewPID11903/session9004 health200.
Log `/tmp/orbyn-c1-preview-api-c082d93e-20261007.log`. QA data preserved, SMTP off;
no provider inference or legal acceptance performed. Capture agent notified to
reload after explicit local Terms confirmation. Main remains3c8feb40.

### Capture-method evidence correction

Root inspectedQA-013c-web-terms-blocker-fromSurface-false.png original2560x1440:
it contains Codex conversation chrome on the left and black pixels on the right,
not the target Orbyn page or legal gate. It is rejected as product/blocker pixel
evidence. The updated Terms blocker remains supported only by the agent's recorded
accessibility state. Requested one public local landing-page Chrome/native capture
for method calibration, no login or consent. Capture agent remains screenshot-only;
root owns analysis. No visual completion claimed.

### Chrome capture calibration accepted

QA-013d corrected the unsupported Chrome visibility option using documented
Chrome options. Root inspected the original1728x871 JPEG: actual local Orbyn
landing page, readable, no black region or tiled Codex surface. Accepted only as
capture-method calibration. It does not qualify C1 Admin/provider/usage layouts or
the whole landing page. OriginalJPEG is primary; PNG re-encoding is unnecessary.
Manifest: `/Users/anhdang/.codex/visualizations/2026/10/07/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/QA-013d-capture-manifest.md`.
Updated local Terms confirmation still blocks signed-in C1 captures. Agent told
to await that dependency and capture only; root inspects images. Corrected full
mainc082d93e continues as session29017; no full pass or main promotion claimed.

## Exact-main C1 regression qualified — 7 October 2026

Frozen release scopec082d93e completed full backend regression3722/3722,
zero failures/cancellations/skips, terminal exit0,868170ms. Session29017 is
terminal. Complete log `/tmp/orbyn-adr-full-main-c082d93e-20261007.log`.
This is the actual main-based442-file test suite, not the broader candidate's
464-file/4044-case scope. Neither historical failed run is presented as passing.

The production/test files remain unchanged from that freeze. All workspace types,
backend/web builds/Home prerender and independent compiled runtime/aggregation
fixture probes passed. No real provider inference, cache economics, installed
native acceptance or whole C1 completion is established. Main stays3c8feb40.

Remaining current-checkpoint gates: signed-in web/mobile screenshots using the
now-working Chrome method (local updated Terms confirmation pending), live
permitted managed-provider cache/latency/quality evaluation, then scoped main
integration when acceptance is sufficient. Local process has no evaluation key;
a names-only inspection finds no managed OpenAI/evaluation key variable in
.env.production. No secret values were printed or changed. Later C1 embedding/
multi-provider matrix and C2/M1-C6/D1/U1 remain required; no final cleanup.

## Generation-control/embedding revision correction

### Separate pgvector integration qualification

Fresh marked `orbyn_compiled_main_256_test` also passes both compiled main probes
with migration256 applied. Runtime proves selected high/explicit controls,
two-step durable tool recovery, encrypted intermediate checkpoint, done-state
cleanup, two owner observations and401/403 usage boundaries. Aggregation proves
overflow stays unknown, anonymous observations remain distinct, expired rows are
excluded and job deletion cascades. External provider requests:0.
Logs: `/tmp/orbyn-main-256-compiled-runtime-20261007.log` and
`/tmp/orbyn-main-256-compiled-aggregation-20261007.log`.
Git comparison confirms backend/shared/client product source is unchanged between
the previously compiledc082d93e and66f7a5f2; only migrations/tests/docs changed.

An existing pgvector16 image ran in the owned tmpfs fixture
`orbyn-c1-vector-qualification-20261007`, loopback55437; no image download or
user-container/engine restart. It was removed after all12 checks completed;
evidence logs remain. Integration files are outside npm test's
`tests/*.test.ts` selection and therefore require explicit qualification.
The initial setup run reproduced two stale assertions (3 passed/2 failed):
`options=options` was incorrectly used to simulate connection changes. Log:
`/tmp/orbyn-c1-256-vector-setup-repro-20261007.log`.

Test-only7934c26b replaces those changes with actual apiVersion edits and proves
no-op/generation-only updates preserve consent and measured search. Separate
schema/setup tests pass9/9, Azure indexed vector storage/cosine search1/1,
pre218 legacy consent/vector cleanup1/1, and late extension installation1/1.
Late installation restores a fresh stock17 fixture into vector16, preserves
recorded migration history, queues the existing page and grants no consent.
Only pg_dump's unsupported PG17 SET transaction_timeout statement is removed
for that test-server restore; application schema/data is preserved.

Logs: `/tmp/orbyn_vector_256_matrix_test-20261007.log`,
`/tmp/orbyn-vector-256-azure-storage-20261007.log`,
`/tmp/orbyn_vector_256_upgrade_test-20261007.log`,
`/tmp/orbyn-256-late-extension-20261007.log`. All12 pass with zero skips/failures;
provider HTTP traffic uses local fixtures, not a real external account. Both
changed files pass scoped formatting. Product source and normal full-suite files
remain unchanged from66f7a5f2; its live regression is not restarted for these
separately executed integration tests/documentation. No full C1 acceptance claimed.

Main-based freeze66f7a5f2 independently passes29/29 focused checks on a fresh
marked database and backend typecheck. Full regression is running as session88045;
log `/tmp/orbyn-adr-full-main-66f7a5f2-20261007.log`. Earlier3722/3722 results
predate this correction; no new terminal full pass or main promotion claimed.
Preview255→256 upgrade and a repeated migration preserve all three provider
embedding/generation revision pairs. Log:
`/tmp/orbyn-c1-256-preview-upgrade-20261007.log`. No provider network calls.

Source audit found migration218 bumps embedding_revision on every provider UPDATE.
Reproduction changed only high reasoning/explicit caching and invalidated the prior
embedding binding (revision6 to7). New regression failed6/7 before the fix; log
`/tmp/orbyn-c1-embedding-controls-reproduction-20261007.log`.

Migration256 replaces only that trigger function: generation-only reasoningEffort,
cacheMode and cacheRetention, and updated_at, do not change the embedding token.
Existing captured tokens are preserved; previously invalidated consent is not
revived. Endpoint, credential, provider kind/name/key hint, enabled state and any
remaining transport options still invalidate the token monotonically. Generation
revision continues to advance for changed generation controls.

Expanded real API/database/resolver matrix covers all three generation fields,
endpoint change, key rotation, API version, disable and re-enable. Old invalidated
binding never resolves again. The combined controls/inventory/catalog/stock search/
embedding validation cohort passes29/29, zero failures/skips,7292ms; no provider
network calls. Log `/tmp/orbyn-c1-embedding-controls-matrix-20261007.log`.
Prior mainc082d93e3722/3722 full pass predates this correction. Fresh exact-main
qualification is required; no promotion or complete C1 stage claimed.

## Reviewed embedding consent visual acceptance — 8 October 2026

Root inspected QA022 web wide panel/narrow top and controls plus mobile320/390
upper and lower controls. Manifest: `/Users/anhdang/.codex/visualizations/2026/10/07/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/QA-022-search-by-meaning-capture-manifest.md`.
Only sampled OFF/prerequisite control containment is accepted; browser captures
do not prove installed-native behavior. The invalid wrong-tab390×219 screenshot
and pre-CORS mobile offline states are historical harness evidence, not current
product findings. No provider/consent/inference action was performed for captures.
Full3781/3781, focused48 plus independent stock20, upgrade/late-install1/1 each,
shared/backend/web builds and client types qualify the reviewed-revision fix.

Delivery receipt: reviewed embedding-consent checkpoint merged by fast-forward and
pushed to main as `43fa8f57` on8October2026. Root mobile/app.json SHA1 remains
`dacd602172347441f2fd92f16d8772b3ba1ef7a8`; unrelated tracked/untracked changes
are preserved. Production deployment is unconfirmed. Next active implementation
checkpoint is persistent indexing failure/retry status within C1.

## Indexing failure/retry checkpoint — qualification in progress, 8 October 2026

Source freeze `d77c1b76` is committed on the qualification branch, not main.
Migration257 adds bounded, sanitized per-page failure state independently of
pgvector. Failed attempts back off from60seconds to a maximum1hour; other due
pages continue. Success and failure acknowledgements both recheck the exact
configuration/provider revision, document version, visibility and queue identity
under the same transaction lock order. Admin and both clients expose the current
failed-page count and earliest retry due; stale/off configurations hide those
fields. Deployment must replace the measuring worker: older workers do not
honour the new backoff.

Final focused cohort:47/47, zero failures, skips or cancellations, exit0.
Log: `/tmp/orbyn-c1-embedding-retry-final-shield-20261008.log`. This covers
poison-page progress/recovery, exponential delay/cap, changed documents,
configuration/provider/project/team fences, compiled-process restart persistence,
repeated migration preservation, safe diagnostics, auth/permissions/parsing/rate
limits and both rendered client status components. Shared/backend builds and
desktop/mobile types passed independently.

Fresh stock PostgreSQL full regression is running as session52257, log
`/tmp/orbyn-c1-retry-full-20261008.log`; no terminal result claimed yet.
Actual active/error browser visual acceptance and remaining migration rollout
checks are still required before promotion. Prior consent qualification does not
qualify this newer source. Full C1 and the full ADR remain incomplete.

Additional retry rollout checks: pre218 pgvector upgrade1/1 passes on a fresh
marked fixture (`/tmp/orbyn-c1-retry-upgrade-20261008.log`). Fresh stock rollout
proves migration257 exists without vector tables, repeated migration preserves
attempt16, invalid attempt17/raw error enum are rejected, and page deletion
cascades the record (`/tmp/orbyn-c1-retry-stock-rollout-20261008.log`).
Temporary web/mobile browser routes render the actual status components using
explicitly labelled synthetic data with actions disabled. Visual Check has been
asked for originals; these will only prove component layout, not installed native
behavior or an enabled real settings-route session. Qualification source remains
frozen while the full run continues.

Late installation with recorded migration257 passes1/1 on a fresh stock fixture
restored into pgvector before extension creation. Only PG17's unsupported
PG16 session option `SET transaction_timeout=0` was removed from the test dump;
application schema/data and migration history were retained. Log:
`/tmp/orbyn-c1-retry-late-install-20261008.log`.

Root inspected all four QA023 Home originals at1278×900 and390×844. The badge
is contained below the hero platform line and absent from footer navigation.
Accept only this badge placement; no full Home/whole-app acceptance implied.
Manifest: `/Users/anhdang/.codex/visualizations/2026/10/07/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/QA-023-home-badge-capture-manifest.md`.

Retry full regression52257 has a confirmed failure in `agenda-private.test.ts`:
ChatGPT Agenda polling/publication deadlocks between the request-row UPDATE lock
and an `ai_jobs` SHARE-to-UPDATE upgrade in provenance recording. PostgreSQL
identifies both statements; log `/tmp/orbyn-c1-retry-deadlock-postgres-20261008.log`.
The embedding checkpoint cannot promote while this prerequisite regression fails.
A new actual-job-guard unit reproduction passes1/2 before correction
(`/tmp/orbyn-c1-inference-lock-before-20261008.log`): its lock must serialize job
writes before the request lock, while retaining source/consent checks. Product
source remains unchanged until the running full cohort is terminal.

Web production build passes (`/tmp/orbyn-c1-retry-web-build-20261008.log`).
Root inspected QA024 originals: web wide/narrow retry text and disabled controls
are contained. Initial mobile originals bypassed App's font bootstrap and used
a fallback serif font; they are excluded from typography acceptance. The
temporary fixture now loads App's actual Manrope/DM Sans set and theme provider;
Visual Check has been asked for refreshed mobile originals. No product font
change or real provider/consent action was performed.

### Corrected inference prerequisite and scoped retry layout acceptance

Original full regression52257 is terminal:3782passed,1failed,0skipped/cancelled,
exit1,824911ms. Its only failure is the recorded Agenda lock cycle; no full pass
is claimed. Correction `a1a1d773` serializes job authority with `FOR UPDATE OF j`
before any request-row lock. It preserves all source, lease and provider-choice
guards; no external request occurs under these locks.

The actual guard unit reproduction changes1/2 before to2/2 after. A controlled
real Agenda publication holds a competing SHARE job lock and probes the request
row with NOWAIT: the old order fails, the corrected order keeps the request
unlocked until job authority is obtained, then the signed completion succeeds.
Logs: `/tmp/orbyn-c1-inference-lock-race-before-20261008.log`,
`/tmp/orbyn-c1-inference-lock-race-after-20261008.log`. Broader Agenda/inference/
lease/provider-route cohort44/44 passes, zero skips/failures; backend build passes.
Log: `/tmp/orbyn-c1-inference-lock-matrix-20261008.log`.

Corrected source freeze `a1a1d773` now has a fresh full regression running as
session14318, log `/tmp/orbyn-c1-retry-full-corrected-20261008.log`. Do not restart
or claim main qualification before that process is terminal.

Root inspected both QA024 mobile font recaptures plus the accepted wide/narrow
web originals. Retry/offline text and disabled controls fit all sampled viewports
without overlap. The refreshed mobile samples use the real App fonts/theme;
earlier serif originals remain excluded from typography acceptance. Accept only
component containment with labelled synthetic state. Real settings-route, broader
UI and installed-native acceptance remain open within C1/U1. Manifest:
`/Users/anhdang/.codex/visualizations/2026/10/07/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/QA-024-mobile-font-recapture-manifest.md`.
Owned temporary fixture routes were removed after capture; mobile/index.ts was
restored exactly, with scoped status components/types retained in the preview.
Fixture sources are archived at `/tmp/orbyn-c1-retry-visual-fixtures-20261008`.

### Measuring-worker deployment prerequisite

Source audit found `deploy.sh` built/migrated the shared image but never replaced
the optional `measure` container. That would leave old workers ignoring persisted
backoff after the retry checkpoint. Correction817c8658 pauses existing measure
containers before migration, and starts/waits for the updated service only when
COMPOSE_PROFILES includes `semantic`. Profile-off leaves it stopped; queued pages
remain in PostgreSQL. A failed deploy after pause leaves it offline until a
successful retry/explicit start. No API downtime requirement is added.

Six semantic/PDF deployment checks pass, zero skips/failures; `bash -n` passes.
Log: `/tmp/orbyn-c1-retry-deployment-checks-20261008.log`. Actual shell helpers were
also run against an isolated Compose project using an already-installed image:
profile-off stop and profile-on start/readiness pass; its owned container was
removed. Log: `/tmp/orbyn-c1-retry-deployment-runtime-20261008.log`. Existing user
containers and production were not modified. This is lifecycle evidence, not a
production deploy or real-provider inference check.

Full backend regression14318 still uses the unchanged corrected backend source
a1a1d773; this independently qualified deployment-script addition does not restart
that live run. Main/origin remain bddd8783 after fetch; root unrelated changes and
mobile/app.json SHA1 remain preserved. No main delivery claimed yet.

Preview runtime upgrade: compiled source applies migration257 twice to the owned
`orbyn_ui_preview` database while hashes of all provider and AI settings rows
remain identical. Log: `/tmp/orbyn-c1-retry-preview-upgrade-20261008.log`. Only the
known preview API60704 was stopped; updated API75984 serves compiled source with
the same database/admin configuration and canonical CORS_ORIGINS, health200.
Mobile cross-origin /ai/providers preflight204. Log:
`/tmp/orbyn-c1-retry-preview-api-20261008.log`. No production or real-provider
request was made. Visual Check has been asked for current real Admin OFF-state
captures in web wide/narrow and mobile390; no consent/settings action authorized
for that capture. Full regression14318 remains live and is not restarted.

Final current-source backend/web/mobile typechecks all exit0. Logs:
`/tmp/orbyn-c1-retry-final-backend-types-20261008.log`,
`/tmp/orbyn-c1-retry-final-web-types-20261008.log`,
`/tmp/orbyn-c1-retry-final-mobile-types-20261008.log`. All changed TypeScript/TSX
and checkpoint docs pass scoped Prettier; the full candidate diff passes
`git diff --check`. These gates do not substitute for the still-live full
regression14318 or the requested real Admin capture handoff.

Corrected full regression14318 is now terminal exit0:3786/3786 passed, zero
failures/skips/cancellations,800227ms. Log:
`/tmp/orbyn-c1-retry-full-corrected-20261008.log`. This includes the actual Agenda
lock-order race plus job-authority guards on corrected backend freezea1a1d773.
The later deployment helpers/tests remain independently qualified6/6 plus the
isolated Compose lifecycle proof; no combined full3789 count is claimed.

Authenticated compiled preview Admin /ai/providers returns200 with semantic
search still OFF; active retry fields are absent rather than invented zero counts.
Only local auth/read endpoints were called; credentials/token were not printed.
Real Admin capture review remains the final requested handoff before main delivery.

Real QA025 originals were inspected by root. Web Search panel controls are
contained in wide/narrow samples; the wide frame's clipped surrounding sidebar/
heading is not whole-page acceptance. Mobile Search disclosure's focused heading
outline crossed the first body line. Added8pt body-top spacing to shared
Disclosure, preserving heading touch target and horizontal/bottom padding.
Both qualification and preview use the correction. Actual style/component checks
pass19/19 and mobile typecheck passes; logs:
`/tmp/orbyn-c1-retry-disclosure-checks-20261008.log`,
`/tmp/orbyn-c1-retry-disclosure-mobile-types-20261008.log`. Visual Check has been
asked for refreshed focused mobile originals; initial images are pre-fix evidence.
The backend source remains identical to the terminal3786/3786 freeze; this mobile
spacing correction is independently checked and does not rerun that backend cohort.
No whole-page/native/fullC1 acceptance or main promotion is claimed.

Root inspected both QA025 post-padding mobile originals. Focus outline is now
separated from the first body line; full Search controls remain contained. Accept
only this real OFF-state panel and the previously inspected web wide/narrow
panel samples, plus QA024 synthetic active/error component containment. No full
page/native/fullC1 acceptance implied. Recapture manifest:
`/Users/anhdang/.codex/visualizations/2026/10/07/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/QA-025-mobile-padding-recapture-manifest.md`.
The scoped retry checkpoint, inference lock/deployment prerequisites and mobile
focus spacing are locally qualified for main integration. Delivery is pending
the actual fast-forward/push receipt; production remains user-controlled.

Delivery receipt: scoped retry checkpoint merged by fast-forward and pushed to
main asd4da3d41 on8October2026. Main/origin matched after push. Root
mobile/app.json SHA1 remains dacd602172347441f2fd92f16d8772b3ba1ef7a8;
unrelated tracked/untracked changes are preserved. No production deployment or
whole ADR stage completion claimed. Next active C1 checkpoint is the retained
multi-provider dispatch/catalog/runtime inventory and permitted cache evaluation.

## Native Perplexity embedding delivery receipt — 8 October 2026

- Frozen source6ece8866: full4112/4112, no failures/skips/cancellations, exit0,
  duration849290.154875ms. Terminal session20230; log
  `/tmp/orbyn-c1-perplexity-full-20261008.log`.
- Source fast-forward merged and pushed to main as6ece8866. Primary unrelated
  files and mobile/app.json SHA1dacd602172347441f2fd92f16d8772b3ba1ef7a8 preserved.
- Generation/catalog compiled baseline1/3 passes; two failures reproduced in
  `/tmp/orbyn-c1-perplexity-generation-before-20261008.log`. The native Agent
  catalog resource and Responses output require a separate C1 correction.
- No live Perplexity key/inference, current UI/native acceptance, production
  deployment or whole-C1 completion is claimed. Finish remaining C1 gates,
  report the remaining ADR table, then pause before C2.

## Native Perplexity generation/catalog candidate — 8 October 2026

- Compiled reproduction1/3 →3/3:
  `/tmp/orbyn-c1-perplexity-generation-before-20261008.log`,
  `/tmp/orbyn-c1-perplexity-generation-after-20261008.log`.
- Native and custom resource/protocol separation, legacy model preservation,
  JSON fallback, signed tool continuation, actual serialized loop recovery,
  authority/cancellation, error sanitization and observed cache-count mapping:
  combined287/287, zero failures/skips, exit0;
  `/tmp/orbyn-c1-perplexity-generation-cohort-20261008.log`.
- Backend build passes:
  `/tmp/orbyn-c1-perplexity-generation-build-20261008.log`.
- Full frozen regression and main delivery pending. Native fixtures do not
  establish live vendor acceptance or finish C1. C2 remains queued; pause only
  after the remaining C1 acceptance gates and final remaining-ADR table.

## Native Perplexity generation delivery receipt — 8 October 2026

- Frozen sourcef71ef338: full4142/4142, zero failures/skips/cancellations,
  exit0,800029.4725ms. Terminal session64430;
  `/tmp/orbyn-c1-perplexity-generation-full-20261008.log`.
- Fast-forward merged and pushed to main asf71ef338. Main/origin verification
  follows the documentation receipt; unrelated primary files and mobile/app.json
  SHA1dacd602172347441f2fd92f16d8772b3ba1ef7a8 remain preserved.
- Actual preview Vite5174 (session68067) and Expo mobile-web8083 (session54697)
  restarted from the C1 qualification checkout. Both return200. Backend8008
  remains an older loaded runtime; no exact-backend acceptance is inferred.
- Visual Check's native Codex capture was denied. The same existing-browser
  lookup subsequently returned `Tab not found in browser 4`, which is not a
  website permission denial. A new tab in that same authorized browser and on
  that same5174 URL was requested; screenshots/acceptance remain pending.
- Local preview metadata confirms selected Matilda/matilda with embeddings OFF.
  Dedicated EVALUATION_OPENAI_API_KEY/EVALUATION_MODEL are unconfigured in the
  local env files. The earlier Matilda baseline is retained; it cannot qualify
  native OpenAI cache economics or an accepted live embedding provider.
- C1 stays active. C2/M1 remains queued; finish retained C1 acceptance, provide
  the remaining ADR table, then pause as requested.

## Searchable provider/model picker candidate — 8 October 2026

- Frozen sourceae099454 is a local committed candidate, not main delivery.
  Web provider/model pickers gain explicit search and bounded100-result rendering;
  the current selection is retained even outside that initial window. Search does
  not save or change the selected value. Manual model entry remains available.
  Mobile provider selection uses a compact control and searchable native Sheet;
  its existing hidden-provider policy and saved hidden selection are preserved.
- Actual component closures and existing management/probe/catalog/embedding
  controls pass61/61. New cases cover5000-model catalogs, filtered selection,
  empty/disabled choices, Escape/Tab focus, Home/End, ordinary typeahead,
  mobile busy guards and visibility policy. The harness does not prove native
  rendering or physical focus/geometry. Log:
  `/tmp/orbyn-c1-picker-cohort-20261008.log`.
- Backend, desktop and mobile typechecks pass. Backend/web builds pass. Fresh
  full regression runs against a separate marked owned test database:
  `/tmp/orbyn-c1-picker-full-20261008.log`. No terminal result yet.
- Visual Check was sent the frozen source for capture-only full viewport review
  on5174/8083, wide/390/320, Light/Dark and search/keyboard states. Root inspected
  the initial mobile390 light sheet: search and rows fit that frame. Remaining
  captures and their verified viewport/source manifest are pending; do not reuse
  QA026 mixed-source baseline images as candidate acceptance.
- Main stays0c407a0a. C1 live-provider/cache/embedding and remaining client/native
  gates stay open. The user requested a pause after all C1 gates finish, before C2.

### Rejected candidate and correction

- The first full run is terminal:4141/4153 pass,12fail, zero skips/cancellations,
  exit1,791939ms. Log `/tmp/orbyn-c1-picker-full-20261008.log`.
  One failure identifies the new mobile16pt label outside Orbyn's type scale.
  Eleven later Teams tests share a prematurely closed pool: top-level signing
  fixture awaits occur after the first tests registered, permitting early cleanup.
  No passing full qualification or main promotion is claimed for that run.
- Root inspected QA026 originals: empty web picker clips its right edge at320px
  in both themes. The popup auto width exceeded the width used for positioning.
  Source54f53b8c sets explicit bounded width/minimum, retains viewport margins,
  uses15pt mobile labels and adds actual-component geometry checks.
  Focused corrected cohort73/73 passes; all workspace typechecks and web build
  pass. Mobile320/390 sheet/search/no-match originals are contained; they are
  pre-type-scale correction and browser-only, without a native software keyboard.
- Test-only693066d5 initializes signing fixtures before any registration.
  Focused actual Teams installation cohort23/23 passes. No C5 product behavior
  is changed or declared accepted by this harness correction.
- A fresh full run is active at frozen product/test source693066d5, log
  `/tmp/orbyn-c1-picker-corrected-full-20261008.log`; terminal result pending.
  Visual Check was asked for corrected320px web and320/390 mobile originals.
  The1280px browser capture returned only918px of output: full wide-surface
  acceptance remains open. Native installed-client gates also remain open.

### Corrected capture review in progress

Root inspected corrected693066d5 originals from Visual Check: web320 Light/Dark
empty and cleared-search popup now fit within the viewport; the light Tab state
returns focus to Name. Mobile320 Light/Dark empty chooser and390 filtered results
keep their search/rows within the sampled control bounds after15pt correction.
The mobile capture reports DPR0.8 with400×925/488×1054 output for320×740/390×844
CSS targets; physical capture/viewport fidelity and native keyboard remain open.
Root requested a lower-list frame to prove the remaining provider rows are
reachable, plus a documented same-browser full-wide capture if supported.
No full C1 or installed-native acceptance is claimed. Await final manifest and
the same confirmed-live full regression before main delivery.

Actual compiled public catalog adapter checks independently pass for DeepInfra
(181 unique sorted models) and ZenMux (201). This used no credential, paid
inference or private content. Receipt:
`/tmp/orbyn-c1-public-catalog-live-20261008.json`.

### Corrected picker qualification — terminal

Frozen product/test source693066d5 passes full4155/4155, zero failures/skips/
cancellations, exit0,791435.589833ms. Terminal session49949, log
`/tmp/orbyn-c1-picker-corrected-full-20261008.log`. No rerun of the failed freeze
is presented as passing. Scoped73/73, Teams23/23, workspace types and web/backend
builds remain separate supporting receipts.

Root inspected corrected narrow originals, including empty and cleared search in
both web themes, Tab focus to Name, mobile320/390 empty/filtered controls and
the scrolled bottom showing Nebius fully reachable. A documented full-page
same-browser attempt now returns1280px width; Visual Check retained only a
credential-safe1280×480 crop. Root inspected this crop's form/popup positioning;
it is not retained full-surface or complete-list/native acceptance. Manifest:
`/Users/anhdang/.codex/visualizations/2026/10/07/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/QA-026-C1-picker-correction-693066d589bb703dd5f63cd431abbb0fc0765e13-capture-manifest.md`.
The corrected picker/test harness checkpoint is qualified for main integration.
C1's remaining live-provider/cache/embedding and client/native gates stay open.

Three task-created, terminal disposable stock test databases were retired after
checking their test marker and zero sessions. Active corrected-full and preview
databases, logs, user Docker containers and unrelated work remain preserved.

## Scoped picker delivery and refreshed API — 8 October 2026

Corrected picker, bounded geometry and test-fixture lifecycle checkpoint was
fast-forwarded and pushed to main as1438b0bd. Main/origin matched. Unrelated
primary changes, including mobile/app.json, were preserved. Qualification source
remained clean. Corrected frozen regression:4155/4155, zero failures/skips/
cancellations, exit0; prior failed run remains recorded.

Owned preview API8008 was restarted from this qualification source with its same
explicit environment and preview database. /health returns200. Disposable QA
login followed by authenticated /me and /ai/providers both return200; the same
four saved providers remain. No configuration, embedding consent or external
provider call was made. Receipt:
`/tmp/orbyn-c1-current-preview-auth-check-20261008.json`.

Visual Check was asked for current-source management/edit captures only, without
Save/Test/Load or external calls; root acceptance remains pending. C1 retains
its live-provider, cache benchmark, embedding and broader client acceptance
gates. Pause only after completing C1 and supplying the remaining ADR table.

## Successful indexing access races and recovery — 8 October 2026

Added two real PostgreSQL/pgvector integration cases to
`backend/tests/embedding-access-races.integration.ts`: team AI permission revoked
after the inert recipient receives the request, and a private page moved into
a kept-out team before the reply. Both discard successful vector output and
retain queued work. An additional measuring attempt while kept out does no work;
restoring permission indexes the page once, clears the queue and stores only a
fresh authorized vector. The recipient mutation executes exactly once.

Current dedicated CI vector cohort passes56/56, zero failures/skips/cancellations,
exit0; backend typecheck passes. Logs:
`/tmp/orbyn-c1-access-vector-corrected-cohort-20261008.log` and
`/tmp/orbyn-c1-access-types-20261008.log`. Product source is unchanged.
Separate original upgrade test passes1/1 on a fresh marked vector database;
late-extension test passes1/1 on a stock schema/data fixture restored into the
vector server without its extension. Logs:
`/tmp/orbyn-c1-access-upgrade-20261008.log` and
`/tmp/orbyn-c1-access-late-restored-corrected-20261008.log`. The restore removes
only PostgreSQL17's unsupported `SET transaction_timeout = 0` header for the
PostgreSQL16 target; schema/data and migration history remain intact.

Harness failures are retained: the initial mixed cohort30/32 failed because
late-install and upgrade require independent fixture databases, not an already
migrated vector database. A blank late-install database then failed its required
restored-stock-fixture prerequisite; the first17→16 restore failed on the header
above. None establishes a product regression; corrected fixture runs pass.
No real vendor content, provider configuration, embedding consent or production
database was touched. Remaining live-recipient, benchmark and client gates stay
open; this checkpoint does not complete C1.

### Access-test delivery and current-source management captures

The access-race/recovery test checkpoint is merged and pushed to main as9921c086;
main/origin matched. The backend product source is unchanged from1438b0bd.
Unrelated primary changes remain preserved.

Root inspected original Light/Dark wide-web provider control columns and edit
form crops, plus narrow-mobile summary/edit form crops. The sampled controls
are contained; empty model rows show disabled Test and saved model fields retain
their values. The summaries/forms fit their sampled bounds. Credential-safe
crops intentionally exclude key columns and lower form actions; this is not
whole-surface, native keyboard or positive Test acceptance. No cached catalog
was present, so the agent did not load one or invoke existing providers. Manifest:
`/Users/anhdang/.codex/visualizations/2026/10/07/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/QA-026-C1-provider-management-edit-1438b0bd-capture-manifest.md`.

After that capture batch completed, root added one disposable LM Studio provider
to the owned local preview, pointing only to127.0.0.1:18089/v1. The original four
rows and selected assistant/embedding settings remain unchanged. The inert
recipient serves250 synthetic catalog IDs and fixed built-in ping responses,
with explicit usage and zero cached tokens. Visual Check is authorized to
Load/Test only this row and capture success/model-change/empty-model states.
No vendor calls, credential entry, settings save or embedding consent is allowed
in that batch. Root owns screenshot review and subsequent fixture removal.
Temporary row metadata: `/tmp/orbyn-c1-ui-inert-provider-row-20261008.json`;
server/state paths use the matching `orbyn-c1-ui-inert-provider` prefix.

## Cache benchmark estimate candidate — 8 October 2026

Fetched current primary OpenAI prompt-caching guidance. Modern Off mapping
(explicit mode with no breakpoints) matches its documented behavior; no runtime
control repair is needed. The standalone benchmark previously returned counters
and latency without a cost comparison. Candidate23773ee6 now reports an
estimated input cost in ordinary-input-token units for the explicitly documented
GPT-6.1 Sol ratios: uncached1x, writes1.25x, reads0.05x. It subtracts read/write
subsets from total input before weighting and never double-counts them.
Unknown models, missing/null/invalid/contradictory counters remain unknown.
Output charges, discounts, account pricing and actual billing are excluded.
Primary source: [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching#how-caching-works).

Focused5/5, backend typecheck/build and scoped format/diff checks pass.
Logs: `/tmp/orbyn-c1-cache-estimate-focused-20261008.log`,
`/tmp/orbyn-c1-cache-estimate-types-20261008.log`,
`/tmp/orbyn-c1-cache-estimate-build-20261008.log`. A fresh frozen full regression
is running against a dedicated marked stock database; log:
`/tmp/orbyn-c1-cache-estimate-full-20261008.log`. Source is not promoted yet.
This is a fixture-qualified estimate/report improvement, not live cache economics
or billed-cost verification. Matilda's functional baseline remains separate.
Root requested the missing authorized OpenAI evaluation key/model configuration
without asking the user to paste a credential. C1 stays active.

### Inert provider positive-state visual batch — partial root review

Root inspected web Light catalog search and changed-model receipt removal,
plus Dark successful local Test receipt. The filtered250-ID catalog, observed
12 input/1 output/0 cached-input counters and local model edit fit their sampled
bounds. No vendor/model entitlement is established.
The first mobile provider-card crop is entirely blank; root rejected it as
unusable capture evidence and requested recapture through Visual Check. The
batch/manifest and both-client acceptance are pending. Root has not removed
the temporary inert provider/server while that authorized batch is live.

### Cache estimate frozen regression — terminal qualification

Frozen23773ee6 source passes4158/4158 in the fresh marked stock database,
zero failures/skips/cancellations, exit0,784294.837291ms. Log:
`/tmp/orbyn-c1-cache-estimate-full-20261008.log`. Focused5/5 and backend
typecheck/build also pass. Later413e0fba is documentation-only. The estimate
is qualified for scoped main integration; it does not complete the live
OpenAI cache benchmark or full C1. No vendor request was made by these tests.

Root's current mobile screenshot review found an exact-match model filtering
defect. The actual component closure reproduces40 chips rather than the single
late model. Isolated correctiona8ad5a8e passes actual picker/component15/15,
extended Admin AI/layout cohort52/52, backend/mobile types. It remains outside
this frozen source/main pending corrected browser captures. See
`c1-mobile-model-search-review.md` in the mobile candidate checkout.
