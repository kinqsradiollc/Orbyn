# C1 isolated embedding runtime qualification

8 October 2026. API/worker evidence, not browser or live-vendor acceptance.
Backend compiled from `244abc21c464d19c379bf0ebaf5d431f4f8e344d`;
mobile-only repair `3ccf8f578d3e355238ee55478e7d5e02b2b68b67` leaves backend
source unchanged. No full C1 acceptance or main promotion.

## Isolation and evidence

- API8010, marked vector database `orbyn_c1_visual_20261008_test` on55437.
- Synthetic page `afba4fb2-f688-4871-821c-4c7a9cc917f2`; no personal content.
- Independent embedding recipient `626ba943-8547-4bdb-ae33-31e3689fa855`,
  compatible endpoint `http://127.0.0.1:18090/v1`. The local server accepts only
  fixed configuration probes and synthetic page text; no external calls.
- Generation default remains off. Explicit API destination/revision/consent
  supplied only for this isolated fixture; this is not browser consent proof.
- Normal authorized API operations and real independently running measure worker;
  no direct settings/queue/heartbeat mutation or simulated elapsed time.
- Read-only observer refuses a different database or non-test marker.
- Safe receipts: `/tmp/orbyn-c1-vector-api-actions-20261008.jsonl` and
  `/tmp/orbyn-c1-vector-visual-observations-20261008.jsonl`. No keys/tokens included.

## Observed sequence

| Time UTC | Operation | Actual result |
| --- | --- | --- |
|09:23:25|Enable reviewed local3-dimension model with exact recipient revision/generation|HTTP200; effective semantic search on, dimensions3, pending1/indexed0, worker live.|
|09:24:56|Read worker storage and effective API status|Queue0, one3-dimensional passage, indexed1, failed0; generation default remains off.|
|09:25:11|Local server503 mode; versioned synthetic page edit via API|HTTP200, pending1/indexed0; previous-version vector is not counted current.|
|09:25:32|Read actual failed attempt|Sanitized `provider_unavailable`, attempts1, failed09:25:18, retry09:26:18; APIfailed1/pending1.|
|09:26:05|Provider restored; read before retry deadline|Failure/queue retained; no premature recovery claimed.|
|09:26:32|Read after scheduled worker retry|Queue0, failure cleared, indexed1/current3-dimensional passage, worker live.|
|09:26:45|Explicit replacement with reviewed7-dimension model|HTTP200, new configuration generation, dimensions7; old vectors deleted, pending1/indexed0.|
|09:26:45|SIGTERM owned worker92361|Stop requested; process initially sleeping, later independently absent from process inventory.|
|09:29:28|Real heartbeat expiry after worker terminal|Age189seconds, API measure_runningfalse; queued1/vectors0, no fake timestamps.|
|09:29:57|Restart after confirmed prior process terminal|New independently owned worker7490; duplicate guard passed.|
|09:30:12|Observe resumed worker|Queue0, indexed7-dimensional passage, heartbeat live, no failures.|
|09:30:54–58|Stale provider/settings and in-flight provider revision|Each refused409. In-flight reply explicitly says provider changed during validation; needs_validationtrue/effective searchfalse.|
|09:30:58|Explicit revalidation with current recipient revision|HTTP200, new generation, dimensions7, pending1; no generation default activation.|
|09:31:59|Read after revalidation / turn off via API|Actual7D passage indexed; off HTTP200 removes consent and disables embedding search.|
|09:32:15|Read off cleanup|Queue0, vectors0, failures0, no consent/default; dimensions retained as saved metadata, not active storage.|
|09:32:34|Stop local provider then query normal word search|Provider process independently absent; HTTP200 with synthetic page found. No embedding service is needed for word search.|

The physical legacy `semantic_search` column remains false; effective API status
uses `embedding_search_enabled` plus current consent/provider validation. Do not
misinterpret the diagnostic legacy column as a failed enable operation.

## Remaining operations and limits

Indexing after revalidation and off cleanup are verified above. Real worker termination,
heartbeat expiry, restart/7D indexing and stale/in-flight refusal are evidenced
above; race receipt `/tmp/orbyn-c1-vector-api-races-receipt-20261008.json`. No fake timestamp, forced queue acknowledgement or restart of
an unconfirmed live worker. Normal word search is evidenced with the local provider stopped. Post-off no-call
authority is supported by the unchanged integration cohort and off configuration;
this runtime receipt does not invent an unmeasured live HTTP count comparison. Broader permission/access races retain the separately
executed vector cohort with exact source equivalence; this one-page runtime
sequence does not replace that matrix. Live recipient/model/cache economics,
installed-client and genuine text enlargement evidence remain open. Visual
checks are on demand under main94284ab7; no automatic embedding screenshot sweep.

Owned restarted worker7490 received SIGTERM after off-state qualification.
Local provider82925 is confirmed terminal; counters are retained privately at
/tmp/orbyn-c1-vector-visual-provider-counts-20261008.json. Synthetic rows/page
remain isolated for reproducibility; no user production data was modified.
