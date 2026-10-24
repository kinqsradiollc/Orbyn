ALTER TABLE assistant_delivery_intents DROP CONSTRAINT assistant_delivery_intents_reason_check;
ALTER TABLE assistant_delivery_intents ADD CONSTRAINT assistant_delivery_intents_reason_check CHECK(reason IN (
  'destination_retired','permission_revoked','unknown_sources','unchanged','empty','muted','rollout_paused','account_disabled','night_summary','resolved'));
