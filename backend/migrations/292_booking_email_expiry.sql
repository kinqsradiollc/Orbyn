-- Verification links must not be emailed after the advertised booking hold.
ALTER TABLE booking_email_outbox ADD COLUMN expires_at timestamptz;
