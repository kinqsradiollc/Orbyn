# C1 acceptance ledger

Updated 7 October 2026. C1 is active. This evidence index supplements the full
contract in `devday-2026-implementation-review.md`; it does not reduce that scope.
Complete C1 before moving to C2/M1. A check means a scoped check passed, not that
the entire row or stage has shipped.

## Current checkpoint

Candidate `fc613153` repairs the managed native agent's Responses tool protocol.
It preserves the selected model, exact function call/output identity and bounded
encrypted reasoning context through serialized checkpoints. Its 38 focused
protocol/graph/wire/output-limit tests pass, as do backend typecheck and build.
The source checkpoint has no UI change. It is not yet on main.

Frozen integration worktree now contains that commit. Full backend regression is
running against the isolated, server-marked `orbyn_full_fc613153_test` database,
exec session 28221. No terminal result is claimed. This invocation's output is
in the tool transcript; it was not redirected to a complete standalone log.

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
2. Implement the missing model capability/reasoning/cache configuration contract
   with shared/backend and both-client wiring together, then qualify that scope.
3. Reconcile independent embeddings and multi-provider configuration against their
   complete upgrade/race and UI matrix; fix every confirmed remaining defect.
4. Complete the C1 managed/BYO/plan authority, fallback, usage and evaluation
   matrix. Record real permitted probes separately from fixtures.
5. Only after C1 exit conditions are proven, start C2/M1.

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
configuration. This confirmed gap is the next C1 implementation checkpoint after
the active Responses repair qualifies.
