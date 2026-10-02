# Deployment

The Compose file in the repository is tuned for local development. This checklist covers what to
change for a real deployment.

## Assistant runtime processes

Deploy `ai`, `assistant-background` and `assistant-overnight` together with the
same backend image. The AI HTTP service runs interactive chats; the other two
services execute only their own automation jobs. `server.js` combines HTTP
services for development but does not replace these automation processes.
Migration 206 assigns existing jobs their runtime and prevents reassignment.
An upgrade establishes full separation after old consumers finish and drain.

The automation workers have private `/ready` probes and separate status-page
heartbeats. They need no gateway route or published port. Compose defaults each
to one replica; `ASSISTANT_BACKGROUND_REPLICAS` and
`ASSISTANT_OVERNIGHT_REPLICAS` can increase availability, while database lease
limits remain two active jobs per lane across all replicas. Four slots are
reserved for interactive chats. Idle workers perform queue housekeeping without
model calls. Remove `AI_RUNNER_IN_WORKER=true` before deployment; the deploy
preflight rejects it and the notifier no longer executes assistant jobs.

Kubernetes includes both deployments in `assistant-workers.yaml`. Check their
readiness after rollout and alert on missing runtime heartbeats. Restarting one
runtime leaves the other available; interrupted work resumes its persisted
checkpoint within the same lane after its lease expires.

## Going live on your domain

The shortest path from a fresh server to a working site, with the details in the sections below.

1. Put the domain on Cloudflare DNS and create a tunnel (Zero Trust → Networks → Tunnels); give it
   a public hostname pointing at `http://gateway:8081`.
2. On your machine, fill in `.env.production`: the tunnel token, `APP_URL` and `CORS_ORIGINS` as
   `https://your-domain`, a generated `POSTGRES_PASSWORD` and `SECRETS_KEY`, `ADMIN_EMAILS`, and
   how mail goes out (your own mail server, or a provider). Never commit it; git ignores it.
3. Still on your machine, check the file before it travels:
   `ENV_FILE=.env.production ./scripts/deploy.sh --check`. Then clone the repository on the server
   and copy the file there as `.env`, next to `compose.yaml`.
4. Run `./scripts/deploy.sh`. It starts everything, including the tunnel and the mail server when
   `.env` asks for them, and prints the DKIM record the mail server wants published.
5. Add the [DNS records](#dns-records): SPF and DMARC now, DKIM from step 4.
6. Sign in with the `ADMIN_EMAILS` address, then in Admin → System send a test email and check the
   received message's headers for `spf=pass` and `dkim=pass`.
7. If SMTP settings were ever saved in Admin → System, clear them or set them to match `.env`:
   saved settings win over the environment.
8. Anything secret that was ever pasted into a chat, ticket or terminal history (an app password,
   the tunnel token) — rotate it now that everything works.

From then on, every update is `./scripts/deploy.sh` ([Updating the server](#updating-the-server)).

## Images

Two images are built from the repository root:

| Dockerfile             | Image role                                       | Commands                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/Dockerfile`   | Every backend service and migrations (one image) | `node backend/dist/services/api.js`, `.../services/ai.js`, `.../services/status.js`, `.../services/notifier.js`, `node backend/dist/migrate.js`; `server.js` runs all in one |
| `desktop/Dockerfile`   | Static web app behind unprivileged nginx         | nginx                                                                                                                                                                        |
| `pgbouncer/Dockerfile` | Connection pooler (Alpine's PgBouncer)           | Configured from environment at start                                                                                                                                         |
| `formula/Dockerfile`   | Equations on imported scans (pix2tex, CPU)       | Built only with the `formula` Compose profile                                                                                                                                |
| `ocr/Dockerfile`       | Heavy OCR for imported scans (CPU, Python)       | Built only with the `ocr` Compose profile; see [Importing files](#importing-pdf-and-word-files-into-docs)                                                                    |

The gateway uses the stock `nginxinc/nginx-unprivileged` image with `gateway/` mounted.

Both are multi-stage, run as non-root, and use `node:22-bookworm-slim` / `nginx-unprivileged`.

```bash
docker build -f backend/Dockerfile -t orbyn-backend .
docker build -f desktop/Dockerfile -t orbyn-web .
docker build -t orbyn-pgbouncer pgbouncer
```

For Kubernetes manifests (deployments, autoscaling, ingress, network policies), see
[deploy/k8s](../deploy/k8s/README.md). For multi-host topology, replicas and capacity, see
[scalability.md](scalability.md).

## Checklist

1. **Secrets.** Set a strong `POSTGRES_PASSWORD`, SMTP credentials, and `SECRETS_KEY`. AI providers are added
   by admins in the app, not in `.env`. Use
   your platform's secret store rather than a committed `.env`.
2. **Database.** Prefer a managed PostgreSQL 15+ with automated backups, failover and read
   replicas. Point `DATABASE_URL` at its pooler (or PgBouncer) and `DATABASE_READ_URL` at a replica
   endpoint. Run the `migrate` command once per deploy, directly against the primary, before
   starting new service containers.
3. **TLS and load balancing.** Put a load balancer (a cloud load balancer, Caddy, Traefik) in front
   of two or more gateways and the web container. Or serve the stack through
   [a Cloudflare tunnel](#public-access-through-a-cloudflare-tunnel), where Cloudflare handles TLS
   and the machine needs no open port. The mobile app and browsers must reach the API
   over HTTPS. Set `GATEWAY_TRUSTED_PROXIES` to the load balancer's ranges so rate limits see real
   client addresses, and leave `GATEWAY_RATE_LIMIT_EXEMPT` empty.
4. **CORS.** Set `CORS_ORIGINS` to your web origin(s), for example `https://app.example.com`.
5. **Email.** Set `DOCKER_SMTP_HOST` (or `SMTP_HOST` outside Compose) to your relay along with
   `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, and a `SMTP_FROM` on a domain you
   control with SPF/DKIM configured — or run [your own mail server](#sending-mail-yourself).
   Remove the `mailpit` service.
6. **Push.** Set `EXPO_PUBLIC_EAS_PROJECT_ID` in the mobile build and, if enabled on your Expo
   account, `EXPO_ACCESS_TOKEN` on the worker.
7. **Ports.** Keep the API bound to the internal network and expose only the proxy. The default
   Compose binds the API and Postgres to loopback.
8. **Scaling.** Run several `api` and `ai` instances, two `status` instances and one or more
   `notifier` instances, on one host or many. List them in `GATEWAY_API_SERVERS` and friends when
   they run on other machines. See [scalability.md](scalability.md).
9. **Health.** Every HTTP service serves `GET /live` (liveness, no database) and `GET /health`
   (readiness, includes the database). The gateway answers `GET /health` itself.
10. **Logs.** The API logs JSON to stdout with the authorization header and passwords redacted; the
    worker logs retry events as JSON. Ship stdout to your log system.
11. **Desktop installers.** `npm run package -w desktop` builds dmg/nsis/AppImage. Set
    `VITE_API_URL=https://your-domain/api` before `npm run build -w desktop` so the Electron app
    talks to production instead of localhost. In a browser the web app needs nothing: it calls
    `/api` on the address it was served from. The mobile app needs the same address in
    `EXPO_PUBLIC_API_URL`.

## Public access through a Cloudflare tunnel

Cloudflare reaches a `cloudflared` container inside the stack, so the machine needs no open port
and no certificate of its own. The tunnel only runs when you ask for it.

1. In Cloudflare (Zero Trust → Networks → Tunnels), create a tunnel and copy its token.
2. Put it in `.env` as `CLOUDFLARE_TUNNEL_TOKEN=…`. Treat it as a secret: anyone holding it can
   run your tunnel. `.env` is not in git.
3. Give the tunnel a public hostname and point it at `http://gateway:8081` — the web app, with
   the API under `/api`. One hostname serves both.
4. Set `APP_URL` and `CORS_ORIGINS` to that address (`https://your-domain`), so booking and
   invitation links, and the browser's own requests, use it.
5. Set `GATEWAY_TRUSTED_PROXIES` to the Docker network range (for example `172.16.0.0/12`), so
   rate limits and logs see the real client address instead of the tunnel container's, and clear
   `GATEWAY_RATE_LIMIT_EXEMPT`.
6. Start it:

```bash
docker compose --profile tunnel up -d
```

`docker compose logs -f cloudflared` shows it registering, and Cloudflare's dashboard shows the
tunnel healthy. The API's host port stays on `127.0.0.1` (`API_BIND`); the web port listens on
every interface unless you set `WEB_PORT=127.0.0.1:8080`, which leaves the tunnel as the only way
in.

Cloudflare waits at most 100 seconds for the first byte of a reply and then shows its own error
page (HTTP 524). The AI assistant is built for this: the apps start a turn and poll for the answer
in short requests, so a model that takes minutes (one running on your own machine) still answers.
Model calls to a local address get five minutes each; hosted providers one.

The token is passed in the environment, not on the command line, so it stays out of `docker ps`.
Docker administrators can still read it with `docker inspect`. To pin a cloudflared release instead of following `latest`, set
`CLOUDFLARED_IMAGE`.

## DNS records

Everything Orbyn needs from DNS, in one place. Web records are created by Cloudflare when you add
the tunnel's public hostname; mail records you add yourself.

| Record                           | Type  | Value                                                                | Proxy     |
| -------------------------------- | ----- | -------------------------------------------------------------------- | --------- |
| `your-domain`                    | CNAME | `<tunnel-id>.cfargotunnel.com` (added by the tunnel route)           | proxied   |
| `www.your-domain`                | CNAME | the same, if you add a `www` route to the tunnel                     | proxied   |
| `your-domain`                    | TXT   | SPF, see below                                                       | —         |
| `default._domainkey.your-domain` | TXT   | the record `scripts/deploy.sh` prints after starting the mail server | —         |
| `_dmarc.your-domain`             | TXT   | `v=DMARC1; p=none;`, then `p=quarantine` once mail is landing        | —         |
| `mail.your-domain`               | A     | the server's address — **direct delivery only**                      | unproxied |

SPF says who may send mail for the domain, and there may be only one SPF record:

- Relaying through Google Workspace: `v=spf1 include:_spf.google.com ~all`
- Delivering directly from the server: `v=spf1 a:mail.your-domain -all`
- Both, or other senders too: merge them into the one record, e.g.
  `v=spf1 include:_spf.google.com a:mail.your-domain ~all`

Only the web records go through Cloudflare's proxy. Mail records are text, and a `mail.` A record
must stay unproxied, because mail has to reach the address itself.

Check what the world sees (a stale local cache can lie; ask a public resolver directly):

```bash
dig +short TXT your-domain @1.1.1.1
```

```bash
dig +short TXT default._domainkey.your-domain @1.1.1.1
```

## Testing your own mail server locally

Run a separate Maddy → Mailpit stack on your development machine:

```bash
./scripts/mail-local.sh up
./scripts/mail-local.sh test
```

Open [the local inbox](http://127.0.0.1:18025). Maddy accepts mail on
`127.0.0.1:11587`, signs it for `orbyn.test`, and forwards every recipient to
Mailpit over authenticated STARTTLS. Mailpit captures messages; it never delivers
them to public recipients. No Tunnel, public DNS records, or production changes
are needed. Both published ports bind only to loopback.

The script generates an ignored, local-only certificate in `mail/.local`. Only
the test Maddy container trusts this certificate; production TLS verification is
unchanged. Docker, OpenSSL and Python 3 are required. The smoke test checks sender
restrictions, SMTP submission, DKIM signature headers and delivery to the TLS-only
inbox. It does not prove public DKIM verification or inbox placement.

To use it from Orbyn's **Admin → System → SMTP**:

| Setting               | Native local backend           | Docker Desktop backend         |
| --------------------- | ------------------------------ | ------------------------------ |
| Host                  | `127.0.0.1`                    | `host.docker.internal`         |
| Port                  | `11587`                        | `11587`                        |
| From                  | `Orbyn <reminders@orbyn.test>` | `Orbyn <reminders@orbyn.test>` |
| Secure (implicit TLS) | off                            | off                            |
| User / password       | empty                          | empty                          |

These are the settings for the private submission hop; the relay hop uses TLS.
Use them only on your local Orbyn instance. Settings saved in Admin override
environment defaults. For an environment-based setup, use `SMTP_HOST`,
`SMTP_PORT`, `SMTP_FROM`, `SMTP_SECURE=false`, empty `SMTP_USER` /
`SMTP_PASSWORD`, and `DOCKER_SMTP_HOST=host.docker.internal` for Docker Desktop,
then recreate the backend containers. Linux Docker requires explicit host-gateway
routing or a shared Docker network instead.

`./scripts/mail-local.sh logs` shows delivery logs. `./scripts/mail-local.sh down`
stops the stack while retaining DKIM keys, the queue, and captured messages in
named volumes. This test stack does not supply user mailboxes or public inbound
SMTP; Mailpit is a development inbox only.

## Sending mail yourself

Orbyn can send its own mail rather than handing it to a provider: the `mail` service signs each
message with DKIM and delivers it straight to the recipient's server. It receives nothing, and its
port is never published — only containers on its Docker network can hand mail over.
Keep untrusted containers off that network: this private submission listener does
not require authentication.

Cloudflare Tunnel is for Orbyn's web traffic; it does not provide a public SMTP MX
or carry this server's outbound SMTP. Cloudflare's
[TCP application routes](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/protocols/)
require a client-side connector, which recipient mail servers do not run.
A full inbound mailbox service would additionally need public port 25, MX records,
mailbox storage, authenticated submission, and TLS. Do not replace existing MX
records when enabling this outbound-only service.

Delivering directly needs two things from the network:

- **Outbound port 25.** Most home and office connections block it, as do several clouds until you
  ask. Check on the machine that will be sending:

```bash
nc -vz -w 5 gmail-smtp-in.l.google.com 25
```

- **A static address whose reverse DNS (PTR) matches `MAIL_HOSTNAME`**, set at that machine's
  provider. Many receivers reject or penalize senders without valid matching reverse DNS.

If either isn't possible, keep everything else and hand only the last hop to another server: set
`MAIL_CONFIG=maddy-relay.conf` along with `MAIL_RELAY`, `MAIL_RELAY_USER` and
`MAIL_RELAY_PASSWORD`. The queue, the retries and the DKIM signature stay here.

### Relaying through Google Workspace

If the domain's mail already lives in Google Workspace, its SMTP relay is a natural last hop: no
static address, reverse DNS or open port 25, and Google's own reputation carries the delivery.

1. In Google Admin, go to Apps → Google Workspace → Gmail → Routing and configure **SMTP relay
   service** (not Outbound gateway) at the top-level organisation:
   - Allowed senders: **Only addresses in my domains**
   - Authentication: **Require SMTP Authentication** on; **Only accept specified IP addresses** off
   - Encryption: **Require TLS encryption** on

   The sending domain must be a verified domain of that Workspace. Changes can take up to 24 hours.

2. Create an **app password** for a Workspace user with Gmail (2-Step Verification must be on).
   Never use the account's normal password.
3. In `.env`:

```bash
MAIL_CONFIG=maddy-relay.conf
MAIL_RELAY=tcp://smtp-relay.gmail.com:587
MAIL_RELAY_USER=that-user@your-workspace-domain
MAIL_RELAY_PASSWORD=the-app-password-without-spaces
```

4. DNS on the sending domain: keep the existing Google MX records; make the one SPF record
   `v=spf1 include:_spf.google.com ~all` (merge any other senders into it — a domain may have
   only one); publish the DKIM record from step 3 of the setup above; and add
   `_dmarc` `v=DMARC1; p=none;`, tightening it once mail lands.

Google enforces its relay sending limits, and the relay only accepts mail whose sender is on one
of the Workspace's domains, which is what `SMTP_FROM` must use.

### Setting it up

1. In `.env`, set `MAIL_HOSTNAME=mail.your-domain` and `MAIL_DOMAIN=your-domain`, and point Orbyn
   at it with `DOCKER_SMTP_HOST=mail`, `SMTP_PORT=587`, `SMTP_SECURE=false` and an `SMTP_FROM`
   address on that domain.
2. Start only the mail service with `docker compose up -d --wait mail`.
   It generates a DKIM key on first start. Then run `./scripts/deploy.sh --no-pull`
   to roll out the SMTP environment changes to the app. The deploy script starts
   and waits for Maddy when `DOCKER_SMTP_HOST=mail`. Clear or update any SMTP
   settings previously saved in Admin; those override the environment.
3. Read the record it wants published:

```bash
docker compose exec mail cat /data/dkim_keys/your-domain_default.dns
```

4. Add these records. In Cloudflare, leave `mail.` **unproxied**: mail has to reach the address
   itself, and the proxy only carries web traffic.

| Name                             | Type | Value                                              |
| -------------------------------- | ---- | -------------------------------------------------- |
| `mail.your-domain`               | A    | the machine's public address, unproxied            |
| `default._domainkey.your-domain` | TXT  | the contents of the `.dns` file above              |
| `your-domain`                    | TXT  | `v=spf1 a:mail.your-domain -all`                   |
| `_dmarc.your-domain`             | TXT  | `v=DMARC1; p=none;` — tighten once mail is landing |

5. Ask the machine's provider to set reverse DNS for its address to `mail.your-domain`.
6. Send a test from Admin → System, watching `docker compose logs -f mail`.
   Confirm the recipient actually received it and inspect SPF/DKIM/DMARC results;
   SMTP acceptance into Maddy's queue is not proof of final delivery.

For relay mode, use your relay provider's SPF instructions instead of the direct
server's A-record SPF rule. Keep a single SPF record per domain and merge any
existing authorized senders. A relay may also require sender/domain verification;
confirm it preserves your DKIM signature or provides its own aligned signature.
The relay configuration requires TLS and validates its certificate. Both
`tcp://host:587` (STARTTLS) and `tls://host:465` (implicit TLS) are supported.

Back up the `mail_data` volume: it contains signing keys and queued mail. Never use
`docker compose down --volumes` on a live deployment. Monitor mail health and
delivery-error logs. This outbound-only setup logs failed deliveries and discards
generated bounce reports; it does not send failure events back to Orbyn.
After Maddy accepts a message, Orbyn records submission success even if a later
delivery attempt fails. Keep existing incoming mail routing in place so replies
and recipient-generated bounces can reach a monitored mailbox.

Expect the first messages to be treated with suspicion until the address earns a reputation, so
send a few at a time rather than a burst. Remove the `mailpit` service in production, so nothing
silently swallows mail that should have gone out.

## Updating the server

One command installs, updates and repairs a server, without downtime:

```bash
./scripts/deploy.sh
```

Use it for every change: new code, a changed `.env`, a new mail or tunnel setting. Its options:

| Command                                                | What it does                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| `./scripts/deploy.sh`                                  | Pull the latest code, then everything below                     |
| `./scripts/deploy.sh --no-pull`                        | The same for what is checked out (after editing `.env`, say)    |
| `./scripts/deploy.sh --no-backup`                      | Skip the database dump                                          |
| `./scripts/deploy.sh --check`                          | Report the plan and check `.env` against itself; change nothing |
| `ENV_FILE=.env.production ./scripts/deploy.sh --check` | The same check for a file you are about to copy to a server     |

On **Windows**, run it from WSL (Ubuntu) or Git Bash, not PowerShell or CMD — it is a bash
script. WSL is the better home for a server: install Docker Desktop with the WSL 2 backend, turn
on integration for the distribution (Settings → Resources → WSL Integration), and keep the clone
inside the WSL filesystem (`~/Orbyn`) rather than under `/mnt/c`, where Docker is much slower.
Git Bash works too; the repository pins Unix line endings in every clone, so the scripts stay
runnable.

In order, it:

1. pulls the code and builds images stamped with the commit (shown in Admin → System and at
   `GET /version`);
2. makes sure the database and pooler are running, without ever recreating them;
3. dumps the database to `backups/` (keeping `BACKUP_KEEP`, default 7), so a migration can be
   undone — see [Backups](#backups);
4. starts or updates the mail server (`DOCKER_SMTP_HOST=mail`) or the test inbox (`mailpit`),
   printing the mail server's DKIM record and whether DNS has it;
5. applies database migrations before any new code serves traffic;
6. for each backend service, starts new copies beside the old ones, waits until they pass their
   health checks and the gateway has picked them up (it re-resolves every 10 seconds), then stops
   the old copies gracefully so in-flight requests finish;
7. replaces the gateway only when its configuration or image changed (nginx starts in about a
   second), and says why;
8. starts or updates the Cloudflare tunnel when `CLOUDFLARE_TUNNEL_TOKEN` is set, on its own
   (starting it with its dependencies would replace every service behind the gateway at once);
9. removes image layers no container uses any more, and confirms the version that is serving.

Before doing any of that it checks `.env`: leftover `TODO` values, a tunnel with `APP_URL` or
`CORS_ORIGINS` still on localhost (emailed links would point at your laptop), and a mail server
missing its relay credentials. Problems stop it before anything changes.

Plain `docker compose up -d --build` replaces every changed container at once. All backend services
share one image, so every copy of every service restarts together and the site answers "Orbyn is
briefly unavailable" until they are up. The script avoids that.

The gateway is the only container with host ports: it serves the API port (`API_PORT`) and the web
port (`WEB_PORT`). The web app runs behind it like every other service, so it rolls over without
downtime too.

If a new copy fails its health check, the old copies keep serving and the script stops with the
new copies' logs. The API, assistant and web app run two copies by default (`API_REPLICAS`,
`AI_REPLICAS`, `WEB_REPLICAS`;
`STATUS_REPLICAS` and `NOTIFIER_REPLICAS` default to one), so a crash or restart of one copy is
also absorbed.

### Deploying from GitHub

`.github/workflows/deploy.yml` runs the script on the server over SSH. Run it from the Actions tab
("Deploy" → "Run workflow"), or set the repository variable `AUTO_DEPLOY` to `true` to deploy
automatically after CI passes on `main`. It needs these repository secrets:

| Secret               | Value                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------- |
| `DEPLOY_HOST`        | Server address                                                                          |
| `DEPLOY_USER`        | SSH user that can run `docker`                                                          |
| `DEPLOY_SSH_KEY`     | Private key for that user; its public key goes in the server's `~/.ssh/authorized_keys` |
| `DEPLOY_PATH`        | The Orbyn checkout on the server, for example `/opt/orbyn`                              |
| `DEPLOY_PORT`        | Optional, defaults to 22                                                                |
| `DEPLOY_KNOWN_HOSTS` | Optional output of `ssh-keyscan <host>`, to pin the server key                          |

## Running it with plain Docker commands

`scripts/deploy.sh` wraps these. Use them directly when you want to do one thing by hand, or on a
machine where bash isn't convenient — Windows PowerShell, for instance. Every command runs from
the repository folder, next to `compose.yaml`.

First, tell Compose which optional services this machine uses, once, in `.env`:

```bash
COMPOSE_PROFILES=tunnel,mail
```

Every command below then includes the tunnel and your own mail server. Without that line, add
`--profile tunnel --profile mail` to each one, or they are silently left out. The optional
`formula` and `ocr` profiles are described in
[Importing files](#importing-pdf-and-word-files-into-docs).

### Install or update everything

```bash
git pull
```

```bash
docker compose up -d --build --wait
```

That builds changed images, runs the database migrations first (every service waits for them to
finish), starts or replaces containers, and waits until they report healthy. It replaces all
changed containers at once, so expect a few seconds of downtime;
[the script](#updating-the-server) avoids that and takes a backup first.

To stamp the build with the commit, so Admin → System and `GET /version` show it:

```bash
GIT_SHA=$(git rev-parse --short HEAD) BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) docker compose up -d --build --wait
```

In PowerShell:

```powershell
$env:GIT_SHA = (git rev-parse --short HEAD); $env:BUILD_TIME = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
```

```powershell
docker compose up -d --build --wait
```

### Everyday commands

| Task                                | Command                                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| What is running                     | `docker compose ps`                                                                     |
| Follow one service's log            | `docker compose logs -f api` (or `mail`, `cloudflared`, `notifier`, `converter`, `ocr`) |
| Restart a service                   | `docker compose restart api`                                                            |
| Rebuild just one service            | `docker compose up -d --build --no-deps api`                                            |
| Apply migrations only               | `docker compose run --rm migrate`                                                       |
| Run more copies of a service        | `docker compose up -d --scale api=3 api`                                                |
| Stop everything, keep the data      | `docker compose stop`                                                                   |
| Stop and remove the containers      | `docker compose down`                                                                   |
| A database shell                    | `docker compose exec postgres psql -U orbyn -d orbyn`                                   |
| Is the API healthy, and which build | `curl http://127.0.0.1:8008/health` and `.../version`                                   |
| Reclaim disk after builds           | `docker image prune -f`                                                                 |

Never run `docker compose down --volumes` on a server: it deletes the database and the mail
server's signing key along with the containers.

### Backing up and restoring the database

Dump inside the container and copy the file out. This avoids shell redirection, which in Windows
PowerShell would write the file as UTF-16 and corrupt the dump:

```bash
docker compose exec -T postgres sh -c "pg_dump -U orbyn -Fc orbyn > /tmp/orbyn.dump"
```

```bash
docker compose cp postgres:/tmp/orbyn.dump ./orbyn.dump
```

To restore one, stop the services that write, put the data back, then start again:

```bash
docker compose stop api ai notifier status
```

```bash
docker compose cp ./orbyn.dump postgres:/tmp/orbyn.dump
```

```bash
docker compose exec -T postgres pg_restore -U orbyn -d orbyn --clean --if-exists /tmp/orbyn.dump
```

```bash
docker compose up -d --wait
```

### The mail server

```bash
docker compose up -d --wait mail
```

```bash
docker compose exec mail cat /data/dkim_keys/your-domain_default.dns
```

```bash
docker compose logs -f mail
```

The second command prints the DKIM record to publish; put your sending domain in the filename, so
for orbyn.dev it is `/data/dkim_keys/orbyn.dev_default.dns`. A message it accepted is logged as `delivered`
when it reaches the recipient, or with the reason when it doesn't.

### The tunnel

```bash
docker compose up -d cloudflared
```

```bash
docker compose logs -f cloudflared
```

A healthy tunnel logs `Registered tunnel connection` four times, and Cloudflare's dashboard shows
it as healthy. Its configuration lives in Cloudflare, not here: the public hostname points at
`http://gateway:8081`.

## Importing PDF and Word files into Docs

People can import a lecture PDF, a Word document or a photo of notes. It becomes a page in
Docs → Uploads, and the file is deleted. These services do the work:

- **`files`** is the file store. It holds uploads encrypted, only until they're read, and never
  longer than 24 hours, in the `import_files` volume. It refuses uploads when less than
  `FILES_MIN_FREE_MB` (1 GB) would be left on the disk. People who turn on **Keep the original**
  have their files kept after import in `kept/` inside that volume, encrypted, within
  `FILES_KEEP_QUOTA_MB` each (500 MB). **Back up `import_files/kept` with the database**: a
  `kept_files` row without its file downloads as "couldn't be found". The file store removes a kept
  file once its page is deleted for good or its account is gone. It also keeps pictures and files
  added to pages, encrypted, for as long as their page, in the `page_files` volume
  (`PAGE_FILES_DIR`): each person has `PAGE_FILES_QUOTA_MB` (1 GB) of space and a file is at most
  `PAGE_FILES_MAX_MB` (25 MB). Back that volume up with the database.
- **`converter`** reads everything:
  - Word files, with exact equations;
  - PDF pages with real text, with columns, headings, tables and maths from their fonts;
  - scanned pages and photos of printed notes, with **Tesseract**. Tesseract is built into the
    image (English), needs no model download and about 100 MB of memory, and takes a few seconds
    a page.
- **`formula`** (optional, the `formula` profile) reads equations on scanned pages as LaTeX with
  pix2tex. It needs about 1–2 GB of RAM.
- **`ocr`** (optional, the `ocr` profile, **off by default**) is the heavy Unlimited-OCR model. It
  needs about 16 GB of RAM, and is only worth it on a big server for scanned maths and handwriting.

`files` and `converter` always run. Importing stays off until the secrets are set. In `.env`:

```bash
# Signs upload links; shared by api, files and converter. Blank turns importing off.
FILES_SECRET=<openssl rand -base64 32>
# Encrypts each stored file's key (files only). 32 bytes, base64.
FILES_MASTER_KEY=<openssl rand -base64 32>
```

That is all a normal server needs: Word files, PDFs and scans all import.

**Equations on scans (the `formula` profile).** To read pictures of equations on scanned pages as
LaTeX, add to `.env`:

```bash
COMPOSE_PROFILES=tunnel,mail,formula
FORMULA_URL=http://formula:8000
```

Then run `docker compose up -d --build --wait`. The image downloads its model while it's built, so
the running container needs no internet. Compose caps it at 2 GB (`FORMULA_MEMORY`) and 2 CPUs
(`FORMULA_CPUS`).

**The heavy OCR model (the `ocr` profile).** This is only for servers with plenty of memory. It
needs about 12 GB for the model, and Compose caps it at 16 GB (`OCR_MEMORY`). On a smaller server
it can take the whole machine down, so it's off by default. To try it, add `ocr` to
`COMPOSE_PROFILES` and set `OCR_URL=http://ocr:8000`. The first start downloads the model into
`ocr_models`, and `docker compose logs -f ocr` shows `model loaded`. After that, `OCR_OFFLINE=1`
stops it from reaching the internet, and `OCR_MODEL_REVISION` pins a reviewed commit. While it's
set, it replaces Tesseract for scanned pages. More workers:
`docker compose up -d --scale ocr=2 ocr` with `OCR_WORKERS=2`.

Never build the `ocr` or `formula` image on a development machine. Tesseract and `pdftoppm` from
Homebrew or apt are enough there, and `scripts/ocr-standin.mjs` stands in for the heavy model.

| Setting               | Default            | What it does                                                       |
| --------------------- | ------------------ | ------------------------------------------------------------------ |
| `FILES_SECRET`        | (blank: off)       | Signs upload links and the converter's requests                    |
| `FILES_MASTER_KEY`    | derived (dev only) | Wraps each file's own encryption key                               |
| `FILES_MIN_FREE_MB`   | `1024`             | Uploads are refused below this much free disk                      |
| `FILES_KEEP_QUOTA_MB` | `500`              | "Keep the original": space per person for kept files               |
| `PAGE_FILES_DIR`      | `FILES_DIR/pages`  | Where pictures and files in pages are kept (Compose: `page_files`) |
| `PAGE_FILES_QUOTA_MB` | `1024`             | Each person's space for pictures and files in pages                |
| `PAGE_FILES_MAX_MB`   | `25`               | The largest picture or file in a page                              |
| `TESSERACT_WORKERS`   | `2`                | Scanned pages read at once with Tesseract                          |
| `FORMULA_URL`         | (blank: off)       | `http://formula:8000` with the `formula` profile                   |
| `FORMULA_MEMORY`      | `2g`               | Memory cap for the `formula` container                             |
| `OCR_URL`             | (blank: off)       | `http://ocr:8000` with the `ocr` profile (heavy)                   |
| `OCR_WORKERS`         | `1`                | Heavy OCR pages read at once (one per `ocr` container)             |
| `OCR_TIMEOUT_MS`      | `600000`           | Longest one scanned page may take                                  |
| `OCR_MEMORY`          | `16g`              | Memory cap for each `ocr` container                                |
| `OCR_IMAGE_MODE`      | `gundam`           | `gundam` crops (better on dense pages); `base` is faster           |
| `OCR_MODEL_REVISION`  | `main`             | Pin the heavy model and its code to a reviewed commit              |
| `OCR_OFFLINE`         | `0`                | `1` after the first download: no internet access                   |

The status page lists **Document import**, which is the converter's heartbeat. Admin → Storage
shows the files on the server, the queue, how scans are read, and the last month of imports.
`docker compose logs -f converter` shows each file it reads.

## Email to task

Let people turn email into tasks. Set two variables and have the mail server hand inbound
messages to Orbyn:

- `MAIL_INBOUND_DOMAIN` — the domain their addresses use, for example `tasks.your-domain`. Point
  its MX at your mail server.
- `MAIL_INBOUND_SECRET` — a long random string. The endpoint is off until this is set.

Configure the mail server to POST each inbound message as JSON `{to, from, subject, text}` to
`http://gateway:8081/api/inbound/mail` with the header `X-Inbound-Secret: <MAIL_INBOUND_SECRET>`
(maddy can pipe a message to a small script that does this). Each person then turns the feature on
in Settings, gets a private `something@tasks.your-domain` address, and mail they send to it becomes
a task. Only mail from their own account address is accepted.

## Subscribing from a calendar app (CalDAV)

Orbyn serves CalDAV at `/dav/`, so people can add their events to Apple Calendar,
Thunderbird or DAVx5. The gateway already routes `/dav/` and `/.well-known/caldav` to the API. In
the calendar app, add a CalDAV account with the server `https://your-domain/`, the username set to
the person's Orbyn email, and the password set to a personal API key they create in
Settings -> Connections. Events sync both ways: events created, edited or deleted in the calendar app sync back to Orbyn. Tasks and other kinds stay read-only.

## Search engines and link previews

The homepage is the one page meant for search results; the app needs a sign-in, and the public
booking, invitation, profile and RSVP pages ask not to be indexed. What's in place:

- `robots.txt` and `sitemap.xml` are generated by the web container's nginx from each request's
  own host, so no deployment has its domain written into the repository.
- The page carries a description, a canonical address, Open Graph and Twitter tags, structured
  data (`SoftwareApplication` and `Organization`) and a share image (`og-image.png`, 1200 × 630).
  The app rewrites the canonical address and `og:url` for the host it is served from, and marks
  every page except the homepage `noindex`.
- Icons: `favicon.ico` (16, 32 and 48 px), `favicon.svg`, `apple-touch-icon.png`, and
  `icon-192.png` / `icon-512.png` behind `site.webmanifest`. They are the header's orbit mark on a
  brand-green tile; the master is `desktop/public/favicon.svg`.
- Text responses are gzip-compressed.

One value is fixed in `desktop/index.html`: the `https://orbyn.dev` in the canonical, `og:url` and
image tags, which link previews read without running any script. Hosting Orbyn elsewhere, change
that domain to yours.

## Errors on screen

People see plain messages: "Couldn't reach Orbyn. Check your connection and try again.", or
what to fix in a form. What really went wrong (the call, its status, what the server said and the
request id) goes to the browser console, and the server logs it with the same request id; a
background refresh that fails only goes to the console. `DEBUG_ERRORS=true` in `.env` also shows
those details on screen and in API replies, for a development or test server; leave it off (the
default) for the public. The web app reads it when its image is built, so run
`./scripts/deploy.sh` after changing it. The phone app has its own switch,
`EXPO_PUBLIC_DEBUG_ERRORS` (see [mobile](mobile.md)).

## Settings in the app

Admins change these in **Admin → System**; every instance picks them up within about 10 seconds,
with no restart or deploy. Anything not set there falls back to `.env`, and each setting can be
reset to its `.env` value:

- allowed web origins (`CORS_ORIGINS`);
- the per-client rate limit (`RATE_LIMIT_PER_MINUTE`);
- reminder delivery lanes (`NOTIFIER_CONCURRENCY`) and the status check interval
  (`STATUS_INTERVAL_MS`);
- email: SMTP host, port, user, password (stored encrypted) and sender, with a test email button.

Secrets and infrastructure stay in `.env`: the database password, `SECRETS_KEY`, ports, and where
services run.

## Maintenance mode

Switch it on in **Admin → System** with an optional message and end time. Members can still sign
in and read everything, but changes are refused with a clear message (HTTP 503); admins keep full
access. The web and mobile apps show a banner and the public status page shows the notice.

## Updates

Admin → System shows the running version. With `UPDATE_REPO=owner/repo` (and `GITHUB_TOKEN`, a
read-only token, for a private repository) it also shows the newest commit on `UPDATE_BRANCH`
(default `main`), whether an update is available, and a link to the deploy workflow. After a
deploy, the web app notices the new version and offers a reload; its page is served with
`Cache-Control: no-cache`, so browsers never keep running old code. The deploy workflow and the
manual path run the same script: `./scripts/deploy.sh` on the server.

## Backups

Everything lives in PostgreSQL, plus a few things beside it: `.env` (the secrets key and
`FILES_MASTER_KEY` above all), the mail server's `mail_data` volume, which holds its DKIM key, and
the `page_files` volume with the pictures and files in pages (already encrypted; without
`FILES_MASTER_KEY` they can't be read). `scripts/deploy.sh` saves `page_files` beside each dump as
`backups/page-files-<stamp>.tar.gz`. Import originals people chose to keep live in
`import_files/kept`; back that folder up too (see the file store above).

`scripts/deploy.sh` dumps the database to `backups/` before every migration and keeps the last
`BACKUP_KEEP` (default 7). That covers "the update broke something"; for everything else — disk
loss, a bad delete — take a nightly dump off the machine as well:

```bash
docker compose exec -T postgres pg_dump -U orbyn -Fc orbyn > orbyn-$(date -u +%F).dump
```

To restore a dump, stop the services that write, put the data back, then deploy again:

```bash
docker compose stop api ai notifier status
```

```bash
docker compose exec -T postgres pg_restore -U orbyn -d orbyn --clean --if-exists < backups/orbyn-<stamp>.dump
```

```bash
./scripts/deploy.sh --no-pull --no-backup
```

## Scaling services

On one host, scale a service with `docker compose up -d --scale api=3 --scale ai=2`. The gateway
re-resolves service names, so new instances receive traffic without a restart. To spread services
across machines, run the backend image on each host and point the gateway at them:

```bash
GATEWAY_API_SERVERS="10.0.1.10:8000 10.0.1.11:8000" \
GATEWAY_AI_SERVERS="10.0.2.10:8000" \
GATEWAY_STATUS_SERVERS="10.0.3.10:8000" \
docker compose up -d gateway
```

Running more than one `notifier` or `status` instance is safe: reminder delivery and status
recording coordinate through PostgreSQL locks. Keep instances x `DB_POOL_MAX` within PgBouncer's
`max_client_conn`. The full guide, with measured numbers and a capacity plan, is
[scalability.md](scalability.md).

One connection per API copy goes around PgBouncer: live documents ride a Postgres `LISTEN`, which a
transaction pooler cannot hold open. `compose.yaml` sets `DATABASE_LISTEN_URL` to the primary
directly, so with Compose there is nothing to do. Anywhere else that `DATABASE_URL` points at a
pooler (Kubernetes, a managed pooler), set `DATABASE_LISTEN_URL` to the database itself — otherwise
documents still save, but two open tabs never hear each other.

## Secrets key

`SECRETS_KEY` is optional. Without it, Orbyn generates a key on first use and keeps it in the
database, so AI provider keys saved from the admin console work with no setup. In production, set
`SECRETS_KEY` so the key lives outside the database: a leaked database dump then cannot reveal
saved keys. Keys saved before you set it keep working. Back `SECRETS_KEY` up with the database;
without it, keys saved while it was set cannot be decrypted and admins must re-enter them.

## Search by meaning (off by default)

Word search always works. Search by meaning is an extra that stays off until an admin sets it up in
**Admin → AI → Search by meaning**, because every page is then sent to the AI provider to be
measured. To make it possible:

1. Use a Postgres image with `pgvector`: set `POSTGRES_IMAGE=pgvector/pgvector:pg17` in `.env`,
   recreate `postgres`, and run the `migrate` service again. Every migrate run calls
   `ensure_vectors()`, which creates the extension, the tables and the queue trigger (which skips
   projects kept out of the assistant) as soon as `pgvector` is there, so this works on a database
   that was first set up without it. Without it nothing changes: the setup says the database can't
   store measurements.

   **Collation caveat on an existing database.** `pgvector/pgvector:pg17` is Debian (glibc) while
   `postgres:17-alpine` is Alpine (musl). They sort text differently, so an existing data directory
   opened under the new image can have text indexes (the unique indexes on email and handle, for
   example) that no longer match their order, and lookups and uniqueness checks can quietly go
   wrong. Before switching, take a backup (`pg_dump`) and stop the API and worker. Right after the
   new image starts, run `REINDEX DATABASE orbyn;` (your `POSTGRES_DB`, as the database owner) before anything writes,
   or dump from the old image and restore into a fresh volume on the new one. A brand-new
   deployment that starts on the pgvector image has nothing to reindex.

2. Start the measuring service: add `semantic` to `COMPOSE_PROFILES` (`docker compose --profile
semantic up -d measure`). It measures changed pages in its own process, never in the reminder
   loop, and reports a heartbeat Admin reads.
3. In Admin → AI, choose the model that measures text and accept that every page (except those in
   projects kept out of the assistant) is sent to be measured. Turning it off forgets every
   measurement.

## Private document PDF renderer

The API authorizes a primary-read document snapshot and sends self-contained HTML
to the private `pdf` service. Set an independent `DOC_PDF_KEY` of at least 32
characters (`openssl rand -hex 32`); Compose supplies `DOC_PDF_URL=http://pdf:8000`.
For a locally running API, configure that URL explicitly. Unconfigured or unavailable
rendering returns503, never a downgraded file. Changed/inaccessible pages are
rechecked before delivery and return409/404.

`backend/Dockerfile --target pdf` builds the dedicated Chromium image. The normal
backend image keeps its existing system dependencies. Chromium's sandbox remains
enabled with the renderer-only [seccomp profile](../deploy/pdf/README.md). The
renderer runs nonroot, with no database/provider credentials, no published port,
dropped capabilities, a read-only root and bounded temporary/shared memory.
Kubernetes requires the documented node-local profile before enabling the deployment.
Do not disable the sandbox for host compatibility. `scripts/deploy.sh` validates the
key and starts/rolls PDF before API; `PDF_REPLICAS` defaults to one.

Work is limited to1–4 simultaneous jobs (`DOC_PDF_CONCURRENCY`, default2),20MiB
input,24MiB output and a35-second request deadline. Private requests are signed
and replay-protected for their complete validity window. Client disconnects cancel
owned rendering work. Math and all ten Mermaid families print without network
access; malformed diagrams retain readable source. Existing image/file captions
remain supported; embedded image-byte parity is a separate D1 gate.

`npm run build:pdf-renderer` regenerates the backend's first-party diagram asset
from the root's locked build dependencies. Export integration tests require a
sandboxed Chromium executable (`PDF_TEST_CHROME` or the detected platform path)
and their own marked PostgreSQL test database. Each process owns its test renderer.
