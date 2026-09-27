import {
  blockText,
  newBlockId,
  parseDoc,
  plainText,
  sourcesIn,
  type DocBlock,
  type MemorySourceInput,
  withoutSources,
} from "@orbyn/core";
import type { Db, Queryable } from "../../db/pool.js";

const MAX_MEMORY_CHARS = 60_000;

export type MemoryFact = { id: string; text: string; sources: string[] };
export type MemoryEntry = {
  id: string;
  topic: string;
  facts: MemoryFact[];
  version: number;
  updated_at: string;
};
export type MemorySourceRow = MemorySourceInput & { learned_at: string };
export type MemorySnapshot = {
  id: string;
  user_id: string;
  title: string;
  content: DocBlock[];
  version: number;
  created_at: string;
  updated_at: string;
  sources: MemorySourceRow[];
};

type MemoryDocRow = {
  id: string;
  user_id: string;
  title: string;
  content: DocBlock[];
  version: number;
  created_at: Date;
  updated_at: Date;
};

const normalize = (text: string) => plainText(text).trim().toLocaleLowerCase();
const safeFact = (text: string) =>
  plainText(text)
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
const safeLabel = (label: string) =>
  label
    .replace(/[\[\]\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);

function factsOf(content: DocBlock[]): MemoryFact[] {
  return content.flatMap((block) => {
    if (!("text" in block) || typeof block.text !== "string") return [];
    const raw = blockText(block).trim();
    const line = plainText(withoutSources(raw)).trim();
    if (!line) return [];
    return line
      ? [
          {
            id: block.id ?? newBlockId(),
            text: line,
            sources: sourcesIn(raw),
          },
        ]
      : [];
  });
}

function contentOf(facts: MemoryFact[]): DocBlock[] {
  return facts.map((fact) => {
    const labels = [...new Set(fact.sources.map(safeLabel).filter(Boolean))];
    const source = labels.length ? ` [src: ${labels.join(" · ")}]` : "";
    const block = parseDoc(`- ${fact.text}${source}`)[0];
    return { ...block, id: fact.id || newBlockId() };
  });
}

async function sourcesFor(
  db: Queryable,
  ids: string[],
): Promise<Map<string, MemorySourceRow[]>> {
  if (!ids.length) return new Map();
  const rows = (
    await db.query<{
      doc_id: string;
      source_type: MemorySourceInput["type"];
      source_id: string | null;
      label: string;
      quote: string | null;
      learned_at: Date;
    }>(
      `SELECT doc_id, source_type, source_id, label, quote, learned_at
         FROM memory_sources WHERE doc_id = ANY($1::uuid[])
        ORDER BY learned_at DESC`,
      [ids],
    )
  ).rows;
  const out = new Map<string, MemorySourceRow[]>();
  for (const row of rows) {
    const list = out.get(row.doc_id) ?? [];
    list.push({
      type: row.source_type,
      id: row.source_id,
      label: row.label,
      quote: row.quote,
      learned_at: row.learned_at.toISOString(),
    });
    out.set(row.doc_id, list);
  }
  return out;
}

function entryOf(row: MemoryDocRow): MemoryEntry {
  return {
    id: row.id,
    topic: row.title,
    facts: factsOf(row.content ?? []),
    version: row.version,
    updated_at: row.updated_at.toISOString(),
  };
}

/** List the person's private memory notes, excluding sources kept out of AI. */
export async function listMemory(
  db: Queryable,
  userId: string,
  options: { limit?: number; keptOutProjects?: string[] } = {},
): Promise<MemoryEntry[]> {
  const rows = (
    await db.query<MemoryDocRow>(
      `SELECT d.id, d.user_id, d.title, d.content, d.version, d.created_at, d.updated_at
         FROM docs d
        WHERE d.user_id = $1 AND d.team_id IS NULL AND d.kind = 'memory'
          AND d.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM memory_sources s
             WHERE s.doc_id = d.id AND s.source_type = 'project'
               AND s.source_id = ANY($2::uuid[]))
        ORDER BY d.updated_at DESC, d.id
        LIMIT $3`,
      [
        userId,
        options.keptOutProjects ?? [],
        Math.max(1, Math.min(options.limit ?? 50, 100)),
      ],
    )
  ).rows;
  return rows.map(entryOf);
}

/** Read one memory note by its exact topic or stable document id. */
export async function readMemory(
  db: Queryable,
  userId: string,
  topicOrId: string,
  keptOutProjects: string[] = [],
): Promise<(MemoryEntry & { sources: MemorySourceRow[] }) | null> {
  const row = (
    await db.query<MemoryDocRow>(
      `SELECT d.id, d.user_id, d.title, d.content, d.version, d.created_at, d.updated_at
         FROM docs d
        WHERE d.user_id = $1 AND d.team_id IS NULL AND d.kind = 'memory'
          AND d.deleted_at IS NULL AND (d.id::text = $2 OR lower(d.title) = lower($2))
          AND NOT EXISTS (
            SELECT 1 FROM memory_sources s
             WHERE s.doc_id = d.id AND s.source_type = 'project'
               AND s.source_id = ANY($3::uuid[]))
        ORDER BY d.updated_at DESC LIMIT 1`,
      [userId, topicOrId.trim(), keptOutProjects],
    )
  ).rows[0];
  if (!row) return null;
  const sources = await sourcesFor(db, [row.id]);
  return { ...entryOf(row), sources: sources.get(row.id) ?? [] };
}

/** Relevant private notes to ground one assistant answer, never over 4,000 chars. */
export async function recallMemory(
  db: Queryable,
  userId: string,
  words: string,
  maxChars = 4_000,
  keptOutProjects: string[] = [],
): Promise<string> {
  const query = words.trim().slice(0, 500);
  if (!query) return "";
  const rows = (
    await db.query<{ title: string; content: DocBlock[] }>(
      // Any word of the request may match (a request is long; every word
      // together would almost never), and a note whose topic the request
      // names always does.
      `WITH q AS (SELECT replace(plainto_tsquery('english', $2)::text, ' & ', ' | ')::tsquery AS tsq)
       SELECT d.title, d.content FROM docs d CROSS JOIN q
        WHERE d.user_id = $1 AND d.team_id IS NULL AND d.kind = 'memory'
          AND d.deleted_at IS NULL
          AND (d.search @@ q.tsq OR (length(d.title) > 2 AND strpos(lower($2), lower(d.title)) > 0))
          AND NOT EXISTS (
            SELECT 1 FROM memory_sources s
             WHERE s.doc_id = d.id AND s.source_type = 'project'
               AND s.source_id = ANY($3::uuid[]))
        ORDER BY ts_rank_cd(d.search, q.tsq) DESC, d.updated_at DESC
        LIMIT 12`,
      [userId, query, keptOutProjects],
    )
  ).rows;
  let out = "";
  for (const row of rows) {
    const lines = (row.content ?? []).flatMap((block) =>
      "text" in block && block.text
        ? [`- ${plainText(blockText(block)).trim()}`]
        : [],
    );
    const section = `## ${row.title}\n${lines.join("\n")}`;
    if (!lines.length) continue;
    if (out && out.length + section.length + 2 > maxChars) break;
    out += `${out ? "\n\n" : ""}${section.slice(0, Math.max(0, maxChars - out.length - 2))}`;
    if (out.length >= maxChars) break;
  }
  return out;
}

/** Add facts to one personal note per topic, with visible and queryable sources. */
export async function rememberMemory(
  db: Db,
  userId: string,
  topic: string,
  incoming: string[],
  sources: MemorySourceInput[],
): Promise<{ entry: MemoryEntry; created: boolean; changed: boolean }> {
  const title = topic.trim().slice(0, 120);
  if (!title) throw new Error("Memory topic is required.");
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `memory:${userId}`,
  ]);
  const current = (
    await db.query<MemoryDocRow>(
      `SELECT id, user_id, title, content, version, created_at, updated_at
         FROM docs WHERE user_id = $1 AND team_id IS NULL AND kind = 'memory'
          AND deleted_at IS NULL AND lower(title) = lower($2)
        ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`,
      [userId, title],
    )
  ).rows[0];
  const facts = current ? factsOf(current.content ?? []) : [];
  const byText = new Map(facts.map((fact) => [normalize(fact.text), fact]));
  let changed = false;
  for (const raw of incoming) {
    const text = safeFact(raw);
    const key = normalize(text);
    if (!key) continue;
    const existing = byText.get(key);
    const labels = sources
      .map((source) => safeLabel(source.label))
      .filter(Boolean);
    if (existing) {
      const merged = [...new Set([...existing.sources, ...labels])];
      if (merged.length !== existing.sources.length) {
        existing.sources = merged;
        changed = true;
      }
      continue;
    }
    const fact = { id: newBlockId(), text, sources: labels };
    facts.push(fact);
    byText.set(key, fact);
    changed = true;
  }
  if (!facts.length)
    return {
      entry: current
        ? entryOf(current)
        : {
            id: "",
            topic: title,
            facts: [],
            version: 0,
            updated_at: new Date().toISOString(),
          },
      created: false,
      changed: false,
    };

  const content = contentOf(facts);
  if (Buffer.byteLength(JSON.stringify(content)) > MAX_MEMORY_CHARS)
    throw new Error(
      "That memory note is full. Forget a topic before adding more.",
    );
  let doc: MemoryDocRow;
  let created = false;
  if (!current) {
    doc = (
      await db.query<MemoryDocRow>(
        `INSERT INTO docs (user_id, team_id, title, kind, content)
         VALUES ($1, NULL, $2, 'memory', $3::jsonb)
         RETURNING id, user_id, title, content, version, created_at, updated_at`,
        [userId, title, JSON.stringify(content)],
      )
    ).rows[0];
    created = true;
    changed = true;
  } else if (changed) {
    await db.query(
      `INSERT INTO doc_versions (doc_id, version, title, content, user_id)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (doc_id, version) DO NOTHING`,
      [
        current.id,
        current.version,
        current.title,
        JSON.stringify(current.content),
        userId,
      ],
    );
    doc = (
      await db.query<MemoryDocRow>(
        `UPDATE docs SET content = $2::jsonb, version = version + 1, updated_at = now()
          WHERE id = $1
          RETURNING id, user_id, title, content, version, created_at, updated_at`,
        [current.id, JSON.stringify(content)],
      )
    ).rows[0];
  } else {
    doc = current;
  }
  for (const source of sources) {
    const saved = await db.query(
      `INSERT INTO memory_sources (doc_id, source_type, source_id, label, quote)
       SELECT $1, $2, $3, $4, $5
        WHERE NOT EXISTS (
          SELECT 1 FROM memory_sources
           WHERE doc_id = $1 AND source_type = $2
             AND source_id IS NOT DISTINCT FROM $3::uuid
             AND ($3::uuid IS NOT NULL OR label = $4))
       ON CONFLICT (doc_id, source_type, source_id) WHERE source_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [doc.id, source.type, source.id, safeLabel(source.label), source.quote],
    );
    if (saved.rowCount) changed = true;
  }
  return { entry: entryOf(doc), created, changed };
}

/** Keep the completed visible turns until M3 gives each chat a durable row. */
export async function enqueueMemory(
  db: Queryable,
  input: {
    userId: string;
    chatId: string;
    turns: unknown[];
    sourceProjectId: string | null;
  },
) {
  await db.query(
    `INSERT INTO memory_queue (chat_id, user_id, turns, source_project_id)
     VALUES ($1, $2, $3::jsonb, $4)`,
    [
      input.chatId,
      input.userId,
      JSON.stringify(input.turns),
      input.sourceProjectId,
    ],
  );
}

/** Permanently remove one private topic and its pending source conversations. */
export async function forgetMemory(
  db: Db,
  userId: string,
  topic: string,
  options: {
    keptOutProjects?: string[];
    onlyDocId?: string;
    includeKeptOut?: boolean;
  } = {},
): Promise<{ docs: { id: string; title: string; version: number }[] }> {
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `memory:${userId}`,
  ]);
  const rows = (
    await db.query<MemoryDocRow>(
      `SELECT id, user_id, title, content, version, created_at, updated_at
        FROM docs WHERE user_id = $1 AND team_id IS NULL AND kind = 'memory'
          AND deleted_at IS NULL
          AND (($3::uuid IS NOT NULL AND id = $3::uuid)
            OR ($3::uuid IS NULL AND lower(title) = lower($2)))
          AND ($5::boolean OR NOT EXISTS (
            SELECT 1 FROM memory_sources s JOIN projects p ON p.id = s.source_id
             WHERE s.doc_id = docs.id AND s.source_type = 'project'
               AND (p.assistant_off OR p.id = ANY($4::uuid[]))))
        FOR UPDATE`,
      [
        userId,
        topic.trim(),
        options.onlyDocId ?? null,
        options.keptOutProjects ?? [],
        options.includeKeptOut ?? false,
      ],
    )
  ).rows;
  const byId = await sourcesFor(
    db,
    rows.map((row) => row.id),
  );
  const sourceChatIds = [
    ...new Set(
      rows.flatMap((row) =>
        (byId.get(row.id) ?? [])
          .filter((source) => source.type === "chat" && source.id)
          .map((source) => source.id!),
      ),
    ),
  ];
  if (sourceChatIds.length)
    await db.query(
      "DELETE FROM memory_queue WHERE user_id = $1 AND chat_id = ANY($2::uuid[])",
      [userId, sourceChatIds],
    );
  if (rows.length)
    await db.query(
      "DELETE FROM docs WHERE id = ANY($1::uuid[]) AND user_id = $2",
      [rows.map((row) => row.id), userId],
    );
  return {
    docs: rows.map(({ id, title, version }) => ({ id, title, version })),
  };
}
