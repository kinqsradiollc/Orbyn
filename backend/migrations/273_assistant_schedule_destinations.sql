-- Content-free schedule routing survives retries, pauses and destination retirement.
-- A missing destination is deliberate: a worker must not choose a later home.
CREATE TABLE assistant_schedule_destinations (
  owner_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  source_kind text NOT NULL CHECK(source_kind IN ('task','goal','routine')),
  source_id uuid NOT NULL,
  destination_id uuid REFERENCES assistant_conversation_streams ON DELETE SET NULL,
  origin_chat_id uuid,
  origin_turn_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,source_kind,source_id)
);
CREATE INDEX assistant_schedule_destination ON assistant_schedule_destinations(destination_id) WHERE destination_id IS NOT NULL;
