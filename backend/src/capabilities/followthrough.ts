import { z } from "zod";
import { STATUSES, WORK_RECORD_KINDS, WORK_RECORD_STATUSES } from "@orbyn/core";
import {
  Params,
  scopeFor,
  visibleItems,
  visibleRecords,
} from "../lib/visibility.js";
import {
  askFor,
  listAsks,
  replyToAsk,
  settleAsk,
} from "../modules/followthrough/asks.js";
import { fadingDocs } from "../modules/followthrough/memory.js";
import { addProof, progressReport } from "../modules/followthrough/proof.js";
import { reentryBrief } from "../modules/followthrough/reentry.js";
import { addProgressUpdate } from "../modules/items/progress.js";
import {
  createRecord,
  readRecord,
  recordEvidence,
  respondToRecord,
  updateRecord,
} from "../modules/work-records/service.js";
import {
  listNotifications,
  markNotificationsRead,
} from "../modules/notifications/service.js";
import { atRiskFor } from "../modules/planner/plans.js";
import { READ, spaceName, teamFilter } from "./common.js";
import { both, clean, cleanTitle, labelled } from "./format.js";
import { appUrl, refs } from "./refs.js";
import {
  CapabilityError,
  defineCapability,
  type CapabilityContext,
} from "./registry.js";
import {
  actionChange,
  entryOf,
  notReachable,
  quoted,
  seeDoc,
  seeItem,
  seeProject,
} from "./shared.js";
import {
  ADDS,
  EDITS,
  actorOf,
  clientRefInput,
  dbOf,
  cantWait,
  destination,
  finishWrite,
  idField,
  isoTime,
  refuseSecrets,
  writeOutput,
  type DoneEntry,
} from "./write.js";

/**
 * The follow-through toolset: asks in both directions, promises, decisions
 * and experiments, tasks at risk, the "while you were away" brief, finished
 * work with its proof and pages going stale (get_follow_through), progress
 * notes and proof (add_progress), answering asks and saving records (both
 * notify a teammate, so they run directly only when the connection may
 * notify teammates, and otherwise wait in the Review inbox), and marking
 * notices read.
 */

/** Items (by id) this connection can see, out of `ids`. */
async function reachableItems(ctx: CapabilityContext, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const p = new Params();
  const scope = scopeFor(ctx.spaces, p);
  return new Set(
    (
      await ctx.db.query<{ id: string }>(
        `SELECT i.id FROM items i WHERE i.id = ANY (${p.add(ids)}::uuid[])
            AND ${visibleItems("i", scope)}`,
        p.values,
      )
    ).rows.map((r) => r.id),
  );
}

const who = (ctx: CapabilityContext, id: string, name: string) =>
  id === ctx.principal.user.id ? "you" : cleanTitle(name);

// --- get_follow_through ---------------------------------------------------

export const getFollowThrough = defineCapability({
  name: "get_follow_through",
  title: "Follow-through",
  description:
    'Asks waiting on the person and on others; open promises, decisions and experiments (evidence: a record id for an experiment\'s before and after); tasks at risk of missing their deadline; the "while you were away" brief; work finished in the last days with its proof; pages going stale; and unread notices.',
  input: z
    .object({
      days: z
        .number()
        .int()
        .min(1)
        .max(31)
        .default(7)
        .describe("For finished work."),
      evidence: z.string().trim().max(300).optional(),
    })
    .strict(),
  output: z.object({
    asks: z.array(
      z.object({
        id: z.string(),
        task: z.string(),
        title: z.string(),
        from: z.string(),
        to: z.string(),
        status: z.string(),
        due: z.object({ at: z.string(), local: z.string() }).nullable(),
        waiting_on: z.enum(["you", "them", "settled"]),
      }),
    ),
    records: z.array(
      z.object({
        id: z.string(),
        kind: z.string(),
        title: z.string(),
        status: z.string(),
        owner: z.string(),
        team: z.string(),
        due: z.object({ at: z.string(), local: z.string() }).nullable(),
      }),
    ),
    at_risk: z.array(
      z.object({ task: z.string(), title: z.string(), reason: z.string() }),
    ),
    away: z.array(
      z.object({ what: z.string(), title: z.string(), detail: z.string() }),
    ),
    finished: z.array(
      z.object({
        task: z.string(),
        title: z.string(),
        proof: z.array(z.string()),
      }),
    ),
    stale_pages: z.array(
      z.object({ doc: z.string(), title: z.string(), since: z.string() }),
    ),
    notices: z.array(
      z.object({ id: z.string(), title: z.string(), at: z.string() }),
    ),
    evidence: z
      .object({
        before: z.record(z.string(), z.unknown()),
        during: z.record(z.string(), z.unknown()),
      })
      .nullable(),
  }),
  annotations: READ,
  access: "read",
  toolset: "followthrough",
  mode: "read",
  tier: "R",
  async run(ctx, a) {
    const me = ctx.principal.user.id;
    const tz = ctx.timezone;
    const actor = actorOf(ctx.principal);
    const asks = await listAsks(ctx.db, me);
    const all = [
      ...asks.to_me.map((x) => ({ ...x, waiting: "you" as const })),
      ...asks.from_me.map((x) => ({ ...x, waiting: "them" as const })),
      ...asks.recent.map((x) => ({ ...x, waiting: "settled" as const })),
    ];
    const seen = await reachableItems(
      ctx,
      all.map((x) => x.item_id),
    );
    const p = new Params();
    const scope = scopeFor(ctx.spaces, p);
    const records = (
      await ctx.db.query<{
        id: string;
        kind: string;
        title: string;
        status: string;
        owner: string | null;
        team_id: string | null;
        due_at: Date | null;
        project_id: string | null;
      }>(
        `SELECT w.id, w.kind, w.title, w.status, o.name AS owner, w.team_id, w.due_at, w.project_id
           FROM work_records w LEFT JOIN users o ON o.id = w.owner_id
          WHERE ${visibleRecords("w", scope)} AND w.status IN ('proposed', 'open')
          ORDER BY (w.status = 'proposed') DESC, w.due_at NULLS LAST, w.updated_at DESC LIMIT 50`,
        p.values,
      )
    ).rows;
    const risky = ctx.principal.personal
      ? await atRiskFor(ctx.db as never, me, ctx.now)
      : [];
    const riskSeen = await reachableItems(
      ctx,
      risky.map((r) => r.item_id),
    );
    const brief = await reentryBrief(ctx.db, me);
    const lineIds = brief
      ? [...brief.assigned, ...brief.changed, ...brief.due]
          .map((l) => l.item_id!)
          .filter(Boolean)
      : [];
    const briefSeen = await reachableItems(ctx, lineIds);
    const away = brief
      ? [
          ...brief.assigned
            .filter((l) => briefSeen.has(l.item_id!))
            .map((l) => ({
              what: "Handed to you",
              title: l.title,
              detail: l.detail,
            })),
          ...brief.changed
            .filter((l) => briefSeen.has(l.item_id!))
            .map((l) => ({
              what: "Moved on",
              title: l.title,
              detail: l.detail,
            })),
          ...brief.due
            .filter((l) => briefSeen.has(l.item_id!))
            .map((l) => ({ what: "Due", title: l.title, detail: l.detail })),
        ].map((x) => ({
          ...x,
          title: cleanTitle(x.title),
          detail: clean(x.detail, 300),
        }))
      : [];
    const since = new Date(ctx.now.getTime() - a.days * 86_400_000);
    const report = ctx.principal.personal
      ? await progressReport(
          ctx.db,
          me,
          { from: since.toISOString(), to: ctx.now.toISOString() },
          null,
        )
      : { people: [] };
    const finished = report.people.flatMap((person) =>
      person.done.map((t) => ({
        task: refs({ type: "task", id: t.item_id }).id,
        title: cleanTitle(t.title),
        proof: t.proofs
          .map((f) =>
            f.url
              ? `${clean(f.note, 200) || "proof"}: ${f.url}`
              : clean(f.note, 300),
          )
          .filter(Boolean),
      })),
    );
    const fading = (await fadingDocs(ctx.db, me, null)).filter((d) =>
      d.team_id === null
        ? ctx.spaces.personal
        : ctx.spaces.teamIds === null || ctx.spaces.teamIds.includes(d.team_id),
    );
    const notices = (await listNotifications(ctx.db, me, 30)).filter(
      (n) => !n.read,
    );
    let evidence = null;
    if (a.evidence) {
      const id = a.evidence.replace(/^record:/, "");
      const rec = await readRecord(ctx.db, id, actor).catch(() => null);
      if (
        !rec ||
        (rec.team_id
          ? !ctx.principal.teams.some((t) => t.id === rec.team_id)
          : !ctx.principal.personal)
      )
        throw notReachable();
      const ev = await recordEvidence(ctx.db, actor, id);
      evidence = {
        before: ev.before as Record<string, unknown>,
        during: ev.during as Record<string, unknown>,
      };
    }
    const structured = {
      asks: all
        .filter((x) => seen.has(x.item_id))
        .map((x) => ({
          id: x.id,
          task: refs({ type: "task", id: x.item_id }).id,
          title: cleanTitle(x.item_title),
          from: who(ctx, x.asked_by, x.asked_by_name),
          to: who(ctx, x.asked_of, x.asked_of_name),
          status: x.status,
          due: both(x.counter_due_at ?? x.due_at, tz),
          waiting_on: x.waiting,
        })),
      records: records.map((r) => ({
        id: refs({ type: "record", id: r.id }).id,
        kind: r.kind,
        title: cleanTitle(r.title),
        status: r.status,
        owner: r.owner ? cleanTitle(r.owner) : "Unassigned",
        team: spaceName(r.team_id, ctx.principal.teams),
        due: both(r.due_at, tz),
      })),
      at_risk: risky
        .filter((r) => riskSeen.has(r.item_id))
        .map((r) => ({
          task: refs({ type: "task", id: r.item_id }).id,
          title: cleanTitle(r.title),
          reason: r.reason,
        })),
      away,
      finished,
      stale_pages: fading.map((d) => ({
        doc: `doc:${d.id}`,
        title: cleanTitle(d.title),
        since: d.reviewed_at ?? d.updated_at,
      })),
      notices: notices.map((n) => ({
        id: n.id,
        title: labelled(n.title, "you").slice(0, 300),
        at: n.created_at.toISOString(),
      })),
      evidence,
    };
    return {
      structured,
      markdown: [
        ...(structured.asks.length
          ? [
              "Asks:",
              ...structured.asks.map(
                (x) =>
                  `- ${x.title}: ${x.from} → ${x.to}, ${x.status}${x.waiting_on === "you" ? " (waiting on you)" : ""} · ask ${x.id}`,
              ),
            ]
          : ["No asks."]),
        ...(structured.records.length
          ? [
              "Promises, decisions and experiments:",
              ...structured.records.map(
                (r) =>
                  `- ${r.kind}: ${r.title} (${r.status}, ${r.owner})${r.due ? ` due ${r.due.local}` : ""} · ${r.id}`,
              ),
            ]
          : []),
        ...(structured.at_risk.length
          ? [
              "At risk:",
              ...structured.at_risk.map(
                (r) => `- ${r.title}: ${r.reason} · ${r.task}`,
              ),
            ]
          : []),
        ...(away.length
          ? [
              "While you were away:",
              ...away.map((x) => `- ${x.what}: ${x.title} (${x.detail})`),
            ]
          : []),
        ...(finished.length
          ? [
              `Finished in ${a.days} days:`,
              ...finished.map(
                (f) =>
                  `- ${f.title}${f.proof.length ? ` — ${f.proof.join(" · ")}` : ""}`,
              ),
            ]
          : []),
        ...(structured.stale_pages.length
          ? [
              "Pages going stale:",
              ...structured.stale_pages.map((d) => `- ${d.title} · ${d.doc}`),
            ]
          : []),
        ...(structured.notices.length
          ? [
              `${structured.notices.length} unread notice${structured.notices.length === 1 ? "" : "s"}.`,
            ]
          : []),
      ].join("\n"),
    };
  },
});

// --- add_progress ---------------------------------------------------------

export const addProgress = defineCapability({
  name: "add_progress",
  title: "Add a progress note",
  description:
    "Adds a progress note to a task, optionally setting its status or percent done, and/or a proof (a link or a note: the pull request, the sent file). Teammates see it on team tasks.",
  input: z
    .object({
      task: z.string().trim().min(1).max(300),
      note: z.string().trim().max(2000).optional(),
      status: z.enum(STATUSES).optional(),
      percent: z.number().int().min(0).max(100).optional(),
      proof_url: z.string().trim().max(2000).optional(),
      proof_note: z.string().trim().max(1000).optional(),
      client_ref: clientRefInput,
    })
    .strict(),
  output: writeOutput,
  annotations: ADDS,
  access: "write",
  toolset: "followthrough",
  mode: "write",
  tier: "W2",
  async run(ctx, a) {
    refuseSecrets(a.note, a.proof_url, a.proof_note);
    const db = dbOf(ctx);
    const actor = actorOf(ctx.principal);
    const item = await seeItem(ctx, a.task);
    if (destination(ctx, item.team_id, "W2") === "review")
      throw cantWait(ctx, item.team_id);
    const done: DoneEntry[] = [];
    let version = item.version;
    if (a.note || a.status || a.percent !== undefined) {
      const detail = await addProgressUpdate(db, actor, item.id, {
        body: a.note ?? "",
        ...(a.status ? { status: a.status } : {}),
        ...(a.percent !== undefined ? { progress: a.percent } : {}),
      });
      version = detail.version;
      done.push(
        entryOf("task", item.id, item.title, version, "Progress added"),
      );
    }
    if (a.proof_url || a.proof_note) {
      await addProof(db, actor, item.id, {
        url: a.proof_url ?? null,
        note: a.proof_note ?? "",
      });
      done.push(entryOf("task", item.id, item.title, version, "Proof added"));
    }
    if (!done.length)
      throw new CapabilityError(
        "INVALID",
        "Give a note, status, percent or proof.",
      );
    return finishWrite(ctx, "Progress", { done, teamId: item.team_id });
  },
});

// --- answer_ask -----------------------------------------------------------

export const answerAsk = defineCapability({
  name: "answer_ask",
  title: "Answer an ask",
  description:
    "Answers an ask handed to the person (accept, counter with another date or length, or decline), or settles one they sent (agree to a counter, keep their date, or withdraw). It notifies the teammate, so it runs at once only when this connection may notify teammates; otherwise it waits in the Review inbox.",
  input: z
    .object({
      ask: idField,
      action: z.enum([
        "accept",
        "counter",
        "decline",
        "agree",
        "keep",
        "withdraw",
      ]),
      message: z.string().trim().max(500).default(""),
      due_at: isoTime.nullable().optional(),
      estimate_minutes: z
        .number()
        .int()
        .min(5)
        .max(10080)
        .nullable()
        .optional(),
      client_ref: clientRefInput,
    })
    .strict(),
  output: writeOutput,
  annotations: EDITS,
  access: "write",
  toolset: "followthrough",
  mode: "write",
  tier: "W2",
  effects: ["notify_member"],
  async run(ctx, a) {
    refuseSecrets(a.message);
    const db = dbOf(ctx);
    const actor = actorOf(ctx.principal);
    const ask = await askFor(db, ctx.principal.user.id, a.ask);
    const item = await seeItem(ctx, `task:${ask.item_id}`).catch(() => {
      throw notReachable();
    });
    const reply = ["accept", "counter", "decline"].includes(a.action);
    const input = reply
      ? {
          action: a.action,
          message: a.message,
          ...(a.action === "counter"
            ? {
                ...(a.due_at !== undefined ? { due_at: a.due_at } : {}),
                ...(a.estimate_minutes !== undefined
                  ? { estimate_minutes: a.estimate_minutes }
                  : {}),
              }
            : {}),
        }
      : { action: a.action, message: a.message };
    const where = destination(ctx, item.team_id, "W2", ["notify_member"]);
    if (where === "review")
      return finishWrite(ctx, "Answering an ask", {
        done: [],
        review: [
          actionChange({
            action: reply ? "ask.reply" : "ask.settle",
            target_id: ask.id,
            title: ask.item_title,
            team_id: item.team_id,
            headline: `${a.action[0].toUpperCase()}${a.action.slice(1)} the ask about ${quoted(ask.item_title)}`,
            rows: a.message
              ? [{ label: "Message", before: null, after: a.message }]
              : [],
            input: reply
              ? { id: ask.id, reply: input }
              : { id: ask.id, settle: input },
          }),
        ],
        teamId: item.team_id,
      });
    const answered = reply
      ? await replyToAsk(db, actor as never, ask.id, input as never)
      : await settleAsk(db, actor as never, ask.id, input as never);
    return finishWrite(ctx, "Answering an ask", {
      done: [
        entryOf("task", item.id, item.title, null, `Ask ${answered.status}`),
      ],
      teamId: item.team_id,
    });
  },
});

// --- save_record ----------------------------------------------------------

export const saveRecord = defineCapability({
  name: "save_record",
  title: "Save a promise, decision or experiment",
  description:
    "Creates a promise, decision or experiment (in Personal or a team, optionally in a project, from a page line or about a task), changes one (record + version: title, details, status, deadline, review date, outcome), or answers a promise offered to the person (respond). Offering a promise to a teammate, and answering one, notify them: at once only when this connection may notify teammates, otherwise through the Review inbox.",
  input: z
    .object({
      record: z.string().trim().max(300).optional(),
      version: z.number().int().min(1).optional(),
      respond: z.enum(["accept", "decline"]).optional(),
      kind: z.enum(WORK_RECORD_KINDS).optional(),
      title: z.string().trim().min(1).max(200).optional(),
      details: z.string().trim().max(4000).optional(),
      space: z.string().trim().max(100).optional(),
      project: z.string().trim().max(300).optional(),
      owner: idField.optional().describe("A teammate to offer a promise to."),
      status: z.enum(WORK_RECORD_STATUSES).optional(),
      due_at: isoTime.nullable().optional(),
      review_at: isoTime.nullable().optional(),
      outcome: z.string().trim().max(4000).optional(),
      source_page: z
        .string()
        .trim()
        .max(300)
        .optional()
        .describe("doc:<id>#<line>."),
      about_task: z.string().trim().max(300).optional(),
      client_ref: clientRefInput,
    })
    .strict(),
  output: writeOutput,
  annotations: EDITS,
  access: "write",
  toolset: "followthrough",
  mode: "write",
  tier: "W2",
  effects: ["notify_member"],
  async run(ctx, a) {
    refuseSecrets(a.title, a.details, a.outcome);
    const db = dbOf(ctx);
    const actor = actorOf(ctx.principal);
    const me = ctx.principal.user.id;
    if (a.record) {
      const id = a.record.replace(/^record:/, "");
      const rec = await readRecord(db, id, actor).catch(() => null);
      if (!rec) throw notReachable();
      const teamId = rec.team_id;
      if (teamId !== null && !ctx.principal.teams.some((t) => t.id === teamId))
        throw notReachable();
      if (teamId === null && !ctx.principal.personal) throw notReachable();
      if (a.respond) {
        const where = destination(ctx, teamId, "W2", ["notify_member"]);
        if (where === "review")
          return finishWrite(ctx, "Answering a promise", {
            done: [],
            review: [
              actionChange({
                action: "record.respond",
                target_id: id,
                title: rec.title,
                team_id: teamId,
                headline: `${a.respond === "accept" ? "Take on" : "Turn down"} the promise ${quoted(rec.title)}`,
                input: { id, decision: a.respond },
              }),
            ],
            teamId,
          });
        const saved = await respondToRecord(db, actor, id, a.respond);
        return finishWrite(ctx, "Answering a promise", {
          done: [
            entryOf(
              "record",
              id,
              saved.title,
              saved.version,
              a.respond === "accept" ? "Promised" : "Turned down",
              saved.project_id,
            ),
          ],
          teamId,
        });
      }
      if (destination(ctx, teamId, "W2") === "review")
        throw cantWait(ctx, teamId);
      if (!a.version)
        throw new CapabilityError(
          "INVALID",
          "Changing a record needs its version.",
        );
      const saved = await updateRecord(db, actor, id, {
        version: a.version,
        ...(a.title ? { title: a.title } : {}),
        ...(a.details !== undefined ? { details: a.details } : {}),
        ...(a.status ? { status: a.status } : {}),
        ...(a.due_at !== undefined ? { due_at: a.due_at } : {}),
        ...(a.review_at !== undefined ? { review_at: a.review_at } : {}),
        ...(a.outcome !== undefined ? { outcome: a.outcome } : {}),
      });
      return finishWrite(ctx, "Saving a record", {
        done: [
          entryOf(
            "record",
            id,
            saved.title,
            saved.version,
            "Changed",
            saved.project_id,
          ),
        ],
        teamId,
      });
    }
    if (!a.kind || !a.title)
      throw new CapabilityError(
        "INVALID",
        "A new record needs a kind and a title.",
      );
    const space = teamFilter(a.space ?? "personal");
    const teamId = space && "team" in space ? space.team : null;
    const project = a.project ? await seeProject(ctx, a.project) : null;
    let sourceDoc: string | null = null;
    let sourceBlock: string | null = null;
    if (a.source_page) {
      const [ref, block] = a.source_page.split("#");
      sourceDoc = (await seeDoc(ctx, ref)).id;
      sourceBlock = block ? block.replace(/^\^/, "") : null;
    }
    const about = a.about_task ? (await seeItem(ctx, a.about_task)).id : null;
    const input = {
      kind: a.kind,
      title: a.title,
      details: a.details ?? "",
      team_id: teamId,
      project_id: project?.id ?? null,
      ...(a.owner ? { owner_id: a.owner } : {}),
      due_at: a.due_at ?? null,
      review_at: a.review_at ?? null,
      source_doc_id: sourceDoc,
      source_block_id: sourceBlock,
      source_item_id: about,
    };
    const offering = !!a.owner && a.owner !== me;
    const where = destination(
      ctx,
      teamId,
      teamId ? "W2" : "W1",
      offering ? ["notify_member"] : [],
    );
    if (where === "review")
      return finishWrite(ctx, "Saving a record", {
        done: [],
        review: [
          actionChange({
            action: "record.create",
            target_id: null,
            title: a.title,
            team_id: teamId,
            headline: offering
              ? `Offer the promise ${quoted(a.title)} to a teammate`
              : `New ${a.kind} ${quoted(a.title)}`,
            rows: a.details
              ? [{ label: "Details", before: null, after: a.details }]
              : [],
            input,
          }),
        ],
        teamId,
      });
    const made = await createRecord(db, actor, input);
    return finishWrite(ctx, "Saving a record", {
      done: [
        entryOf(
          "record",
          made.id,
          made.title,
          made.version,
          offering ? "Offered" : "Saved",
          made.project_id,
        ),
      ],
      teamId,
    });
  },
});

// --- mark_notifications_read (folded into ack_inbox) --------------------

/**
 * Marks the person's in-app notices read: these ids, or every unread one.
 * Notices are the person's own, so the connection needs Personal. Returns
 * how many were marked. ack_inbox's `notices` runs this (H6a folded the
 * old mark_notifications_read tool into it).
 */
export async function markNotices(
  ctx: CapabilityContext,
  notices: string[] | "all",
): Promise<number> {
  if (!ctx.principal.personal)
    throw new CapabilityError(
      "FORBIDDEN",
      "Notices are the person's own: the connection needs Personal.",
    );
  if (destination(ctx, null, "W1") === "review") throw cantWait(ctx, null);
  const db = dbOf(ctx);
  const me = ctx.principal.user.id;
  const ids =
    notices === "all"
      ? (await listNotifications(db, me, 100))
          .filter((n) => !n.read)
          .map((n) => n.id)
      : notices;
  return ids.length ? markNotificationsRead(db, me, ids) : 0;
}

/**
 * The retired name, for connections that still call it: ack_inbox with
 * `notices` does the same. Not listed and not counted (legacyOnly), but
 * callable by any connection with the follow-through toolset.
 */
export const markNotificationsReadCapability = defineCapability({
  name: "mark_notifications_read",
  title: "Mark notices read (older tool)",
  description:
    "Deprecated: use ack_inbox with notices. Marks in-app notices read: ids, or all unread with all.",
  input: z
    .object({
      ids: z.array(idField).max(100).optional(),
      all: z.boolean().optional(),
      client_ref: clientRefInput,
    })
    .strict(),
  output: writeOutput,
  annotations: EDITS,
  access: "write",
  toolset: "followthrough",
  mode: "write",
  tier: "W1",
  legacyOnly: true,
  aliasOf: "ack_inbox",
  async run(ctx, a) {
    if (!a.ids?.length && !a.all)
      throw new CapabilityError("INVALID", "Give ids, or all.");
    const count = await markNotices(ctx, a.all ? "all" : a.ids!);
    return finishWrite(ctx, "Notices", {
      done: [
        {
          id: "notices",
          title: "Notices",
          url: `${appUrl()}/app/today`,
          version: null,
          change: `${count} marked read`,
        },
      ],
    });
  },
});
