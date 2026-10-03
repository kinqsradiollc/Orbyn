ALTER TABLE assistant_page_runs ADD COLUMN reserved_tokens integer NOT NULL DEFAULT 0 CHECK(reserved_tokens>=0);
ALTER TABLE assistant_page_runs ADD COLUMN model_key text CHECK(model_key IS NULL OR length(model_key) BETWEEN 1 AND 100);
ALTER TABLE assistant_page_runs ADD COLUMN retry_after timestamptz;
ALTER TABLE assistant_page_runs ADD CONSTRAINT assistant_page_reserved_budget CHECK(reserved_tokens<=token_estimate AND token_estimate<=token_budget);
