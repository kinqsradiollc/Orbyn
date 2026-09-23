-- Request tracing for the admin console. Every service records the requests
-- it handles, batched off the request path: the route pattern (never the raw
-- URL, so no ids or query strings), status, time taken, which service and
-- copy answered, the request id the gateway gave it, and who asked. No IP
-- addresses. Raw rows are kept for seven days (the worker prunes them); the
-- daily roll-ups below keep the long view.
CREATE TABLE request_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  service     text NOT NULL,
  instance    text NOT NULL DEFAULT '',
  request_id  text NOT NULL DEFAULT '',
  method      text NOT NULL,
  route       text NOT NULL,
  status      smallint NOT NULL,
  duration_ms integer NOT NULL,
  user_id     uuid
);
CREATE INDEX request_log_at ON request_log (at DESC, id DESC);
CREATE INDEX request_log_service_at ON request_log (service, at DESC);
CREATE INDEX request_log_user_at ON request_log (user_id, at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX request_log_problems ON request_log (at DESC)
  WHERE status >= 500 OR duration_ms >= 1000;
CREATE INDEX request_log_request_id ON request_log (request_id) WHERE request_id <> '';

-- Traffic per service and route per day, added to as requests are flushed.
CREATE TABLE request_daily (
  day         date NOT NULL,
  service     text NOT NULL,
  route       text NOT NULL,
  method      text NOT NULL,
  requests    integer NOT NULL DEFAULT 0,
  errors      integer NOT NULL DEFAULT 0,
  total_ms    bigint NOT NULL DEFAULT 0,
  max_ms      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, service, route, method)
);

-- Who used Orbyn each day, and how: the basis for daily, weekly and monthly
-- active users and assistant usage. One row per person per day.
CREATE TABLE daily_activity (
  day          date NOT NULL,
  user_id      uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  requests     integer NOT NULL DEFAULT 0,
  writes       integer NOT NULL DEFAULT 0,
  ai_requests  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, user_id)
);
CREATE INDEX daily_activity_user ON daily_activity (user_id, day DESC);
