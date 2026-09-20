-- Round-robin booking pages: instead of everyone needing to be free, a slot is
-- offered when any host is free, and each booking goes to the fairest one.
ALTER TABLE booking_pages
  ADD COLUMN assignment text NOT NULL DEFAULT 'collective'
    CHECK (assignment IN ('collective', 'round_robin'));
-- Which host a round-robin booking went to (null for collective = all hosts).
ALTER TABLE bookings
  ADD COLUMN assigned_user_id uuid REFERENCES users ON DELETE SET NULL;
CREATE INDEX bookings_assigned ON bookings (assigned_user_id) WHERE assigned_user_id IS NOT NULL;
