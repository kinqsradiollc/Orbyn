# C1 embedding model discovery

Status: local candidate; not merged or visually accepted. C1 remains active.

## Contract

- `POST /ai/providers/:id/embedding-models` requires administrator authority,
  strict rate limits, and the displayed `expected_revision` for the independent
  embedding connection. It checks that revision before and after network I/O.
- Disabled, changed, deleted and A→B→A connections cannot publish a stale catalog.
  No row lock spans the external request. Credentials stay server-side.
- Discovery uses embedding connection options, not generation reasoning/cache
  controls. It sends no page text, changes no assistant setting and grants no consent.
- Web and mobile retain typed models, searchable candidates, refresh/loading/error
  states and empty/manual catalogs. Selecting a model clears prior consent.
  Catalog configuration remains available when the measuring service or pgvector
  is unavailable; enabling indexing still requires every prerequisite and validation.
- Mobile search is independent of the typed model, limits visible chips to40,
  and reports the filtered count. Late replies, provider/revision switches,
  disabled providers, newer refreshes and unmounts are fenced in both clients.

## Discovery inventory

All20 saved kinds are covered by an adapter fixture. This is protocol evidence,
not proof of vendor availability, model capability or account entitlement.

| Connection                                                    | Catalog                          | Meaning                                                           |
| ------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------- |
| Exact native OpenRouter HTTPS `/api/v1`                       | GET `/embeddings/models`         | Embedding-only catalog; dimensions still validated                |
| Custom OpenRouter destination                                 | Saved base + `/models`           | Unclassified candidates; no cross-origin redirect                 |
| Azure                                                         | No network request               | Type a deployment name manually                                   |
| Native Anthropic                                              | No embedding catalog request     | Manual response; embedding setup excludes messages-only providers |
| Other supported compatible kinds, including native Perplexity | Existing saved catalog transport | Unclassified candidates; embedding support must pass validation   |

OpenRouter documents the separate endpoint in its
[embedding model catalog reference](https://openrouter.ai/docs/api/api-reference/embeddings/list-all-embeddings-models).
Generic generation catalogs are never presented as proof of embedding support.

## Evidence

- Initial typecheck found an inferred hook-return union; corrected by explicit
  optional catalog/error fields. Initial unit run74/88 had14 VM export-harness
  failures; corrected the harness to read `module.exports`. Both original logs
  are preserved, and neither run is reported as passing.
- Corrected adapter/hook/catalog unit cohort88/88, zero failures/skips/cancellations:
  `/tmp/orbyn-c1-embedding-discovery-unit-corrected-20261008.log`.
- Expanded discovery, authorization, in-flight mutations and existing generation
  catalog/client cohort122/122, zero failures/skips/cancellations:
  `/tmp/orbyn-c1-embedding-discovery-focused-20261008.log`.
- The isolated marked stock-Postgres test database is
  `orbyn_c1_embedding_catalog_20261008_test`; no production/preview database is used.
- Final workspace typecheck and backend build pass (exit0):
  `/tmp/orbyn-c1-embedding-discovery-final-types-20261008.log` and
  `/tmp/orbyn-c1-embedding-discovery-backend-build-20261008.log`.
- Web build passes (exit0):
  `/tmp/orbyn-c1-embedding-discovery-web-build-20261008.log`.
- Frozen combined source5466bc1c full regression terminated with exit7, without
  a final TAP summary. Its log records18 old component-harness failures resolving
  the new hook import, and stops during the native page clock test. It is not a
  full-suite pass: `/tmp/orbyn-c1-embedding-discovery-full-20261008.log`.
- After authoritative termination, the existing component harness was updated to
  isolate discovery imports; the real hook remains independently tested. Twelve
  added component cases cover loading, read-only actions, failure/manual drafts
  and honest catalog labels. Corrected combined cohort154/154 passes with zero
  failures/skips/cancellations:
  `/tmp/orbyn-c1-embedding-discovery-corrected-cohort-20261008.log`.
- The complete native-page diagnostic file independently passes10/10, zero
  failures/skips/cancellations:
  `/tmp/orbyn-c1-embedding-discovery-native-clock-diagnostic-20261008.log`.
  The earlier exit7 cause remains unconfirmed; disk fell below500MiB and a full
  rerun awaits recovered space. No failed source was changed while its run was live.
- The human restored Chrome control. Visual Check is capturing the corrected
  mobile and new embedding UI; root has not accepted any new originals yet.
- Same-origin candidate previews return web/API200. An authenticated inert
  embedding catalog returns250 unclassified models, matching recipient revision;
  semantic search remainsOFF. This uses only the local inert server, not a vendor.

No live vendor credential, embedding document upload, production deployment,
installed-native acceptance or full C1 completion is claimed.

## Empty catalog track correction

Root inspected the original mobile Light and Dark no-match screenshots and
confirmed C1-EMB-UI-01: an empty segmented track below the catalog query.
The control now renders only when matches exist. The manual model and no-match
notice remain unchanged. The new regression failed before the correction
(30/31 component cases) and passes afterward (48/48 controls, hooks and mobile
search cases). Mobile typecheck exits zero. Expanded catalog authority, adapter,
client and control checks pass145/145, zero failures/skips/cancellations:
`/tmp/orbyn-c1-embedding-empty-track-expanded-20261008.log`.
This selected cohort differs from the earlier154-case selection; it is not a
full-suite result. Corrected mobile and web originals have been requested.
The earlier Dark generation no-match v2 capture clips the notice and requires
recapture. No complete visual or C1 acceptance is claimed.

## Post-full-run corrections

Frozen d498febd full regression finished4226/4227, one failure, no skips or
cancellations, exit1,809877.996125ms. The failure names the new administrator
embedding-catalog route missing from the capability inventory. It is now
explicitly excluded as `admin`, matching the existing catalog/test routes;
this does not expose an agent capability.

Root inspected corrected mobile originals in both themes and the full Dark
manual/no-match notice crop. Empty-strip removal and manual preservation pass
those scoped browser states. The first web1280 Light exact-model crop shows
the new Load catalog action using browser-default chrome. It now uses the
existing `secondary` class; an actual component assertion preserves that style.
Corrected web captures remain required.

The shared provider send function previously followed redirects after checking
only the initial URL. An actual local compiled Anthropic catalog302 forwards
an inert x-api-key sentinel to another origin. No real key or document was used.
All redirect statuses301/302/303/307/308 are now rejected before a subsequent
request, including same-origin redirects and caller `redirect:follow` overrides.
An actionable sanitized error asks the admin to update the saved base URL;
Location/body contents are not shown. This deliberately requires a final saved
endpoint rather than forwarding provider credentials or request text.

The real-source regression covers the three credential header families, direct
success, same-origin rejection, error privacy and body cancellation. Initial
isolated proposal checks failed on the harness's nonexistent `code` property;
using the real `reason` property yields16/16. Product-source tests later found
a streaming redirect body left open (18/19); explicit cancellation corrects it
and19/19 pass. Logs remain distinct:
`/tmp/orbyn-c1-provider-redirect-body-before-20261008.log` and
`/tmp/orbyn-c1-provider-redirect-body-after-20261008.log`.

No source was changed while the full run or frozen capture batch was live;
Visual Check confirmed quiescence before these changes. The mobile UI is
unchanged since its accepted d498febd screenshots. Final focused/build/full
qualification and refreshed web review precede feature promotion.

Final combined redirect/inventory/discovery/controls cohort passes170/170,
zero failures/skips/cancellations; workspace typecheck passes and final backend
typecheck/backend build/web build exit zero. Logs:
`/tmp/orbyn-c1-discovery-redirect-final-focused-20261008.log`,
`/tmp/orbyn-c1-discovery-redirect-corrected-types-20261008.log`,
`/tmp/orbyn-c1-discovery-redirect-final-backend-types-20261008.log`,
`/tmp/orbyn-c1-discovery-redirect-final-backend-build-20261008.log`,
`/tmp/orbyn-c1-discovery-redirect-final-web-build-20261008.log`.
The earlier failed full result is not relabelled by these focused passes.

## 8 October terminal regression and generated catalog correction

Frozen product81e807ee full regression finished4245/4246, one failure,
zero skips/cancellations, exit1. The sole failure is the generated MCP route
summary: adding the admin exclusion changes excluded290 to291. Regeneration
changes only those two counts in docs/mcp-catalog.json and docs/mcp.md; no MCP
capability is added. Product source remains81e807ee. The failed full receipt
is retained at /tmp/orbyn-c1-redirect-final-full-terminal-20261008.json and
its complete log at /tmp/orbyn-c1-redirect-final-full-20261008.log.

An initial follow-up invocation passed the four catalog tests but failed the
route test bootstrap because TEST_DATABASE_URL was omitted. It is retained as
/tmp/orbyn-c1-generated-catalog-corrected-20261008.log; this is not a product
failure or a combined passing result. The configured follow-up is recorded
separately in /tmp/orbyn-c1-generated-catalog-final-20261008.log.

Root inspected original81e807ee narrow Light/Dark zero-result screenshots:
manual-unlisted-model remains in the model field, the popup shows No matches,
and controls fit horizontally. Narrow Light/Dark selected249 and wide Dark
selected249 are contained, with the catalog action styled secondary and consent
off. These closed-dropdown states do not prove exact-search interaction.
The narrow navigation-open screenshot shows an overlay over the main content;
closed navigation restores the contained main surface. Full navigation behavior,
installed-native interaction and remaining C1 gates are not established here.

Configured generated catalog/inventory follow-up passes10/10, no failures,
skips or cancellations, exit0. This corrects the sole generated-document
failure; the original full4245/4246 result is preserved, not relabelled.
