-- Four-week alerts (40320 minutes) exceed smallint's 32767 maximum.
-- Keep the existing range/cardinality checks and widen existing data in place.
ALTER TABLE items ALTER COLUMN alerts TYPE integer[] USING alerts::integer[];
