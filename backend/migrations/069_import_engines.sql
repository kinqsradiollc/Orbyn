-- How each page of an import was read, and what the converter can read.
--
-- Pages are read by the cheapest way that works: the file's own text (with
-- maths rebuilt from its fonts), Tesseract for scans and photos, and the
-- optional heavy OCR model. The page records which, with its equations and
-- how many of them were a guess, for the page's note and Admin → Storage.
ALTER TABLE import_pages
  ADD COLUMN engine    text,
  ADD COLUMN equations integer NOT NULL DEFAULT 0,
  ADD COLUMN checks    integer NOT NULL DEFAULT 0;

-- Which readers an import's pages used, kept on the import once its pages
-- are cleared (Admin → Storage's history).
ALTER TABLE imports ADD COLUMN engines text[] NOT NULL DEFAULT '{}';

-- The converter's report of what this server can read, refreshed with its
-- heartbeat: the apps say up front what will and won't import.
CREATE TABLE converter_state (
  id          integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- 'full' (the heavy OCR model), 'tesseract', or 'none'.
  scans       text NOT NULL DEFAULT 'none',
  formulas    boolean NOT NULL DEFAULT false,
  workers     integer NOT NULL DEFAULT 1,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
