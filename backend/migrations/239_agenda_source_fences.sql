-- Source writers hold a shared transaction lock for every affected reader.
-- Agenda validation/application holds the corresponding exclusive lock. This
-- fences insert phantoms as well as updates/deletes without storing an epoch,
-- changing isolation settings, or serializing unrelated owners.
CREATE FUNCTION fence_agenda_source_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  current_row jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE '{}'::jsonb END;
  owners uuid[] := ARRAY[(previous->>'user_id')::uuid, (current_row->>'user_id')::uuid];
  spaces uuid[] := ARRAY[(previous->>'team_id')::uuid, (current_row->>'team_id')::uuid];
  identities uuid[] := '{}';
  item_ids uuid[] := ARRAY[(previous->>'item_id')::uuid, (current_row->>'item_id')::uuid];
  subscriptions uuid[] := ARRAY[(previous->>'subscription_id')::uuid, (current_row->>'subscription_id')::uuid];
  affected uuid;
BEGIN
  IF TG_TABLE_NAME IN ('users','teams','items','docs','projects') THEN
    identities := ARRAY[(previous->>'id')::uuid, (current_row->>'id')::uuid];
  END IF;
  IF TG_TABLE_NAME = 'users' THEN
    owners := owners || identities;
    spaces := spaces || ARRAY(SELECT team_id FROM team_members WHERE user_id=ANY(identities));
  ELSIF TG_TABLE_NAME = 'teams' THEN
    spaces := spaces || identities;
  ELSIF TG_TABLE_NAME = 'items' THEN
    item_ids := item_ids || identities;
  ELSIF TG_TABLE_NAME = 'docs' THEN
    -- Deck and original-source changes also affect existing copied cards.
    owners := owners || ARRAY(SELECT user_id FROM study_cards
      WHERE doc_id=ANY(identities) OR source_doc_id=ANY(identities));
  ELSIF TG_TABLE_NAME = 'projects' THEN
    -- A project's policy/deadline also affects its contained facts, even if a
    -- historical row's container and team identities do not match.
    owners := owners || ARRAY(SELECT user_id FROM items WHERE project_id=ANY(identities)
      UNION SELECT user_id FROM docs WHERE project_id=ANY(identities));
    spaces := spaces || ARRAY(SELECT team_id FROM items WHERE project_id=ANY(identities)
      UNION SELECT team_id FROM docs WHERE project_id=ANY(identities));
  END IF;
  owners := owners || ARRAY(SELECT user_id FROM items WHERE id=ANY(item_ids)
    UNION SELECT user_id FROM time_blocks WHERE item_id=ANY(item_ids)
    UNION SELECT user_id FROM calendar_subscriptions WHERE id=ANY(subscriptions));
  spaces := spaces || ARRAY(SELECT team_id FROM items WHERE id=ANY(item_ids));
  -- Shared locks permit concurrent source writers. Stable ordering avoids
  -- reversing the order when one statement affects multiple readers.
  FOR affected IN
    SELECT owner_id FROM unnest(owners) owner_id WHERE owner_id IS NOT NULL
    UNION SELECT user_id FROM team_members WHERE team_id=ANY(spaces)
    ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('agenda-sources:' || affected::text, 0));
  END LOOP;
  RETURN NULL; -- AFTER trigger: never replaces the source row.
END;
$$;

DO $$
DECLARE source_table text;
BEGIN
  FOREACH source_table IN ARRAY ARRAY[
    'users','items','item_overrides','item_attendees','time_blocks',
    'planner_prefs','places','habits','habit_blocks',
    'calendar_subscriptions','external_events',
    'docs','study_cards','study_reviews','study_exams',
    'projects','teams','team_members'
  ] LOOP
    EXECUTE format('CREATE TRIGGER agenda_source_fence AFTER INSERT OR UPDATE OR DELETE ON %I
      FOR EACH ROW EXECUTE FUNCTION fence_agenda_source_write()', source_table);
  END LOOP;
END;
$$;
