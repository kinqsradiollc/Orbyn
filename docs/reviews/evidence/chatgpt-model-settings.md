# ChatGPT connection and model settings — 3 October 2026

Scoped candidate on main1100ca98; broad4f223040/e7 source branches and two untracked preview files are preserved.

## Implementation

- Owned device discovery through a session-only credential-free route; revoked connections and expired owning sessions excluded.
- Shared remote store fences session/account changes, cancels stale loads and retains explicit unavailable states.
- Web/desktop Settings expose ChatGPT accounts, device catalogs, model search/defaults and reconnect/retry; mobile exposes owned devices and their account-bound defaults.
- Settings search indexes discover the same controls in both clients.
- Credential-owning desktop runtime rereads the shared default before inference, checks binding/version and rejects failed/foreign/stale reads without cached-model fallback.
- Private device-discovery route excluded from agent tools; generated MCP catalog updated.

## Evidence so far

- Initial combined discovery/store/UI/picker/inventory51/51 passed.
- Current runtime/default/store/UI checks43/43 passed, including remote default changes before private inference and no fallback after failed/foreign reads.
- Generated MCP catalog checks4/4 passed. Current combined rerun67/67 passed, zero skips/cancellations; all workspace types/build and candidate formatting passed.
- The old worktree contained incomplete dependency directories and broken shared root dependency paths. Only this worktree's dependency links were repaired against the matching healthy worktree. Incomplete apple-targets retained at /tmp/orbyn-model-settings-incomplete-apple-targets. No root/user dependencies were changed.
- Full formatting flagged only preserved user file desktop/src/settings-connection-preview.tsx. It is untouched and excluded from candidate staging. Candidate formatting is checked separately; CI's clean checkout must pass full formatting.

## Remaining gates

Full matching-head local/CI, actual authenticated executor/provider behavior and native/web/desktop visual/interaction acceptance. Types and VM components do not prove delivery. Native Simulator remains at the Terms-linked Sign in button; human final action pending. Saved denied localhost UI permission remains respected. No deployment or cleanup; M1/U1 and the whole ADR remain open.
