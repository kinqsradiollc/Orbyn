ALTER TABLE assistant_page_bindings
  ADD COLUMN token_budget integer NOT NULL DEFAULT 20000
  CHECK (token_budget BETWEEN 1000 AND 20000);
