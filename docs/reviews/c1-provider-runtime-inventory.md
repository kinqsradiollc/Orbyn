# C1 provider runtime inventory

Source audit: 8 October 2026, current checkpoint delivered on main `2186dcb9`.
This inventory records Orbyn's dispatch contract, not vendor-wide certification.
Definitions: `packages/core/src/aiProviders.ts`; resolution:
`backend/src/modules/ai/providers/resolve.ts`; adapters:
`backend/src/modules/ai/providers/adapters.ts`.

| Saved kind        | Catalog contract                                                    | Generation transport                                  | Embedding adapter                                                     |
| ----------------- | ------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| openai            | GET /models, data IDs                                               | Responses                                             | Compatible /embeddings                                                |
| anthropic         | GET /models, native cursor pages                                    | Messages                                              | Explicitly unsupported                                                |
| gemini            | Compatible /models                                                  | Chat Completions                                      | Compatible probe required                                             |
| openrouter        | Compatible /models                                                  | Chat Completions                                      | Compatible probe required                                             |
| zenmux            | Compatible /models                                                  | Chat Completions                                      | Compatible probe required                                             |
| matilda           | Compatible /models                                                  | Chat Completions, schema and request limits           | Compatible probe required                                             |
| groq              | Compatible /models                                                  | Chat Completions                                      | Compatible probe required                                             |
| azure             | Manual deployment name, no catalog fetch                            | Deployment Chat Completions, apiVersion               | Deployment embeddings, apiVersion                                     |
| openai-compatible | Compatible /models                                                  | Chat Completions                                      | Compatible probe required                                             |
| opencode          | Compatible /models, public key if blank                             | Reviewed per-model Responses/Messages/Gemini/chat     | Compatible probe required                                             |
| lmstudio          | Compatible /models, local key handling                              | Chat Completions                                      | Compatible probe required                                             |
| ollama            | Compatible /models, local key handling                              | Chat Completions                                      | Compatible probe required                                             |
| deepseek          | Compatible /models; hidden from add picker                          | Chat Completions                                      | Compatible probe required                                             |
| together          | /models, native array normalized                                    | Chat Completions                                      | Compatible probe required                                             |
| fireworks         | Compatible /models                                                  | Chat Completions                                      | Compatible probe required                                             |
| mistral           | Compatible /models                                                  | Chat Completions                                      | Compatible probe required                                             |
| xai               | Compatible /models                                                  | Chat Completions                                      | Compatible probe required                                             |
| perplexity        | Saved root /models currently returns404; native catalog is separate | Legacy Chat Completions; native migration under audit | Candidate native signed-int8 /v1/embeddings; custom compatible floats |
| deepinfra         | Compatible /models                                                  | Chat Completions                                      | Compatible probe required                                             |
| nebius            | Compatible /models                                                  | Chat Completions                                      | Compatible probe required                                             |

A compatible embedding adapter does not establish that the vendor serves the
selected model or dimensions. Reviewed-destination consent and a successful
validation probe are required before indexing. Reasoning/cache controls are
validated by model and request format; a compatible URL does not enable every
control. Private ChatGPT transports and plugin/MCP authority remain separate.

## Concrete gap: Anthropic catalog pagination

[Anthropic's primary reference](https://platform.claude.com/docs/en/api/models/list)
specifies `after_id`, `has_more`, `last_id`, and a default page size of20.
The existing adapter read one response and ignored continuation fields.
A two-page fixture reproduced the omission:19 tests pass, one fails because
only `b` is returned instead of `a,b`.

Candidate pagination preserves the saved endpoint and authentication headers,
encodes the opaque cursor as a single query value, and shares one eight-second
signal across requests. Cycles, malformed metadata, more than100 pages or100000
entries fail with a sanitized catalog error. Later-page errors reject the whole
catalog; no partial result is published. Compatible catalogs retain their prior
single-response contract. Azure remains manual. Legacy Anthropic fixtures with
no continuation fields retain their single-page behavior.

Evidence: `/tmp/orbyn-c1-pagination-before-20261008.log` (19pass/1fail),
`/tmp/orbyn-c1-pagination-after-20261008.log` (34/34).
The adapter/catalog-authority/provider cohort passes49/49 with zero failures,
skips or cancellations (`/tmp/orbyn-c1-pagination-cohort-20261008.log`).
Backend typecheck passes. Source-frozen full regression passes3806/3806, zero failures/skips/cancellations,
exit0,804189ms (`/tmp/orbyn-c1-pagination-full-20261008.log`). No live Anthropic
call or whole-stage acceptance is claimed.

## Per-kind fixture qualification

`backend/tests/provider-runtime-inventory.unit.test.ts` resolves a saved row for
all20 kinds through the actual connection resolver, rather than constructing
adapter formats directly. Its independent kind list requires new providers to
be reviewed.61/61 checks pass in
`/tmp/orbyn-c1-runtime-inventory-20261008.log`:

- Direct generation URL, authentication and response decoding for every kind.
- Catalog/manual-deployment behavior, compatible embedding request/model/input
  and native Anthropic embedding refusal for every kind.
- Blank local/public keys for LM Studio, Ollama and OpenCode.
- Durable agent starting mode and parsed tool call for every kind; Matilda sends
  its JSON schema with no native tools, OpenAI uses stateless Responses, and
  Anthropic uses native Messages tool blocks.

These are mocked HTTP responses with inert content. Saved endpoint overrides
are intentional; the tests do not certify a vendor's public default address,
model availability, embedding product, pricing, controls or live tool support.
The full regression was started before this additional test file existed;
its terminal count must be reported separately from these61 checks. Product
adapter source remains frozen at `cee9219e`.

## Reproduced and repaired: Anthropic JSON fallback

The durable loop (`agent/loop.ts:415–420`) switches to JSON mode after a native
HTTP400 tool-support rejection. Before correction, `jsonStep()` called the compatible
`chatUrl()` even for native Anthropic. A mocked first response rejects tools;
the actual second step requests `/v1/chat/completions` and fails404 instead of
remaining on `/v1/messages`. This is a concrete runtime defect, not a vendor
capability assumption. Reproduction:
`/tmp/orbyn-c1-anthropic-json-fallback-before-20261008.log`.
The actual durable `runAgent()` loop independently reproduces the same first
Messages request → wrong compatible request →404, with an inert tool and no DB
reads/writes: `/tmp/orbyn-c1-anthropic-json-loop-before-20261008.log`.

The initial10-case fallback suite had5pass/5fail. Failures covered wire
shape/usage, actual durable-loop recovery, resumed history, truncation and
post-response authority. HTTP400/401/403/429/500 sanitization already passes.
Log: `/tmp/orbyn-c1-anthropic-json-suite-before-20261008.log`.
The repair preserves native Messages authentication/system/conversation shape,
JSON tool parsing, native usage once, authority, timeout and truncation.
Expanded focused cohort145/145, backend build, compiled actual loop and full
frozen regression3880/3880 pass. Merged/pushed as `eb493433`; documentation
receipt is `8749f5f1`. This uses the fallback-specific evidence, rather than the
earlier61 starting-mode checks. Live vendor qualification remains separate.

## Primary-documentation spot checks

- [Groq models](https://console.groq.com/docs/models) documents its active-model
  catalog at `/openai/v1/models`; the saved default path matches. Its
  [compatibility guide](https://console.groq.com/docs/openai) describes partial
  OpenAI compatibility. This does not qualify embeddings or every model's tools.
- [LM Studio model listing](https://lmstudio.ai/docs/developer/openai-compat/models)
  documents its compatible model endpoint. Its [developer overview](https://lmstudio.ai/docs/developer)
  lists compatible chat/Responses/embedding support. Loaded models, server auth,
  local network reachability and model-specific tools require runtime validation.
- [Gemini compatibility](https://ai.google.dev/gemini-api/docs/openai) documents
  the saved `/v1beta/openai` base, Bearer auth, model listing and embeddings.
  Reasoning mappings vary by model and require separate control qualification.
- OpenRouter documents its [generation catalog](https://openrouter.ai/docs/api/api-reference/models/get-models),
  [embedding catalog](https://openrouter.ai/docs/api/api-reference/embeddings/list-embeddings-models)
  and [embedding requests](https://openrouter.ai/docs/api/api-reference/embeddings/create-embeddings).
  Embedding discovery uses a distinct `/embeddings/models` path. Orbyn currently
  lets the admin type the embedding model; do not use its generation catalog as
  proof of embedding choices.
- [OpenCode Zen](https://opencode.ai/docs/zen) documents the saved `/zen/v1/models`
  path, but lists model-dependent inference endpoints. Orbyn currently chooses
  a compatible protocol for the entire connection. Review that mismatch after
  the Anthropic fallback checkpoint; starting-mode fixtures do not prove that
  every Zen model accepts Chat Completions.
- [Matilda documentation](https://maincode.com/docs) is a documentation landing
  page, not sufficient evidence for all endpoints/options. Keep its existing
  fixed live baseline separate; do not infer embedding support from the brand
  or a compatible response fixture.

These are spot checks on8October2026. Every remaining vendor still needs the
same evidence review; missing search results do not prove an API unsupported.

## Next confirmed catalog gap: Together

[Together's current primary model reference](https://docs.together.ai/reference/models)
documents a top-level JSON array of model records. Orbyn's catalog adapter rejects
all top-level arrays before inspecting their IDs. A Together-kind fixture using
that documented shape reproduces `ProviderError: invalid model catalog`.
Log: `/tmp/orbyn-c1-together-catalog-before-20261008.log`.

Checkpoint `22f24742` on main normalizes Together's explicit array contract without accepting
arrays for every provider. Common ID validation, error redaction and revision
fencing remain. Adapter46/46 and route cohort63/63 pass, including an actual
saved Together connection and in-flight mutation409. All20 inventory61/61 now
uses the vendor's array shape. Full frozen regression passes3894/3894,
zero failures/skips/cancellations, exit0,764252ms; merged and pushed as `22f24742`.
These fixtures do not establish a live saved-host model call.

## Additional endpoint evidence

- [DeepSeek model listing](https://api-docs.deepseek.com/api/list-models/) documents
  a `data` array of IDs and model-specific effort/protocol capabilities. The saved
  compatible catalog shape matches; richer capability/control qualification stays
  open.
- [ZenMux model listing](https://zenmux.ai/docs/api/openai/openai-list-models.html)
  documents the saved `/api/v1/models` endpoint. Its
  [API overview](https://zenmux.ai/docs/api/overview.html) lists compatible chat
  and embedding endpoints; model-specific support still requires validation.
- [Mistral models](https://docs.mistral.ai/api/endpoint/models) documents a `data`
  array at `/v1/models`; [embeddings](https://docs.mistral.ai/api/endpoint/embeddings)
  documents `/v1/embeddings`. Orbyn's endpoint contract matches; no live key/model
  or selected-dimension acceptance is claimed.
- [xAI models](https://docs.x.ai/developers/rest-api-reference/inference/models)
  documents `/v1/models` with `data`, and a separate richer language-model catalog.
  The current ID-only path matches the simple catalog contract.
- [Fireworks model listing](https://docs.fireworks.ai/api-reference/list-models)
  documents an account management path, not evidence that its saved inference
  `/inference/v1/models` endpoint works. Keep that inference catalog unverified;
  absence in this page alone is not proof it is unsupported.
- [Nebius's public OpenAPI specification](https://api.tokenfactory.nebius.com/openapi.json)
  was retrieved with normal TLS verification. It documents `/v1/models` with a
  `data` array and `/v1/embeddings` with indexed vectors and token usage.
  Snapshot: `/tmp/orbyn-c1-nebius-openapi-20261008.json`. This verifies the new
  Token Factory API contract, not availability of Orbyn's saved legacy Studio
  hostname or an authorized live model call.
- [DeepInfra chat](https://docs.deepinfra.com/chat/overview) documents the saved
  `/v1/openai` compatible base; its
  [embedding reference](https://docs.deepinfra.com/apis/embeddings) documents
  `/embeddings` with string-array input and float output. Selected model,
  dimensions and runtime behavior remain unverified. The documented explicit
  `encoding_format: "float"` example alone does not prove omission is a bug.
- [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)
  documents `/v1/models` and `/v1/embeddings` at the configured local base.
  Loaded model, dimensions and local runtime acceptance remain open.
- [Perplexity Agent models](https://docs.perplexity.ai/api-reference/models-get)
  documents `/v1/models` for `/v1/agent`, while
  [Router models](https://docs.perplexity.ai/api-reference/gateway-models-get)
  documents `/router/v1/models`. Both use a `data` array. The
  [Router quickstart](https://docs.perplexity.ai/docs/router/quickstart) pairs
  `/router/v1` with compatible chat/Responses. These distinct products do not
  establish that Orbyn's saved Sonar `/models` path works; verify its catalog and
  execution pair before changing it. HTML references were readable after the
  initial Markdown reference requests failed.

Public OpenCode metadata GET returned86 ID records with only id/object/created/
owned_by fields. It supplies no per-model transport hint to fix mixed endpoint
routing automatically. Snapshot: `/tmp/orbyn-c1-opencode-public-catalog-20261008.json`.
The first Python request failed local CA validation; native curl succeeded with
normal TLS verification. No key, personal data or inference request was sent.

## Next transport audit: OpenCode Zen

[Zen's endpoint table](https://opencode.ai/docs/zen) assigns transports by model:
GPT6.1 Sol uses Responses, Claude Sonnet4.6 and Qwen3.8 Flash use Messages,
while other models use compatible chat or native Gemini. Orbyn's saved
`opencode` resolver currently sets one compatible-chat format for every model.

Compiled saved-row resolution reproduces the mismatch for direct completion
and durable agent steps for those three documented models. All six dispatches
target `/zen/v1/chat/completions`, rather than their documented endpoint.
The controlled fixture returns404 to make the mismatch visible; that status is
not an observed vendor failure. No live inference or workspace content is sent.
Log: `/tmp/orbyn-c1-opencode-transport-before-20261008.log`.

After Together qualification/promotion, resolve the selected model's transport
without redirecting the saved connection or leaking credentials. Catalog reads
must remain independent of generation format. Cover direct calls, durable tools,
JSON fallback, usage/authority and embeddings separately. The public ID-only
catalog has no protocol metadata, and vendor-specific model mappings cannot be
inferred safely from names alone (Qwen models already use different protocols).
Native Gemini requires its own verified wire contract; generic compatible
fixtures must not be used to claim that endpoint family complete.

The current `usesResponsesApi` guard also requires OpenAI's exact public base
and its model-name family. Setting a Zen connection's `requestFormat` flag alone
would therefore leave it on Chat Completions. The next repair must preserve that
existing OpenAI default behavior while introducing an explicit, qualified
gateway transport selection; changing only the provider definition is inadequate.

## Frozen Zen selected-model correction

Candidate `890d42ce` replaces connection-wide Chat Completions with exact reviewed
model assignments for Responses, Messages and native Google content. It preserves
the saved endpoint and auth, and leaves catalog/embedding resolution independent.
The metadata fixture118 IDs is sourced from Models.dev's OpenCode entry and the
SDK mapping used by OpenCode; it is not fetched at runtime. The public Zen
catalog snapshot86 IDs has84 reviewed assignments; its two Jev IDs require a
custom transport and are rejected explicitly. Unknown IDs retain the existing
compatible path and are not asserted to have native or live certification.

Focused protocol/provider cohort335/335, workspace typechecks, backend/web builds
and three compiled actual durable-loop cases pass. Gemini uses Orbyn's JSON
agent tool protocol rather than native Google function calls. Native content
usage/authority/abort/truncation and malformed response checks are covered.
Current-source pgvector setup/schema/retry/storage/client cohort47/47 also passes
on a fresh marked database; it is independent of full stock regression13419,
which is now terminal4044/4044, zero failures/skips/cancellations and exit0. Logs and source freeze are in the C1 acceptance ledger.
Fast-forward merged and pushed as `2186dcb9`; no live Zen inference or whole C1
completion is claimed.

## Remaining qualification

Perplexity's native embedding contract has a reproduced repair candidate in the
C1 ledger. Native root `/models` returned404 while documented `/v1/models`
returned401 without credentials. That catalog describes Agent API models rather
than proving they accept Orbyn's legacy generation request. Keep catalog,
generation and embedding authority separate; the next audit must qualify native
generation before exposing its models as usable. Primary references:
[model catalog](https://docs.perplexity.ai/api-reference/models-get),
[Sonar migration](https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview).
Public unauthenticated metadata probes sent no provider key or inference text;
`/tmp/orbyn-c1-public-catalog-probes-20261008.json` records status and shape only.

- Verify public endpoint/catalog availability and model-specific controls against
  primary documentation and authorized live calls where required; do not convert
  per-kind fixture coverage into live vendor certification.
- Pagination revision guards are qualified in the saved-connection route fixture:
  edits/deletion while a later page is in flight are rejected without a DB row
  lock spanning the network call. Retain this coverage in subsequent repairs.
- Complete remaining consent/validation/reindex/search/error/client matrices.
- Preserve actual Matilda baseline observations; obtain permitted OpenAI cache
  benchmark evidence separately before claiming economics.
- Installed native and full-page UI acceptance remain open. Visual Check supplies
  capture originals and manifests; root owns review.
