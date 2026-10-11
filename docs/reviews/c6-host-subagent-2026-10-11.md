# C6 production host check — 2026-10-11

**Result:** Public discovery metadata remains blocked in browsers. The existing authenticated plugin connection and Today bootstrap are visible and its Today read succeeded; full production host acceptance remains open.

## Scope and provenance

- Checked only the exact public discovery URL in the Codex in-app browser: `https://mcp.orbyn.dev/.well-known/oauth-protected-resource/plugin`.
- The browser inventory showed the Codex in-app browser available with no tabs. Its visibility option is unsupported in this subagent session; the first attempted open therefore did not navigate. One background navigation was then made.
- The internal browser reported `net::ERR_BLOCKED_BY_CLIENT`. No HTTP status, response body, or rendered page was available. The packaged browser-troubleshooting guidance does not classify this error or identify a permission/security setting. Reading the selected IAB's browser documentation returned `Browser is not available: 4`, which did not identify an endpoint restriction.
- The user authorized Chrome. The parent asked for one bounded Chrome navigation if no explicit tool restriction applied. No tool response or browser documentation explicitly identified a saved Block or permission/security refusal for this URL, so one exact-URL Chrome navigation was made. Chrome returned the same `net::ERR_BLOCKED_BY_CLIENT`; no HTTP status, response body, or rendered page was available. No further navigation to this endpoint or non-browser network route was used.
- This checkout was on `codex/c6-file-viewer` at `602df2fd1dacc9100e7840e3923e7f25fc73feca` (`origin/main` matched). Existing edits to `docs/reviews/adr-current-state.md` and `docs/reviews/c6-production-visual-2026-10-11.md` were preserved.

## Provenance of deployment and local acceptance

- Parent-provided repository evidence says local runtime `937cb16f` completed Test/Review acceptance in round 1/3. This host check did not re-evaluate that acceptance.
- The owner reports deployed commit `b3d02d19`, `/plugin` recovery, and later completed custom-MCP setup/account approval for the connection named `Orbyn Plugin`. The browser error alone does not establish endpoint health or the deployed commit; parent-provided authenticated plugin calls succeeded separately.
- Parent-provided update names latest main `902c5357` as evidence only; this subtask did not inspect that checkout or requalify the accepted runtime.

## ChatGPT authoring UI inspection

- In Chrome, `https://chatgpt.com/plugins` loaded the Plugins directory in the existing ChatGPT session without a sign-in prompt. This does not establish access for an unauthenticated user.
- The visible **Add** menu contains **Create plugin**, **Upload plugin archive**, and **Add custom MCP server**.
- Selecting **Add custom MCP server** initially closed the menu. After one 1.2-second wait, the same `/plugins` page displayed an **Add custom MCP server** dialog with **Name**, **Description (optional)**, and **Server URL** fields. The URL placeholder was `https://example.com/mcp`.
- The dialog warns that custom MCP servers introduce risk and that an untrusted server may access or steal information shared through app use, or trick ChatGPT into unintended tool use, including changing or deleting data.
- The separate menu item was labeled **Create plugin**. A later **Create as a plugin** step was not reached. No form fields were filled; no credentials were entered; no plugin, connection, grant, or consent was created. The current tab stayed at `/plugins`, and the supported console-log API returned zero error entries.

Discovery metadata and its authorization-server issuer remained unverified during this authoring-page phase. This phase made no plugin, connection, grant, or consent changes and captured no screenshot.

## Existing connection and Today UI check

- The Personal plugin directory listed the exact `Orbyn Plugin` entry. Its details page showed **Open plugin** and **Manage**. Settings showed a **Connected accounts** section for `https://mcp.orbyn.dev/plugin` and permission **Allow low-risk**. The current session showed no login prompt; anonymous access was not tested.
- The connection settings page noted that the private tool widget `open_markdown_file` could not render. The UI did not enumerate other tool capabilities. Parent-provided authenticated tool output reports `get_context` succeeded (`isError=false`, kind `plugin`, access `write`, `readonly=false`, 8 toolsets, limits available, 0 teams).
- Parent-provided `get_today` output succeeded with a structured day/timezone result and aggregate counts: planned 4, due 0, late 0, up next 3. No item text or personal account identifier was copied here.
- Opening the existing plugin in ChatGPT rendered a **Today** card with an explicit **Load today** button and **Open Today in Orbyn** disabled. After the explicit **Load today** click, a fresh DOM snapshot showed **Load today** absent, **Open Today in Orbyn** enabled, and no loading or failure status. The individual Today entries were not copied or reported; **Open Today in Orbyn** was not activated.
- This check created no plugin or connection and changed no grant or permission. It performed the explicitly authorized read-only Today load; no production data was changed.

The Today bootstrap is verified at the host UI level. Account/data isolation is not fully qualified by the aggregate result alone. Discovery metadata and its OAuth issuer remain unverified, and the later **Create as a plugin** step was not observed.

## Next step

The next safe acceptance case is Mentions, limited to verifying authorized titles/links without item contents. Account switch/reconnect, provider execution, and revocation remain untested and require parent coordination. The public discovery URL and OAuth issuer still need independent verification before C6 can close.
