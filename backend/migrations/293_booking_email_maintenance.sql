CREATE INDEX booking_email_outbox_expiry ON booking_email_outbox(expires_at)
  WHERE state IN ('pending','preparing') AND expires_at IS NOT NULL;
CREATE INDEX booking_email_outbox_settled ON booking_email_outbox(settled_at)
  WHERE state IN ('sent','superseded','uncertain','failed');
CREATE INDEX booking_email_outbox_active ON booking_email_outbox(booking_id)
  WHERE state IN ('preparing','sending');
