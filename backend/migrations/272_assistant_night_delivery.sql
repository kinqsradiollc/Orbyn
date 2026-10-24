ALTER TABLE assistant_delivery_bindings ADD COLUMN night_id uuid REFERENCES assistant_nights ON DELETE SET NULL;
ALTER TABLE assistant_delivery_bindings ADD COLUMN not_before timestamptz;
CREATE INDEX assistant_delivery_night ON assistant_delivery_bindings(night_id,destination_id) WHERE night_id IS NOT NULL;
ALTER TABLE assistant_delivery_intents DROP CONSTRAINT assistant_delivery_intents_reason_check;
ALTER TABLE assistant_delivery_intents ADD CONSTRAINT assistant_delivery_intents_reason_check CHECK(reason IN (
  'destination_retired','permission_revoked','unknown_sources','unchanged','empty','muted','rollout_paused','account_disabled','night_summary'));
