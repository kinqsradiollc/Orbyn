# Admin Publishing

## Use

Open **Admin → Publishing** in the web app (including a mobile browser).
The workspace supports saved drafts, release notes, a company post preview,
local PNG/JPEG/WebP image editing (crop, position, rotate and resize), an Orbyn
brand image, image download, and optional AI post suggestions. Apply an image
with **Use image**, then **Save draft**. Images are saved as PNG, up to 2 MB
and 4096 pixels per side. Up to 100 drafts/public updates are retained; remove
old drafts explicitly when needed. A post already sent to LinkedIn is immutable
in this editor; create a new update for another post.

- **Publish notes / Update notes** publishes a snapshot on `/changelog` and in
  the web and mobile **What's new** sheets when opened. A later draft edit
  stays private until **Update notes**. The management menu can unpublish notes.
  Existing bundled history remains available when the API cannot be reached.
  Automatic launch-time new-release prompts still use the bundled release date;
  publishing does not send a push notification or force that prompt open.
- **Suggest post** sends only draft text and instructions, without the image,
  to the admin's selected AI provider through the existing consent, authority,
  usage and budget pipeline. **Use suggestion** copies it into the editable
  draft. AI cannot publish, schedule, inspect the repo or certify release claims.
- **Publish to LinkedIn** queues the exact saved draft for the **Orbyn company
  Page** after confirmation. The notifier processes it independently of reminder
  delivery, usually within one 10-second cycle. A retained LinkedIn URN confirms
  successful posting.
- **Approve schedule** authorizes that saved post at the chosen local time
  (stored in UTC, up to 30 days ahead). Cancel the schedule to edit it. A stopped
  notifier delivers overdue approved posts after it starts again.
- Unknown deliveries require checking the Page before **Reset delivery**; no
  automatic retry follows an ambiguous response. Published LinkedIn posts stay
  published when a draft is deleted, changelog notes are unpublished, or the
  connection is disconnected. Manage those posts directly on LinkedIn.

The full editor is part of the responsive web/desktop admin console. The native
mobile admin console does not embed this image editor; mobile readers receive
published notes and images in their existing What's new sheet. OAuth connection
setup is supported from the same-origin web admin console; use the web app for
setup if the installed desktop uses a different API origin.

## Server setup

1. Deploy code and apply migration `268_admin_publishing.sql` through the normal
   migration service. Restart API and notifier. The notifier must run to deliver
   approved LinkedIn posts; drafting/public changelog publication use the API.
2. Create/verify a LinkedIn developer app associated with the Orbyn company Page.
   Obtain **Community Management API** product access and permission for
   `r_organization_admin` and `w_organization_social`. Personal-profile Share on
   LinkedIn access alone does not grant company Page posting.
3. Configure these **server-only** values in the target's private `.env`:

   ```dotenv
   LINKEDIN_CLIENT_ID=<approved app client ID>
   LINKEDIN_CLIENT_SECRET=<approved app client secret>
   LINKEDIN_ORGANIZATION_ID=<numeric Orbyn company Page ID>
   LINKEDIN_REDIRECT_URI=https://your-orbyn-domain/api/admin/publishing/linkedin/callback
   LINKEDIN_API_VERSION=202606
   ```

   `LINKEDIN_REDIRECT_URI` defaults to the callback above under `APP_URL`.
   Register the **exact** callback URL in LinkedIn. Production requires HTTPS.
   `APP_URL` must be the public web origin, including for published image URLs.
   Keep `DB_POOL_MAX` and the database pooler server pool at two or more connections
   (the shipped defaults provide 10 or 20); durable claim/refresh writes commit separately.
   Preserve the existing `SECRETS_KEY`; production credential storage requires it.
   Never put the client secret in Vite/Expo configuration.

4. Compose inherits these values from its existing `.env` binding. Kubernetes
   uses `orbyn-config` for Page ID, callback and API version, and optional
   `orbyn-secrets` keys for the client ID/secret, selected only by API/notifier.
   Public HTTPS egress is required to `api.linkedin.com` and `www.linkedin.com`.
5. From web **Admin → Publishing**, choose **Connect LinkedIn** and consent as
   an Orbyn Page administrator. Close the resulting connection tab. Returning
   focus refreshes the connection status; Refresh is also available.
6. Review the actual draft and image before publishing. No live post is created
   by deployment or connection alone. Review custom Privacy Policy overrides in
   Admin → System; the bundled policy now describes this integration.

LinkedIn permission expires according to its grant. When LinkedIn issues a
refresh token, Orbyn renews it while authorized; apps without programmatic
refresh access need another LinkedIn consent when their access grant expires.
Revocation or loss of the connecting member's Page role also requires action.
Do not promise a permanent connection. Update the pinned API version before
LinkedIn sunsets it.

## Contracts and recovery

All `/admin/publishing*` routes require a signed-in app admin with
`system:manage`; agent and API keys cannot use them. OAuth callback is the sole
exception: single-use state is bound to an HttpOnly SameSite browser cookie,
user and still-live session, with a 10-minute expiry. The callback verifies
Page administrator authority and stores encrypted tokens. Expired attempts are
removed by the existing hourly sweeper. Disconnect removes credentials and
pending attempts and cancels queued posts, serialized against current delivery.

Core owns draft schemas/types and the merge with bundled history; api-client
owns transport. API and notifier own LinkedIn requests; no provider secret is
sent to clients. Every edit uses an expected version. Approved/sending/posted
content cannot be overwritten by another tab. Admin transitions are audited
without draft text, images or credentials. Credential rewrapping discovers the
new `*_encrypted` columns through the existing generic migration mechanism.

Publication states: `draft → scheduled → sending → published`.
A pre-post failure is `failed`; a timeout, missing receipt or interrupted send
is `unknown`. A durable claim is committed before outbound side effects.
Only one delivery holds the transaction-scoped advisory connection lock at a
time (compatible with PgBouncer transaction pooling). Refresh writes commit
independently while that lock is held so a later post failure does not roll
back newly rotated credentials. Requests share a 120-second deadline; sending
claims abandoned for five minutes become unknown. They never auto-resend.

`GET /changelog/updates` returns only explicit public snapshots; image bytes
are read separately from `GET /changelog/updates/:id/image`, available only
while the snapshot remains published. Public reads do not expose drafts or
LinkedIn credentials. Both responses use no-store. Draft/media retention is
explicit admin deletion and the 100-record cap, not an unbounded job log.

## API reference

- `GET/POST /admin/publishing`: list/create drafts.
- `GET/PUT /admin/publishing/:id`: read/save (`version`, `content`).
- `POST /admin/publishing/:id/{publish,schedule,cancel,release,unrelease,reset,delete}`:
  expected `version`; schedule also accepts ISO `at`.
- `POST /admin/publishing/suggest`: content plus instructions; returns text only.
- `GET/DELETE /admin/publishing/linkedin`: status/disconnect.
- `POST /admin/publishing/linkedin/connect`: starts browser-bound OAuth.
- `GET /admin/publishing/linkedin/callback`: single-use LinkedIn callback.
- `GET /changelog/updates` and `GET /changelog/updates/:id/image`: published only.

## Provider references

- [Posts API and required organization roles](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-06)
- [Images API: initialization, upload, availability and media alt text](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api?view=li-lms-2026-06)
- [Organization access-control finder and read permission](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role?view=li-lms-2026-06)
- [Authorization code flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow)
- [Programmatic refresh eligibility and expiry](https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens)
