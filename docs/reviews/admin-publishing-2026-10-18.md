# Admin Publishing — 18 October 2026

## Scope and delivery

The owner requested an admin page for editing images and updates/changelog,
AI-assisted posting, and direct LinkedIn publishing. Their destination answer
was **Orbyn company Page**. This change is on `codex/admin-publishing`, based
on `origin/main` at `b446b49d`. It preserves unrelated review-report edits.

The owner's standing instruction skips Tester, Visual Check and Reviewer and
requests PR/main delivery. No tests or role qualification were run. Waived
stages are not passes.

## Implementation

- Responsive web admin Publishing workspace: persistent versioned drafts,
  text/release notes, company preview, local crop/position/rotate/resize,
  bundled brand image, alt text and PNG download.
- AI suggestions reuse the admin's selected provider and existing feature
  authority/usage/budget pipeline; suggestions require explicit adoption.
- Company-only LinkedIn OAuth with browser cookie, single-use state, live admin
  session binding, Page administrator check, encrypted credentials and optional
  provider-issued refresh tokens. Pending callbacks and disconnect serialize.
  Callback queries are excluded from backend/proxy logs; code exchange is not
  proxy-retried.
- Explicit immediate/scheduled approval, immutable queued/sent content,
  optimistic versions, durable delivery claim and receipt, bounded deadline,
  and unknown-outcome recovery without blind retries. The notifier publishing
  task is independent of reminder delivery and uses a PgBouncer-compatible
  transaction advisory lock. Refreshed credentials commit separately.
- Explicit public release snapshots feed `/changelog` and the existing web and
  mobile What's new sheets. Draft edits stay private until Update notes.
  Public feed queries exclude image bytes; published images have a separate
  read endpoint. Bundled history remains an offline/server-version fallback.
- Migration 268, API-client/core contracts, optional server configuration,
  Kubernetes bindings/HTTPS egress, bounded draft retention, pending-state
  sweeper, audit events and bundled privacy text.
- Configuration/setup/API/recovery documentation is in `docs/admin-publishing.md`.
  Private production env inventory was synchronized without replacing values;
  no LinkedIn credentials were supplied or invented.

## Development evidence

| Command                                                  | Exit / result                                               |
| -------------------------------------------------------- | ----------------------------------------------------------- |
| `npm run build:packages`                                 | 0                                                           |
| `npm run typecheck -w backend`                           | 0                                                           |
| `npm run typecheck -w desktop`                           | 0                                                           |
| `npm run typecheck -w mobile`                            | 0                                                           |
| `npm run build -w backend`                               | 0, final backend source                                     |
| `npm run build -w desktop`                               | 0, final web source; existing large-chunk warning           |
| `node scripts/check-env-examples.mjs`                    | 0; 137 backend/Compose variables plus both client templates |
| Prettier on changed TypeScript/CSS/feature documentation | 0                                                           |
| `git diff --check`                                       | 0                                                           |

An initial backend type check identified mismatched audit target, completion
option, date narrowing and pool/queryable types. Those were corrected before
the successful builds. The web build regenerates unrelated LaTeX/PDF runtime
metadata; only those build-induced changes were restored, preserving prior
review edits. Build logs were retained under `/private/tmp/orbyn-publishing-*`.

## Unverified / setup boundaries

- Migration execution, real PostgreSQL concurrency, OAuth, refresh, upload,
  live AI generation, scheduling/recovery and actual LinkedIn posting were
  not exercised. No live external post or company Page connection was created.
- LinkedIn developer product approval, server credentials/numeric Page ID and
  Page administrator consent remain external setup. Programmatic refresh is
  conditional on the token LinkedIn grants; it is not a permanent connection.
- No rendered browser qualification, installed desktop/mobile build or native
  interaction verification. The full editor/OAuth setup is the responsive web
  admin workspace; native mobile only consumes published release notes/images.
- Native mobile does not embed the image editor. Automatic new-release prompts
  still use bundled history; published updates appear when What's new opens.
- Nginx was not installed locally, so proxy edits received source inspection,
  not an `nginx -t` runtime receipt. Kubernetes manifests were not deployed.
- This report records implementation/development checks, not production
  deployment or live-provider acceptance.
