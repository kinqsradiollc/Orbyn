-- Uptime history for the public status page. The status service records one
-- row per component per probe; rows older than 90 days are pruned.
CREATE TABLE status_checks (
  id bigserial PRIMARY KEY,
  service text NOT NULL,
  ok boolean NOT NULL,
  latency_ms integer,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX status_checks_service_time ON status_checks (service, checked_at DESC);

-- Liveness for services without an HTTP port, such as the reminder service.
CREATE TABLE service_heartbeats (
  service text PRIMARY KEY,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
