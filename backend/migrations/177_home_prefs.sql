-- Home (W1): how the person's Home is laid out follows the account, with
-- the sidebar, shortcuts and view choices (account_prefs, migration 120):
-- { hubs: [{ id, title, cover_file_id, icon, auto, links: [...] }],
--   order: [...], hidden: [...], quote: { on, doc_id } }.
-- Empty until something is chosen; the apps start from the defaults.
--
-- Safe to run again.

ALTER TABLE account_prefs ADD COLUMN IF NOT EXISTS home jsonb;
