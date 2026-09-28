import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  chatTitle,
  chatTraceEntry,
  docInput,
  fail,
  parseDoc,
  projectChatInput,
  savedChatTurn,
  updateAiChatInput,
  type AiChat,
  type AiChatSummary,
  type ChatScope,
  type ChatTraceEntry,
  type ChatTurn,
  type ProjectChatInput,
  type SavedChatTurn,
} from "@orbyn/core";
import { pool, reader, transaction, type Queryable } from "../../db/pool.js";
import { authenticate, type UserRow } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { visibleItems, visibleProjects } from "../../lib/visibility.js";
import { createDoc } from "../docs/service.js";

const PER_PROJECT = 50;
const MAX_TRACE = 4_000;
const projectSeen = visibleProjects("p");
// Assistant history is itself AI data: a project kept out of AI, and the
// chats scoped to it, must stay invisible here as well.
const PROJECT_VISIBLE =
  "(c.project_id IS NULL OR (" + projectSeen + " AND NOT p.assistant_off))";
const SUMMARY = `c.id, c.project_id, p.name AS project_name, c.title, c.pinned,
  jsonb_array_length(c.turns)::int AS turn_count, c.created_at, c.last_used_at,
  c.summary_doc_id, c.swept_at,
  CASE WHEN c.scope_kind IS NULL THEN NULL
       ELSE jsonb_build_object('kind', c.scope_kind, 'id', c.scope_id) END AS scope`;

type ChatRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  project_name: string | null;
  title: string;
  pinned: boolean;
  turns: unknown;
  trace: unknown;
  summary_doc_id: string | null;
  swept_at: Date | null;
  last_used_at: Date;
  created_at: Date;
  scope_kind: "project" | "task" | null;
  scope_id: string | null;
};

type SummaryRow = Omit<
  ChatRow,
  "turns" | "trace" | "user_id" | "scope_kind" | "scope_id"
> & {
  turn_count: number;
  scope: ChatScope | null;
};

const listQuery = z.object({
  search: z.string().trim().max(200).default(""),
  project_id: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const dateText = (value: Date | null) => value?.toISOString() ?? null;

function turnsOf(value: unknown): SavedChatTurn[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((turn) => {
    const parsed = savedChatTurn.safeParse(turn);
    return parsed.success ? [parsed.data] : [];
  });
}

function traceOf(value: unknown): ChatTraceEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const parsed = chatTraceEntry.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

function scopeOf(
  row: Pick<ChatRow, "scope_kind" | "scope_id">,
): ChatScope | null {
  return row.scope_kind && row.scope_id
    ? { kind: row.scope_kind, id: row.scope_id }
    : null;
}

function summaryOf(row: SummaryRow): AiChatSummary {
  return {
    id: row.id,
    project_id: row.project_id,
    project_name: row.project_name,
    title: row.title,
    pinned: row.pinned,
    turn_count: Number(row.turn_count),
    created_at: row.created_at.toISOString(),
    last_used_at: row.last_used_at.toISOString(),
    summary_doc_id: row.summary_doc_id,
    swept_at: dateText(row.swept_at),
    scope: row.scope,
  };
}

async function visibleProject(db: Queryable, userId: string, id: string) {
  const row = (
    await db.query<{ assistant_off: boolean }>(
      `SELECT p.assistant_off FROM projects p WHERE p.id = $2 AND ${projectSeen}`,
      [userId, id],
    )
  ).rows[0];
  if (!row) fail(404, "Project not found");
  return row;
}

async function projectForScope(
  db: Queryable,
  user: UserRow,
  scope: ChatScope | null,
): Promise<string | null> {
  if (scope?.kind === "project") return scope.id;
  if (scope?.kind !== "task") return null;
  const row = (
    await db.query<{ project_id: string | null }>(
      `SELECT i.project_id FROM items i
        WHERE i.id = $2 AND ${visibleItems("i")}`,
      [user.id, scope.id],
    )
  ).rows[0];
  if (!row) fail(404, "Task not found");
  return row.project_id;
}

/** Load a chat's scope before the assistant checks its current visibility. */
export async function resolveChatScope(
  db: Queryable,
  userId: string,
  chatId: string,
  requested: ChatScope | null,
): Promise<ChatScope | null> {
  const row = (
    await db.query<{
      scope_kind: "project" | "task" | null;
      scope_id: string | null;
      swept_at: Date | null;
    }>(
      `SELECT scope_kind, scope_id, swept_at FROM ai_chats
        WHERE id = $1 AND user_id = $2`,
      [chatId, userId],
    )
  ).rows[0];
  if (!row) return requested;
  if (row.swept_at) fail(409, "This chat has been saved as a summary note.");
  const stored = scopeOf(row);
  if (
    requested &&
    stored &&
    (requested.kind !== stored.kind || requested.id !== stored.id)
  )
    fail(409, "Open this chat in its saved scope to continue it.");
  return requested ?? stored;
}

/** Persist the user turn and return the server-owned history for this chat. */
export async function beginChatTurn(
  user: UserRow,
  input: {
    chatId: string;
    turnId: string;
    message: string;
    scope: ChatScope | null;
    legacyHistory: ChatTurn[];
  },
): Promise<ChatTurn[]> {
  return transaction(async (db) => {
    const projectId = await projectForScope(db, user, input.scope);
    if (projectId) {
      const project = await visibleProject(db, user.id, projectId);
      if (project.assistant_off)
        fail(422, "This project is kept out of the assistant.");
    }
    const row = (
      await db.query<ChatRow>(
        `SELECT c.*, p.name AS project_name FROM ai_chats c
          LEFT JOIN projects p ON p.id = c.project_id
         WHERE c.id = $1 AND c.user_id = $2 FOR UPDATE OF c`,
        [input.chatId, user.id],
      )
    ).rows[0];
    if (row?.swept_at) fail(409, "This chat has been saved as a summary note.");

    const storedScope = row ? scopeOf(row) : input.scope;
    if (
      row &&
      input.scope &&
      storedScope &&
      (input.scope.kind !== storedScope.kind ||
        input.scope.id !== storedScope.id)
    )
      fail(409, "Open this chat in its saved scope to continue it.");
    if (row && row.project_id !== projectId)
      fail(409, "This chat belongs to a different project.");

    const saved: SavedChatTurn[] = row
      ? turnsOf(row.turns)
      : input.legacyHistory.slice(-12).map((turn) => ({
          role: turn.role,
          text: turn.content,
        }));
    // A retried send (same turn id) reuses the turn already saved rather
    // than adding the message twice.
    const retried = row
      ? saved.findIndex(
          (turn) => turn.role === "user" && turn.turn_id === input.turnId,
        )
      : -1;
    const previous = retried >= 0 ? saved.slice(0, retried) : saved;
    const history = previous.slice(-12).map((turn) => ({
      role: turn.role,
      content: turn.history_text ?? turn.text,
    })) as ChatTurn[];
    if (retried >= 0) return history;
    const userTurn = {
      role: "user" as const,
      text: input.message.slice(0, 12_000),
      turn_id: input.turnId,
    };
    const turns = [...previous, userTurn].slice(-200);
    const title = row?.title ?? chatTitle([userTurn]);
    const scopeKind = storedScope?.kind ?? null;
    const scopeId = storedScope?.id ?? null;
    if (!row) {
      // Another person's chat id is simply not found (never a clash).
      const made = await db.query(
        `INSERT INTO ai_chats
          (id, user_id, project_id, title, turns, last_used_at, scope_kind, scope_id)
         VALUES ($1, $2, $3, $4, $5::jsonb, now(), $6, $7)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [
          input.chatId,
          user.id,
          projectId,
          title,
          JSON.stringify(turns),
          scopeKind,
          scopeId,
        ],
      );
      if (!made.rowCount) fail(404, "Chat not found");
    } else {
      await db.query(
        `UPDATE ai_chats SET turns = $3::jsonb,
           title = CASE WHEN title = 'Chat' THEN $4 ELSE title END,
           last_used_at = now(), scope_kind = $5, scope_id = $6
         WHERE id = $1 AND user_id = $2`,
        [
          input.chatId,
          user.id,
          JSON.stringify(turns),
          chatTitle(turns),
          scopeKind,
          scopeId,
        ],
      );
    }
    return history;
  });
}

/** Save the completed answer and its safe, content-free trace. */
export async function finishChatTurn(
  userId: string,
  chatId: string,
  turnId: string,
  result: {
    summary: string;
    proposalId?: string;
    outcome?: SavedChatTurn["outcome"];
    sources?: SavedChatTurn["sources"];
    trace: ChatTraceEntry[];
    failed?: boolean;
  },
) {
  await transaction(async (db) => {
    const row = (
      await db.query<{
        turns: unknown;
        trace: unknown;
        project_id: string | null;
      }>(
        `SELECT turns, trace, project_id FROM ai_chats WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [chatId, userId],
      )
    ).rows[0];
    if (!row) return;
    const turns = turnsOf(row.turns);
    if (
      turns.some((turn) => turn.role === "assistant" && turn.turn_id === turnId)
    )
      return;
    const assistantTurn: SavedChatTurn = {
      role: "assistant",
      text: result.summary.slice(0, 12_000),
      history_text: result.summary.slice(0, 12_000),
      turn_id: turnId,
      ...(result.proposalId ? { proposal_id: result.proposalId } : {}),
      outcome: result.failed
        ? "info"
        : (result.outcome ?? (result.proposalId ? "pending" : "info")),
      ...(result.sources?.length
        ? { sources: result.sources.slice(0, 20) }
        : {}),
    };
    // Repeated polling or a retried completion cannot duplicate the answer.
    const withoutTurn = turns.filter(
      (turn) => !(turn.role === "assistant" && turn.turn_id === turnId),
    );
    const nextTurns = [...withoutTurn, assistantTurn].slice(-200);
    const trace = [...traceOf(row.trace), ...result.trace.slice(-MAX_TRACE)]
      .filter(
        (entry, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.turn_id === entry.turn_id &&
              candidate.at === entry.at &&
              candidate.step === entry.step &&
              candidate.kind === entry.kind &&
              candidate.label === entry.label &&
              candidate.tool === entry.tool,
          ) === index,
      )
      .slice(-MAX_TRACE);
    await db.query(
      `UPDATE ai_chats SET turns = $3::jsonb, trace = $4::jsonb,
         last_used_at = now() WHERE id = $1 AND user_id = $2`,
      [chatId, userId, JSON.stringify(nextTurns), JSON.stringify(trace)],
    );
    if (!result.failed) {
      const memoryTurns = nextTurns
        .filter((turn) => turn.turn_id === turnId)
        .map((turn) => ({
          role: turn.role,
          content: turn.history_text ?? turn.text,
        }));
      await db.query(
        `INSERT INTO memory_queue (chat_id, user_id, turns, source_project_id)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [chatId, userId, JSON.stringify(memoryTurns), row.project_id],
      );
    }
  });
}

/** Persist one safe, content-free trace event as the assistant makes progress. */
export async function appendChatTrace(
  userId: string,
  chatId: string,
  entry: ChatTraceEntry,
) {
  await transaction(async (db) => {
    const row = (
      await db.query<{ trace: unknown }>(
        "SELECT trace FROM ai_chats WHERE id = $1 AND user_id = $2 FOR UPDATE",
        [chatId, userId],
      )
    ).rows[0];
    if (!row) return;
    const trace = [...traceOf(row.trace), chatTraceEntry.parse(entry)].slice(
      -MAX_TRACE,
    );
    await db.query(
      "UPDATE ai_chats SET trace = $3::jsonb, last_used_at = now() WHERE id = $1 AND user_id = $2",
      [chatId, userId, JSON.stringify(trace)],
    );
  });
}

export async function listAiChats(
  db: Queryable,
  userId: string,
  options: z.output<typeof listQuery>,
): Promise<AiChatSummary[]> {
  if (options.project_id) await visibleProject(db, userId, options.project_id);
  const rows = (
    await db.query<SummaryRow>(
      `SELECT ${SUMMARY} FROM ai_chats c
        LEFT JOIN projects p ON p.id = c.project_id
       WHERE c.user_id = $1 AND ${PROJECT_VISIBLE}
         AND ($2::uuid IS NULL OR c.project_id = $2)
         AND ($3 = '' OR c.title ILIKE '%' || $3 || '%'
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(c.turns) t
                       WHERE t->>'text' ILIKE '%' || $3 || '%'))
       ORDER BY c.pinned DESC, c.last_used_at DESC, c.id
       LIMIT $4`,
      [userId, options.project_id ?? null, options.search, options.limit],
    )
  ).rows;
  return rows.map(summaryOf);
}

export async function readAiChat(
  db: Queryable,
  userId: string,
  id: string,
): Promise<AiChat> {
  const row = (
    await db.query<ChatRow>(
      `SELECT c.*, p.name AS project_name FROM ai_chats c
        LEFT JOIN projects p ON p.id = c.project_id
       WHERE c.id = $2 AND c.user_id = $1 AND ${PROJECT_VISIBLE}`,
      [userId, id],
    )
  ).rows[0];
  if (!row) fail(404, "Chat not found");
  return {
    id: row.id,
    project_id: row.project_id,
    project_name: row.project_name,
    title: row.title,
    pinned: row.pinned,
    turn_count: turnsOf(row.turns).length,
    created_at: row.created_at.toISOString(),
    last_used_at: row.last_used_at.toISOString(),
    summary_doc_id: row.summary_doc_id,
    swept_at: dateText(row.swept_at),
    scope: scopeOf(row),
    turns: row.swept_at ? [] : turnsOf(row.turns),
    trace: row.swept_at ? [] : traceOf(row.trace),
  };
}

async function updateChat(
  userId: string,
  id: string,
  patch: z.output<typeof updateAiChatInput>,
) {
  await transaction(async (db) => {
    const row = (
      await db.query<{ turns: unknown; project_id: string | null }>(
        `SELECT turns, project_id FROM ai_chats WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [id, userId],
      )
    ).rows[0];
    if (!row) fail(404, "Chat not found");
    // A chat in a project the person can no longer see (or that is kept
    // out of the assistant) is not theirs to change here.
    if (row.project_id) {
      const project = await db.query(
        `SELECT 1 FROM projects p WHERE p.id = $2 AND ${projectSeen} AND NOT p.assistant_off`,
        [userId, row.project_id],
      );
      if (!project.rowCount) fail(404, "Chat not found");
    }
    let turns = turnsOf(row.turns);
    if (patch.turn_id && patch.outcome) {
      let changed = false;
      turns = turns.map((turn) => {
        if (turn.role !== "assistant" || turn.turn_id !== patch.turn_id)
          return turn;
        changed = true;
        return {
          ...turn,
          outcome: patch.outcome,
          history_text:
            turn.text +
            (patch.outcome === "applied"
              ? "\n\n(Proposed changes were approved and saved.)"
              : patch.outcome === "discarded"
                ? "\n\n(Proposed changes were discarded; nothing changed.)"
                : ""),
        };
      });
      if (!changed) fail(404, "Chat turn not found");
    }
    // Renaming, pinning or recording an outcome is not using the chat, so
    // it leaves last_used_at (the seven-day compaction clock) alone.
    const assignments: string[] = [];
    const values: unknown[] = [id, userId];
    if (patch.title !== undefined) {
      values.push(patch.title);
      assignments.push(`title = $${values.length}`);
    }
    if (patch.pinned !== undefined) {
      values.push(patch.pinned);
      assignments.push(`pinned = $${values.length}`);
    }
    if (patch.turn_id) {
      values.push(JSON.stringify(turns));
      assignments.push(`turns = $${values.length}::jsonb`);
    }
    if (!assignments.length) return;
    await db.query(
      `UPDATE ai_chats SET ${assignments.join(", ")} WHERE id = $1 AND user_id = $2`,
      values,
    );
  });
}

async function saveChatAsNote(user: UserRow, id: string) {
  return transaction(async (db) => {
    const row = (
      await db.query<{
        title: string;
        turns: unknown;
        summary_doc_id: string | null;
        project_id: string | null;
      }>(
        `SELECT title, turns, summary_doc_id, project_id FROM ai_chats
          WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [id, user.id],
      )
    ).rows[0];
    if (!row) fail(404, "Chat not found");
    if (row.project_id) {
      const project = await visibleProject(db, user.id, row.project_id);
      if (project.assistant_off)
        fail(422, "This project is kept out of the assistant.");
    }
    if (row.summary_doc_id) {
      const existing = (
        await db.query<{ id: string; title: string }>(
          `SELECT id, title FROM docs WHERE id = $1 AND user_id = $2
            AND team_id IS NULL AND kind = 'agent' AND deleted_at IS NULL`,
          [row.summary_doc_id, user.id],
        )
      ).rows[0];
      if (existing) return existing;
    }
    const turns = turnsOf(row.turns);
    if (!turns.length) fail(409, "This chat has no turns to save.");
    const markdown = turns
      .map(
        (turn) =>
          `## ${turn.role === "user" ? "You" : "Orbyn"}\n\n${turn.text}`,
      )
      .join("\n\n");
    const doc = await createDoc(
      db,
      user,
      docInput.parse({
        title: row.title.slice(0, 120),
        kind: "agent",
        content: parseDoc(markdown),
      }),
    );
    await db.query(
      `UPDATE ai_chats SET summary_doc_id = $3 WHERE id = $1 AND user_id = $2`,
      [id, user.id, doc.id],
    );
    return { id: doc.id, title: doc.title };
  });
}

export async function projectChatRoutes(app: FastifyInstance) {
  app.get("/ai/chats", async (r): Promise<AiChatSummary[]> => {
    const u = await authenticate(r);
    return listAiChats(reader(r.headers), u.id, listQuery.parse(r.query));
  });

  app.get("/ai/projects/:id/chats", async (r): Promise<AiChatSummary[]> => {
    const u = await authenticate(r);
    const id = idParam(r);
    return listAiChats(reader(r.headers), u.id, {
      search: "",
      project_id: id,
      limit: PER_PROJECT,
    });
  });

  app.get("/ai/chats/:id", async (r): Promise<AiChat> => {
    const u = await authenticate(r);
    return readAiChat(reader(r.headers), u.id, idParam(r));
  });

  // Metadata and proposal outcome updates for the new clients.
  app.patch("/ai/chats/:id", async (r): Promise<AiChatSummary> => {
    const u = await authenticate(r);
    const id = idParam(r);
    await updateChat(u.id, id, updateAiChatInput.parse(r.body));
    return readAiChat(reader({ "x-orbyn-consistency": "primary" }), u.id, id);
  });

  // Keep accepting the prior project-chat save shape while older clients roll forward.
  app.put("/ai/chats/:id", async (r): Promise<AiChatSummary> => {
    const u = await authenticate(r);
    const id = idParam(r);
    const input: ProjectChatInput = projectChatInput.parse(r.body);
    await transaction(async (db) => {
      const project = await visibleProject(db, u.id, input.project_id);
      if (project.assistant_off)
        fail(422, "This project is kept out of the assistant.");
      const existing = (
        await db.query<{
          user_id: string;
          project_id: string | null;
          swept_at: Date | null;
        }>(
          "SELECT user_id, project_id, swept_at FROM ai_chats WHERE id = $1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (existing) {
        if (
          existing.user_id !== u.id ||
          existing.project_id !== input.project_id
        )
          fail(404, "Chat not found");
        if (existing.swept_at)
          fail(409, "This chat has been saved as a summary note.");
        await db.query(
          `UPDATE ai_chats SET turns = $3::jsonb,
             title = coalesce($4, title), last_used_at = now()
           WHERE id = $1 AND user_id = $2`,
          [id, u.id, JSON.stringify(input.turns), input.title ?? null],
        );
        return;
      }
      // Older clients kept at most PER_PROJECT chats themselves; nothing is
      // pruned here, so newer chats and compacted ones are never removed.
      const made = await db.query(
        `INSERT INTO ai_chats (id, user_id, project_id, title, turns,
            last_used_at, scope_kind, scope_id)
           VALUES ($1, $2, $3, $4, $5::jsonb, now(), 'project', $3)
           ON CONFLICT (id) DO NOTHING RETURNING id`,
        [
          id,
          u.id,
          input.project_id,
          input.title ?? chatTitle(input.turns),
          JSON.stringify(input.turns),
        ],
      );
      if (!made.rowCount) fail(404, "Chat not found");
    });
    return readAiChat(reader({ "x-orbyn-consistency": "primary" }), u.id, id);
  });

  app.post("/ai/chats/:id/save-note", async (r) => {
    const u = await authenticate(r);
    return saveChatAsNote(u, idParam(r));
  });

  app.delete("/ai/chats/:id", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    await transaction(async (db) => {
      const gone = await db.query(
        "DELETE FROM ai_chats WHERE id = $1 AND user_id = $2",
        [id, u.id],
      );
      if (!gone.rowCount) fail(404, "Chat not found");
      await db.query(
        "DELETE FROM memory_queue WHERE user_id = $1 AND chat_id = $2",
        [u.id, id],
      );
    });
    reply.code(204);
  });
}
