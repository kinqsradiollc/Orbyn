# Orbyn — Agent Instructions

**Project:** Orbyn — planner with web/desktop/mobile apps, AI assistant, reminder worker.

## Before Any Task

1. Read `docs/architecture.md` — services, data model, reminder pipeline, access control.
2. Read `docs/setup.md` — env vars, Docker and local workflows.
3. Read `AGENTS.md` if it exists (project-level overrides).
4. Check `backend/src/config/env.ts` for canonical environment variables.
5. Check `packages/core/src/rbac.ts` for role/permission definitions.

## Dependency Rules (Strict)

```
apps (desktop, mobile) → @orbyn/api-client → @orbyn/core
backend → @orbyn/core, @orbyn/api-client
```

Never import from apps into packages, backend into packages, or packages into apps. `@orbyn/core` depends on nothing in-repo besides zod.

## Code Conventions

From `conventions-skill`: kebab-case.ts files, PascalCase components/types, camelCase functions, Prettier formatting, single quotes, 2-space indent, 100-char lines, no console.log, JSDoc for public APIs.

## UI Conventions

- **Colours:** never change the palette. Use theme tokens (`var(--color-*)` on web, `colors.*` on mobile); no colour literals in new code.
- **Corners:** web uses the radius scale in `desktop/src/styles/global.css` — `--radius-xs` (4, bars and marks), `--radius-sm` (8, controls), `--radius-md` (12, cards and panels), `--radius-lg` (16, dialogs), `--radius-pill`. Mobile uses `radii.input` / `radii.card` / `radii.pill`. No raw pixel radii.
- **Controls are ours, not the browser's:** `Select` (`components/Select.tsx`) instead of `<select>`, `DateField` (`components/DateField.tsx`) instead of `<input type="date|time|datetime-local">`. Bare fields, checkboxes and radios are styled at zero specificity in `global.css`; a switch is a checkbox with `role="switch"` and `className="ai-switch"`. Mobile switches set `trackColor={{ true: colors.accent }}`.
- **Managing things lives behind ⋯:** rename, delete, leave and similar rare actions go in a menu beside the title (`MoreMenu` on mobile, a bottom action sheet; small toolbar icons on web), never as a row of buttons over the content.
- **Mobile type is light, like the web:** `fonts.semibold` renders at 500 and `fonts.bold` at 600; controls are drawn at 34pt and reach 44pt through `hitSlop`. Selected chips are a soft accent tint, not a solid fill.
- **Spacing:** anything with a border or fill has inner padding — nothing touches its box's edge. Siblings that repeat (chips, pickers, rows) share one height and line up.
- **Room to work:** the web sidebar collapses to an icon rail (⌘\\, remembered per browser); the Docs library can be hidden for a full-width page. On mobile, tapping the tab you're on scrolls to the top and refreshes.
- **Verify in the preview** on web (5174) and mobile web (8083) before calling UI done.

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

| Service    | Owns                                                                              |
| ---------- | --------------------------------------------------------------------------------- |
| `api`      | Auth, users, items, teams, admin, devices, notifications, planner, booking        |
| `ai`       | Assistant chat, proposals, provider settings                                      |
| `status`   | Probes every 30s, `GET /status`                                                   |
| `notifier` | Reminder scheduling & delivery                                                    |
| `realtime` | Live streams (`/events`, doc presence), fanned out through Postgres LISTEN/NOTIFY |
| `migrate`  | Applies migrations under advisory lock                                            |

## Operations

- **Request tracing:** every service records requests via `backend/src/lib/request-log.ts` (batched, route patterns, no IPs); the gateway forwards `X-Request-Id`. Admin → Requests and Analytics read it.
- **The sweeper** (`backend/src/lib/sweep.ts`) clears outdated records hourly from the worker. A new table that grows without bound gets a rule there, not an ad-hoc `DELETE` on a timer.
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
