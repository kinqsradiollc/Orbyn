# ChatGPT reference inspection — 13 October 2026

Status: **Bounded reference inspection completed in the user-selected internal browser. Coverage limits are listed below.**

## Scope and provenance

Orbyn Visual Check inspected Chat/Work landing layouts, composer growth, an existing Chat conversation, an existing Work conversation, sidebar/project history, account navigation, Settings, installed plugins and one plugin detail page. This is reference research for ADR 003, not an Orbyn visual acceptance pass.

The user selected the existing internal-browser tab at `https://chatgpt.com/` after Chrome access failed. The observed default viewport was 1431×1259 CSS pixels, devicePixelRatio 1.6, with the account's existing dark appearance. No viewport override was applied.

Orbyn checkout: `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`. Observed HEAD: `c7b3bdb7f64ed6bf1cc6b2bf27493a605fac0f7c`. The redesign remains in progress; no new frozen candidate was supplied.

## Direct observations

### Landing views and composer

- **Chat landing:** a small Chat/Work segmented control sits at the top. A short heading and single-line pill composer are centered within the remaining main pane, with generous empty space. Suggestions are separate rows below the composer. The input, attachment action, model selector and voice controls share one surface.
- **Work landing:** retains the same main-pane alignment but uses a taller composer with input above the control row. A visually secondary utility strip directly below it contains project, files and plugins choices. Three suggestion cards appeared below after loading; the initial skeletons occupied that same region.
- **Work input growth:** entered a synthetic, unsent 30-line draft in the initially empty landing composer, then cleared it. The empty editor was approximately 52 CSS pixels high. With the draft, the content measured 780 pixels high, while its scroll wrapper stopped at approximately 315 pixels with `overflow-y:auto`. A downward scroll moved the wrapper to scrollTop 465. This establishes internal scrolling in this Work composer; nothing was sent.
- **Chat input growth (focused follow-up):** the previously observed empty editor was approximately 26 pixels high. A synthetic, unsent 30-line draft produced 780 pixels of editor content inside a 315-pixel wrapper (`max-height:314.75px`, `overflow-y:auto`). Scrolling moved that wrapper to scrollTop 465. The draft was cleared and the empty Ask ChatGPT field verified. Both landing modes therefore have directly exercised bounded draft growth and internal scrolling at this viewport.
- **Chat active conversation:** transcript content scrolls above a composer dock at the bottom of the main pane. Before and after an upward transcript scroll, the input stayed at approximately y=1191–1227 in the 1259-pixel-high viewport. A Scroll to bottom control appeared after leaving the bottom. User messages use a bounded right-aligned bubble; assistant text, tables and diagrams flow on the main surface.
- **Work active conversation:** the inspected conversation also had a bottom dock, using the taller Work composer. Its embedded output showed an existing load-error row with Retry and a developer-settings indicator; neither action was used.

### Sidebar, account and project history

- A narrow app icon rail stays beside a secondary navigation/history pane. The profile trigger sits at the rail's bottom. Home, Space, Scheduled and other app destinations are separate from conversation history.
- History is grouped under **Pinned**, **Projects** and **Recents**. Section labels are quiet; individual rows use compact text, with pin/menu actions beside them rather than persistent button clusters. The selected conversation has a soft filled row.
- Expanding one project revealed two indented conversation links beneath its parent row. It was collapsed again after inspection. No project or history record was edited.
- **Chat versus Work project choice (focused follow-up):** switching the landing mode to Work retained the same Pinned/Projects/Recents history groups. Work exposes Choose project in its composer utility bar; the inspected Chat landing did not expose that utility bar. Opening Choose project showed an initial Loading projects state, followed by a dialog with Search projects, a suggestions list, New project, and one existing project marked disabled. Escape closed the chooser and restored focus to Choose project. No project was selected or created, so selection effects and project-scoped history filtering remain unverified. The sidebar's Filter chats and work control produced no visible popover/state change in this attempt; its filtering behavior is not established.
- The history scroll region had clientHeight 1127 and scrollHeight 1295 with `overflow-y:auto`, allowing a long list within the sidebar while the app rail and sidebar header remained available.
- The account popover contains account/plan access, personalization, profile, Settings, help and sign-out. Opening Settings navigates to a dedicated Settings route.

### Settings and connections

- Settings replaces the conversation-history pane with its own search and grouped category navigation: **Personal**, **Integrations** and **Coding**. The app rail remains. Selecting a category keeps that navigation frame while the main pane loads.
- The General page used a short title and a simple setting row: label/necessary helper on the left, current-value control on the right. Settings is a full-page workspace in this inspected desktop layout.
- Plugins Settings used a constrained main column, heading/short helper, directory action, installed-plugin search and default-permission row. Six installed entries were grouped inside one rounded boundary with horizontal dividers. Each row had an icon, name and short description at the left; current permission or reconnect status and a chevron at the right.
- One plugin detail page used a breadcrumb, title/description, a permission row, a connected-account section, skill rows with trailing switches, and About metadata. It had one connected account. Account identity is intentionally omitted from this report. No controls that change permissions, connections, installation or settings were used.
- The six-entry list and single-account section fit the inspected page. **Large connection-list or multiple-account scroll bounding was not verified.**

### Panels and split workspaces

- The synthetic document conversation rendered tables and a Mermaid diagram inline, with explicit expand controls. These controls were visible but not exercised.
- Neither inspected conversation exposed a working side-by-side artifact workspace. The existing Work output was in an error state. This pass therefore provides **no evidence for split-pane sizing, resizing, focus ownership or artifact-pane behavior**.

## Proposed adaptations for Orbyn

These are design recommendations inferred from the observations, not inspected Orbyn implementation results.

1. Center the empty Assistant composer within its actual remaining pane. Once a conversation exists, dock the composer to that pane's bottom and let the transcript scroll independently. Keep text width readable even when the workspace is wide.
2. Give long drafts a clear maximum height relative to the usable pane, followed by internal scrolling. Keep attachment/model/send actions stable and visible as the draft grows. Verify this separately for Orbyn's web and Expo implementations.
3. Keep workspace destinations, project navigation and session history visually distinct. Use quiet group labels, compact rows, a soft selected state and a row menu for management actions. Bound history scrolling so it does not move the app's primary navigation.
4. Give Settings a clear local navigation/search frame and a readable content column. Use flat setting rows with short labels and trailing current values. Adapt this hierarchy to Orbyn's mobile sheet instead of assuming the desktop route should be copied literally.
5. Present providers/connections as a shared list surface with dividers, leading identity and trailing status/action. Put account, permission and capability detail on a dedicated detail surface. Test long lists and long identities in Orbyn because this reference did not establish their overflow behavior.
6. Use neutral surfaces and sparse borders to establish hierarchy; reserve Orbyn's agreed blue accent for selection and primary actions. Keep assistant responses as readable content rather than wrapping every section in another card.
7. Make the current project context visible near the composer, with a searchable chooser that supports loading, unavailable options, dismissal and focus return. Keep navigation/history available when switching assistant modes. Whether Orbyn filters history by project should follow its own task/session contract; the reference did not establish that behavior.

## Access history and evidence handling

Chrome inventory and one direct existing-tab retry both returned `Unable to load browser request-header policy. Retry the browser command.` before Chrome tab state or pixels were available. This is not evidence of a saved site Block. The later user-selected internal-browser tab was accessible and supplied all observations above.

Screenshots were captured and inspected inline through the supported browser screenshot API. Its documented surface returned image bytes/inline pixels and exposed no local screenshot-save path, so **there are no local screenshot files to hand off**. No alternate export route was attempted. Private history titles, account identity and personalized suggestion text are not reproduced in the report.

## Limits and restored state

- One existing desktop viewport and dark appearance only; no phone, native, light-theme, formal contrast or motion audit.
- Chat and Work landing draft growth/internal scrolling were exercised; post-send transitions, streaming and live tool execution were not exercised.
- Work project chooser opening/loading/options/dismissal were exercised; project selection effects and history filtering were not verified.
- Large connections lists, multi-account overflow and a working split artifact pane remain uninspected.
- No message was sent; no conversation, project, account setting, permission or consent state was changed. The temporary unsent draft was cleared.
- The tab was returned to `https://chatgpt.com/`, with Chat selected, the composer empty and the inspected project collapsed.
- No Orbyn source, tests, fixtures or previews were operated. Its final web/Expo visual pass remains pending the complete frozen candidate handoff.
