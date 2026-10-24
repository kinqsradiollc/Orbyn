ALTER TABLE assistant_delivery_bindings ADD COLUMN attention_key text
  CHECK(attention_key IS NULL OR length(attention_key) BETWEEN 1 AND 180);
CREATE INDEX assistant_delivery_attention ON assistant_delivery_bindings(owner_id,destination_id,attention_key)
  WHERE attention_key IS NOT NULL;
ALTER TABLE agent_settings ADD COLUMN conversation_updates_muted boolean NOT NULL DEFAULT false;
CREATE TABLE assistant_job_source_revisions (
  job_id uuid NOT NULL,
  source_kind text NOT NULL,
  source_id uuid NOT NULL,
  observed_revision text,
  FOREIGN KEY(job_id,source_kind,source_id) REFERENCES assistant_job_sources(job_id,source_kind,source_id) ON DELETE CASCADE,
  PRIMARY KEY(job_id,source_kind,source_id)
);
ALTER TABLE assistant_delivery_sources ADD COLUMN observed_revision text;
