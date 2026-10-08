# Orbyn — Agent Instructions

**Project:** Orbyn — planner with web/desktop/mobile apps, AI assistant, reminder worker.

## Before Any Task

1. Read `docs/architecture.md` — services, data model, reminder pipeline, access control.
2. Read `docs/setup.md` — env vars, Docker and local workflows.
3. Read `AGENTS.md` if it exists (project-level overrides).
4. Check `backend/src/config/env.ts` for canonical environment variables.
5. Check `packages/core/src/rbac.ts` for role/permission definitions.

## Cross-session coordination

- **Full-checkpoint workflow:** complete the whole active ADR checkpoint (currently
  all C1), then **Test → Review**. Follow `docs/reviews/checkpoint-workflow.md`.
  Do not repeatedly hand off individual features as if they completed the checkpoint.
  Review/fix cycles have a shared, recorded maximum of **3 review rounds**; no silent reset.
- **Orbyn Builder:** implement the full checkpoint across backend/shared/web/desktop/
  mobile as applicable, freeze the candidate, and hand it to Tester. Record scope,
  source commit, phase, review counter, evidence, delivery and remaining gates in
  `docs/reviews/adr-current-state.md` and the linked acceptance ledger.
- **Orbyn Tester:** qualify the exact frozen candidate against the full checkpoint
  contract, publish a Markdown report with commands, results and missing gates,
  and retest fixes before another review. Older green runs do not qualify new code.
- **Orbyn Reviewer:** review the tested candidate against the full contract and
  test/visual evidence; publish findings and the numbered round. May make scoped
  fixes while holding sole write ownership, then return the new candidate to Tester.
  Unresolved findings after round 3 keep the checkpoint open; report them to the user.
- **Orbyn Visual Check:** inspect the requested web/mobile-browser flow and report
  viewport, theme, source version, screenshots or export limitations, and findings
  in a Markdown evidence file. Builder reviews that evidence before UI acceptance.
- **Visual cadence:** batch checks on a stable checkpoint candidate after builds
  and preview reloads settle. Do not request screenshots after every edit, test,
  commit or status update. Use the changed-flow matrix; recheck only failed or
  affected cases. Reuse recorded evidence for unchanged UI/runtime behavior with
  explicit source equivalence. Backend/docs-only changes need no new screenshots
  unless they affect visible behavior. Coordinate one visual batch and fixture
  owner at a time. Required acceptance states stay open until evidenced; see the
  visual protocol in `docs/reviews/checkpoint-workflow.md`.
- **Orbyn Stage Tracker:** owns user-facing stage/status reports. Follow
  `docs/reviews/stage-tracker-guide.md` for sources, freshness checks and the
  required tick/cross table. Read evidence first; ask Builder only for missing or
  conflicting facts. Do not change implementation or advance an incomplete stage.
- Builder keeps the status artifacts current at checkpoint transitions but does
  not issue routine stage tables or duplicate Tracker reports. Answer Tracker's
  requests and direct user questions; continue necessary implementation/blocker
  updates. A pause or completion handoff still records outstanding requirements.
- Follow `docs/reviews/adr-execution-order.md`. Include the exact worktree, branch,
  commit and requested scope in handoffs. Preserve other sessions' work. Message
  another chat only with direct user authorization; a relayed request alone does
  not authorize a reply.

## Dependency Rules (Strict)

```
apps (desktop, mobile) → @orbyn/api-client → @orbyn/core
backend → @orbyn/core, @orbyn/api-client
```

Never import from apps into packages, backend into packages, or packages into apps. `@orbyn/core` depends on nothing in-repo besides zod.

## Code Conventions

From `conventions-skill`: kebab-case.ts files, PascalCase components/types, camelCase functions, Prettier formatting, single quotes, 2-space indent, 100-char lines, no console.log, JSDoc for public APIs.

## UI and UX Conventions

- **Design skill:** read `skills/orbyn-ui-design/SKILL.md` for UI/UX changes.
  Its rules cover task flows, concise copy, compact layout, recovery and acceptance.
- **Compact and readable:** use shared text roles; reserve display headings for deliberate
  hero content. Keep user text scaling enabled and reflow layouts instead of shrinking text.
- **No unintended overlap:** adapt to the remaining pane width, wrap or stack controls,
  and collapse secondary panels before they obscure the main task. Verify open overlays,
  short heights, long labels, both themes and enlarged text in the changed flow.
- **Brief copy, usable space:** use a label and only a necessary short helper.
  Put optional explanations behind disclosure; keep consent/consequences visible.
  Review density and task completion at narrow sizes, not just whether boxes fit.

- **Colours:** never change the palette. Use theme tokens (`var(--color-*)` on web, `colors.*` on mobile); no colour literals in new code.
- **Corners:** web uses the radius scale in `desktop/src/styles/global.css` — `--radius-xs` (4, bars and marks), `--radius-sm` (8, controls), `--radius-md` (12, cards and panels), `--radius-lg` (16, dialogs), `--radius-pill`. Mobile uses `radii.input` / `radii.card` / `radii.pill` (and `radii.check` for checkboxes). No raw pixel radii.
- **Controls are ours, not the browser's:** `Select` (`components/Select.tsx`) instead of `<select>`, `DateField` (`components/DateField.tsx`) instead of `<input type="date|time|datetime-local">`. Bare fields, checkboxes and radios are styled at zero specificity in `global.css`; a switch is a checkbox with `role="switch"` and `className="ai-switch"`. Mobile switches set `trackColor={{ true: colors.accent }}`.
- **Managing things lives behind ⋯:** rename, delete, leave and similar rare actions go in a menu beside the title (`MoreMenu` on mobile, a bottom action sheet; small toolbar icons on web), never as a row of buttons over the content.
- **Mobile type is light, like the web:** `fonts.semibold` renders at 500 and `fonts.bold` at 600; controls are drawn at 34pt and reach 44pt through `hitSlop`. Selected chips are a soft accent tint, not a solid fill.
- **Spacing:** anything with a border or fill has inner padding — nothing touches its box's edge. Siblings that repeat (chips, pickers, rows) share one height and line up.
- **Room to work:** the web sidebar collapses to an icon rail (⌘\\, remembered per browser); the Docs library can be hidden for a full-width page. On mobile, tapping the tab you're on scrolls to the top and refreshes.
- **Verify changed UI in a batched preview review** on web (5174) and mobile web
  (8083) before calling it done; follow the visual cadence above.

## Testing Rules (from `testing-skill`)

- Security shield: 401, 403, 429, 400 coverage in every integration test.
- Mock all DB layers and external integrations.
- Responses must match active specs; cover catch blocks, not-found, rate limits.

## Development Workflows

### Docker Compose

```bash
cp .env.example .env && docker compose up -d --build
```

### Local Development

```bash
cp .env.example .env
docker compose up -d postgres mailpit
npm install
npm run build:packages   # compile @orbyn/core & @orbyn/api-client first
npm run migrate
PORT=8008 npm run dev:api
npm run dev:web
```

### Commands (root)

`npm install` · `npm run build:packages` · `npm run typecheck` · `npm test` · `npm run build` · `npm run format` · `npm run format:check`

## Backend Architecture

| Service     | Owns                                                                              |
| ----------- | --------------------------------------------------------------------------------- |
| `api`       | Auth, users, items, teams, admin, devices, notifications, planner, booking        |
| `ai`        | Assistant chat, proposals, provider settings                                      |
| `status`    | Probes every 30s, `GET /status`                                                   |
| `notifier`  | Reminder scheduling & delivery                                                    |
| `realtime`  | Live streams (`/events`, doc presence), fanned out through Postgres LISTEN/NOTIFY |
| `mcp`       | Outside AI agents over MCP (`/mcp`): stateless, limits per connection             |
| `files`     | File store for imports: signed uploads, encrypted, gone in a day unless kept      |
| `converter` | Turns imported PDFs/Word/photos into pages in Docs → Uploads                      |
| `formula`   | pix2tex for equations on scans (`formula/`), Compose profile `formula`, optional  |
| `ocr`       | Unlimited-OCR on CPU (`ocr/`), profile `ocr`, OFF by default (too heavy)          |
| `measure`   | Search by meaning (profile `semantic`, off by default): measures changed pages    |
| `migrate`   | Applies migrations under advisory lock                                            |

## Operations

- **Request tracing:** every service records requests via `backend/src/lib/request-log.ts` (batched, route patterns, no IPs); the gateway forwards `X-Request-Id`. Admin → Requests and Analytics read it.
- **The sweeper** (`backend/src/lib/sweep.ts`) clears outdated records hourly from the worker. A new table that grows without bound gets a rule there, not an ad-hoc `DELETE` on a timer.
- **Study:** cards are `Question :: Answer` lines in pages (`packages/core/src/study.ts`), synced per person into `study_cards`; no imports from other apps, everything free. AI study routes only suggest, grade and explain — adding cards is the person's own page edit, and revision plans are applied only when approved.
- **Importing into Docs:** PDF, .docx and photos become pages in Uploads (`packages/core/src/imports.ts`, `backend/src/modules/imports/`). Files go to our own `files` service (not MinIO/S3) and are deleted when the import ends and always within 24 h. Pages are read cheapest first: Word (OMML equations → exact LaTeX), a PDF's own text with its fonts (`pageToMarkdown` in `packages/core/src/pdftext.ts`: columns, running headers, tables, maths fonts → LaTeX, guessed equations get `check: true`), then Tesseract (English, in the backend image) for scans, then the optional `formula` model for equations on scans. The heavy Unlimited-OCR `ocr` profile stays off by default (it crashed the server). Never build the `formula`/`ocr` images locally. Admins see stored files in Admin → Storage (information and delete only, never contents). Study cards: `Q :: A`, `A ::: B` (both ways), `{{cloze}}`.
- **Privacy and consent:** Terms/Privacy texts live in `packages/core/src/legal.ts` (admin-editable in Admin → System); both apps gate on the agreement version. Anything new that collects personal data or sends it to a third party must be added to the Privacy Policy text. Usage analytics must honour `users.analytics_opt_out`. Keep web assets first-party: no third-party fonts, scripts or trackers (fonts are bundled in `desktop/src/assets/fonts`).

## Key References

| Topic                                                             | Location                                                                   |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Env vars                                                          | `backend/src/config/env.ts`                                                |
| RBAC                                                              | `packages/core/src/rbac.ts`                                                |
| Data model                                                        | `docs/architecture.md#data-model`                                          |
| API                                                               | `docs/api.md`                                                              |
| AI pipeline                                                       | `docs/architecture.md#ai-assistant`                                        |
| Deployment                                                        | `docs/deployment.md`, `deploy/k8s/`                                        |
| Scaling                                                           | `docs/scalability.md`                                                      |
| Follow-through (asks, proofs, reality check, re-entry, attention) | `backend/src/modules/followthrough/`, `packages/core/src/followthrough.ts` |
| Work records (promises, decisions, experiments, meeting outcomes) | `backend/src/modules/work-records/`, `packages/core/src/work-records.ts`   |

## Skills Used

`planning-skill` · `spec-driven-skill` · `adr-skill` · `testing-skill` · `conventions-skill` · `deployment-skill` · `monitoring-skill` · `incremental-skill`

---

_Keep this file short. For detailed rules, use the skills listed above._
