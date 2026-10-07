# C1 provider runtime inventory

Source audit: 8 October 2026, candidate based on main `be31aed3`.
This inventory records Orbyn's dispatch contract, not vendor-wide certification.
Definitions: `packages/core/src/aiProviders.ts`; resolution:
`backend/src/modules/ai/providers/resolve.ts`; adapters:
`backend/src/modules/ai/providers/adapters.ts`.

| Saved kind        | Catalog contract                           | Generation transport                        | Embedding adapter                 |
| ----------------- | ------------------------------------------ | ------------------------------------------- | --------------------------------- |
| openai            | GET /models, data IDs                      | Responses                                   | Compatible /embeddings            |
| anthropic         | GET /models, native cursor pages           | Messages                                    | Explicitly unsupported            |
| gemini            | Compatible /models                         | Chat Completions                            | Compatible probe required         |
| openrouter        | Compatible /models                         | Chat Completions                            | Compatible probe required         |
| zenmux            | Compatible /models                         | Chat Completions                            | Compatible probe required         |
| matilda           | Compatible /models                         | Chat Completions, schema and request limits | Compatible probe required         |
| groq              | Compatible /models                         | Chat Completions                            | Compatible probe required         |
| azure             | Manual deployment name, no catalog fetch   | Deployment Chat Completions, apiVersion     | Deployment embeddings, apiVersion |
| openai-compatible | Compatible /models                         | Chat Completions                            | Compatible probe required         |
| opencode          | Compatible /models, public key if blank    | Chat Completions                            | Compatible probe required         |
| lmstudio          | Compatible /models, local key handling     | Chat Completions                            | Compatible probe required         |
| ollama            | Compatible /models, local key handling     | Chat Completions                            | Compatible probe required         |
| deepseek          | Compatible /models; hidden from add picker | Chat Completions                            | Compatible probe required         |
| together          | Compatible /models                         | Chat Completions                            | Compatible probe required         |
| fireworks         | Compatible /models                         | Chat Completions                            | Compatible probe required         |
| mistral           | Compatible /models                         | Chat Completions                            | Compatible probe required         |
| xai               | Compatible /models                         | Chat Completions                            | Compatible probe required         |
| perplexity        | Compatible /models                         | Chat Completions                            | Compatible probe required         |
| deepinfra         | Compatible /models                         | Chat Completions                            | Compatible probe required         |
| nebius            | Compatible /models                         | Chat Completions                            | Compatible probe required         |

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
Backend typecheck passes. Broader regression is pending. No live Anthropic
call or whole-stage acceptance is claimed.

## Remaining qualification

- Enumerate per-kind fixture dispatch/header/options tests against every row;
  format-family coverage alone does not prove each vendor's live service.
- Extend successful catalog pagination through current revision guards; reject
  edits/deletion while a later page is in flight without holding a DB row lock.
- Complete remaining consent/validation/reindex/search/error/client matrices.
- Preserve actual Matilda baseline observations; obtain permitted OpenAI cache
  benchmark evidence separately before claiming economics.
- Installed native and full-page UI acceptance remain open. Visual Check supplies
  capture originals and manifests; root owns review.
