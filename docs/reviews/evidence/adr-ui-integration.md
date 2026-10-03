# ADR UI integration preview

The isolated `codex/adr-ui-integration` branch combines the Home profiles/editorial
candidates (PR165/171), Docs through source editing (PR175) and ChatGPT account
model settings (PR170). Their frozen branches remain intact. Merge conflicts
were limited to appended review/ADR sections and shared export lists; both sets
of content/exports were retained. The combined capability catalog was regenerated.
Root main and its user-owned files are untouched.

## Executed checks

- 163 focused source/Markdown/navigation/Home/profile/model/catalog checks pass,
  zero failures/skips/cancellations.
- Combined workspace typechecks, production build and full formatting pass.
- Dedicated existing marked preview test DB migrated successfully, preserving
  the requested admin account and test data; no database reset.
- Preview now serves the combined branch on5174 and its API on8027. Explicit
  API_PROXY_URL and VITE_API_URL repair the previous preview's accidental8008
  proxy target. `/api/health` now returns200 instead of502.
- Admin login200, role verified, authenticated `/me`, assistant profiles,
  ChatGPT connection discovery and executor discovery each returned200 through
  the web proxy. Password/session contents are private and excluded from Git.

## Open gates

This is a review preview, not a main merge or deployment. Frozen full integration
local/CI, actual eligible ChatGPT execution, signed-in editor saves/concurrency,
Android and remaining native screenshots/interactions are not established by
these checks. Web visual acceptance is the user's manual review; saved browser
denial is not bypassed. All C1–C6/M1/D1/U1 remain required, alongside plugin,
reflection/collaboration and the rest of the whole-app UI. No cleanup/release.
