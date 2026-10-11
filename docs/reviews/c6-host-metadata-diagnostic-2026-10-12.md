# C6 host metadata diagnostic — 2026-10-12

Decision: **evidence pending for interactive host acceptance**, within existing
round **2/3**. Local source acceptance is retained. This diagnostic neither opens
a new full review round nor waives the embedded editor requirement.

## Scope and evidence

Read-only source/dependency inspection at
`/Users/anhdang/.codex/worktrees/c6-next/Orbyn`, branch `codex/c6-file-viewer`,
HEAD `9f8d9c9d4f1bba93e20a4f12211430454010eaf1`. The diff from accepted candidate
`8f99272c66101734f0536405ad5bb68f5122e60b` is empty for `backend` and
`package-lock.json`. This is source equivalence, not independent verification of
the deployed image or host session.

Builder/Visual handoff reports canonical authentication and synthetic API
fetch/save/idempotent replay/stale rejection working; cards enabled in Admin;
ChatGPT rendering Markdown/table/Mermaid without embedded Edit/Review/Submit
controls. These are reported observations, not Reviewer-executed checks.
The synthetic `.md` entrypoint check is pending in the handoff.

Reviewer ran no tests, builds, security scans, browser interactions or API writes.
Only this report was added; existing Tracker/Visual working-tree edits were
preserved.

## Findings

1. **No demonstrated SDK metadata-loss defect.** In
   `backend/src/modules/mcp-server/server.ts`, enabled calls pass the result
   through `withResultPreview` before `projectCallToolResult`. The installed
   `@modelcontextprotocol/server` implementation in
   `node_modules/@modelcontextprotocol/server/dist/src-D-y6h4N7.mjs` preserves
   `_meta` in legacy and modern projections: object-shaped results are returned
   unchanged, and fallback/wrapping branches spread the original result. The
   inspected modern encoding helpers also preserve metadata; server identity
   stamping merges existing entries. This does not establish what the deployed
   transport or host adapter actually delivered.

2. **Empty model-visible `_meta` is inconclusive.** OpenAI documents result
   `_meta` as component-only, hidden from the model; `content` and
   `structuredContent` appear in the transcript. A connector/model result is
   therefore not a wire capture or a component-delivery receipt.
   [Official tool-result contract](https://developers.openai.com/apps-sdk/reference#tool-results).

3. **Current tool-to-resource metadata follows the documented standard.**
   `apps.ts` supplies `_meta.ui.resourceUri` for `ui://orbyn/result.html` and
   resources use `text/html;profile=mcp-app`. `host-surfaces.ts` maps ordinary
   registered tools, including fetch, to the result card; `server.ts` advertises
   UI resources and the UI extension when the effective call settings enable
   cards. OpenAI prefers `ui.resourceUri`; `openai/outputTemplate` is an optional
   compatibility alias. Its absence alone does not justify a mandatory patch.
   [Official descriptor contract](https://developers.openai.com/apps-sdk/reference#tool-descriptor-parameters).

4. **Rendering document text does not prove the Orbyn component mounted.**
   The host can render ordinary tool content itself. Distinguish that from the
   actual result card, whose static chrome includes Orbyn and Details. In
   `apps.ts`, the editor requires a document preview with editable permission,
   string identity, integer revision and nonempty anchored lines. In
   `result-preview.ts`, missing `edit_doc` authority or local preview clipping
   disables editing. These conditions must be inspected before diagnosing host
   suppression of a valid editor.

5. **Separate Mermaid subframe compatibility concern; not a proven cause of
   the missing editor.** `apps.ts` creates a sandboxed `srcdoc` iframe for its
   diagram runtime, but its resource CSP declares only empty `connectDomains`
   and `resourceDomains`, with no `frameDomains`. OpenAI documents subframes as
   disabled by default. This is a concrete source/host-policy mismatch to
   investigate once mounting is established; actual enforcement against this
   `srcdoc` path has not been observed here. The diagram fallback and editor are
   separate paths. Host-rendered Mermaid is not proof that Orbyn's nested runtime
   ran. [Official component CSP contract](https://developers.openai.com/apps-sdk/reference#component-resource-_meta-fields).

## Minimum next action and decision branches

Builder/Visual should collect **one bounded, sanitized trace of the existing
synthetic document fetch in the failing host session**, using the same canonical
endpoint and grant. Record the deployed revision, effective cards setting,
negotiated protocol/UI capability and the following boundaries. Keep credentials
and document content out of the diagnostic record; metadata key names, booleans,
types and counts suffice.

| Boundary | Evidence needed | Meaning / next owner action |
| --- | --- | --- |
| Discovery | Actual host-consumed fetch descriptor contains `ui.resourceUri`; resource is available | If absent, inspect effective per-call settings, deployment consistency and descriptor caching before changing renderer code. |
| Resource loading | Host requests `ui://orbyn/result.html`; response has expected MIME and card; iframe mount and `ui/initialize` outcome | If current descriptor is correct but host never requests/mounts it, investigate host support or discovery cache. Do not call unsupported capability proven solely from missing controls. |
| Result delivery | Server wire result and component `ui/notifications/tool-result` contain `orbyn/document-preview` | Missing on wire points to server preview/settings/serialization; present on wire but missing in the mounted component points to host forwarding/bridge integration. |
| Editor eligibility | `editable`, ID/revision types, anchor count and `locallyClipped` | If invalid, explain the specific grant/data gate. If valid in the component but controls remain hidden, capture its render/bridge error and investigate the UI path. |
| Diagram execution | Nested-frame CSP/console outcome inside the actual Orbyn card | A confirmed block warrants a bounded Builder correction to diagram hosting/rendering, preserving isolation and fallback. Avoid wildcard CSP changes. |

`server.ts` advertises five-minute discovery/tools-list cache hints, thirty-second
resource-list hints, zero resource-read TTL, and `tools.listChanged: false`.
Stale metadata after enabling cards is plausible, not established. Use the host's
supported metadata refresh or establish a fresh descriptor receipt after expiry;
the hints do not prove that this host honors those lifetimes. An Admin screenshot
alone does not prove the effective settings used by the failing request.

If host debugging cannot expose these boundaries, retain the precise missing
evidence and request a supported host diagnostic path; do not infer metadata
loss from the model transcript. A successful file card would narrow the failure
to the document result path, but would not substitute for the required anchored
document edit workflow.

## Source-change disposition and closure

**No SDK projection patch, metadata relocation into model-visible output, or
mandatory OpenAI alias addition is justified by the current evidence.** An alias
may become a targeted compatibility change only if the actual host is shown to
require it. The nested diagram iframe merits targeted host verification and a
correction if its restriction is confirmed; it does not explain or close the
whole-card/editor gap.

Builder owns any resulting source change; Tester owns execution; Visual owns
the bounded host observation. Retain the original real-host Edit → Review →
Submit workflow and its required stale/denied/proposal draft-retention cases as
open until evidenced. API writes and text rendering do not satisfy that gate.
Any scope waiver requires direct user disposition, recorded explicitly.
