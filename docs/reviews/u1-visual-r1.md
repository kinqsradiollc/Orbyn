# U1 Visual Check — R1

Date: 2026-10-12  
Status: **Bounded visual pass complete; targeted `e0997ae4` keyboard/focus rechecks passed. Listed unverified cases remain.**

## Candidate and environment

- Checkout: `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`
- Branch: `codex/c6-file-viewer`
- Frozen candidate: `ad1a5dde6987db74c2cbf994d8d9d5fd39dae8cd` (parent `3b488b51332d8cf46d25de913bd89dbe71bce428`)
- Shared web preview: `http://localhost:5174`
- Expo web preview: `http://localhost:8083`
- Tester reported the API health endpoint returned HTTP 200 against disposable `orbyn_test` with `orbyn.environment=test`. Visual Check did not restart or independently recheck the services.
- Sign-in used the existing synthetic account. Its previously recorded local QA consent was not repeated. No credential value is included here.
- The in-app browser reported `devicePixelRatio=0.8` during the responsive checks. Calibrated CSS viewport measurements were 320×740 (raw override 256×592), 900×740 (720×592), and 1280×900 (1024×720). The shared web tab's temporary override was reset before finishing. Expo web rendered at 320×740.

## Web observations

### Settings and Home

- At exact 320×740 CSS, Settings used the single category picker. Opening it, pressing Down, then Return selected **Assistants**; focus remained on the picker. The account content and accordions stacked vertically.
- At exact 320×740 CSS, the Home project card measured about 271 CSS pixels wide; its title and Project badge fit on one line. The document width was 320 CSS pixels with no horizontal overflow.
- At exact 1280×900 CSS, Home used the wider multi-column hub layout. The project title was ellipsized to preserve room for the Project badge; the card and badge did not overlap in the inspected view.
- At wide size, Settings showed horizontal category buttons. Selecting **Assistants** and opening **Assistant rules** worked; the inspected panel remained within the Settings dialog.
- The narrow Settings screenshot was captured with the account section collapsed. The wide Settings screenshot also had account details collapsed; no account email appears in the report.
- The two-step and passkey enrollment prompts were not opened because continuing would add an authentication factor. The Docs custom AI instruction prompt was not reached: the supplied fixture page was empty, so it had no selectable page text. No page content was added.

### TaskDetail drawer (not SidePeek)

- Opening the fixture task from Home’s **Up next** rendered the editable TaskDetail drawer, with status controls, progress, Sessions, Notes, Subtasks, Checklist, Updates, and **Focus** / **Edit details** actions.
- At the first nominal 320×740 override (effective 400×925 CSS), the drawer filled the viewport, the status controls wrapped into two columns, the title remained readable, and footer actions stayed visible. This was not an exact 320 CSS check.
- With TaskDetail open, Cmd+K opened Search and focus reached its search combobox. The first Escape closed TaskDetail while Search remained open; the second Escape closed Search. This is a separate, observed Escape-order interaction on TaskDetail; it does not describe SidePeek.

### Read-only SidePeek

- Opened the fixture task from Search with Cmd+Enter. The accessibility tree identified **Task beside: Review the semester project plan, verify every milestone, gather team feedback, and prepare a clear summary before Friday's workshop** and exposed **Pin the peek**, **Open full**, and **Close the peek**, with no TaskDetail editing controls.
- At exact 900×740 CSS, the long title wrapped across four lines without covering the top actions. The workspace behind the SidePeek was dimmed; clicking the backdrop closed it.
- Cmd+K opened the command palette over SidePeek. Focus stayed on the palette input while typing a harmless local search query. The first Escape closed only the palette and restored focus to **Close the peek**; SidePeek remained open. A second Escape closed SidePeek.
- **Focus-restoration observation:** after SidePeek closed with Escape or a backdrop click, focus moved to the web area/body instead of a specific control in the underlying task list. This merits follow-up in the keyboard/focus review.
- No forced load error was created. Retry behavior remains unverified because the mounted task view had no error or retry state.

### Assistant panels and composer

- At exact 320×740 CSS, opening Chat history showed only Chat history. Escape closed it and returned focus to the Chat history trigger. Opening Upcoming showed only Upcoming; Chat history was absent while Upcoming was open.
- At exact 320×740 CSS, the composer, send control, and suggestions fit in the view. A harmless local draft was entered and cleared; the composer retained focus, Send enabled while the draft existed and became disabled after clearing. Nothing was sent.

## Expo web observations

- Expo web rendered at exact 320×740 CSS. Workspace **Settings** opened as a full-height sheet. The inspected settings list was readable and vertically scrollable. A cropped screenshot below the account header avoided the synthetic account email.
- Settings closed using its Close control and Escape. On Escape, focus returned to the Settings trigger. The theme started in Light; Dark was selected for the contrast inspection and then Light was restored. Dark-mode text and controls remained legible in the inspected view; no formal contrast-ratio audit was performed.
- Tester updated the disposable task through the authenticated local `orbyn_test` API while Visual Check was on Expo Settings. The persisted task is version 2, title length 132 characters, kind `task`, status `todo`. Visual Check only inspected it; the unsaved long title typed earlier in the editor had been discarded and was not saved.
- At 320×740 CSS, the persisted long title wrapped across six lines in Task detail. The top **Task options** and **Close** actions remained visible, and the pinned update composer stayed below the scrollable content without overlapping the title.
- The changed mobile AlertHost path was reached through **Edit details → Delete item**. It displayed an app-owned **Delete this item?** dialog with **Cancel** and **Delete**. Choosing **Cancel** closed the dialog; the task remained To do. No item was deleted.
- The Task options **Cancel task** flow was also opened and dismissed with **Keep task**; the task stayed To do. This older ActionSheet path is separate from the AlertHost check above.

## Candidate correction context

- Reviewer R1 identified a passkey cancellation defect and narrow SidePeek focus theft by the command palette. The Tester supplement for `ad1a5dde` reports both corrections and six focused dialog regressions passing, plus desktop typecheck/build. The browser pass above confirms palette focus and restoration to **Close the peek** at 900×740 CSS.
- The initial focus-restoration observation on `ad1a5dde` was about closing SidePeek itself; it was distinct from the corrected palette focus behavior and is superseded by the targeted checks below.

## Targeted keyboard and focus rechecks

Scope: only the TaskDetail/Search Escape order and SidePeek focus return requested for the follow-up. No broader web sweep, Expo pass, combined-panel gate, or tests were run.

### Interim candidate `c2cefbe7`

- Candidate: `c2cefbe77ab525cfa30db29853ce289a3622a10e` (parent `ad1a5dde6987db74c2cbf994d8d9d5fd39dae8cd`). At 900×740 CSS, TaskDetail stayed open after Cmd+K then Escape, and closed on the next Escape. SidePeek opened from Search with Cmd+Enter; Cmd+K focused Search, the first Escape returned focus to **Close the peek**, and the next Escape closed SidePeek and returned focus to **Search or ask**.
- These are interim observations only. A combined-layer ownership issue was identified in this candidate, so it is not the final recheck candidate.

### Refreshed candidate `e0997ae4` — final targeted visual recheck

- Candidate: `e0997ae434cb8cee9bb783ce524a8519aede34a7` (parent `c2cefbe77ab525cfa30db29853ce289a3622a10e`). The local preview was reloaded after the candidate update; the disposable task remained To do. Exact viewport was 900×740 CSS pixels (`devicePixelRatio=0.8`; viewport override 720×592 device pixels).
- **TaskDetail/Search Escape order — passed:** opened the editable task from My tasks, then opened Search with Cmd+K. First Escape removed Search while focus returned to **Close task panel**, with TaskDetail still present. Second Escape removed TaskDetail and focus returned to the fixture task's **Open** button.
- **SidePeek focus return — passed:** opened the task from Search with Cmd+Enter. SidePeek exposed only the read-only **Pin the peek**, **Open full**, and **Close the peek** actions. Its title wrapped across four lines; top actions remained visible and the underlying workspace was dimmed. Cmd+K opened Search with focus on its combobox. Escape closed Search and restored focus to **Close the peek** while SidePeek remained open. The next Escape closed SidePeek and returned focus to the underlying **Search or ask** button, rather than the page/body.
- **Source inspected:** `desktop/src/lib/dialogLayers.ts:1-39` compares the nearest positioned numeric-z layer and uses DOM paint order to break equal-z ties. `desktop/src/features/task/TaskDetail.tsx:291-305` and `desktop/src/features/peek/SidePeek.tsx:169-180` defer Escape/Tab ownership when a higher dialog owns the layer. `desktop/src/features/peek/SidePeek.tsx:159-168` restores focus to the surviving opener or the stable `.command-trigger` fallback.
- The visible results match the requested two behaviors on `e0997ae4`. This bounded pass did not independently verify the combined-panel runtime pair beyond the two requested interactions.

## Unverified scope

- SidePeek retry under an actual load error: no safe error fixture was supplied, and Visual Check did not disrupt Tester-owned services.
- Custom AI instruction prompt: the available fixture page was empty; opening this prompt would require selectable page text. No content was added.
- Passkey/two-step enrollment prompts: not opened because these would create an authentication factor.
- Native desktop and iOS/Android checks: out of this web/Expo-web pass.

## Evidence handling

Screenshots were inspected inline through the browser-control tool, including exact-width Home, wide Home and Settings, long-title SidePeek, Expo Settings, Expo long-title Task detail, and the Expo AlertHost dialog. The tool exposed no local screenshot-save path, so no screenshot file is attached. No Visual Check action changed fixture records, sent an assistant message, or submitted a form. Tester’s separate version-2 title update is recorded above. No source files or tests were changed or run by Visual Check.
