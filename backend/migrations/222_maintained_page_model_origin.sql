ALTER TABLE assistant_page_runs ADD COLUMN model_origin jsonb NOT NULL DEFAULT '{"kind":"legacy_unverified"}'::jsonb
  CHECK(jsonb_typeof(model_origin)='object' AND model_origin->>'kind' IN ('hosted','chatgpt','chatgpt_selection_required','legacy_unverified') AND pg_column_size(model_origin)<=2048);
-- Earlier drafts did not capture model provenance. Never infer it for pending work.
UPDATE assistant_page_runs SET state='cancelled',lease_token=NULL,lease_expires_at=NULL,waiting_id=NULL,
  proposal=NULL,error_message='Review the model choice before running this page update.',updated_at=now()
WHERE state IN ('queued','running','waiting');
