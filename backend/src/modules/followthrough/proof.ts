import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  dateLabel,
  fail,
  proofInput,
  type ItemProof,
  type ProgressReport,
} from "@orbyn/core";
import { pool, reader, type Queryable } from "../../db/pool.js";
import { authenticate, type UserRow } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";
import { requireItemAccess, type ItemRow } from "../items/service.js";

type ProofRow = Omit<ItemProof, "created_at"> & { created_at: Date };
const toProof = (r: ProofRow): ItemProof => ({
  ...r,
  created_at: r.created_at.toISOString(),
});

async function itemFor(id: string, db: Queryable = pool) {
  const item = (
    await db.query<ItemRow>("SELECT * FROM items WHERE id = $1", [id])
  ).rows[0];
  if (!item) fail(404, "Item not found");
  return item;
}

/**
 * Proof of progress: a link or a note on a task that shows it moved — the
 * pull request, the sent file, the signed form — and a summary of what got
 * done over a stretch of days, with the proof, ready to paste anywhere.
 */
export async function proofRoutes(app: FastifyInstance) {
  app.get("/items/:id/proofs", async (r): Promise<ItemProof[]> => {
    const u = await authenticate(r);
    const item = await itemFor(idParam(r));
    await requireItemAccess(u, item, "items:read");
    return listProofs(reader(r.headers), item.id);
  });

  app.post("/items/:id/proofs", async (r, reply): Promise<ItemProof> => {
    const u = await authenticate(r);
    const item = await itemFor(idParam(r));
    await requireItemAccess(u, item, "items:write");
    const d = proofInput.parse(r.body);
    const row = await addProof(pool, u, item.id, d);
    reply.code(201);
    return row;
  });

  app.delete("/items/:id/proofs/:proofId", async (r, reply) => {
    const u = await authenticate(r);
    const item = await itemFor(idParam(r));
    const { proofId } = z
      .object({ id: z.string(), proofId: z.uuid() })
      .parse(r.params);
    await requireItemAccess(u, item, "items:write");
    await deleteProof(pool, item.id, proofId);
    reply.code(204);
  });

  /**
   * What got done between `from` and `to`, by person, with its proof. For a
   * team: its tasks, by whoever they were assigned to (or who finished
   * them). Without one: your own.
   */
  app.get("/progress", async (r): Promise<ProgressReport> => {
    const u = await authenticate(r);
    const q = z
      .object({
        from: z.iso.datetime({ offset: true }),
        to: z.iso.datetime({ offset: true }),
        team_id: z.uuid().optional(),
      })
      .strict()
      .refine((d) => Date.parse(d.to) > Date.parse(d.from), "End after start")
      .refine(
        (d) => Date.parse(d.to) - Date.parse(d.from) <= 93 * 86_400_000,
        "Up to three months at a time",
      )
      .parse(r.query);
    const team = q.team_id
      ? (await requireTeam(q.team_id, u, "items:read")).name
      : null;
    return progressReport(reader(r.headers), u.id, q, team);
  });
}

/** A task's proofs, oldest first. */
export async function listProofs(
  db: Queryable,
  itemId: string,
): Promise<ItemProof[]> {
  return (
    await db.query<ProofRow>(
      `SELECT p.id, p.item_id, p.user_id, coalesce(w.name, '') AS user_name,
              p.url, p.note, p.created_at
         FROM item_proofs p LEFT JOIN users w ON w.id = p.user_id
        WHERE p.item_id = $1 ORDER BY p.created_at`,
      [itemId],
    )
  ).rows.map(toProof);
}

/** Add a proof (a link or a note) to a task: 20 at most. Access is checked by the caller. */
export async function addProof(
  db: Queryable,
  u: { id: string; name: string },
  itemId: string,
  input: z.input<typeof proofInput>,
): Promise<ItemProof> {
  const d = proofInput.parse(input);
  const count = (
    await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM item_proofs WHERE item_id = $1",
      [itemId],
    )
  ).rows[0].n;
  if (count >= 20) fail(422, "A task holds up to 20 proofs.");
  const row = (
    await db.query<ProofRow>(
      `INSERT INTO item_proofs (item_id, user_id, url, note)
       VALUES ($1, $2, $3, $4)
       RETURNING id, item_id, user_id, $5::text AS user_name, url, note, created_at`,
      [itemId, u.id, d.url, d.note, u.name],
    )
  ).rows[0];
  return toProof(row);
}

/** Remove a proof from a task. Access is checked by the caller. */
export async function deleteProof(
  db: Queryable,
  itemId: string,
  proofId: string,
) {
  const gone = await db.query(
    "DELETE FROM item_proofs WHERE id = $1 AND item_id = $2",
    [proofId, itemId],
  );
  if (!gone.rowCount) fail(404, "Proof not found");
}

/** A task `u` may use with `permission`, for proofs (404 otherwise). */
export async function proofItem(
  db: Queryable,
  u: UserRow,
  itemId: string,
  permission: "items:read" | "items:write",
) {
  const item = await itemFor(itemId, db);
  await requireItemAccess(u, item, permission, db as never);
  return item;
}

/**
 * What got done between `from` and `to`, by person, with its proof: a
 * team's tasks (`team` names it), or `userId`'s own.
 */
export async function progressReport(
  db: Queryable,
  userId: string,
  q: { from: string; to: string; team_id?: string },
  team: string | null,
): Promise<ProgressReport> {
  const rows = (
    await db.query<{
      item_id: string;
      title: string;
      done_at: Date;
      person_id: string;
      person: string;
      project: string | null;
      proofs: { url: string | null; note: string }[];
    }>(
      `SELECT i.id AS item_id, i.title, x.done_at,
            p.id AS person_id, p.name AS person, pr.name AS project,
            coalesce((SELECT json_agg(json_build_object('url', f.url, 'note', f.note)
                                      ORDER BY f.created_at)
                        FROM item_proofs f WHERE f.item_id = i.id), '[]'::json) AS proofs
       FROM items i
       JOIN LATERAL (
         SELECT max(created_at) AS done_at, (array_agg(user_id ORDER BY created_at DESC))[1] AS by
           FROM item_updates WHERE item_id = i.id AND status = 'done'
       ) x ON x.done_at IS NOT NULL
       JOIN users p ON p.id = coalesce(i.assignee_id, x.by, i.user_id)
       LEFT JOIN projects pr ON pr.id = i.project_id
      WHERE i.status = 'done' AND i.kind = 'task'
        AND x.done_at >= $2 AND x.done_at < $3
        AND (CASE WHEN $4::uuid IS NULL
               THEN i.team_id IS NULL AND i.user_id = $1
               ELSE i.team_id = $4 END)
      ORDER BY p.name, x.done_at`,
      [userId, q.from, q.to, q.team_id ?? null],
    )
  ).rows;
  const people = new Map<string, ProgressReport["people"][number]>();
  for (const row of rows) {
    const person = people.get(row.person_id) ?? {
      user_id: row.person_id,
      name: row.person,
      done: [],
    };
    person.done.push({
      item_id: row.item_id,
      title: row.title,
      done_at: row.done_at.toISOString(),
      project: row.project,
      proofs: row.proofs,
    });
    people.set(row.person_id, person);
  }
  const list = [...people.values()];
  const span = `${dateLabel(q.from)} – ${dateLabel(q.to)}`;
  const lines = [
    `## ${team ? `${team}: ` : ""}Done, ${span}`,
    "",
    ...(list.length
      ? list.flatMap((p) => [
          ...(team ? [`**${p.name}**`] : []),
          ...p.done.map((t) => {
            const proof = t.proofs
              .map((f) => (f.url ? `[${f.note || "proof"}](${f.url})` : f.note))
              .filter(Boolean)
              .join(" · ");
            return `- ${t.title}${t.project ? ` (${t.project})` : ""}${proof ? ` — ${proof}` : ""}`;
          }),
          "",
        ])
      : ["Nothing finished in these days yet."]),
  ];
  return {
    from: q.from,
    to: q.to,
    people: list,
    markdown: lines.join("\n").trim(),
  };
}
