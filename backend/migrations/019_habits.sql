-- Flexible routines. Unlike a rigid recurring event, a habit says "this often,
-- roughly here" and the planner places the sessions into free time and moves
-- them when the day changes. Each placed session is a habit_block.
CREATE TABLE habits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  name varchar(60) NOT NULL,
  -- How many sessions to fit into each period.
  cadence smallint NOT NULL CHECK (cadence BETWEEN 1 AND 21),
  period text NOT NULL DEFAULT 'week' CHECK (period IN ('day', 'week')),
  duration_minutes smallint NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  -- Weekdays the session may land on (0 = Sunday), and the time-of-day window
  -- it must fit inside. NULL times mean "use my working hours".
  days smallint[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
  window_start time,
  window_end time,
  priority text NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high')),
  active boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(days) BETWEEN 1 AND 7),
  CHECK (window_start IS NULL OR window_end IS NULL OR window_end > window_start)
);
CREATE INDEX habits_user ON habits (user_id, position);

-- One placed session of a habit. Like a time_block, but backed by a habit
-- rather than a task, so it never needs a task item to exist.
CREATE TABLE habit_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  habit_id uuid NOT NULL REFERENCES habits ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'planner' CHECK (source IN ('manual', 'planner')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at AND end_at - start_at <= interval '24 hours')
);
CREATE INDEX habit_blocks_user ON habit_blocks (user_id, start_at);
CREATE INDEX habit_blocks_habit ON habit_blocks (habit_id);
