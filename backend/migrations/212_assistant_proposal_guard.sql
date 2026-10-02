-- Keep the source runtime and reviewed rule revision through the Review inbox.
-- Old proposals remain unbound; rule edits invalidate them rather than assume
-- that an unbound background proposal came from an interactive conversation.
ALTER TABLE proposals ADD COLUMN assistant_guard jsonb
  CHECK (assistant_guard IS NULL OR jsonb_typeof(assistant_guard) = 'object');
