-- Keep source identities after source deletion; only deleting the derived owner
-- erases the edge. A missing entry denies access instead of dropping authority.
CREATE TABLE assistant_turn_entry_sources (
  chat_id uuid NOT NULL REFERENCES ai_chats ON DELETE CASCADE,
  turn_id uuid NOT NULL,
  source_entry_id uuid NOT NULL,
  PRIMARY KEY(chat_id,turn_id,source_entry_id)
);
CREATE INDEX assistant_turn_entry_source ON assistant_turn_entry_sources(source_entry_id);

CREATE TABLE memory_entry_sources (
  doc_id uuid NOT NULL REFERENCES docs ON DELETE CASCADE,
  source_entry_id uuid NOT NULL,
  PRIMARY KEY(doc_id,source_entry_id)
);
CREATE INDEX memory_entry_source ON memory_entry_sources(source_entry_id);
