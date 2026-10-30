import {
  assistantSourceVisible,
  assistantTurnSourcesVisible,
} from "./assistant-source-visibility.js";
import { deliveryBindingVisible } from "./assistant-binding-visibility.js";

/** Reused at display, acknowledgement and targeted reply/context boundaries. */
export function conversationEntryVisible(entry = "e", owner = "$1") {
  return `(${entry}.sources_checked AND (${entry}.intent_id IS NULL OR EXISTS(
    SELECT 1 FROM assistant_delivery_intents delivery_intent JOIN assistant_delivery_bindings b ON b.id=delivery_intent.binding_id
    WHERE delivery_intent.id=${entry}.intent_id AND ${deliveryBindingVisible("b", owner)})) AND NOT EXISTS(
    SELECT 1 FROM assistant_conversation_entry_sources entry_source
    WHERE entry_source.entry_id=${entry}.id AND NOT ${assistantSourceVisible("entry_source.source_kind", "entry_source.source_id", owner, false)}) AND NOT EXISTS(
      SELECT 1 FROM assistant_conversation_streams source_stream WHERE source_stream.id=${entry}.destination_id
      AND NOT ${assistantTurnSourcesVisible("source_stream.chat_id", `${entry}.turn_id`, owner)}))`;
}
