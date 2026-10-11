# C6 Markdown file card visual check

**Candidate:** `codex/c6-file-viewer` at `83c49c18ec24c2ea9e3b371d5bf5acef2f3d4316`  
**Resource:** `ui://orbyn/markdown-file.html` from `backend/src/modules/mcp-server/apps.ts`

## Verified

Used an isolated synthetic MCP host wrapper. It delivered a long `.md` filename and an editable synthetic file with a 1,600-character unbroken line. The wrapper returned a conflict for the synthetic save request; it did not contact an Orbyn service or a real ChatGPT host.

| State        | 320 × 740 light                                                                                                    | 1280 × 900 dark                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Loaded file  | Long title wraps across lines and the mode badge moves below it. The unbroken source line wraps inside the editor. | Filename and mode badge fit on one line; source wraps inside the editor.                |
| Unsaved edit | Status wraps; Save enables and Reload remains visible.                                                             | Status, Save, and Reload remain readable and separated.                                 |
| Conflict     | Conflict status wraps without clipping; draft remains visible, Save disables, and Reload remains available.        | Conflict message and controls remain readable; draft remains visible and Save disables. |

No overlap or clipping was observed. Measured document widths matched their viewports (320/320 and 1280/1280); the textarea width also matched its client width (284/284 and 1244/1244). The mobile editor scrolls vertically within its fixed viewport, as expected for the long source.

**Issues:** None observed in these cases.

## Limits

- These results cover the card in a synthetic host wrapper only; they do not establish acceptance in ChatGPT or another production MCP Apps host.
- Screenshots were captured inline. The supported `tab.screenshot()` API returns JPEG bytes and has no local file path/export option, so no screenshot paths are available.
- Tests were not run; this was a bounded visual check only.

## Checkout provenance

The checkout matched the frozen candidate `83c49c18ec24c2ea9e3b371d5bf5acef2f3d4316` at the start. During cleanup, the shared checkout reported `HEAD 34e21418486ea836f3bb8cc65a283ce8c812dd2f` with modifications to `backend/src/modules/mcp-server/apps.ts` and `backend/tests/plugin-ui-resources.unit.test.ts`. At the final status check it had advanced to `a98e6f040e236adcb2773aa0d3e013b1c327d41a`, with those modifications no longer present. This visual check did not edit product or test source; its observations remain tied to the frozen candidate above.
