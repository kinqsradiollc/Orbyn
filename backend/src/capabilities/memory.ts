import { z } from "zod";
import {
  memorySourceId,
  memoryFactInput,
  memorySourceInput,
  type MemorySourceInput,
} from "@orbyn/core";
import { keptOutFor } from "../lib/assistant-off.js";
import { pool } from "../db/pool.js";
import {
  Params,
  scopeFor,
  visibleDocs,
  visibleItems,
  visibleProjects,
} from "../lib/visibility.js";
import { refUrl } from "./refs.js";
import {
  CapabilityError,
  defineCapability,
  type CapabilityContext,
} from "./registry.js";
import {
  EDITS,
  clientRefInput,
  dbOf,
  destination,
  finishWrite,
  writeOutput,
} from "./write.js";
import {
  forgetMemory,
  listMemory,
  readMemory,
  rememberMemory,
} from "../modules/memory/service.js";
import { announceDocChange } from "../modules/docs/live.js";

// MCP requires an object root schema. Action-specific required fields are
// checked below because a discriminated union serializes as `oneOf`.
const input = z
  .object({
    action: z.enum(["list", "read", "remember", "forget"]),
    limit: z.number().int().min(1).max(100).optional(),
    topic: z.string().trim().min(1).max(120).optional(),
    facts: z.array(memoryFactInput).min(1).max(30).optional(),
    sources: z.array(memorySourceInput).max(10).default([]),
    client_ref: clientRefInput,
  })
  .strict();

function topicOf(topic: string | undefined): string {
  if (!topic)
    throw new CapabilityError(
      "INVALID",
      "Choose a Memory topic for this action.",
    );
  return topic;
}

function factsOf(facts: string[] | undefined): string[] {
  if (!facts?.length)
    throw new CapabilityError("INVALID", "Add at least one fact to remember.");
  return facts;
}

const factOutput = z.object({
  id: z.string(),
  text: z.string(),
  sources: z.array(z.string()),
});
const memoryShape = z.object({
  id: z.string(),
  topic: z.string(),
  facts: z.array(factOutput),
  version: z.number(),
  updated_at: z.string(),
});
const readOutput = z.object({
  status: z.literal("ok"),
  action: z.enum(["list", "read"]),
  memories: z.array(memoryShape),
  memory: z
    .object({
      ...memoryShape.shape,
      sources: z.array(
        z.object({
          type: memorySourceInput.shape.type,
          id: memorySourceId.nullable(),
          label: z.string(),
          quote: z.string().nullable(),
          learned_at: z.string(),
        }),
      ),
    })
    .nullable(),
});
// A union of read and write answers would serialize as a non-object root,
// which MCP rejects. The action/status fields identify which subset applies.
const output = z.object({
  status: z.enum(["ok", "done", "pending_review", "partly_pending"]),
  action: readOutput.shape.action.optional(),
  memories: readOutput.shape.memories.optional(),
  memory: readOutput.shape.memory.optional(),
  done: writeOutput.shape.done.optional(),
  pending: writeOutput.shape.pending.optional(),
  skipped: writeOutput.shape.skipped.optional(),
});

async function checkedSources(
  ctx: CapabilityContext,
  sources: MemorySourceInput[],
): Promise<MemorySourceInput[]> {
  const params = new Params();
  const scope = scopeFor(ctx.spaces, params);
  const checked: MemorySourceInput[] = [];
  for (const source of sources) {
    if (!source.id) {
      checked.push(source);
      continue;
    }
    let label: string | undefined;
    if (source.type === "doc") {
      const row = (
        await ctx.db.query<{ title: string }>(
          `SELECT d.title FROM docs d WHERE d.id = $${params.values.length + 1}
             AND d.kind <> 'memory' AND ${visibleDocs("d", scope)}`,
          [...params.values, source.id],
        )
      ).rows[0];
      label = row?.title;
    } else if (source.type === "task") {
      const row = (
        await ctx.db.query<{ title: string }>(
          `SELECT i.title FROM items i WHERE i.id = $${params.values.length + 1}
             AND ${visibleItems("i", scope)}`,
          [...params.values, source.id],
        )
      ).rows[0];
      label = row?.title;
    } else if (source.type === "project") {
      const row = (
        await ctx.db.query<{ name: string }>(
          `SELECT p.name FROM projects p WHERE p.id = $${params.values.length + 1}
             AND ${visibleProjects("p", scope)}`,
          [...params.values, source.id],
        )
      ).rows[0];
      label = row?.name;
    } else if (source.type === "person") {
      const row = (
        await ctx.db.query<{ name: string }>(
          `SELECT u.name FROM users u WHERE u.id = $1 AND (
             u.id = $2 OR EXISTS (
               SELECT 1 FROM team_members own
               JOIN team_members other ON other.team_id = own.team_id
                WHERE own.user_id = $2 AND other.user_id = u.id
                  AND own.team_id = ANY($3::uuid[])))`,
          [source.id, ctx.principal.user.id, ctx.spaces.teamIds ?? []],
        )
      ).rows[0];
      label = row?.name;
    } else if (source.type === "chat") {
      const exists = (
        await ctx.db.query<{ exists: string | null }>(
          "SELECT to_regclass('public.ai_chats')::text AS exists",
        )
      ).rows[0]?.exists;
      if (exists) {
        const row = (
          await ctx.db.query<{ id: string }>(
            "SELECT id FROM ai_chats WHERE id = $1 AND user_id = $2",
            [source.id, ctx.principal.user.id],
          )
        ).rows[0];
        if (row) label = "Assistant conversation";
      }
    }
    if (!label)
      throw new CapabilityError(
        "NOT_FOUND",
        "That memory source is gone or unreachable from this connection.",
        "Use a source returned by search, fetch or get_context.",
      );
    checked.push({ ...source, label });
  }
  return checked;
}

export const manageMemory = defineCapability({
  name: "manage_memory",
  title: "Manage Memory",
  description:
    "Lists and reads private Memory notes, saves facts with sources, or permanently forgets a topic. Personal only; sources from kept-out projects stay hidden.",
  input,
  output,
  annotations: EDITS,
  access: "suggest",
  toolset: "core",
  mode: "write",
  tier: "W2",
  async run(ctx, a) {
    if (!ctx.spaces.personal)
      throw new CapabilityError(
        "FORBIDDEN",
        "Memory is private to Personal; this connection needs Personal access.",
      );
    const db = dbOf(ctx);
    const keptOutProjects = [
      ...(await keptOutFor(db, ctx.principal.user.id)).projects,
    ];
    if (a.action === "list") {
      const memories = await listMemory(db, ctx.principal.user.id, {
        limit: a.limit ?? 50,
        keptOutProjects,
      });
      return {
        structured: {
          status: "ok" as const,
          action: "list" as const,
          memories,
          memory: null,
        },
        markdown: memories.length
          ? memories
              .map((entry) => `- ${entry.topic} (${entry.facts.length} facts)`)
              .join("\n")
          : "No Memory notes yet.",
        targets: memories.map((entry) => `doc:${entry.id}`),
      };
    }
    if (a.action === "read") {
      const topic = topicOf(a.topic);
      const memory = await readMemory(
        db,
        ctx.principal.user.id,
        topic,
        keptOutProjects,
      );
      if (!memory)
        throw new CapabilityError(
          "NOT_FOUND",
          "That Memory topic was not found.",
        );
      return {
        structured: {
          status: "ok" as const,
          action: "read" as const,
          memories: [],
          memory,
        },
        markdown: [
          `## ${memory.topic}`,
          ...memory.facts.map(
            (fact) =>
              `- ${fact.text}${fact.sources.length ? ` [src: ${fact.sources.join(" · ")}]` : ""}`,
          ),
        ].join("\n"),
        targets: [`doc:${memory.id}`],
      };
    }
    if (a.action === "remember") {
      const topic = topicOf(a.topic);
      const facts = factsOf(a.facts);
      const sources = await checkedSources(ctx, a.sources);
      const where = destination(ctx, null, "W2", [], {
        asks: "profile",
        why: "it changes your private Memory notes",
      });
      if (where === "review")
        return finishWrite(ctx, "Remembering in Memory", {
          done: [],
          review: [
            {
              type: "memory.remember",
              title: topic,
              team_id: null,
              topic,
              facts,
              sources,
            },
          ],
          reviewSummary: `Remember ${facts.length} fact${facts.length === 1 ? "" : "s"} in Memory: ${topic}`,
        });
      const result = await rememberMemory(
        db,
        ctx.principal.user.id,
        topic,
        facts,
        sources,
      );
      if (!result.changed)
        return {
          structured: {
            status: "ok" as const,
            action: "read" as const,
            memories: [],
            memory: await readMemory(
              db,
              ctx.principal.user.id,
              result.entry.id,
              keptOutProjects,
            ),
          },
          markdown: `Those facts are already in Memory under ${result.entry.topic}.`,
          targets: [`doc:${result.entry.id}`],
        };
      return finishWrite(ctx, "Memory updated", {
        done: [
          {
            id: `doc:${result.entry.id}`,
            title: result.entry.topic,
            url: refUrl({ type: "doc", id: result.entry.id }),
            version: result.entry.version,
            change: `${facts.length} fact${facts.length === 1 ? "" : "s"} remembered with source`,
          },
        ],
        teamId: null,
      });
    }

    const topic = topicOf(a.topic);
    const current = await readMemory(
      db,
      ctx.principal.user.id,
      topic,
      keptOutProjects,
    );
    if (!current)
      throw new CapabilityError(
        "NOT_FOUND",
        "That Memory topic was not found.",
      );
    const where = destination(ctx, null, "W3", [], {
      asks: "profile",
      why: "it permanently removes private Memory notes",
    });
    if (where === "review")
      return finishWrite(ctx, "Forgetting Memory", {
        done: [],
        review: [
          {
            type: "memory.forget",
            title: current.topic,
            team_id: null,
            topic: current.topic,
            docs: [{ id: current.id, version: current.version }],
          },
        ],
        reviewSummary: `Permanently forget Memory topic: ${current.topic}`,
      });
    const forgotten = await forgetMemory(db, ctx.principal.user.id, topic, {
      keptOutProjects,
    });
    if (!forgotten.docs.length)
      throw new CapabilityError(
        "NOT_FOUND",
        "That Memory topic was not found.",
      );
    return finishWrite(ctx, "Memory forgotten", {
      done: [
        {
          id: `doc:${current.id}`,
          title: current.topic,
          url: refUrl({ type: "doc", id: current.id }),
          version: null,
          change: "Permanently forgotten",
        },
      ],
      after: [
        () =>
          announceDocChange(pool, current.id, current.version + 1, "agent", {
            forgotten: true,
          }),
      ],
      teamId: null,
    });
  },
});
