-- A link's words are not a page's words (D3aF).
--
-- A picker link keeps, in its brackets, the title its target had when the
-- link was made: [Budget 2027](orbyn://doc/…). Pages keep those words, so
-- the people who can open the target still read its title, but the words
-- are not the page's own: someone who can read the page but not the thing
-- it links to must neither find the page by that title nor read it in a
-- search hit's snippet. So the words a page is found by, and its snippets
-- are cut from, leave every orbyn:// link out.
--
-- Pages that already have links are indexed again here. Only `search` is
-- written, so no version, edit, change note or activity is recorded.
--
-- Safe to run again.

CREATE OR REPLACE FUNCTION doc_words(content jsonb, kind text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(string_agg(
           regexp_replace(b->>'text',
                          '\[[^]\n]+\]\(orbyn://[^)[:space:]]+\)', ' ', 'g'),
           ' '), '')
    FROM jsonb_array_elements(coalesce(content, '[]'::jsonb)) AS b
   WHERE b->>'text' IS NOT NULL
     AND (kind IS NULL OR (b->>'type') = kind);
$$;

UPDATE docs d SET search =
      setweight(to_tsvector('english', coalesce(d.title, '') || ' ' ||
                                       orbyn_aliases(d.aliases)), 'A')
   || setweight(to_tsvector('english', doc_words(d.content, 'heading')), 'B')
   || setweight(to_tsvector('english', coalesce(
        (SELECT coalesce(string_agg(t.name, ' '), '')
           FROM doc_tags dt JOIN tags t ON t.id = dt.tag_id
          WHERE dt.doc_id = d.id) || ' ' ||
        coalesce((SELECT p.name FROM projects p WHERE p.id = d.project_id), ''),
        '')), 'C')
   || setweight(to_tsvector('english', doc_words(d.content, NULL)), 'D')
 WHERE d.content::text LIKE '%orbyn://%';
