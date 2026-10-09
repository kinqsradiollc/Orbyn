-- Display-only executor identity. Older clients remain unknown until re-enrollment.
ALTER TABLE chatgpt_executor_challenges
  ADD COLUMN device_type text CHECK (device_type IN ('desktop', 'ios', 'android')),
  ADD COLUMN device_name text CHECK (length(device_name) BETWEEN 1 AND 60),
  ADD CONSTRAINT chatgpt_challenge_device_pair CHECK ((device_type IS NULL) = (device_name IS NULL));

ALTER TABLE chatgpt_executor_enrollments
  ADD COLUMN device_type text CHECK (device_type IN ('desktop', 'ios', 'android')),
  ADD COLUMN device_name text CHECK (length(device_name) BETWEEN 1 AND 60),
  ADD CONSTRAINT chatgpt_enrollment_device_pair CHECK ((device_type IS NULL) = (device_name IS NULL));
