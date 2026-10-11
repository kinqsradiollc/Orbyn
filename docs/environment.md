# Environment files

| File                                          | Use                                                      |
| --------------------------------------------- | -------------------------------------------------------- |
| `.env.example` → `.env`                       | Local backend and Docker Compose                         |
| `.env.production.example` → `.env.production` | Private server configuration prepared locally            |
| `desktop/.env.example`                        | Vite development and shared web/desktop builds           |
| `desktop/.env.production.example`             | Public production build settings                         |
| `mobile/.env.example`                         | Expo development; use a reachable LAN address on a phone |
| `mobile/.env.production.example`              | Public Expo production build settings                    |

Existing env files are private and ignored by Git. Merge new settings into them;
never replace existing secrets with template placeholders. Commented assignments
are optional overrides, not enabled settings.

## Server deployment

1. Set `POSTGRES_PASSWORD`, `APP_URL` and `CORS_ORIGINS` for the target server.
2. Supply independent `SECRETS_KEY` and `FILES_MASTER_KEY` values, each 32 random
   bytes encoded as base64. Keep existing keys unchanged on upgrades.
3. Set independent `FILES_SECRET` and `DOC_PDF_KEY` secrets; the PDF key must be
   at least 32 characters. Blank file credentials disable file features.
4. Configure mail and any optional tunnel/integrations you actually use.
5. Preview with `ENV_FILE=.env.production ./scripts/deploy.sh --check`.
6. Copy the private file to the target server as `.env`, then deploy there.
   `ENV_FILE` is supported only for the preview, not a real deployment.

Compose constructs database and internal service URLs. Do not activate the native
`DATABASE_URL` example for a Compose deployment. Keep `DEBUG_ERRORS=false`,
`ALLOW_PRIVATE_WEBHOOKS=false` and `GATEWAY_RATE_LIMIT_EXEMPT` blank publicly.
Do not run tests against the production database. Grant an administrator using the
trusted `admin:grant` command; `ADMIN_EMAILS` does not promote sign-ins.

Database credentials in URLs must be URL-encoded. Do not source an env file in a
shell: values may contain shell syntax. Use dotenv-compatible syntax, and follow
the deploy script's simple unquoted `KEY=value` format for deployment settings.

## Client builds

`VITE_*` and `EXPO_PUBLIC_*` values are visible to users. Put only public URLs and
feature settings there. Never copy server secrets to a client env file.

- Web normally uses the same-origin `/api` gateway.
- Installed desktop needs a reachable absolute API URL at build time.
- Expo uses an absolute API URL, such as `https://your-domain/api`, and a web
  origin without `/api` for `EXPO_PUBLIC_WEB_URL`.
- `API_PROXY_URL` is a process environment variable for Vite development; setting
  it in a Vite env file does not configure the proxy.
- Restart development servers or rebuild assets after client configuration changes.

Check template coverage with `node scripts/check-env-examples.mjs`. The backend
schema and Compose remain the authority for defaults and required service wiring.
