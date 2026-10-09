-- Per-owner lane limits are independent of the workspace provider and the
-- existing night-window cap. Reservations survive worker restarts and count
-- estimated work, not provider-reported or billed usage.
CREATE TABLE assistant_lane_budget_settings (
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  lane text NOT NULL CHECK (lane IN ('background','overnight')),
  daily_token_limit integer NOT NULL DEFAULT 1000000 CHECK (daily_token_limit BETWEEN 1000 AND 10000000),
  hourly_start_limit integer NOT NULL DEFAULT 10 CHECK (hourly_start_limit BETWEEN 1 AND 100),
  per_run_token_limit integer NOT NULL DEFAULT 200000 CHECK (per_run_token_limit BETWEEN 1000 AND 200000),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,lane)
);

CREATE TABLE assistant_work_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  lane text NOT NULL CHECK (lane IN ('background','overnight')),
  job_id uuid REFERENCES ai_jobs ON DELETE CASCADE,
  page_run_id uuid REFERENCES assistant_page_runs ON DELETE CASCADE,
  agenda_run_id uuid REFERENCES agenda_summary_runs ON DELETE CASCADE,
  budget_day date NOT NULL,
  reserved_tokens integer NOT NULL CHECK (reserved_tokens BETWEEN 0 AND 200000),
  starting_estimate integer NOT NULL CHECK (starting_estimate >= 0),
  reported_tokens integer CHECK (reported_tokens >= 0),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','settled')),
  started_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CHECK ((state='active' AND reported_tokens IS NULL AND settled_at IS NULL)
    OR (state='settled' AND settled_at IS NOT NULL)),
  CHECK (num_nonnulls(job_id,page_run_id,agenda_run_id)=1)
);
CREATE UNIQUE INDEX assistant_work_one_active_reservation ON assistant_work_reservations(job_id)
  WHERE state='active';
CREATE UNIQUE INDEX assistant_page_one_active_reservation ON assistant_work_reservations(page_run_id)
  WHERE state='active';
CREATE UNIQUE INDEX assistant_agenda_one_active_reservation ON assistant_work_reservations(agenda_run_id)
  WHERE state='active';
CREATE INDEX assistant_work_daily_budget ON assistant_work_reservations(user_id,lane,budget_day);
CREATE INDEX assistant_work_hourly_starts ON assistant_work_reservations(user_id,lane,started_at);

CREATE FUNCTION assistant_lane_budget_day(owner_id uuid, at_time timestamptz) RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT (at_time AT TIME ZONE coalesce((SELECT timezone FROM planner_prefs WHERE user_id=owner_id),'UTC'))::date
$$;

-- The global runtime-slot lock serializes claims. The settings row is locked
-- again in the application before inserting a reservation.
CREATE FUNCTION assistant_lane_budget_available(owner_id uuid, runtime text, at_time timestamptz,
  minimum_tokens integer DEFAULT 1) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT
    coalesce((SELECT sum(coalesce(reported_tokens,reserved_tokens)) FROM assistant_work_reservations
      WHERE user_id=owner_id AND lane=runtime AND budget_day=assistant_lane_budget_day(owner_id,at_time)),0)
      + minimum_tokens <= coalesce((SELECT daily_token_limit FROM assistant_lane_budget_settings
        WHERE user_id=owner_id AND lane=runtime),1000000)
    AND (SELECT count(*) FROM assistant_work_reservations
      WHERE user_id=owner_id AND lane=runtime AND started_at>at_time-interval '1 hour')
      < coalesce((SELECT hourly_start_limit FROM assistant_lane_budget_settings
        WHERE user_id=owner_id AND lane=runtime),10)
$$;

-- A parked, failed, completed or requeued job no longer owns its active
-- estimate reservation. Unknown usage conservatively retains the reserve.
CREATE FUNCTION settle_assistant_job_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE measured integer;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM assistant_work_reservations WHERE job_id=NEW.id AND state='active') THEN
    RETURN NEW;
  END IF;
  measured := coalesce(
    (NEW.result->'assistant_run'->>'token_estimate')::integer,
    (NEW.run_state->'state'->>'token_estimate')::integer,
    (OLD.run_state->'state'->>'token_estimate')::integer);
  UPDATE assistant_work_reservations r SET state='settled',
    reported_tokens=CASE WHEN measured IS NULL THEN NULL
      ELSE greatest(0,measured-r.starting_estimate) END,
    settled_at=clock_timestamp()
  WHERE r.job_id=NEW.id AND r.state='active';
  RETURN NEW;
END
$$;
CREATE TRIGGER ai_jobs_settle_assistant_budget AFTER UPDATE OF state ON ai_jobs
  FOR EACH ROW WHEN (OLD.state='running' AND NEW.state<>'running')
  EXECUTE FUNCTION settle_assistant_job_reservation();

CREATE FUNCTION settle_assistant_page_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE assistant_work_reservations r SET state='settled',
    reported_tokens=greatest(0,NEW.token_estimate-r.starting_estimate),
    settled_at=clock_timestamp()
  WHERE r.page_run_id=NEW.id AND r.state='active';
  RETURN NEW;
END
$$;
CREATE TRIGGER assistant_page_settle_budget AFTER UPDATE OF state ON assistant_page_runs
  FOR EACH ROW WHEN (OLD.state='running' AND NEW.state<>'running')
  EXECUTE FUNCTION settle_assistant_page_reservation();

-- Agenda's provider adapter does not expose an attributable token total. Keep
-- its reserved estimate charged unless it failed before an inference attempt.
CREATE FUNCTION settle_assistant_agenda_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE assistant_work_reservations r SET state='settled',
    reported_tokens=CASE WHEN NEW.reason IN ('expired','authority_changed') THEN 0 ELSE NULL END,
    settled_at=clock_timestamp()
  WHERE r.agenda_run_id=NEW.id AND r.state='active';
  RETURN NEW;
END
$$;
CREATE TRIGGER assistant_agenda_settle_budget AFTER UPDATE OF state ON agenda_summary_runs
  FOR EACH ROW WHEN (OLD.state='running' AND NEW.state<>'running')
  EXECUTE FUNCTION settle_assistant_agenda_reservation();
