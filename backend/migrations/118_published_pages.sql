-- Publishing a page or a folder to the web (SHR-05, SHR-06).
--
-- Off by default: nothing is on the web until someone publishes it, and
-- Unpublish deletes the row, so the address stops working at once. A team
-- can switch publishing off (teams.publishing_allowed); its published pages
-- then stop showing straight away, and come back if it is switched on again.
--
-- A published page or folder is read at /p/<slug> with no account. Hidden
-- from search engines unless the publisher says otherwise; an optional
-- password (stored as a hash); a description for the social card. A page's
-- own description (docs.web_description) is used on its card when it is
-- published or when it is in a published folder.
--
-- Safe to run again.

CREATE TABLE IF NOT EXISTS published_pages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id        uuid UNIQUE REFERENCES docs(id) ON DELETE CASCADE,
  folder_id     uuid UNIQUE REFERENCES folders(id) ON DELETE CASCADE,
  slug          text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  published_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Hidden from search engines (noindex) unless switched off.
  noindex       boolean NOT NULL DEFAULT true,
  description   text NOT NULL DEFAULT '' CHECK (length(description) <= 300),
  password_hash text,
  views         integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((doc_id IS NULL) <> (folder_id IS NULL))
);

ALTER TABLE teams ADD COLUMN IF NOT EXISTS publishing_allowed boolean
  NOT NULL DEFAULT true;

ALTER TABLE docs ADD COLUMN IF NOT EXISTS web_description text
  NOT NULL DEFAULT '';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'docs_web_description_length'
  ) THEN
    ALTER TABLE docs ADD CONSTRAINT docs_web_description_length
      CHECK (length(web_description) <= 300);
  END IF;
END;
$$;
