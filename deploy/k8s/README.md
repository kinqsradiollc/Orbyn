# Orbyn on Kubernetes

Plain, kustomize-ready manifests for running Orbyn in production. There is no
Helm chart. The layout mirrors `compose.yaml`: one backend image runs as
four workloads with different commands. Ingress routing replaces the Compose
gateway, and a managed Postgres replaces the `postgres` container.

```
            api.orbyn.example                         app.orbyn.example
                   |                                          |
          Ingress (TLS, rate limits)                  Ingress (TLS)
       /ai/*     /status      /*                              |
         |          |          |                         web (nginx)
        ai       status       api   <---- /api/* proxied ----'
         \          |          /
          \    notifier (no port)
           \        |        /
      pooler (managed, or pgbouncer.yaml) -> Postgres primary (+ read replica)
```

| File                                 | What it holds                                                             |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `namespace.yaml`                     | Namespace `orbyn`, Pod Security `restricted` enforced                     |
| `config.yaml`                        | ConfigMap `orbyn-config` (non-secret env)                                 |
| `secrets.example.yaml`               | Example `orbyn-secrets`, **never applied or committed with real values**  |
| `migrate-job.yaml`                   | One-shot migrations Job, run before each rollout                          |
| `api.yaml`, `ai.yaml`, `status.yaml` | Deployment + Service for each HTTP service                                |
| `mcp.yaml`                           | MCP service for outside AI agents (Deployment + Service)                  |
| `notifier.yaml`                      | Reminder worker Deployment (no Service)                                   |
| `imports.yaml`                       | File store (Deployment, volume, Service, upload Ingress) and converter    |
| `web.yaml`                           | Web app nginx config, Deployment, Service, HPA, PDB                       |
| `autoscaling.yaml`                   | HPAs and PDBs for api, mcp, ai, status, notifier                          |
| `ingress.yaml`                       | `api.orbyn.example`, `app.orbyn.example` and `mcp.orbyn.example`          |
| `pgbouncer.yaml`                     | Optional PgBouncer (commented out in the kustomization)                   |
| `networkpolicy.yaml`                 | Default deny, plus the allowed flows                                      |
| `kustomization.yaml`                 | Everything above except the Secret example, the migrate Job and PgBouncer |

## Prerequisites

- Kubernetes 1.31 or newer: the manifests use `matchLabelKeys` in topology
  spread and `unhealthyPodEvictionPolicy` on PDBs.
- metrics-server, for the HPAs.
- An ingress controller with class `nginx`, and cert-manager with a
  ClusterIssuer (the manifests assume one named `letsencrypt-prod`; change the
  annotation to match yours). Note that the Kubernetes project has retired
  ingress-nginx; see the header of `ingress.yaml`.
- A CNI that enforces NetworkPolicy.
- A managed PostgreSQL, ideally with a read replica and a built-in pooler.
- **The backend must serve `GET /live`** (no database, cheap). The startup
  and liveness probes use it. An image built before `/live` existed will
  crash-loop.

## Deploy

1. **Build and push the images** from the repo root:

   ```sh
   TAG=$(git rev-parse --short HEAD)
   docker build -f backend/Dockerfile -t ghcr.io/your-org/orbyn-backend:$TAG .
   docker build -f desktop/Dockerfile -t ghcr.io/your-org/orbyn-web:$TAG .
   docker build -t ghcr.io/your-org/orbyn-pgbouncer:$TAG pgbouncer   # only with pgbouncer.yaml
   docker push ghcr.io/your-org/orbyn-backend:$TAG   # and the others
   ```

   Then set the tag (and your registry) in `kustomization.yaml`:

   ```sh
   cd deploy/k8s
   kustomize edit set image ghcr.io/your-org/orbyn-backend=ghcr.io/your-org/orbyn-backend:$TAG
   kustomize edit set image ghcr.io/your-org/orbyn-web=ghcr.io/your-org/orbyn-web:$TAG
   ```

2. **Create the namespace and the Secret.** In production, sync
   `orbyn-secrets` from a secret manager (an External Secrets `ExternalSecret`,
   or a SOPS-encrypted file decrypted in CI). It needs the same keys as
   `secrets.example.yaml`. For a throwaway cluster only:

   ```sh
   kubectl apply -f deploy/k8s/namespace.yaml
   kubectl -n orbyn create secret generic orbyn-secrets --from-env-file=orbyn-secrets.env
   ```

   `SECRETS_KEY` must stay the same across deploys: it decrypts AI provider
   credentials stored in the database.

3. **Run migrations** with the same tag you are about to roll out. The
   ConfigMap must exist first, because the Job reads it.

   ```sh
   kubectl apply -f deploy/k8s/config.yaml -n orbyn
   kubectl -n orbyn delete job orbyn-migrate --ignore-not-found
   sed "s|orbyn-backend:TAG|orbyn-backend:$TAG|" deploy/k8s/migrate-job.yaml | kubectl apply -f -
   kubectl -n orbyn wait --for=condition=complete job/orbyn-migrate --timeout=10m
   ```

   Migrations take a Postgres advisory lock and skip files already recorded,
   so a rerun is harmless. Keep migrations backward compatible (expand, then
   contract): old pods keep serving while new ones roll out. With Argo CD,
   uncomment the PreSync hook annotations in `migrate-job.yaml` and add it to
   the kustomization instead.

4. **Apply everything else:**

   ```sh
   kubectl apply -k deploy/k8s
   kubectl -n orbyn rollout status deploy/api deploy/ai deploy/status deploy/notifier deploy/web
   ```

5. Point DNS for `api.orbyn.example` and `app.orbyn.example` at the ingress
   load balancer, and replace every `*.orbyn.example` placeholder (Ingress
   hosts, `CORS_ORIGINS`, `SMTP_FROM`).

## How scaling works

- **Every service is stateless.** Sessions, reminders and status history all
  live in Postgres, so any replica can serve any request. The Deployments set
  no `replicas`; the HPAs own the count:

  | Workload | Min | Max | Target  |
  | -------- | --- | --- | ------- |
  | api      | 3   | 50  | CPU 65% |
  | ai       | 2   | 20  | CPU 65% |
  | status   | 2   | 4   | CPU 70% |
  | notifier | 2   | 10  | CPU 70% |
  | web      | 2   | 10  | CPU 70% |

- **Background work is safe to run many times over.** Notifier replicas and
  lanes claim reminders with `SKIP LOCKED`. Only the status replica holding
  an advisory lock records a probe round.
- **Rollouts never drop capacity:** `maxUnavailable: 0`, readiness gates on
  `/health`, and a `preStop` sleep keeps a pod serving until the ingress has
  stopped routing to it. PDBs keep drains and upgrades from taking out too much
  at once, and topology spread keeps replicas across zones and nodes.
- **CPU is a rough signal for ai and notifier.** The ai service mostly waits
  on providers, and the notifier on its backlog. If they lag while CPU stays
  low, scale them on in-flight requests or reminder backlog (KEDA or
  Prometheus Adapter).

### Database connection math

Each backend process keeps a pool of up to `DB_POOL_MAX` (20) connections to
the primary, and another pool of the same size to the replica when
`DATABASE_READ_URL` is set. At full scale:

```
(api 50 + ai 20 + status 4 + notifier 10) replicas x 20  = 1,680 to the primary
                                        same again       = 1,680 to the replica
plus rolling-update surge (25%) and the migrate Job (2)
```

Rule: **max replicas x `DB_POOL_MAX` (x2 with a replica), plus surge, must be
at most the pooler's client limit.** PgBouncer here allows 5,000 client
connections per instance. The server side is what Postgres sees: PgBouncer
opens at most `default_pool_size` 40 + `reserve_pool_size` 10 per
database/user pair per PgBouncer replica, 100 with two replicas, and that
must fit under Postgres `max_connections`. Without a pooler, 1,680 direct
connections would overwhelm Postgres. Always run behind one.

To scale further, raise the pooler's server pool (and the database size)
before raising `maxReplicas` or `DB_POOL_MAX`.

## Managed Postgres and read replicas

- Prefer the provider's pooler: RDS Proxy, Cloud SQL managed connection
  pooling, or the PgBouncer built into Azure Database for PostgreSQL Flexible
  Server. Use `pgbouncer.yaml` only when there is none. Orbyn uses only
  transaction-scoped features (`pg_advisory_xact_lock`, unnamed prepared
  statements), so transaction pooling is safe.
- `DATABASE_URL` goes to the primary (writes, transactions, fresh reads).
  `DATABASE_READ_URL` optionally goes to a replica for lag-tolerant reads,
  such as the status report. Leave it empty to read from the primary.
- Read-your-writes: clients send `x-orbyn-consistency: primary` for a few
  seconds after their own writes, and those reads go to the primary. Keep
  replica lag well under that window.
- Migrations (`MIGRATE_DATABASE_URL`) connect straight to the primary, not
  through the pooler.
- Managed databases usually require TLS. Add `sslmode=require` (or
  `verify-full`) to direct URLs. The bundled PgBouncer config does not yet
  set `server_tls_sslmode`; see `pgbouncer.yaml`.

## What to monitor

The services expose no `/metrics` endpoint, so monitoring comes from the
edge, Kubernetes, Postgres and the status page.

- **Edge (ingress):** request rate, p95/p99 latency and 5xx rate per path
  (`/ai`, `/status`, the rest), 429s (rate limiting), TLS certificate expiry.
- **Kubernetes:** HPA current vs max replicas (alert when a service stays at
  max), pods not ready, restarts, `OOMKilled`, CPU throttling, PDBs blocking
  drains, failed migrate Jobs.
- **Database and pooler:** connections used vs limit, pooler wait queue
  (PgBouncer `SHOW POOLS`: `cl_waiting`, `maxwait`), slow queries, replica
  lag, storage and IOPS, lock waits.
- **Notifier:** heartbeat age (`service_heartbeats.last_seen_at` for
  `notifier`; the status page marks it down after 90s), the backlog of due
  but undelivered reminders, SMTP and Expo push errors in logs.
- **AI:** provider error rate and latency in the `ai` service logs.
- **Status page:** `GET https://api.orbyn.example/status`. Any component down
  there is a user-visible outage.

Logs are JSON (Fastify/pino) on stdout, labelled with `service`. Ship them
with the cluster's log agent.

## Caveats

- These manifests have **not been applied to a real cluster**. They are checked
  only by YAML parsing and a client-side dry run.
- Every placeholder must be replaced: image registry and tag, hosts, the
  ClusterIssuer name, the ingress controller namespace and labels in
  `networkpolicy.yaml`, the database CIDR, and SMTP settings.
- `STATUS_*_URL` and the web nginx config use `*.orbyn.svc.cluster.local`
  names. Update them if you deploy to another namespace.
