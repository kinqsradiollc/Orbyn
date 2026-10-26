# Environment files

| File                   | Use                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `.env.example`         | Shared backend/Compose template for development, testing and production                                    |
| `.env.production`      | Private production configuration; copy it to the testing server and adjust target-specific values manually |
| `.env`                 | Active backend/Compose configuration on the target server                                                  |
| `desktop/.env.example` | Public Vite settings template for all build environments                                                   |
| `mobile/.env.example`  | Public Expo settings template for all build environments                                                   |

Existing env files are private and ignored by Git. Merge new settings into them;
never replace existing secrets with template placeholders. Commented assignments
are optional overrides, not enabled settings.

## Server deployment

1. Use the existing private `.env.production` as the configuration source for
   production and the testing server. Copy it, then manually adjust the target's
   domains, database credentials, tunnel and integrations. Keep the same variable
   inventory and feature configuration unless that target intentionally differs.
   A new installation uses `.env.example`; no separate production example exists.
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

## Architecture consolidation settings

Merge these non-secret settings into existing `.env.production` and the server's
active `.env` without replacing existing credentials or encryption keys:

| Setting                          | Default | Upgrade behavior                                                                                                                                                                        |
| -------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BOOKING_EMAIL_DELIVERY_ENABLED` | `true`  | The notifier sends committed booking email intents. Set `false` to pause delivery while retaining work.                                                                                 |
| `ASSISTANT_ADMISSION_REVISION`   | `1`     | Must match the persisted admission policy on every claimer. Migration 294 seeds revision 1; after a policy change use the database's current revision. This is not a concurrency limit. |
| `ASSISTANT_CONVERSATION_ENABLED` | `false` | Explicit rollout gate. Adding the variable does not enable unified conversation delivery; follow the [conversation cutover](deployment.md#unified-conversation-rollout-opt-in).         |

Compose passes booking delivery and admission settings through its shared backend
`env_file: .env`; the conversation flag is also explicitly interpolated. A private
`.env.production` is a configuration source, not the file Compose containers load.
Copy the reviewed file to the target as `.env`, then recreate affected services
through the deployment procedure. Editing either file alone changes no running
process. Keep the notifier and all assistant claimers on compatible code and
policy revisions; the [operations guide](operations.md#assistant-admission-policy)
describes the coordinated cutover.

Compose supplies `DOC_LATEX_URL=http://latex:8000` and
`DOC_PDF_URL=http://pdf:8000` for the API. These are internal service URLs, not
public browser URLs; they need no private env override for Compose. Outside
Compose, configure reachable renderer URLs explicitly. Leave
`LEGACY_SECRET_CUTOVER` unset: it is a migration-only attestation, not a missing
runtime setting.

Planner reconciliation has no environment variable: the shared client store owns
the active five-minute bound. Assistant ceilings remain 8 global / 4 interactive /
2 background / 2 overnight in the persisted policy; fairness attribution is by
team. Do not invent per-service env overrides for either contract.

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

### Legacy key migration

`LEGACY_SECRET_CUTOVER` is migration-only. Do not enable it in the server env.
Compose deployment detects the legacy database key and stops/removes all backend
writers before passing the attestation to the migration process. Kubernetes needs
the explicit [quiesced cutover](../deploy/k8s/README.md#one-time-legacy-encryption-key-cutover).
A failed cutover leaves old writers stopped; do not restore an old image over
converted credentials.

## One MCP connection; legacy plugin compatibility

`MCP_PUBLIC_URL` is the canonical connection for tools, document previews,
mentions and supported host file entrypoints. Enable **Cards in agents** for UI;
text/structured results remain available without it. Workspace inference has a
separate owner permission and server switch:

```dotenv
MCP_PUBLIC_URL=https://mcp.orbyn.dev/mcp
COMPOSE_PROFILES=tunnel,mail,plugin
MCP_WORKSPACE_AI_ENABLED=false
# Preserve this while existing /plugin grants remain in use:
PLUGIN_PUBLIC_URL=https://mcp.orbyn.dev/plugin
```

The `plugin` Compose profile runs the isolated integration process: canonical
`/mcp/*` auxiliaries and inference jobs go to `plugin:8000`; `/mcp` protocol/tools
stay on the MCP process. Neither service exposes a direct host port. The gateway's
port 8082 serves the MCP hostname. The two configured OAuth audiences remain
**distinct**. Do not point `PLUGIN_PUBLIC_URL` at `/mcp` or redirect bearer requests.

Set `MCP_WORKSPACE_AI_ENABLED=true` only when enabling canonical workspace AI.
Every connection still needs separate owner consent, an exact workspace provider
and model, and a daily allowance. Existing MCP grants acquire no provider permission.
False prevents canonical enqueue/dispatch; retained receipts remain readable under
live grant/provider checks. No personal ChatGPT plan is used by this broker.

Reconnect existing host connections explicitly to `/mcp`. This creates a new grant;
legacy jobs, receipts, cursors and inference permission are not transferred. Retain
`PLUGIN_PUBLIC_URL` until legacy retirement is separately approved.

Copy the reviewed private `.env.production` to the server's `.env` before running
`scripts/deploy.sh`. Keep one `.env.example` per workspace. Client envs contain no
connector URL/provider secret. `ENV_FILE=...` is supported only for `--check`.

Legacy host evidence does not qualify the current runtime. See
[verification boundaries](verification.md) and the current source; retired
ADR 002 and C6 records remain in Git history. Kubernetes
currently has no integration Deployment/Service/Ingress; Compose evidence does
not qualify that deployment target.
