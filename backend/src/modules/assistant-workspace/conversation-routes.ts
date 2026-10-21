import {
  assistantConversationHome,
  assistantConversationPreferences,
  assistantConversationMuteInput,
  assistantConversationLocation,
  fail,
} from "@orbyn/core";
import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import { readTransaction, transaction } from "../../db/pool.js";
import { idParam } from "../../lib/params.js";
import { firstParty } from "../proposals/service.js";
import {
  conversationDestination,
  openPersonalConversation,
} from "./conversation-storage.js";
import {
  acknowledgeConversation,
  conversationFeed,
  conversationEntryVisible,
} from "./conversation-feed.js";
import { assistantPrincipal } from "../agents/assistant.js";
import { conversationAttention } from "./conversation-attention.js";
import { answerConversationQuestion } from "./conversation-answers.js";
import { readWorkControls, updateWorkControls } from "./work-controls.js";
import { readSavedConversationHistory } from "./conversation-legacy.js";

function requireRollout() {
  if (env.ASSISTANT_CONVERSATION_ENABLED !== "true")
    fail(404, "Conversation not found.");
}

export async function assistantConversationRoutes(app: FastifyInstance) {
  app.get("/me/assistant/conversations/:id/history", async (request, reply) => {
    const user = await firstParty(request);
    reply.header("Cache-Control", "private, no-store");
    const id = idParam(request);
    return readTransaction(
      (db) => readSavedConversationHistory(db, user.id, id, request.query),
      { primary: true },
    );
  });
  app.get("/me/assistant/work-controls", async (request, reply) => {
    const user = await firstParty(request);
    reply.header("Cache-Control", "private, no-store");
    return readTransaction((db) => readWorkControls(db, user.id), {
      primary: true,
    });
  });
  app.patch("/me/assistant/work-controls", async (request, reply) => {
    const user = await firstParty(request);
    reply.header("Cache-Control", "private, no-store");
    return transaction((db) => updateWorkControls(db, user.id, request.body));
  });
  app.post(
    "/me/assistant/conversations/:id/entries/:entryId/answer",
    async (request, reply) => {
      const user = await firstParty(request);
      requireRollout();
      reply.header("Cache-Control", "private, no-store");
      const id = idParam(request),
        entryId = idParam(request, "entryId");
      return transaction((db) =>
        answerConversationQuestion(
          db,
          user,
          id,
          entryId,
          request.body,
          request.log,
        ),
      );
    },
  );
  app.get(
    "/me/assistant/conversations/:id/entries/:entryId",
    async (request, reply) => {
      const user = await firstParty(request);
      requireRollout();
      reply.header("Cache-Control", "private, no-store");
      const id = idParam(request),
        entryId = idParam(request, "entryId");
      return readTransaction(
        async (db) => {
          const destination = await conversationDestination(db, user.id, id);
          if (!destination) fail(404, "Conversation not found.");
          const entry = (
            await db.query<{ sequence: string }>(
              `SELECT e.sequence::text FROM assistant_conversation_entries e WHERE e.destination_id=$2 AND e.id=$3 AND ${conversationEntryVisible()}`,
              [user.id, id, entryId],
            )
          ).rows[0];
          if (!entry) fail(404, "Update is no longer available.");
          return assistantConversationLocation.parse({
            destination,
            entry_id: entryId,
            sequence: entry.sequence,
          });
        },
        { primary: true },
      );
    },
  );
  app.get("/me/assistant/conversation/for-chat/:id", async (request, reply) => {
    const user = await firstParty(request);
    requireRollout();
    reply.header("Cache-Control", "private, no-store");
    const chatId = idParam(request);
    return readTransaction(
      async (db) => {
        const stream = (
          await db.query<{ id: string }>(
            "SELECT id FROM assistant_conversation_streams WHERE owner_id=$1 AND chat_id=$2 AND retired_at IS NULL",
            [user.id, chatId],
          )
        ).rows[0];
        return stream ? conversationDestination(db, user.id, stream.id) : null;
      },
      { primary: true },
    );
  });
  const preferences = async (
    db: import("../../db/pool.js").Queryable,
    owner: string,
  ) => {
    const { availableAt, ...value } = await conversationAttention(
      db,
      owner,
      new Date(),
    );
    return assistantConversationPreferences.parse(value);
  };
  app.get("/me/assistant/conversation/preferences", async (request, reply) => {
    const user = await firstParty(request);
    requireRollout();
    reply.header("Cache-Control", "private, no-store");
    return readTransaction((db) => preferences(db, user.id), { primary: true });
  });
  app.patch(
    "/me/assistant/conversation/preferences",
    async (request, reply) => {
      const user = await firstParty(request);
      requireRollout();
      const { muted } = assistantConversationMuteInput.parse(request.body);
      reply.header("Cache-Control", "private, no-store");
      return transaction(async (db) => {
        await db.query(
          `INSERT INTO agent_settings(user_id,conversation_updates_muted) VALUES($1,$2)
        ON CONFLICT(user_id) DO UPDATE SET conversation_updates_muted=$2`,
          [user.id, muted],
        );
        return preferences(db, user.id);
      });
    },
  );
  // Reading capability/home never creates a destination or acknowledges content.
  app.get("/me/assistant/conversation", async (request, reply) => {
    const user = await firstParty(request);
    reply.header("Cache-Control", "private, no-store");
    if (env.ASSISTANT_CONVERSATION_ENABLED !== "true")
      return assistantConversationHome.parse({
        enabled: false,
        destination: null,
      });
    return readTransaction(
      async (db) => {
        const stream = (
          await db.query<{ id: string }>(
            "SELECT id FROM assistant_conversation_streams WHERE owner_id=$1 AND personal AND retired_at IS NULL",
            [user.id],
          )
        ).rows[0];
        return assistantConversationHome.parse({
          enabled: true,
          destination: stream
            ? await conversationDestination(db, user.id, stream.id)
            : null,
        });
      },
      { primary: true },
    );
  });
  // Explicit personal open only. Background workers never call this path.
  app.post("/me/assistant/conversation", async (request, reply) => {
    const user = await firstParty(request);
    requireRollout();
    reply.header("Cache-Control", "private, no-store");
    return transaction(async (db) => {
      await assistantPrincipal(user, { db });
      return openPersonalConversation(db, user.id);
    });
  });
  app.get("/me/assistant/conversations/:id", async (request, reply) => {
    const user = await firstParty(request);
    requireRollout();
    reply.header("Cache-Control", "private, no-store");
    const id = idParam(request);
    return readTransaction(
      (db) => conversationFeed(db, user.id, id, request.query),
      { primary: true },
    );
  });
  app.post("/me/assistant/conversations/:id/read", async (request, reply) => {
    const user = await firstParty(request);
    requireRollout();
    reply.header("Cache-Control", "private, no-store");
    const id = idParam(request);
    return transaction((db) =>
      acknowledgeConversation(db, user.id, id, request.body),
    );
  });
}
