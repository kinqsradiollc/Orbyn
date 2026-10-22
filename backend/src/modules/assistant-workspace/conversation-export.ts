import { assistantChatVisible } from "../../lib/assistant-visibility.js";
import type {
  AssistantConversationDestination,
  AssistantConversationEntry,
} from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import { conversationDestination } from "./conversation-storage.js";
import { conversationFeed } from "./conversation-feed.js";

export type ConversationExport = {
  destination: AssistantConversationDestination;
  title: string;
  entries: AssistantConversationEntry[];
};

/** Export owned personal history through current entry authority; never import execution identities. */
export async function* exportConversationPages(db: Queryable, owner: string) {
  const streams = (
    await db.query<{ id: string; title: string }>(
      `
    SELECT s.id,CASE WHEN ${assistantChatVisible("c", "$1")} THEN c.title ELSE 'Conversation' END AS title FROM assistant_conversation_streams s JOIN ai_chats c ON c.id=s.chat_id
    WHERE s.owner_id=$1 AND c.user_id=$1 AND s.retired_at IS NULL AND c.swept_at IS NULL
      AND (c.project_id IS NULL OR EXISTS(SELECT 1 FROM projects p WHERE p.id=c.project_id AND p.user_id=$1 AND p.team_id IS NULL))
      AND (c.scope_kind IS DISTINCT FROM 'task' OR EXISTS(SELECT 1 FROM items i WHERE i.id=c.scope_id AND i.user_id=$1 AND i.team_id IS NULL))
    ORDER BY s.created_at,s.id`,
      [owner],
    )
  ).rows;
  for (const stream of streams) {
    if (!(await conversationDestination(db, owner, stream.id))) continue;
    let after = "0",
      through: string | undefined;
    for (;;) {
      const page = await conversationFeed(
        db,
        owner,
        stream.id,
        { after, through, limit: 100 },
        true,
      );
      through ??= page.destination.last_sequence;
      yield { ...page, title: stream.title };
      if (!page.has_more) break;
      after = page.cursor;
    }
  }
}

export async function exportConversations(
  db: Queryable,
  owner: string,
): Promise<ConversationExport[]> {
  const conversations = new Map<string, ConversationExport>();
  for await (const page of exportConversationPages(db, owner)) {
    let conversation = conversations.get(page.destination.id);
    if (!conversation) {
      conversation = {
        destination: page.destination,
        title: page.title,
        entries: [],
      };
      conversations.set(page.destination.id, conversation);
    }
    conversation.entries.push(...page.entries);
  }
  return [...conversations.values()];
}
