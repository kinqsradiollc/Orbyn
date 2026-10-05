-- Keep the flat leaf projection for existing search, link/file ACL and Study
-- triggers. Structured ownership is separately stored; legacy content writers
-- cannot overwrite it. No runtime creates format 2 until adapters adopt it.
ALTER TABLE docs ADD COLUMN content_format smallint NOT NULL DEFAULT 1;
ALTER TABLE docs ADD COLUMN content_nodes jsonb;
ALTER TABLE doc_versions ADD COLUMN content_format smallint NOT NULL DEFAULT 1;
ALTER TABLE doc_versions ADD COLUMN content_nodes jsonb;
ALTER TABLE docs ADD CONSTRAINT docs_content_format_check CHECK (
  (content_format=1 AND content_nodes IS NULL) OR
  (content_format=2 AND content_nodes IS NOT NULL AND jsonb_typeof(content_nodes)='array'));
ALTER TABLE doc_versions ADD CONSTRAINT doc_versions_content_format_check CHECK (
  (content_format=1 AND content_nodes IS NULL) OR
  (content_format=2 AND content_nodes IS NOT NULL AND jsonb_typeof(content_nodes)='array'));

CREATE FUNCTION doc_container_projection_step(nodes jsonb, depth integer, counted integer)
RETURNS TABLE (blocks jsonb, total integer) LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE node jsonb; item jsonb; nested record;
BEGIN
  IF depth>12 OR jsonb_typeof(nodes) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid document container depth or children' USING ERRCODE='23514';
  END IF;
  blocks:='[]'::jsonb; total:=counted;
  FOR node IN SELECT value FROM jsonb_array_elements(nodes) LOOP
    total:=total+1;
    IF total>2000 OR jsonb_typeof(node) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Invalid document container count or node' USING ERRCODE='23514';
    END IF;
    CASE node->>'kind'
      WHEN 'block' THEN
        IF jsonb_typeof(node->'block') IS DISTINCT FROM 'object' OR node->'block'->>'type' IS NULL THEN
          RAISE EXCEPTION 'Invalid document leaf' USING ERRCODE='23514';
        END IF;
        blocks:=blocks || jsonb_build_array(node->'block');
      WHEN 'quote' THEN
        SELECT * INTO nested FROM doc_container_projection_step(node->'children',depth+1,total);
        blocks:=blocks || nested.blocks; total:=nested.total;
      WHEN 'list' THEN
        IF jsonb_typeof(node->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(node->'items')=0 THEN
          RAISE EXCEPTION 'Invalid document list items' USING ERRCODE='23514';
        END IF;
        FOR item IN SELECT value FROM jsonb_array_elements(node->'items') LOOP
          total:=total+1;
          IF total>2000 OR jsonb_typeof(item) IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'Invalid document list item' USING ERRCODE='23514';
          END IF;
          SELECT * INTO nested FROM doc_container_projection_step(item->'children',depth+1,total);
          blocks:=blocks || nested.blocks; total:=nested.total;
        END LOOP;
      ELSE
        RAISE EXCEPTION 'Unknown document container kind' USING ERRCODE='23514';
    END CASE;
  END LOOP;
  RETURN NEXT;
END;
$$;

CREATE FUNCTION doc_container_projection(nodes jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE projected record;
BEGIN
  IF nodes IS NULL OR octet_length(nodes::text)>8000000 THEN
    RAISE EXCEPTION 'Invalid document container source size' USING ERRCODE='23514';
  END IF;
  SELECT * INTO projected FROM doc_container_projection_step(nodes,0,0);
  RETURN projected.blocks;
END;
$$;

CREATE FUNCTION guard_doc_structured_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.content_format=2 AND
     (NEW.content IS DISTINCT FROM OLD.content OR
      NEW.content_nodes IS DISTINCT FROM OLD.content_nodes OR
      NEW.content_format IS DISTINCT FROM OLD.content_format) AND
     current_setting('orbyn.doc_content_writer',true) IS DISTINCT FROM '2' THEN
    RAISE EXCEPTION 'This page requires the structured document writer' USING ERRCODE='23514';
  END IF;
  IF NEW.content_format=2 THEN
    IF TG_OP='INSERT' OR NEW.content_format IS DISTINCT FROM OLD.content_format OR
       NEW.content_nodes IS DISTINCT FROM OLD.content_nodes OR NEW.content IS DISTINCT FROM OLD.content THEN
      IF current_setting('orbyn.doc_content_writer',true) IS DISTINCT FROM '2' THEN
        RAISE EXCEPTION 'Structured document writes require explicit capability' USING ERRCODE='23514';
      END IF;
      IF NEW.content IS DISTINCT FROM doc_container_projection(NEW.content_nodes) THEN
        RAISE EXCEPTION 'Document leaf projection disagrees with structured content' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER docs_structured_content_guard BEFORE INSERT OR UPDATE OF content, content_format, content_nodes
ON docs FOR EACH ROW EXECUTE FUNCTION guard_doc_structured_content();
