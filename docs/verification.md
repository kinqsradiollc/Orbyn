# Delivery verification

This records the implementation checks performed on the `feature/rbac` branch on
15 September 2026. It distinguishes working local delivery from release steps that
require deployment credentials or a physical device.

| Requirement                         | Evidence                                                                                                                     | Result                                                                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Separate backend and PostgreSQL     | TypeScript/Fastify services, migrations, Docker images, gateway and PgBouncer started against PostgreSQL                     | Verified locally                                                                                                        |
| Web homepage and planner            | Public homepage and authentication routes; browser checks of calendar, team creation and admin dashboard                     | Verified locally                                                                                                        |
| Desktop application                 | Exact Electron version pinned; unsigned arm64 macOS app packaged, launched, signed in and loaded planner                     | Verified locally; no notarization or Windows/Linux installer validation claimed                                         |
| Mobile application                  | iOS simulator workflows and CI iOS/Android Metro exports; shared typed API client                                            | Simulator and bundles verified; physical-device push remains pending                                                    |
| Web/mobile consistency              | Shared colors, labels, assistant copy, schemas and overview calculation; regressions for counts, grouping and activity dates | Type-checks and focused tests pass                                                                                      |
| AI provider support                 | Admin-managed provider adapters, encrypted keys, proposal validation and approval                                            | Live configured provider summarized, proposed a task with history, applied it, and rejected access from another account |
| Planner CRUD, teams and permissions | Live API smoke run through gateway                                                                                           | 44 checks passed, including AI                                                                                          |
| Deadline email                      | Created a near-due QA task; received its subject in local Mailpit; removed the test task                                     | Actual SMTP delivery verified                                                                                           |
| Mobile push transport               | Tests for acceptance tickets, successful receipts, unregistered devices and retryable errors                                 | Three mocked-transport regressions pass; not evidence of APNs/FCM device delivery                                       |
| Environment and documentation       | Ignored local `.env`, `.env.example`, mobile build profiles, setup/API/architecture/deployment guides                        | Present; secrets remain untracked                                                                                       |
| GitHub delivery                     | Commits pushed to existing PR #2, stacked on PR #1                                                                           | Open for review; not merged or publicly deployed                                                                        |

The backend suite passed 65 tests before the three push transport regressions were
added; those three also passed separately. Hosted CI runs the combined suite,
workspace type-checks, mobile bundle exports, Docker builds and live API smoke checks.
Use the latest PR checks for the authoritative result at a particular commit.

## Remaining release verification

- Configure an Expo EAS project and native push credentials, install a development or
  distribution build on a physical device, enable notifications in Settings, and
  verify a reminder arrives. Follow [the mobile guide](mobile.md).
- Sign/notarize desktop installers and build the target operating systems for a
  public desktop release.
- Configure production HTTPS, SMTP and database backups before public deployment.
  Follow [the deployment guide](deployment.md).

These checks do not claim app-store publication, production deployment, or delivery
to an actual mobile device.
