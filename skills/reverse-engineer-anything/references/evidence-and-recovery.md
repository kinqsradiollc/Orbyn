# Evidence and recovery

This is a local operating method, not a schema replacement. Inspect the connected
server's current contract. The [source record](source-record.md) distinguishes
the historical source pin from later reviewed guidance; no engine update follows
from reading this file.

## Preserve identity and coverage

Preserve complete returned Evidence records and their identities, including
`evidence_id`, subject/provider identity, `normalized_result`, limitations and
coverage fields. Do not manufacture IDs, remove explicit nulls or repair a digest
by editing the payload. Retain original raw-reply bytes when available; write
interpretation separately. Older or incompatible
records remain evidence of their original observation; recapture or use a
supported reader rather than relabelling them as current.

Read `normalized_result` for the normalized facts. A missing or null `raw_result`
does not mean no evidence was collected. Preserve observed, derived and inferred
relationships separately. An empty selected page is not proof of absence; inspect
filters, scope, coverage and the end-of-pagination indication first. Exhausting
static facts still does not establish complete runtime behavior.

## Summary versus complete evidence

Determine what the operation actually returned. Some servers deliver complete
function Evidence by default; newer implementations can return a summary while
retaining the full dossier. Never infer the default from `6.7.0` alone.

When a summary exposes `normalized_result.parent_evidence_id`, retain both the
summary and that parent identity. Use `inspect_analysis_view` only if available,
with the schema's supported fields, selection and pagination. A retained ID is
not a portable file and may require the same live session. Export complete
records before session closure when later work needs them; do not assume a bundle
and one Evidence record are interchangeable inputs.

Check the next tool's accepted input before composing it:

- If it accepts retained dossier references, supply the parent dossier reference,
  not the summary's evidence ID. A supported reference shape is
  `{"kind":"retained-evidence","evidence_id":"<parent_evidence_id>"}`.
- If it accepts only inline complete dossiers, obtain the complete record using
  supported detail/export controls. In the reviewed newer contract,
  `build_call_path` needs inline complete dossiers; `compare_functions` can use
  retained dossier references. Confirm that against the connected schema.
- If no compatible retrieval exists, report the comparison as unavailable. Do
  not expand a summary into invented full evidence or bypass integrity checks.

Comparison requires identified targets, compatible observation roles, scope,
versions and coverage. Different engine/options can explain a delta. Retain
unsupported facets as unknown and avoid equating root-byte equality with runtime
equivalence. Shorter JSON proves smaller delivery, not fewer total tokens or
faster completed investigations.

## Diagnose before retrying

Separate host-policy rejection, transport failure and a returned REA error. A
rejected approval is not a broken engine; another transport cannot bypass it.
Follow actual remediation, rather than guessing settings or fields.

| Observation | Next step | Stop / preserve |
| --- | --- | --- |
| No tools or missing registration | Inspect supported local registration diagnostics, such as `rea doctor`, when available and in scope. Inspect the host connection state separately. | A skill install does not register MCP; doctor cannot establish a live connection. Prepare scoped setup only if authorized. |
| Connection dropped | Retry once only if safe to repeat or known not to have started. | If effects may already have happened, preserve uncertainty and inspect supported status/receipts first. Repeated drops need client reconnection, not repeated target actions. |
| Server cannot start | Read the launch error; inspect actual PATH/runtime and registration. One retry is useful only with a transient explanation or changed condition. | Do not repeat the same unchanged startup failure. Explain a required human-only restart when the host cannot reconnect itself. |
| `invalid_request` | Correct every reported field against the actual schema. | No unchanged retry or guessed newer fields. |
| `provider_unavailable` | Inspect the operation's availability, reason and prerequisites. | Catalog presence is not provider readiness; installation or permission changes need scope. |
| Timeout / cancellation | Read remediation, partial evidence and owned-resource status. | Client wait expiry does not prove server stop. Do not repeat possibly active/effectful work; do not assume a larger client deadline changes a provider limit. |
| `cleanup_incomplete` or reported live owners | Use the exact owner's supported cleanup/recovery operation. Retry only unresolved resources. | Block replacement work needing those resources until release is confirmed; retain the primary failure and completed observations. Restarting the original analysis is not cleanup. |
| Retryable resource capacity | Wait within the caller's budget for the reported active admission to finish, then make a bounded retry. | Do not restart to steal capacity or spin indefinitely. A nonretryable limit needs a supported smaller selection or an explicit limitation. |
| Invalid configuration | Correct only the named setting, in its actual launch environment, within authorized configuration scope. | Restart only when required for startup-read settings. Do not invent `REA_*` controls, raise memory blindly or rewrite shared config. |
| Evidence integrity mismatch | Preserve the original record and diagnostic; obtain a fresh compatible observation if authorized. | Do not rewrite IDs, hashes, nulls or provenance to force acceptance. |

Changing configuration, installing an engine, launching or attaching a target,
publishing and messaging remain separate effects governed by the task. Close only
owned resources and report unresolved cleanup even when the useful analysis
succeeded. Keep raw captures in consumer-owned local output or approved artifacts,
not the public skill template.
