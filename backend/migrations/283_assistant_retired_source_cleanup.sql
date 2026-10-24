-- Remove outgoing provenance when its owning conversation is explicitly retired.
-- Incoming references to erased entries survive and continue to deny access.
CREATE FUNCTION erase_retired_assistant_source_edges() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM assistant_delivery_entry_sources s USING assistant_delivery_bindings b
    WHERE s.binding_id=b.id AND b.destination_id=NEW.id;
  DELETE FROM assistant_turn_entry_sources WHERE chat_id=NEW.chat_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER assistant_retired_source_edges AFTER UPDATE OF retired_at ON assistant_conversation_streams
FOR EACH ROW WHEN (OLD.retired_at IS NULL AND NEW.retired_at IS NOT NULL)
EXECUTE FUNCTION erase_retired_assistant_source_edges();

DELETE FROM assistant_delivery_entry_sources s USING assistant_delivery_bindings b,assistant_conversation_streams c
WHERE s.binding_id=b.id AND b.destination_id=c.id AND c.retired_at IS NOT NULL;
DELETE FROM assistant_turn_entry_sources s USING assistant_conversation_streams c
WHERE s.chat_id=c.chat_id AND c.retired_at IS NOT NULL;
