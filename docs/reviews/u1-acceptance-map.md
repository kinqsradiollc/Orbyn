# U1 acceptance map

Prepared 11 October 2026 against main runtime `937cb16f`, delivered in
`4ab7dbc9`. This is the remaining-evidence inventory, not a visual pass or
permission to skip full C6 real-host acceptance. Finish C6 before starting the
next implementation checkpoint.

## Scope and evidence rules

- Shared desktop UI uses web preview; mobile UI uses Expo web. No installed
  desktop check, iOS build, Android verification or automatic 200% audit.
- Reuse stage evidence only after checking affected source equivalence. A
  screenshot of one state does not qualify every surface or interaction.
- All rendered checks go through Orbyn Visual Check. Batch only the concrete
  missing risks; no repeated whole-app sweep after every change.
- Preserve C4 browser/visual and hosted SIWC/live-provider/channel deferrals.
  They remain unverified, not passes or silently restored prerequisites.
- Keep this map separate from routine status owned by Stage Tracker.

## Surface inventory

Source discovery: `desktop/src/app/App.tsx`, `desktop/src/app/views.ts`,
`mobile/src/app/{App,RootScreen}.tsx`, `mobile/src/app/tabs.ts`, and the owning
feature/screen modules. Route presence proves implementation location only.

| Surface family | Main task / risk to qualify | Existing evidence to inspect before requesting anything |
| --- | --- | --- |
| Navigation, Home, Workspace | Find a destination; expanded/collapsed navigation and secondary panes must leave useful task space | C5 visual report; earlier Home/navigation reports |
| Tasks, Lists, Views, task detail | Add/edit/complete a task; retain drafts, list/board state and reachable actions in narrow panels | Earlier task checkpoints; C5 structured task evidence |
| Calendar, Agenda, planning, Focus, progress | Change a plan or schedule; avoid overlay/toolbar collisions and stale time state | Planning/focus stage reports; identify missing states explicitly |
| Assistant, inbox, review | Chat and review an exact proposal; history/upcoming panels must not squeeze or overlap composer | Assistant layout fixes and content-density reports |
| Background, Overnight, agent identity/activity | Distinct agent/run states; setup belongs to agent work, not chat onboarding | C3 closeout and focused authority/activity results |
| Settings and connections | Modal/category navigation, short copy, provider/model/device identity, truthful usage and separate MCP grants | C1/C2 visual reports and content-density closure |
| Docs, Projects, Memory, agent notes, Study | Normal editing/recovery, Markdown/Mermaid and supported render/export families; preserve permission-filtered links | C4/D1 delivery and user-deferred browser checks; C5 Docs evidence |
| Teams, replies, publication | Select exact blocks, approve/revoke sharing, synchronize replies without losing another client's draft | C5 visual report and final reply synchronization evidence |
| Booking and public pages | Public read-only flow, permission-safe titles/media, usable form/recovery | Publication/privacy tests; existing booking/public UI evidence |
| Admin, providers, legal/status/auth | Compact controls, meaningful error/loading/disabled states; no secret/fixture prose or native alert regressions | Provider/admin visual reports, content-density checkpoint, auth tests |
| Plugin host UI and files | Real-host discovery, scoped consent, Today, mentions, resource read/save and account switch/revocation | C6 synthetic reports only; production-host cases still required |

## Bounded execution after C6

1. For each family, locate the exact current component and latest passing
   report. Record source equivalence and the specific states it proves.
2. List confirmed defects separately from missing evidence. Builder completes
   the full agreed fix batch before formal Test → Review.
3. Give Visual Check one stable candidate and the missing tasks/states. Prior
   user issues prioritize 320×740 task space, nested panels, Settings category
   picker, assistant history/composer, long values and modal dismissal/focus.
   Use wide web and Expo web counterparts where the same task is supported.
4. Tester checks affected functionality; Reviewer inspects code and both test
   and visual evidence. Maximum three formal rounds, with same-round closure.
5. Push accepted checkpoints to main, then reconcile the complete requirement
   ledger. Do not infer full completion from this inventory or a test count.

## Current external observation

On 11 October, a read-only request to
`https://mcp.orbyn.dev/.well-known/oauth-protected-resource/plugin` returned
HTTP **404** (curl exit 0). This proves the requested metadata was unavailable
at observation time, not whether code or env had reached that server. Owner
deployment is pending; no alternative host/resource or browser bypass was used.
