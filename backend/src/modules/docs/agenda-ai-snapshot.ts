import { createHash } from "node:crypto";
import { pool, type Queryable } from "../../db/pool.js";
import { visibleAiItems } from "../../lib/assistant-source-visibility.js";
import { readAgendaAiDay } from "./agenda.js";
import { agendaBriefFacts } from "./agenda-ai-facts.js";
import {
  assertAgendaStudySources,
  type AgendaAiSource,
} from "./agenda-study-sources.js";

export type AgendaAiSnapshot = {
  ownerId: string;
  capturedAt: string;
  facts: ReturnType<typeof agendaBriefFacts>;
  sources: AgendaAiSource[];
  references: AgendaAiReference[];
  digest: string;
};
type AgendaAiReference =
  | { kind: "time_block" | "habit_block"; id: string; version: number }
  | {
      kind: "calendar_event";
      calendarId: string;
      uid: string;
      startAt: string;
    };
const sourceRevision = (value: number | undefined): number => {
  if (value === undefined || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Agenda source revision is unavailable.");
  return value;
};

/** Capture source identities alongside only the current AI-visible daily facts. */
export async function captureAgendaAiSnapshot(
  owner: string,
  now: Date,
  db: Queryable = pool,
): Promise<AgendaAiSnapshot> {
  const day = await readAgendaAiDay(owner, now, db);
  const captured = day.aiSources ?? [];
  const tasks = [
    ...new Set(captured.filter((s) => s.kind === "task").map((s) => s.id)),
  ];
  const versions = tasks.length
    ? (
        await db.query<{ id: string; version: number }>(
          `SELECT i.id,i.version FROM items i WHERE i.id=ANY($2::uuid[]) AND ${visibleAiItems()}`,
          [owner, tasks],
        )
      ).rows
    : [];
  if (versions.length !== tasks.length)
    throw new Error("Agenda source changed.");
  const byTask = new Map(versions.map((row) => [row.id, row.version]));
  const unique = new Map<string, AgendaAiSource>();
  for (const source of captured) {
    if (
      source.kind === "task" &&
      source.version !== undefined &&
      source.version !== byTask.get(source.id)
    )
      throw new Error("Agenda source changed.");
    unique.set(
      `${source.kind}:${source.id}`,
      source.kind === "task"
        ? { ...source, version: byTask.get(source.id) }
        : source,
    );
  }
  const sources = [...unique.values()].sort((a, b) =>
    `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`),
  );
  await assertAgendaStudySources(owner, sources, db);
  const facts = agendaBriefFacts(day, now);
  const state = day.aiState;
  const referenceInput: AgendaAiReference[] = state
    ? [
        ...state.blocks.map((block) => ({
          kind: "time_block" as const,
          id: block.id,
          version: sourceRevision(block.revision),
        })),
        ...state.habits.map((block) => ({
          kind: "habit_block" as const,
          id: block.id,
          version: sourceRevision(block.version),
        })),
        ...[...state.busyExternal, ...state.visibleExternal].map((event) => ({
          kind: "calendar_event" as const,
          calendarId: event.subscription_id,
          uid: event.uid,
          startAt: event.start_at,
        })),
      ]
    : [];
  const references = [
    ...new Map(
      referenceInput.map((reference) => [JSON.stringify(reference), reference]),
    ).values(),
  ];
  const capturedAt = now.toISOString();
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        ownerId: owner,
        capturedAt,
        facts,
        sources,
        state: day.aiState,
      }),
    )
    .digest("hex");
  return { ownerId: owner, capturedAt, facts, sources, references, digest };
}

/** Reread at the captured time so derived counts and schedule changes invalidate late output. */
export async function assertAgendaAiSnapshot(
  owner: string,
  now: Date,
  captured: AgendaAiSnapshot,
  db: Queryable = pool,
): Promise<void> {
  if (captured.ownerId !== owner || captured.capturedAt !== now.toISOString())
    throw new Error("Agenda snapshot belongs to a different owner or time.");
  await assertAgendaStudySources(owner, captured.sources, db);
  const current = await captureAgendaAiSnapshot(owner, now, db);
  if (
    current.digest !== captured.digest ||
    JSON.stringify(current.facts) !== JSON.stringify(captured.facts) ||
    JSON.stringify(current.sources) !== JSON.stringify(captured.sources) ||
    JSON.stringify(current.references) !== JSON.stringify(captured.references)
  )
    throw new Error("Agenda facts changed. Start a fresh request.");
}
