-- Index page-scoped Markdown references alongside inline object links. Metadata
-- remains source; this projection never evaluates YAML, Markdown or a URL.
CREATE OR REPLACE FUNCTION doc_reference_mask(source text) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  result text := source;
  chars text[] := regexp_split_to_array(source, '');
  at_pos integer := 1;
  scan_pos integer;
  close_pos integer;
  width integer;
  candidate_width integer;
  size integer := char_length(source);
  ch text;
BEGIN
  WHILE at_pos <= size LOOP
    ch := chars[at_pos];
    IF ch = E'\\' AND chars[at_pos + 1] ~ '[[:punct:]]' THEN
      result := overlay(result placing '  ' from at_pos for 2);
      at_pos := at_pos + 2;
      CONTINUE;
    END IF;
    IF ch = '$' THEN
      scan_pos := at_pos + 1;
      WHILE scan_pos <= size AND chars[scan_pos] NOT IN (E'\n', E'\r', '$') LOOP
        scan_pos := scan_pos + CASE WHEN chars[scan_pos] = E'\\' THEN 2 ELSE 1 END;
      END LOOP;
      IF scan_pos > at_pos + 1 AND chars[scan_pos] = '$' THEN
        result := overlay(result placing repeat(' ', scan_pos - at_pos + 1) from at_pos for scan_pos - at_pos + 1);
        at_pos := scan_pos + 1;
        CONTINUE;
      END IF;
    END IF;
    IF ch = '`' THEN
      width := 1;
      WHILE chars[at_pos + width] = '`' LOOP width := width + 1; END LOOP;
      scan_pos := at_pos + width;
      close_pos := 0;
      WHILE scan_pos <= size LOOP
        IF chars[scan_pos] <> '`' THEN scan_pos := scan_pos + 1; CONTINUE; END IF;
        candidate_width := 1;
        WHILE chars[scan_pos + candidate_width] = '`' LOOP candidate_width := candidate_width + 1; END LOOP;
        IF candidate_width = width THEN close_pos := scan_pos; EXIT; END IF;
        scan_pos := scan_pos + candidate_width;
      END LOOP;
      IF close_pos > 0 THEN
        result := overlay(result placing repeat(' ', close_pos + width - at_pos) from at_pos for close_pos + width - at_pos);
        at_pos := close_pos + width;
      ELSE at_pos := at_pos + width;
      END IF;
      CONTINUE;
    END IF;
    at_pos := at_pos + 1;
  END LOOP;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION doc_reference_targets(content jsonb)
RETURNS TABLE (block_id text, target_kind text, target_id text, source_context text)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  blocks jsonb := CASE WHEN jsonb_typeof(content) = 'array' THEN content ELSE '[]'::jsonb END;
  definitions jsonb := '{}'::jsonb;
  entry record;
  definition text[];
  occurrence text[];
  target text[];
  label text;
  href text;
  raw text;
  masked text;
  cursor_pos integer;
  match_pos integer;
BEGIN
  -- The first definition wins even if it is external or unsupported.
  FOR entry IN SELECT value FROM jsonb_array_elements(blocks) LOOP
    IF entry.value->>'type' <> 'paragraph' THEN CONTINUE; END IF;
    definition := regexp_match(entry.value->>'text', '^ {0,3}\[([^]\n]+)\]:[ \t]*(?:<([^<>\n]+)>|(\S+))(?:[ \t]+(?:"[^"\n]*"|''[^''\n]*''|\([^()\n]*\)))?[ \t]*$');
    IF definition IS NULL OR char_length(definition[1]) > 999 OR left(definition[1], 1) = '^' THEN CONTINUE; END IF;
    label := lower(upper(btrim(regexp_replace(definition[1], '\s+', ' ', 'g'))));
    IF label = '' OR definitions ? label THEN CONTINUE; END IF;
    definitions := definitions || jsonb_build_object(label, coalesce(definition[2], definition[3]));
  END LOOP;
  IF definitions = '{}'::jsonb THEN RETURN; END IF;
  FOR entry IN SELECT value, ordinality FROM jsonb_array_elements(blocks) WITH ORDINALITY LOOP
    IF entry.value->>'type' IN ('code', 'math', 'divider') THEN CONTINUE; END IF;
    raw := coalesce(entry.value->>'text', '');
    IF entry.value->>'type' = 'paragraph' AND regexp_match(raw, '^ {0,3}\[[^]\n]+\]:') IS NOT NULL THEN CONTINUE; END IF;
    IF strpos(raw, '[') = 0 THEN CONTINUE; END IF;
    masked := doc_reference_mask(raw);
    cursor_pos := 1;
    FOR occurrence IN SELECT regexp_matches(masked, '(\[([^]\n]+)\](?:\[([^]\n]*)\])?)', 'g') LOOP
      match_pos := cursor_pos + strpos(substr(masked, cursor_pos), occurrence[1]) - 1;
      cursor_pos := match_pos + char_length(occurrence[1]);
      IF char_length(occurrence[2]) > 999 OR char_length(coalesce(occurrence[3], '')) > 999 OR substr(masked, match_pos - 1, 1) = '!' OR substr(masked, cursor_pos, 1) = '(' OR left(occurrence[2], 1) = '^' OR occurrence[2] ~ '^src:[ \t]*\S' THEN CONTINUE; END IF;
      label := lower(upper(btrim(regexp_replace(coalesce(nullif(occurrence[3], ''), occurrence[2]), '\s+', ' ', 'g'))));
      href := definitions->>label;
      target := regexp_match(href, '^orbyn://(doc|task|project|event|person|date)/([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}|[0-9]{4}-[0-9]{2}-[0-9]{2})(?:#[A-Za-z0-9_-]{1,64})?$');
      IF target IS NULL THEN CONTINUE; END IF;
      IF target[1] = 'date' THEN
        IF target[2] !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN CONTINUE; END IF;
        BEGIN PERFORM target[2]::date;
        EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN CONTINUE;
        END;
      ELSIF target[2] !~ '^[0-9A-Fa-f-]{36}$' THEN CONTINUE;
      END IF;
      block_id := coalesce(nullif(entry.value->>'id', ''), '#' || (entry.ordinality - 1));
      target_kind := CASE WHEN target[1] = 'event' THEN 'task' ELSE target[1] END;
      target_id := lower(target[2]);
      source_context := left(raw, 400);
      RETURN NEXT;
    END LOOP;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION object_reference_links_from_doc() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- docs_object_links runs first and removes the prior index entries. This
  -- trigger augments that same index; it never changes page content/version.
  IF TG_OP = 'INSERT' OR NEW.content IS DISTINCT FROM OLD.content THEN
    INSERT INTO object_links (source_kind, source_id, source_block, target_kind, target_id, link_kind, context)
    SELECT DISTINCT 'doc', NEW.id, block_id, target_kind, target_id, 'link', source_context
    FROM doc_reference_targets(NEW.content)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER docs_object_links_references AFTER INSERT OR UPDATE OF content ON docs
FOR EACH ROW EXECUTE FUNCTION object_reference_links_from_doc();

-- Existing pages receive the identical projection without a fake edit/revision.
INSERT INTO object_links (source_kind, source_id, source_block, target_kind, target_id, link_kind, context)
SELECT DISTINCT 'doc', d.id, r.block_id, r.target_kind, r.target_id, 'link', r.source_context
FROM docs d CROSS JOIN LATERAL doc_reference_targets(d.content) r
ON CONFLICT DO NOTHING;
