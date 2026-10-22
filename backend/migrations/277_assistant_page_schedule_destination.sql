ALTER TABLE assistant_schedule_destinations DROP CONSTRAINT assistant_schedule_destinations_source_kind_check;
ALTER TABLE assistant_schedule_destinations ADD CONSTRAINT assistant_schedule_destinations_source_kind_check
  CHECK(source_kind IN ('task','goal','routine','page_binding'));
