-- Explicit owner-requested follow-up work keeps its receiving lane in the
-- immutable checkpoint, independent of which service accepts the proposal.
ALTER TABLE ai_chats DROP CONSTRAINT ai_chats_origin_check;
ALTER TABLE ai_chats ADD CONSTRAINT ai_chats_origin_check
  CHECK (origin IN ('person','idea','goal','routine','task','night','reminders','handoff'));
ALTER TABLE ai_jobs DROP CONSTRAINT ai_jobs_run_origin_check;
ALTER TABLE ai_jobs ADD CONSTRAINT ai_jobs_run_origin_check
  CHECK (run_origin IN ('person','idea','goal','routine','task','night','handoff'));

CREATE OR REPLACE FUNCTION assistant_runtime_lane(checkpoint jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE
  WHEN checkpoint->>'version'='6' THEN 'background'
  WHEN checkpoint->'request'->'automation'->>'kind'='handoff'
    THEN CASE WHEN checkpoint->'request'->'automation'->>'recipient_lane'='overnight'
      THEN 'overnight' ELSE 'background' END
  WHEN checkpoint->'request'->'automation'->>'kind'='night'
    OR nullif(checkpoint->'request'->'automation'->>'night_id','') IS NOT NULL THEN 'overnight'
  WHEN nullif(checkpoint->'request'->'automation','null'::jsonb) IS NOT NULL THEN 'background'
  ELSE 'interactive' END
$$;

-- Receiving Overnight work is eligible only inside the person's configured
-- local window. Jobs already running may finish under their leased deadline.
CREATE FUNCTION assistant_handoff_window_open(owner_id uuid, at_time timestamptz)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE setting jsonb;
DECLARE starts time;
DECLARE ends time;
DECLARE clock time;
BEGIN
 SELECT night_shift INTO setting FROM agent_settings WHERE user_id=owner_id;
 IF setting->>'enabled' IS DISTINCT FROM 'true'
   OR setting#>>'{kinds,handed}' IS DISTINCT FROM 'true'
   OR setting->>'timezone' IS NULL
   OR setting->>'start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
   OR setting->>'end' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
  RETURN false;
 END IF;
 starts:=(setting->>'start')::time;
 ends:=(setting->>'end')::time;
 clock:=(at_time AT TIME ZONE (setting->>'timezone'))::time;
 IF starts=ends THEN RETURN false; END IF;
 IF starts<ends THEN RETURN clock>=starts AND clock<ends; END IF;
 RETURN clock>=starts OR clock<ends;
EXCEPTION WHEN invalid_parameter_value OR datetime_field_overflow THEN
 RETURN false;
END;
$$;
