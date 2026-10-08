# Architecture and operations reference

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
