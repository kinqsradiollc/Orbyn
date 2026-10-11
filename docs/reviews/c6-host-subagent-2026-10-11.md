# C6 production host check — 2026-10-11

**Result:** Blocked before a public discovery response; production host acceptance remains unverified.

## Scope and provenance

- Checked only the exact public discovery URL in the Codex in-app browser: `https://mcp.orbyn.dev/.well-known/oauth-protected-resource/plugin`.
- The browser inventory showed the Codex in-app browser available with no tabs. Its visibility option is unsupported in this subagent session; the first attempted open therefore did not navigate. One background navigation was then made.
- The internal browser reported `net::ERR_BLOCKED_BY_CLIENT`. No HTTP status, response body, or rendered page was available. The packaged browser-troubleshooting guidance does not classify this error or identify a permission/security setting. Reading the selected IAB's browser documentation returned `Browser is not available: 4`, which did not identify an endpoint restriction.
- The user authorized Chrome. The parent asked for one bounded Chrome navigation if no explicit tool restriction applied. No tool response or browser documentation explicitly identified a saved Block or permission/security refusal for this URL, so one exact-URL Chrome navigation was made. Chrome returned the same `net::ERR_BLOCKED_BY_CLIENT`; no HTTP status, response body, or rendered page was available. No further navigation or alternate network route was used.
- This checkout was on `codex/c6-file-viewer` at `602df2fd1dacc9100e7840e3923e7f25fc73feca` (`origin/main` matched). Existing edits to `docs/reviews/adr-current-state.md` and `docs/reviews/c6-production-visual-2026-10-11.md` were preserved.

## Provenance of deployment and local acceptance

- Parent-provided repository evidence says local runtime `937cb16f` completed Test/Review acceptance in round 1/3. This host check did not re-evaluate that acceptance.
- The owner reports deployed commit `b3d02d19` and that `/plugin` now works. This browser check could not confirm the deployment, endpoint health, or reported recovery.

## ChatGPT authoring UI inspection

- In Chrome, `https://chatgpt.com/plugins` loaded the Plugins directory in the existing ChatGPT session without a sign-in prompt. This does not establish access for an unauthenticated user.
- The visible **Add** menu contains **Create plugin**, **Upload plugin archive**, and **Add custom MCP server**.
- Selecting **Add custom MCP server** initially closed the menu. After one 1.2-second wait, the same `/plugins` page displayed an **Add custom MCP server** dialog with **Name**, **Description (optional)**, and **Server URL** fields. The URL placeholder was `https://example.com/mcp`.
- The dialog warns that custom MCP servers introduce risk and that an untrusted server may access or steal information shared through app use, or trick ChatGPT into unintended tool use, including changing or deleting data.
- The separate menu item was labeled **Create plugin**. A later **Create as a plugin** step was not reached. No form fields were filled; no credentials were entered; no plugin, connection, grant, or consent was created. The current tab stayed at `/plugins`, and the supported console-log API returned zero error entries.

Discovery metadata and its authorization-server issuer remain unverified. Sign-in/consent, account/data isolation, resource extensions, provider execution, and revocation were not reached. Host/account capabilities beyond the visible authoring menu are unknown; no unsupported feature was established. No production data or screenshot was created or accessed.

## Next step

The browser/client-side block's cause is unknown and produced no endpoint response in either browser. The visible manual entry point is ChatGPT **Plugins → Add → Add custom MCP server**; the empty details form is now visible in the existing ChatGPT session. The next manual action is for the owner to review that form and, when ready, enter the chosen server name and deployed URL. The owner should personally handle any login, connection creation, consent, grant, or data write. Discovery metadata and the OAuth issuer still need independent verification before the host connection can qualify C6.
