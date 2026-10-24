ALTER TABLE assistant_delivery_bindings ADD COLUMN grant_id uuid REFERENCES agent_grants ON DELETE SET NULL;

-- Every transition writer (normal completion, interrupted recovery, provider
-- failure, review and maintained pages) saves intent in its existing transaction.
-- Unbound legacy jobs are untouched. Content remains private until publication.
CREATE FUNCTION queue_assistant_job_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE binding assistant_delivery_bindings; event_name text; delivery_key text;
        question_id uuid; message text; next_payload jsonb;
BEGIN
  IF NEW.state NOT IN ('done','failed','waiting') THEN RETURN NEW; END IF;
  SELECT * INTO binding FROM assistant_delivery_bindings
    WHERE owner_id=NEW.user_id AND work_kind='job' AND work_id=NEW.id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NEW.state='waiting' THEN
    IF coalesce(NEW.run_state->'state'->'waiting'->>'id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN RETURN NEW; END IF;
    question_id := (NEW.run_state->'state'->'waiting'->>'id')::uuid;
    event_name := 'question'; delivery_key := 'question:' || question_id;
    message := NEW.run_state->'state'->'waiting'->>'question';
  ELSIF NEW.state='failed' THEN
    event_name := 'failure'; delivery_key := 'failure';
    -- Provider error text can contain internals. Use a content-free product message.
    message := 'This work could not finish. Open its activity to see the details.';
  ELSE
    event_name := 'result'; delivery_key := 'result';
    message := NEW.result->>'answer';
  END IF;
  UPDATE assistant_delivery_bindings SET sources_checked=NEW.sources_checked WHERE id=binding.id;
  INSERT INTO assistant_delivery_sources(binding_id,source_kind,source_id,observed_revision)
    SELECT binding.id,s.source_kind,s.source_id,r.observed_revision FROM assistant_job_sources s
      LEFT JOIN assistant_job_source_revisions r ON r.job_id=s.job_id AND r.source_kind=s.source_kind AND r.source_id=s.source_id
      WHERE s.job_id=NEW.id
    ON CONFLICT(binding_id,source_kind,source_id) DO UPDATE SET observed_revision=
      CASE WHEN assistant_delivery_sources.observed_revision=EXCLUDED.observed_revision
        THEN EXCLUDED.observed_revision ELSE NULL END;
  next_payload := jsonb_build_object('lane',binding.lane,'work',jsonb_build_object('kind','job','id',NEW.id),
    'event',event_name,'text',left(coalesce(message,''),12000),'completed_at',
    CASE WHEN NEW.state IN ('done','failed') THEN to_jsonb(clock_timestamp()) ELSE 'null'::jsonb END,
    'execution_chat_id',NEW.chat_id,'waiting_id',question_id,'sources','[]'::jsonb);
  INSERT INTO assistant_delivery_intents(binding_id,event_key,payload,completed_at)
    VALUES(binding.id,delivery_key,next_payload,CASE WHEN NEW.state IN ('done','failed') THEN clock_timestamp() END)
    ON CONFLICT(binding_id,event_key) DO NOTHING;
  RETURN NEW;
END
$$;
CREATE TRIGGER assistant_job_delivery AFTER UPDATE OF state ON ai_jobs
  FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state) EXECUTE FUNCTION queue_assistant_job_delivery();

CREATE FUNCTION queue_assistant_page_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE binding assistant_delivery_bindings; event_name text; delivery_key text; message text;
BEGIN
  IF NEW.state NOT IN ('done','failed','waiting') THEN RETURN NEW; END IF;
  SELECT * INTO binding FROM assistant_delivery_bindings
    WHERE owner_id=NEW.user_id AND work_kind='page_run' AND work_id=NEW.id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NEW.state='waiting' THEN
    event_name := 'question'; delivery_key := 'question:' || NEW.waiting_id;
    message := 'A page update is ready for your review.';
  ELSIF NEW.state='failed' THEN
    event_name := 'failure'; delivery_key := 'failure';
    message := 'This page update could not finish. Open its activity to see the details.';
  ELSE
    event_name := 'result'; delivery_key := 'result';
    message := 'Your page update is ready.';
  END IF;
  INSERT INTO assistant_delivery_intents(binding_id,event_key,payload,completed_at)
    VALUES(binding.id,delivery_key,jsonb_build_object('lane',binding.lane,
      'work',jsonb_build_object('kind','page_run','id',NEW.id),'event',event_name,'text',message,
      'completed_at',CASE WHEN NEW.state IN ('done','failed') THEN to_jsonb(clock_timestamp()) ELSE 'null'::jsonb END,
      'execution_chat_id',NULL,'waiting_id',NEW.waiting_id,'sources','[]'::jsonb),
      CASE WHEN NEW.state IN ('done','failed') THEN clock_timestamp() END)
    ON CONFLICT(binding_id,event_key) DO NOTHING;
  RETURN NEW;
END
$$;
CREATE TRIGGER assistant_page_delivery AFTER UPDATE OF state ON assistant_page_runs
  FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state) EXECUTE FUNCTION queue_assistant_page_delivery();
