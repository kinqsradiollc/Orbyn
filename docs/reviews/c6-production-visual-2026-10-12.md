# C6 canonical host visual check — 2026-10-12

**Result: Partial.** The canonical Orbyn connection returned authenticated reads,
the `@Orbyn` app mention worked, and ChatGPT displayed a Markdown preview of the
current synthetic document with a table, Mermaid diagram and source link. This
does not close C6: the document-level mention picker and host editor controls
were not available in the observed UI, and the `.md` host-file flow could not be
opened because Chrome rejected the file chooser.

## Scope and provenance

- Worktree: `codex/c6-file-viewer`. At the start of this host inspection, local
  HEAD and `origin/main` were both `9f8d9c9d`. While the report was being written,
  both advanced to `65c5e556`, a documentation-only host-metadata diagnostic
  commit. The existing changes in
  `adr-current-state.md`, `adr-execution-order.md`, `c6-production-visual-2026-10-11.md`
  and `c6-progress.md` were preserved.
- The owner reported deployment and completed sign-in for the existing canonical
  Orbyn connection. The deployed server hash remains unknown. `get_context`
  returned an authenticated OAuth connection; this call does not identify the
  issuer, discovery response or server build.
- The existing **Orbyn Plugin** `/plugin` connection and tab were left untouched.
  No account switch, new consent, provider setting change, revocation or account
  creation occurred.
- The only document used for document-specific checks was the synthetic Personal
  fixture `doc:07775a91-a645-433c-930a-c79f9a5c68c4`, titled
  `[QA] C6 canonical MCP preview — 2026-10-12`.

## Read and rendered preview

The canonical connector's exact-title search returned only the synthetic QA
document. Fetch returned **version 2**, with the expected anchored Markdown,
inline code, table, Mermaid source and synthetic links. The connector response
contained no `_meta` fields; this alone does not establish whether the host strips
metadata or which server version it runs.

In the ChatGPT host conversation, the first preview shown was version 1. A later
read-only search and fetch displayed **version 2** with Markdown emphasis and
inline code, a rendered table, a Mermaid diagram and a link back to the synthetic
document. The version 2 preview line read `Editable QA line: canonical API save
verified.` The source link pointed to the same synthetic document. The visible
host response and a screenshot of the rendered content were captured inline in
this Visual Check conversation; no local screenshot export was available. The
visible preview does not by itself establish that the Orbyn result component was
loaded or initialized by the host.

The bounded Today read also completed in the host. Only aggregate values were
retained: local date **12 October 2026**, **8 planned**, **1 due**, **0 late** and
**3 up next**. No personal item title or content was copied into this report.

## Composer mention picker

The composer `@` menu displayed the plugin list, including Orbyn, and described
its search as **“Type to search plugins.”** Selecting Orbyn successfully added
the Orbyn app mention to the unsent composer. Typing `@` again reopened the same
plugin list; no document resource picker or selectable result for the exact
synthetic QA title appeared. The unsent draft was cleared. No mention search
tool call or message was sent.

This is an observation of the current ChatGPT composer UI, not proof that every
host implements or omits `openai/mentions`. The server source advertises
`search_orbyn_mentions` under `openai/mentions` when the relevant app setting and
search capability are enabled; that source declaration does not prove the live
host's picker behavior.

## Review and Submit controls

The rendered version 2 document response offered no embedded **Edit a line** or
**Review change** controls. The host explicitly reported that those controls
were unavailable and that no draft was entered or submitted. The selected line
anchor `bmv3wsi3n4dfck8` was not edited; no `edit_doc` or other write call was
made. The Orbyn Admin page showed **Cards in agents (preview)** enabled, and that
setting was only inspected, not changed.

The implementation source in `backend/src/modules/mcp-server/apps.ts` defines
the result card controls. Their source presence and the checked app setting do
not establish that this ChatGPT host rendered or enabled them.

The bounded browser trace could not inspect the host-consumed fetch descriptor,
resource request/response, `ui/initialize`, tool-result bridge event, component
preview metadata or edit-eligibility values. The supported CUA observations in
this run exposed the rendered UI and accessibility tree, not those transport or
component-internal boundaries. The connector result's empty `_meta` is not a
wire receipt. The missing controls therefore do not identify whether the host
loaded the Orbyn component or whether a permission, preview field or local
clipping rule disabled editing. The visible Mermaid rendering likewise does not
prove the Orbyn component's nested diagram iframe ran. No iframe-policy cause
or source defect is established by this check.

## `.md` host-file entrypoint

A minimal synthetic `.md` file was prepared locally for a host file-resource
check. The browser file chooser rejected the upload with a message directing the
operator to Chrome extension Details and **Allow access to file URLs**. No file
was uploaded or attached. The extension permission was not changed, and no
alternate upload route was used. The local synthetic file remains available for
a later authorized retry.

Consequently, the actual host file card and its writable/ETag Save and Reload
controls remain unverified. The implementation source in
`backend/src/modules/mcp-server/host-surfaces.ts` declares the `open_markdown_file`
entrypoint for `.md`/`.markdown` resources. The UI source in
`backend/src/modules/mcp-server/apps.ts` relies on the host resource bridge and
shows save controls only when the host reports a writable resource with an ETag.
Those source contracts are not live-host acceptance evidence.

## Remaining evidence gates

- Public discovery, issuer identity and the deployed server hash remain
  unverified. The prior browser discovery request was blocked; this check did
  not retry it or use another route.
- The actual composer document mention picker and the Review → Submit interaction
  were not available in the observed host UI. App-level `@Orbyn` selection did
  work; document-level selection did not appear in the inspected picker.
- The host-to-component descriptor, load, initialization, result-delivery and
  edit-eligibility diagnostics were unavailable through the supported CUA
  observations, so the missing editor's cause remains undetermined.
- The host `.md` resource card, writable/ETag metadata, Save, Reload and conflict
  behavior remain unverified because file upload was blocked.
- No tests were run as part of this visual check. The earlier local code,
  synthetic-wrapper and connector receipts remain separate evidence and do not
  establish full production-host acceptance.

To continue the host-file check, Chrome must first allow the ChatGPT extension
access to file URLs. The CUA file chooser specifically named that permission as
the prerequisite; it remains unchanged pending the user's action.
