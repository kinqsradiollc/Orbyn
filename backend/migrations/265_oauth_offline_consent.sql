-- Only newly issued refresh credentials have provable offline consent.
-- Legacy refresh tokens require reauthorization; access tokens retain expiry.
ALTER TABLE agent_tokens ADD COLUMN offline_allowed boolean NOT NULL DEFAULT false;
DELETE FROM agent_tokens WHERE kind='refresh';
