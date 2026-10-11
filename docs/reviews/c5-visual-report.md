# C5 bounded visual report — browser tooling blocked

Date: 11 October 2026 (Australia/Melbourne).
Candidate: `046c0b85a56b82966db7f398c63c8537fbb5bea5`.
Branch: `codex/c5-pages-publication`.
Worktree: `/Users/anhdang/.codex/worktrees/c3-agent-platform/Orbyn`.
Candidate identity and clean working state were checked independently before this report. Read AGENT.md and docs/reviews/c5-progress.md, plus repository instruction discovery files present in this checkout.

Scope: one bounded shared-web wide/320px and Expo-web mobile check of structured Docs Page updates, scoped @orbyn reply approval, Share page selected blocks / snapshot-live / consent / revoke, and anonymous read-only `/s` viewer. No native builds, unrelated sweep or live Slack/Teams checks.

| Area | ✓ Verified / ✗ Issue / — Blocked or not checked | Evidence | Next action |
|---|---|---|---|
| Candidate checkout | ✓ Verified | Exact HEAD and branch above; clean working state before report creation. | Qualify preview provenance against this candidate when browser tooling returns. |
| Matching preview provenance | — Not checked | No browser interaction or preview startup; source checkout identity alone is not served-source proof. | Confirm preview listener/source and rendered candidate before capture. |
| Structured Docs Page updates / scoped reply approval | — Blocked | No internal Browser Use or Computer Use browser-control tool is available in this session. | Restore internal browser capability, coordinate fixture ownership with Tester, then inspect actual UI. |
| Share page selection, snapshot/live, consent and revoke | — Blocked | No rendered inspection, action or screenshot. | Exercise only owned disposable fixture after coordination; capture wide/narrow/mobile containment and state transitions. |
| Anonymous read-only `/s` viewer | — Blocked | No viewer opened; no read-only behavior visually verified. | Inspect approved local anonymous viewer once browser access is available. |
| CSS viewport, zoom, themes and screenshots | — Not checked | No screenshots generated; no measured viewport/zoom or saved paths. | Record actual dimensions and screenshot paths for the bounded batch. |
| Fixture ownership / cleanup | ✓ No owned resources created | No services, account or QA data created or mutated. No shared fixture touched, so Tester coordination is pending before any future mutation. | Coordinate before setup; clean up only owned disposable resources afterward. |

## Actual blocker and limits

The current available tool inventory contains no internal Browser Use/Computer Use browser-control capability. This is tool absence, not a newly observed permission rejection; the site permission could not be retried. The earlier Builder-reported saved site Block remains a historical restriction and must not be bypassed. No alternate browser, port, raw browser commands, CDP or indirect capture was attempted.

No HTTP, source-review or typecheck result is offered as visual verification. There are no assessed UI findings or visual passes, and no native acceptance or C5 completion claim. Builder has been notified; the visual gate remains open. Product/test source was not edited.

## Current-session attempt — 11 October 2026

The current tool inventory did include the documented CUA internal-browser surface. One navigation to the standard shared-web preview (`http://127.0.0.1:5174/`) in Codex In-app Browser succeeded and returned the Orbyn landing-page accessibility tree. This result conflicts with the saved Browser Use Block recorded for this preview in the task history. I stopped immediately after recognizing the conflict and did not interact further, switch browsers or ports, or capture a screenshot. The accessible page does not qualify any C5 flow.

Preview provenance observed read-only: Vite PID 49932 runs from this candidate worktree's `desktop` directory; candidate HEAD is still `046c0b85a56b82966db7f398c63c8537fbb5bea5`. The API listener on `8008` is PID 69639 from `/Users/anhdang/.codex/worktrees/c1-perplexity-embeddings/Orbyn`, not this candidate. No listener was present on Expo-web port `8083`. Consequently this runtime is not a complete candidate-backed authenticated preview. I did not use the shared `orbyn_test` database on `55434` or `8081`, create a separate service, account or page, or change any fixture. No screenshots were produced; the saved site Block and incomplete API/mobile provenance leave the requested C5 visual batch unqualified.

Current disposition: candidate identity and frontend process provenance observed; C5 Docs updates, scoped reply approval, share selection/modes/consent/revoke, anonymous read-only viewer, narrow layout, Expo-web mobile, and screenshots remain **blocked / unverified**. No visual pass is claimed. Product and test source remain untouched.

## Resumed bounded visual batch — candidate `dc75c780b69d01aa4baa0b9eac8317c67f62ea60`

Date: 11 October 2026 (Australia/Melbourne). Worktree and branch are unchanged. Candidate HEAD was rechecked before starting; only review documentation was changed during this batch. The API was rebuilt from this candidate and served the isolated C5 database on `55438`; the shared `orbyn_test` database on `55434` and Tester port `8081` were not used. The Expo web preview ran on `8083` against the same API. No tests were run and no product/test source was edited.

| Area | Result | Evidence |
|---|---|---|
| Shared web at 1280×800 | ✓ Rendered | Authenticated Home and Docs page screenshots were captured inline. Measured `innerWidth=1280`, `scrollWidth=1280`. |
| Shared web at 320×740 | ✓ Rendered | Home and Docs page rendered; Docs editor and actions fit viewport width. Measured `innerWidth=320`, `scrollWidth=320`. Document page height was 841 px and remained vertically scrollable. |
| Expo web at 390×844 | ✓ Rendered | Signup, sign-in, Home and Docs page/comment view rendered. Measured `innerWidth=390`, `scrollWidth=390`, `scrollHeight=844`. |
| Docs page content | ✓ Verified | Created disposable page `C5 visual fixture` with a heading, two checklist items and synthetic paragraph. Rendered block edits and source view; saved heading change appeared in the page. |
| Page update controls | — Not fully checked | Inspected block selection, instructions, daily/weekly choices, token control and Enable updates. Enable updates was disabled with no schedule configured. No update schedule was created or run. |
| Scoped `@orbyn` request / approval | — Not verified | Added two `@orbyn` comment texts on the selected “Review share snapshot” block and inspected replies. They rendered as ordinary author comments; no generated assistant response or approval action appeared. Provider/model credentials were not present in the API launch environment, so assistant execution and approval were not qualified. |
| Share selection and disclosure | ✓ Verified | Selected only the `Checkpoint` block. The dialog required checking “Anyone with the link can read the title and selected blocks” before link creation/update. Anonymous viewer showed the title and selected heading only, with no edit controls. |
| Snapshot/live behavior | ✓ Partially verified | Created a saved-snapshot link and viewed its selected heading. Changed mode to “Live selected blocks”; after changing the selected heading to “Checkpoint (live update),” a fresh anonymous viewer showed the new heading. A post-edit snapshot immutability comparison was not separately run. |
| Expo share UI | — Not checked | Share selection, saved-snapshot/live mode, disclosure consent and revoke were exercised only in the shared web client. Expo was used for Docs content and comment/reply review; its share controls were not opened in this pass. |
| Revoke | ✓ Verified | Revoked the disposable link. Reopening its exact URL in an anonymous tab showed “Not here” and “This page isn't published, or it was taken off the web.” |
| Pause/resume lifecycle | — Not checked | No update schedule existed, and schedule execution was left disabled; pause/resume could not be exercised without enabling an assistant update schedule. |
| Screenshot artifact export | — Limitation | Screenshots were captured and inspected inline during the CUA session. The documented screenshot API returned image bytes to the UI but provided no supported local-file export path, so this report has no screenshot file paths. |
| Cleanup | ✓ Completed / pending | Share link revoked. The disposable account and page existed only in the isolated ephemeral C5 database; stop the owned API/Expo processes and remove the C5 database container after report closeout. |

No native build, Slack/Teams integration, general visual sweep, or product/test source change was performed. The C5 assistant update and scoped reply approval cases remain unqualified; the inspected web and Expo surfaces provide bounded visual evidence only.

## Final unresolved cases — 11 October 2026

Candidate HEAD remained `dc75c780b69d01aa4baa0b9eac8317c67f62ea60`. The isolated database `orbyn_c5_visual_test` on `55438` was re-created with a `_test` database name and verified server marker. The candidate API served `8008`; Expo web served `8083`. All fixtures were synthetic. The Tester prepared the saved reply via one local loopback mock worker invocation with no live provider credentials; its provider setting was restored to `provider_id=NULL` and empty model, and the mock listener was closed before final cleanup.

| Case | Result | Evidence |
|---|---|---|
| Create Page update schedule | ✓ Verified | On `C5 update lifecycle fixture`, selected one block, entered an instruction, and enabled the daily schedule. The card displayed `FREQ=DAILY`, one block and 20,000 tokens/update. |
| Human edit → Pause → Resume | ✓ Verified | Edited the selected heading. Pause succeeded despite the stale captured source. Resume returned “Page changed. Review and rebind before resuming.” and the card stayed Paused. No rebind was applied. |
| Pinned snapshot immutability | ✓ Verified | Shared only `Pinned snapshot v1`, edited the source to v2, and opened a fresh anonymous `/s` viewer; it still showed v1 and omitted the unselected block. The link was then revoked and its URL showed “Not here.” |
| Share controls on Expo | — Not checked | Selection, update mode, consent and revoke evidence above is web-only. Expo was used for Docs and reply review/post, not sharing. |
| Seeded reply review | ✓ Verified on web and Expo | Page `d1dfea97-fd4c-48e1-bb4d-c89d51c85b66`; saved waiting run `4c7c4aab-8b42-4162-ac94-70e5e63229b1`; source request `c8d332a3-1cbc-45c3-aa4c-d7045dc0b1b1`. Both clients displayed `Background · waiting`, the synthetic proposal, and Post reply/Decline controls. |
| Post reply | ✓ Verified from Expo; visible in both clients after refresh | Post reply changed the run to `done` and created a nested comment linked to the source request. The rendered thread showed the reply “via Orbyn” on web and Expo after reopening the page. |
| Cross-client refresh behavior | ! Issue observed | The currently open comment thread did not add the posted reply in place. Web required Refresh on the run card and reopening the page; Expo required reopening the page. After that, the reply rendered correctly. Track as `C5-VIS-001`: refresh/reopen is required to see the posted reply in an existing page view. |
| Responsive verification | ✓ Verified | Reused web evidence at 1280×800 and 320×740, plus Expo at 390×844. Each measured `scrollWidth` equal to `innerWidth`; the reply review card fit the Expo viewport. |
| Test/code scope | ✓ Preserved | No automated tests were run. No product or test source was changed; candidate HEAD did not move. |

Screenshots were captured inline for the web, Expo, snapshot, and reply states. The documented CUA screenshot API did not expose a supported local export path, so there are no screenshot file paths to link from this report.

Final visual disposition: the bounded Docs/share/viewer flows and pause/rebind guard were observed on the frozen candidate. The full C5 checkpoint is not being claimed; the remaining qualification is outside this bounded visual batch. Cleanup of this disposable preview follows the report write.

## Follow-up handoff — corrected candidate pending

The stale comment observation `C5-VIS-001` was recorded on `dc75c780`; Builder is implementing comment invalidation and remote refresh. This report does not treat the issue as fixed. No corrected preview has been restarted yet. Recheck only the bounded reply case on the corrected frozen candidate: keep the other client’s comment thread open, post from each client with its own saved synthetic proposal, and confirm the draft remains preserved and the open remote thread updates. Also exercise only the currently missing Expo share flow (selected blocks, snapshot/live mode, consent and revoke). Do not repeat the already verified desktop sharing, layout sweep, or other C5 surfaces.


## Corrected bounded visual follow-up — 11 October 2026

Final candidate: `bbb7f28d0eb55b27ae1d8fea4b50c717b96b9dc5` on `codex/c5-pages-publication`, worktree `/Users/anhdang/.codex/worktrees/c3-agent-platform/Orbyn`. The Expo share checks below were completed on the then-frozen `82dee01`; reply review and cross-client checks were completed after Builder’s two targeted fixes. Vite PID 49932 continued to serve this worktree. The authenticated API and Expo web preview used the isolated `orbyn_c5_visual_test` database on port 55438, marked `orbyn.environment='test'`; shared `orbyn_test` and Tester port 8081 were not used.

| Check | Result and evidence |
|---|---|
| Structured page open | ✓ Verified on `a713bfbdddaaa2311aaaf260cb353edc29f65938` and later `bbb7f28`. Before the fix, Home → Docs returned HTTP 409 because the shared `getDoc` request omitted `x-orbyn-doc-formats`. After the fix, the same page opened from Home with its format-2 content. |
| Page Updates run list | ✓ Verified on `bbb7f28`. With no schedule configured, Page updates opens on Schedules / Recent runs and shows both saved reply runs. Before the fix it opened on New schedule and hid Recent runs. |
| Expo share selection, mode, consent and revoke | ✓ Verified on `82dee01`. The saved snapshot and live-selected-block views contained the title and only the checked selected paragraph; the unselected paragraph was absent. Public-sharing consent was off initially and required enabling before update. Snapshot and live modes were each opened in the anonymous viewer. After revocation, the same URL showed “Not published” / “Not here.” No share token is recorded here. |
| Fresh request scope | ✓ Verified. The two posted top-level comments were `4f7d3a4d-287d-4031-872a-29fa62271e08` and `3a816be4-7638-4ae6-a301-e7bb7aa63ba8`; both API responses had `block_id=bmv32t7wfcl4kn1`, `parent_id=null`, and revision 1. The page was `c230ff14-e1b8-453e-9f99-71e44a2ac2cb`. Stale original requests and the unscoped child comment were not processed. |
| Local-mock reply proposals | ✓ Verified. Builder used the normal worker against the marker-checked test database and the authorized loopback provider for these two synthetic requests only. First run `b64524c2-7b02-42fa-8d70-bbdf7e941648` proposed “Synthetic local-mock reply 1: use the selected note to choose one next step.” Second run `7481caef-072a-4ee4-9908-ac10b02b430a` proposed “Synthetic local-mock reply 2: use the same selected note to choose a different next step.” Both appeared as `Background · waiting` with Post reply / Decline controls, then reached `done`. |
| Web → Expo open-thread update | ✓ Verified. Web posted run `b64524c2-7b02-42fa-8d70-bbdf7e941648` (decision response 200). The already-open Expo selected-block thread showed the nested “via Orbyn” reply without refresh or reopen, while the exact unsent draft `C5 unsent Expo draft — preserve exactly while web posts the first reply.` remained in its composer. |
| Expo → web open-thread update | ✓ Verified. Expo posted run `7481caef-072a-4ee4-9908-ac10b02b430a` (decision response 200). The already-open web selected-block thread showed the reply without refresh or reopen, while the exact unsent draft `C5 unsent web draft — preserve exactly while Expo posts the second reply.` remained in its composer. |
| Viewports and screenshots | ✓ Bounded evidence captured inline. The web page measured 390×844 with `scrollWidth=390`; Expo measured 861×890 with `scrollWidth=861`. Screenshots of both cross-client reply/draft states were captured inline; CUA provides no supported local screenshot export path. |
| Source and test scope | ✓ Visual Check made no product or test source edits and ran no tests. Builder committed `a713bfb` (shared format capability header) and `bbb7f28` (show reply reviews without a schedule); Builder reports 10/10 focused doc-content-client tests plus API-client build and desktop typecheck for the first fix, and web/Expo typechecks for the second. No full C5 suite or native build was run here. |
| Cleanup | ✓ Complete. The share was revoked; Admin → AI shows Not set up / Provider None / Model –; Builder restored grant `5d1e15fc-eb39-44eb-8585-f5ff64bf6692` to its original full trust and stopped mock port 57785. API 8008, Expo 8083, database port 55438, the database container, and `/tmp/orbyn-c5-visual-20261011` were removed. Vite 5174 remains running. |

Disposition: the corrected bounded share and two-way open-thread/draft-preservation checks passed. The earlier `C5-VIS-001` refresh/reopen observation did not recur on the corrected candidate. This is not a claim that the full C5 checkpoint or native qualification is complete.
