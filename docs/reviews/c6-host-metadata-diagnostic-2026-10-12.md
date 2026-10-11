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

## Follow-up: refresh warning identifies a file-launch descriptor mismatch

Builder subsequently reports a completed **Manage app → Refresh tools** action
on the canonical OAuth `/mcp` connection, with controls reenabled and warning:
“These private tools can't render their widgets: open_markdown_file”. Owner
reports deployment `de83f54b`; Reviewer checkout now resolves to
`de83f54bc209d40bd3c17da8fc8306cfd2ca7b15`. This is a Builder-observed host warning,
not a Reviewer browser reproduction. Review remains round **2/3**.

**P2 — targeted compatibility correction justified:**
`backend/src/modules/mcp-server/host-surfaces.ts:99` explicitly sets
`ui.visibility: ["app"]` on `open_markdown_file`, while assigning a widget
resource and a file launch entrypoint. It is therefore UI-only in the advertised
catalog, yet expected to launch a widget. The warning names precisely this
combination. The resource URI agrees with `MARKDOWN_FILE` in `apps.ts`; no URI
typo or missing `openai/outputTemplate` alias is implicated by this evidence.

The official descriptor reference defines visibility as model/UI availability,
with default `["model", "app"]`. The warning supplies the host-specific
restriction on this UI-only widget launcher; do not generalize it into a claim
that every MCP Apps host prohibits such descriptors.
[Official visibility contract](https://developers.openai.com/plugins/reference#_meta-fields-on-tool-descriptor).

**Smallest Builder correction:** make this launch tool model-and-app visible,
preferably explicitly `visibility: ["model", "app"]`, preserving its resource
URI, file entrypoint, annotations and strict input validation. This exposes the
launcher to model invocation, so describe its precondition clearly: use an
existing host-provided file handle, never invent a handle or infer filesystem
access. Visibility is not authorization. The backend must continue returning
only its static launch receipt and must never dereference the handle; actual
file reads/writes remain host-controlled. Do not remove the widget association
just to silence the warning, since that defeats the intended launcher.

If keeping this launcher hidden from the model is a retained product requirement,
do not silently relax it: the alternative needs a supported separate public
launch surface and private UI actions. The current evidence favors the small
visibility correction for the existing launch design, not a broader redesign.

**Focused verification for Builder/Tester:**

- Extend `backend/tests/unified-mcp.unit.test.ts` to inspect the serialized
  `tools/list` descriptor: both visibility audiences, exact resource URI and
  unchanged `.md`/`.markdown` file entrypoint. Resolve that URI through the
  canonical resource path and assert the expected MIME/card. Check UI opt-out
  removes the file launcher and its resource.
- The shared descriptor also reaches `/plugin`; extend the existing descriptor
  assertion in `backend/tests/plugin-service.test.ts` to cover the intended
  visibility. Retain existing bounded-handle, invalid-path and static-receipt
  checks. Add a negative assertion/spy for backend dereferencing if current
  coverage does not actually enforce the no-read boundary.
- After deployment, repeat the supported refresh once and record whether the
  named warning disappears. A descriptor test cannot prove widget mounting.
  Preserve any owner deferral of the host upload/file interaction; do not run
  it merely to close this descriptor change.
- Retest the document result card separately through its existing synthetic
  fetch. Record actual card mounting and editor interaction, not just formatted
  text. The launcher correction does not by itself close that gate.

**Catalog impact remains unknown.** The warning proves that the refreshed host
identified this private widget launcher as non-renderable. Reenabled controls
do not establish whether the host installed a partial catalog, retained the old
catalog or rejected the refresh transaction. The message alone does not prove
whole-catalog rejection, nor that every other descriptor was accepted. Use the
post-refresh active tool inventory/resource trace and independent fetch-card
retest to distinguish those outcomes. No catalog-wide metadata patch is
justified on this evidence.

This follow-up supersedes the earlier no-change disposition **only for the
file-launch visibility mismatch**. SDK metadata preservation and the open
document-editor acceptance decision remain unchanged. No source edits, tests,
builds or scans were performed by Reviewer.

## Candidate source review and visual stop disposition

Reviewed frozen launcher candidate
`29f9494262bc4796b6273c8e8a5f906ecc4e88d0` on the same checkout. **Source review:
no further correction identified; test-evidence closure pending.** Round remains
**2/3**. At inspection, no focused Tester report naming this candidate was yet
present in `docs/reviews/`.

The source diff changes only launcher visibility and its handle precondition
description. It retains the resource URI, file entrypoint and input validator.
The canonical handler still validates then returns the static launch result,
without entering document read/write execution. The new assertions inspect the
serialized canonical descriptor, resource MIME, legacy descriptor and opt-out;
the launch test traps global fetch and checks zero calls and no handle echoed
in output. The fixture also rejects writes. These checks meaningfully cover
the small correction. The fetch trap does not prove absence of every possible
I/O mechanism, and the resource text assertion is only a coarse identity check;
the inspected unchanged static launch path supports the narrow conclusion.
Neither limitation warrants broader testing for this metadata-only change.

Builder subsequently reports direct observation of the actual nested Orbyn
component after refresh: Edit a line → Review → Submit, UI “Change recorded”,
then a fresh canonical fetch confirming revision 2 → 3 and the intended line.
This supersedes the earlier prose-based missing-editor conclusion for the
**happy path only**, on deployed `de83f54b`. It does not verify deployment or
host refresh behavior for newer candidate `29f94942`.

The latest handoff conveys the user's explicit end to further C6 visual checks.
**Do not request screenshots or additional visual runs.** Preserve the missing
UI conflict/draft-retention evidence, denied/proposal interaction evidence and
host-file/upload limits as unverified/deferred, never passed. Actual card
Mermaid source fallback with host CSP already disabled establishes neither
diagram-runtime success nor enforced-CSP compatibility. These limits do not
prevent assessing the focused launcher correction against Tester's forthcoming
suite/typecheck evidence; they do prevent claiming full host qualification.

Next owner: Tester supplies exact-candidate focused results and logs; Reviewer
then records closure or concrete corrections in this same round. No product
source edits or test execution were performed by Reviewer.

## Launcher correction closure — approved for main integration

**Approve** frozen candidate
`29f9494262bc4796b6273c8e8a5f906ecc4e88d0` for main integration. The focused
launcher source finding is **closed within round 2/3**; no additional correction
is requested. This supersedes the preceding pending-test disposition for this
candidate only.

Reviewed [Tester's exact-candidate receipt](c6-widget-launcher-tester-2026-10-12.md)
alongside the previously inspected source and test assertions. The receipt
records serial canonical MCP **8/8**, legacy plugin service **16/16**, each with
zero failures/skips and exit 0, plus backend typecheck exit 0. Reviewer also
inspected Tester's session execution output confirming the canonical TAP totals
and completed typecheck; the legacy total is taken from the signed-role Tester
report. The report records `orbyn_test` and `orbyn.environment=test` guards,
with no production/provider calls. HEAD remained the frozen candidate and its
three source/test files had no uncommitted diff at closure inspection.

This is acceptance of the narrow source correction and affected regression
coverage, not evidence that the deployed warning has disappeared. Merge, push
and deployment remain separate Builder/owner actions. The earlier deployed
document editor happy path remains valid within its recorded scope. UI
conflict/draft-retention, remaining host interactions and enforced-CSP Mermaid
runtime are unverified; upload/file checks remain deferred. The user's stop on
further visual checks remains binding, with no additional visual run requested.

Live managed/BYO provider qualification remains unverified under the
[readiness report](c6-live-provider-readiness-2026-10-12.md): isolated QA grant,
provider/model/allowance consent and usable test/sandbox configuration were not
established. Do not promote this focused approval to full C6 qualification.
Reviewer changed only this report and executed no tests, builds or scans.
