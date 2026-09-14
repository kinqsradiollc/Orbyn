# Scalability

How Orbyn grows from one Docker host to many machines and a million users,
what has been measured, and what to add next. For image builds and the
release checklist see [deployment.md](deployment.md); for Kubernetes see
[deploy/k8s/README.md](../deploy/k8s/README.md).

## Principles

- **Stateless services.** Sessions, AI proposals, reminders and status
  history live in Postgres. Any instance of a service can answer any
  request, so instances can be added, removed or moved between machines
  freely.
- **Separate services, one image.** `api`, `ai`, `status` and `notifier`
  run from the same backend image with different commands. Each scales on
  its own, and a slow AI provider cannot starve the planner API.
- **Coordination through the database.** Reminder delivery claims work with
  `FOR UPDATE SKIP LOCKED`, and status probing takes an advisory lock, so
  running several notifier or status instances never double-sends or
  double-records.
- **Pooling everywhere.** Instances keep small pools (`DB_POOL_MAX`); PgBouncer
  multiplexes thousands of client connections onto a few dozen Postgres
  connections.

## Topology

```mermaid
flowchart LR
  Clients[Web, mobile, desktop] --> LB[Load balancer / ingress<br/>TLS, health checks]
  LB --> G1[Gateway 1]
  LB --> G2[Gateway N]
  G1 & G2 --> API[api x N]
  G1 & G2 --> AI[ai x N]
  G1 & G2 --> ST[status x 2]
  API & AI & ST & NT[notifier x N] --> PB[PgBouncer]
  PB -->|writes, fresh reads| P[(Postgres primary)]
  PB -->|"&lt;db&gt;_read"| R[(Read replicas)]
  P -. streaming replication .-> R
```

| Layer           | Scales by                                    | Notes                                                                          |
| --------------- | -------------------------------------------- | ------------------------------------------------------------------------------ |
| Load balancer   | Managed (ALB, Cloud Load Balancing, ingress) | Terminates TLS, health-checks gateways on `/health`                            |
| Gateway (nginx) | More instances behind the load balancer      | Routes `/ai/*`, `/status`, everything else; keep-alive upstreams; `least_conn` |
| `api`           | Horizontal, CPU-based autoscaling            | Planner, auth, teams, admin                                                    |
| `ai`            | Horizontal                                   | Mostly waiting on providers; scale on concurrency                              |
| `status`        | 2 for availability                           | One prober at a time (advisory lock); report cached 15 s                       |
| `notifier`      | Horizontal                                   | Parallel lanes (`NOTIFIER_CONCURRENCY`) per instance                           |
| PgBouncer       | 2+ instances, scaled by hand                 | Transaction pooling; `<db>_read` route to a replica                            |
| Postgres        | Vertical primary, horizontal read replicas   | Managed service recommended in production                                      |

## Running services on separate machines

Every piece is addressed by configuration, not by Docker's service names.

**Gateway.** `gateway/nginx.conf.template` is rendered at start by
`gateway/entrypoint.sh`. Point it at instances anywhere:

```bash
GATEWAY_API_SERVERS="10.0.1.10:8000 10.0.1.11:8000 api.internal:8000"
GATEWAY_AI_SERVERS="10.0.2.10:8000"
GATEWAY_STATUS_SERVERS="10.0.3.10:8000"
GATEWAY_RESOLVER=10.0.0.2          # your VPC DNS, for hostnames
GATEWAY_TRUSTED_PROXIES="10.0.0.0/16"
```

Hostnames are re-resolved every 10 seconds, so a DNS name that returns
several addresses (Consul, Cloud Map, a Kubernetes headless Service) load
balances without restarting the gateway. Unreachable instances are skipped
after 3 failures for 10 seconds.

**Services.** Each host runs the backend image with the command for its
service and these settings:

| Setting                                                 | Value on a multi-host deployment                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| `DATABASE_URL`                                          | PgBouncer (or the managed pooler) for the primary                   |
| `DATABASE_READ_URL`                                     | PgBouncer's `<db>_read` route or a replica endpoint                 |
| `TRUST_PROXY`                                           | `true` behind the gateway                                           |
| `RATE_LIMIT_PER_MINUTE`                                 | A generous per-instance backstop, or `0` to leave it to the gateway |
| `STATUS_GATEWAY_URL`, `STATUS_API_URL`, `STATUS_AI_URL` | Internal URLs the status service probes                             |
| `SECRETS_KEY`                                           | The same value on every `ai` and `api` instance                     |

Migrations run once per release from one place (`node backend/dist/migrate.js`
against the primary directly) before new instances start.

**Health checks.** Every HTTP service has two endpoints:

- `GET /live`: liveness. No database, so a brief database outage never makes
  an orchestrator restart every instance at once.
- `GET /health`: readiness. Includes a database check; a failing instance is
  taken out of rotation until it recovers.

## Load balancer

Put a managed load balancer or ingress in front of two or more gateways (or,
on Kubernetes, use the ingress instead of the gateway; see `deploy/k8s`).

- Health-check gateways on `/health` (the gateway answers without a backend
  hop).
- Set `GATEWAY_TRUSTED_PROXIES` to the load balancer's address ranges. The
  gateway then takes the client address from `X-Forwarded-For`, so rate
  limits and logs apply per end user rather than to the load balancer.
- In production leave `GATEWAY_RATE_LIMIT_EXEMPT` empty; its default only
  exists so a load test from the same machine is not throttled.
- Rate limits are per gateway instance: with N gateways a client can reach up
  to N times the configured rate. For strict global limits, enforce them at
  the load balancer or WAF, or add a shared store (see "Next steps").

## Database

### Connection pooling

PgBouncer runs in transaction mode (`pgbouncer/pgbouncer.base.ini`:
`max_client_conn` 5000, `default_pool_size` 40). Keep

```text
service instances x DB_POOL_MAX  <=  PgBouncer max_client_conn x PgBouncer instances
PgBouncer instances x (default_pool_size + reserve_pool_size)  <  Postgres max_connections
```

Managed poolers (RDS Proxy, Cloud SQL connector pooling, Azure Flexible
Server's PgBouncer) replace this container. Set `SERVER_TLS_SSLMODE=require`
when PgBouncer talks to a database that expects TLS.

### Read/write split

Writes, transactions and anything security-sensitive (sign-in, token checks,
permission checks inside writes) always use the primary. Reads that tolerate
a moment of replication lag go to `DATABASE_READ_URL` when it is set:

- item lists and task detail, notifications, the team list;
- the AI assistant's planner snapshot;
- the admin console (users, teams, audit log, stats);
- the public status report.

**Read-your-writes.** For 5 seconds after a client writes, the shared API
client sends `X-Orbyn-Consistency: primary` on its reads, and the server
serves those from the primary. A user always sees their own change even if a
replica is a moment behind. Without `DATABASE_READ_URL` everything uses the
primary and the header has no effect.

### Replication

Locally, the `replica` Compose profile runs a streaming replica:

```bash
# First start of a new database volume only: the primary allows replicas.
PGBOUNCER_READ_HOST=postgres-replica \
DOCKER_DATABASE_READ_URL=postgres://orbyn:PASSWORD@pgbouncer:6432/orbyn_read \
docker compose --profile replica up -d
```

The primary's first-start script (`deploy/postgres/primary-replication.sh`)
allows replication connections; for a database that already exists, add the
same line to `pg_hba.conf` and reload. The replica
(`deploy/postgres/replica-entrypoint.sh`) clones the primary with
`pg_basebackup` and runs as a hot standby.

In production use a managed Postgres with read replicas (RDS/Aurora, Cloud
SQL, Azure Flexible Server, Crunchy Bridge). They provide automated failover,
point-in-time recovery and replica endpoints; set that endpoint as the read
route. Failover of the primary is the provider's job; services reconnect
through the pooler.

### Growth and housekeeping

- Hot paths are indexed: open work by due date (`items_due`, partial on
  `status <> 'done'`), per-owner and per-team lists, notification claims.
- The scheduler only scans a bounded window (due within the next 7 days, or
  in the last day).
- Expired AI proposals are removed after a day, and finished reminder records
  after 90 days.
- Beyond tens of millions of items, partition `items`, `item_updates` and
  `notifications` by time or by owner hash; the code addresses rows by id and
  owner, which suits either scheme.

## Caching and polling

The apps refresh every 30 seconds; at scale, that polling is most of the
traffic.

- **Conditional GETs.** Every successful GET carries a weak `ETag`. The shared
  client remembers the last body per signed-in path and sends
  `If-None-Match`. Unchanged data comes back as a bodyless `304`, which the
  client turns into the cached result.
- **Status page.** The gateway micro-caches `GET /status`, and the status
  service caches its report for 15 seconds, so the public page costs almost
  nothing however many people watch it.
- **Compression and keep-alive** at the gateway, with persistent upstream
  connections to every instance.

## Measured

A load test on one MacBook: the load generator, three `api` processes, one
`ai`, one `status`, the gateway, PgBouncer, a primary and a streaming replica,
all sharing the same CPU. The gateway reached the processes through
host networking, as it would reach separate machines. Numbers are therefore a
floor for a single laptop, not per-server capacity.

```bash
LOAD_URL=http://127.0.0.1:18008 LOAD_SECONDS=15 LOAD_CONCURRENCY=64 npm run load -w backend
```

| Scenario                         | Requests/s | p50     | p95     | p99      | Errors |
| -------------------------------- | ---------- | ------- | ------- | -------- | ------ |
| Gateway `/health`                | 8,560      | 6.9 ms  | 11.0 ms | 15.1 ms  | 0%     |
| `GET /status` (cached)           | 3,642      | 16.8 ms | 24.3 ms | 34.1 ms  | 0%     |
| `GET /me`                        | 2,951      | 17.4 ms | 39.5 ms | 87.0 ms  | 0%     |
| `GET /items` (50 items, replica) | 1,143      | 51.0 ms | 90.1 ms | 159.4 ms | 0%     |
| `POST /items` (primary)          | 1,531      | 37.6 ms | 58.1 ms | 89.0 ms  | 0%     |

CPU time was spread almost evenly across the three `api` processes (about
18 seconds each), confirming the gateway balances across instances.

Replication was checked on the same stack: PgBouncer's primary route is not in
recovery, its `_read` route is; a write on the primary was visible on the
replica after 4 ms; the replica rejects writes.

## Capacity plan for a million users

Assumptions, to be replaced with real telemetry:

| Quantity                    | Assumption                 | Result       |
| --------------------------- | -------------------------- | ------------ |
| Registered users            | 1,000,000                  |              |
| Peak concurrently open apps | 5%                         | 50,000       |
| Background refreshes        | 1 per 30 s per open app    | ~1,700 req/s |
| Interactive requests        | ~3 per minute per open app | ~2,500 req/s |
| Peak total                  | with 2x headroom           | ~8,500 req/s |

Sizing from that peak:

- **`api`:** at a conservative 300–400 list or write requests per second per
  vCPU, 20–30 one-vCPU instances cover the peak; the Kubernetes autoscaler
  allows 3–50.
- **Database:** most refreshes are unchanged and end as `304`s, but they still
  run their query. A primary with 8–16 vCPUs handles the writes; 2–3 read
  replicas carry the lists. Pooling keeps Postgres at a few hundred
  connections regardless of instance count.
- **`ai`:** bound by provider latency and per-user limits (10 chats per
  minute), not CPU; scale on in-flight requests.
- **`notifier`:** one instance with 8 lanes sends thousands of reminders a
  minute; add instances if the queue grows.
- **Gateways:** 2–3 behind the load balancer for availability; one nginx
  instance alone serves the peak.

## Next steps

These are not built yet; add them when telemetry says so.

1. **Push instead of polling.** Server-sent events or WebSockets for item
   changes would remove most refresh traffic; the 30-second poll becomes a
   fallback.
2. **Shared rate limits.** A Redis-backed limiter (for example
   `@fastify/rate-limit` with a Redis store) gives exact global limits
   across gateways and instances.
3. **Server-side cache.** Redis for hot reads such as `GET /me` and team
   membership, invalidated on write.
4. **Observability.** Prometheus metrics and OpenTelemetry traces per
   service, with alerts on p95 latency, error rate, queue depth and
   replication lag.
5. **Multi-region.** Read replicas per region with the primary in one; route
   users to the nearest region for reads.
