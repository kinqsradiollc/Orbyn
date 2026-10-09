import { z } from "zod";
import {
  AGENT_INBOX_KIND_LABELS,
  hasLearning,
  learningProfileOf,
  learningText,
  type AgentInboxKind,
  type LearningProfile,
} from "@orbyn/core";
import {
  Params,
  scopeFor,
  visibleDocs,
  visibleItems,
} from "../lib/visibility.js";
import {
  instructionsFor,
  profileDoc,
  profileMarkdown,
} from "../modules/agent-context/service.js";
import { cleanTitle } from "./format.js";
import { levelIn } from "./policy.js";
import { appUrl, refUrl } from "./refs.js";
import type { CapabilityContext } from "./registry.js";

/**
 * Agents start warm (H8): what get_context adds so an agent needn't ask
 * again. The person's "About me for agents" page (Orbyn Markdown with
 * anchors, trimmed), its learning profile in fields, each reachable
 * space's instructions, the standing rules, and what changed since this
 * connection last spoke: new inbox items, what the person did themselves,
 * what teammates and other agents did where this connection reaches, and
 * what waits on the person. Bounded: counts, and the newest few things
 * with links. Only what the connection reaches: Personal's page and
 * instructions need Personal, a team's instructions and changes need the
 * team, and nothing in a project kept out of agents.
 */

/** A gap this long between calls starts a new session. */
export const SESSION_GAP_MS = 30 * 60_000;
/** The most of the profile page get_context returns. */
export const PROFILE_CHARS = 6000;
const TOP = 5;

export const warmOutput = {
  profile: z
    .object({
      id: z.string(),
      url: z.string(),
      version: z.number(),
      markdown: z.string(),
      more: z.boolean(),
    })
    .nullable(),
  learning: z.object({
    card_style: z.string().nullable(),
    cards: z.number().nullable(),
    session_minutes: z.number().nullable(),
    study_times: z.array(
      z.object({
        text: z.string(),
        start: z.string().nullable(),
        end: z.string().nullable(),
      }),
    ),
  }),
  instructions: z.array(z.object({ space: z.string(), text: z.string() })),
  rules: z.array(z.object({ kind: z.string().nullable(), text: z.string() })),
  since: z.object({
    at: z.string().nullable(),
    inbox: z.number(),
    added: z.number(),
    done: z.number(),
    pages: z.number(),
    moved: z.number(),
    others: z.number(),
    waiting: z.number(),
    top: z.array(z.object({ what: z.string(), url: z.string() })),
  }),
};
const warmSchema = z.object(warmOutput);
export type Warm = z.output<typeof warmSchema>;

/**
 * When this connection last spoke before this session: the last call
 * before a gap of half an hour or more. Null for a connection that hasn't
 * (or a person's own session).
 */
export async function lastSpoke(ctx: CapabilityContext): Promise<Date | null> {
  const grant = ctx.principal.grant_id;
  if (!grant) return null;
  const rows = (
    await ctx.db.query<{ at: Date }>(
      `SELECT at FROM agent_activity
        WHERE grant_id = $1 AND at <= $2 AND at > $2::timestamptz - interval '90 days'
        ORDER BY at DESC LIMIT 2000`,
      [grant, ctx.now],
    )
  ).rows;
  let after = ctx.now.getTime();
  for (const r of rows) {
    if (after - r.at.getTime() >= SESSION_GAP_MS) return r.at;
    after = r.at.getTime();
  }
  if (rows.length) return null;
  const used = (
    await ctx.db.query<{ last_used_at: Date | null }>(
      "SELECT last_used_at FROM agent_grants WHERE id = $1",
      [grant],
    )
  ).rows[0]?.last_used_at;
  return used && ctx.now.getTime() - used.getTime() >= SESSION_GAP_MS
    ? used
    : null;
}

type Top = { what: string; url: string; at: Date };

const ACTION: Record<string, string> = {
  created: "added",
  edited: "edited",
  done: "finished",
  reopened: "reopened",
  restored: "restored",
};
const KIND: Record<string, string> = {
  page: "page",
  task: "task",
  event: "event",
  reminder: "reminder",
};

/** Everything get_context adds for a warm start. */
export async function warmContext(ctx: CapabilityContext): Promise<Warm> {
  const p = ctx.principal;
  const me = p.user.id;
  const teams = p.teams.filter((t) => levelIn(p, t.id) !== null);
  const teamIds = teams.map((t) => t.id);
  const teamName = (id: string | null) =>
    id === null
      ? "Personal"
      : cleanTitle(teams.find((t) => t.id === id)?.name) || "a team";

  // The page, in Personal and out of keep-out projects.
  const doc = ctx.spaces.personal ? await profileDoc(ctx.db, me, true) : null;
  let profile: Warm["profile"] = null;
  let learning: Warm["learning"] = {
    card_style: null,
    cards: null,
    session_minutes: null,
    study_times: [],
  };
  if (doc) {
    const full = profileMarkdown(doc, true);
    const cut = full.length > PROFILE_CHARS;
    profile = {
      id: `doc:${doc.id}`,
      url: refUrl({ type: "doc", id: doc.id }),
      version: doc.version,
      markdown: cut
        ? `${full.slice(0, full.lastIndexOf("\n", PROFILE_CHARS) > 0 ? full.lastIndexOf("\n", PROFILE_CHARS) : PROFILE_CHARS)}\n\n[More on the page: fetch ${`doc:${doc.id}`}.]`
        : full,
      more: cut,
    };
    learning = learningProfileOf(profileMarkdown(doc, false));
  }

  const instructions = (
    await instructionsFor(ctx.db, me, ctx.spaces.personal, teamIds)
  ).map((i) => ({
    space: i.team_id ?? "personal",
    text: i.text,
  }));

  const rules = ctx.spaces.personal
    ? (
        await ctx.db.query<{ kind: AgentInboxKind | null; text: string }>(
          "SELECT kind, text FROM agent_rules WHERE user_id = $1 ORDER BY created_at, id LIMIT 50",
          [me],
        )
      ).rows
    : [];

  const since = await sinceLastSpoke(ctx, teamIds, teamName);
  return { profile, learning, instructions, rules, since };
}

async function sinceLastSpoke(
  ctx: CapabilityContext,
  teamIds: string[],
  teamName: (id: string | null) => string,
): Promise<Warm["since"]> {
  const p = ctx.principal;
  const me = p.user.id;
  const grant = p.grant_id;
  const at = await lastSpoke(ctx);
  const out: Warm["since"] = {
    at: at?.toISOString() ?? null,
    inbox: 0,
    added: 0,
    done: 0,
    pages: 0,
    moved: 0,
    others: 0,
    waiting: 0,
    top: [],
  };
  // Inbox and pending-review counts have no space filter. With a restrictive
  // read rule, omit these aggregate counts rather than reveal hidden work.
  const restrictedRead =
    p.via === "assistant" &&
    p.assistant_rules?.some(
      (rule) =>
        rule.lane === p.assistant_lane &&
        rule.action === "read" &&
        rule.decision !== "allow",
    );
  if (grant && !restrictedRead) {
    const w = (
      await ctx.db.query<{ inbox: number; questions: number; reviews: number }>(
        `SELECT
           (SELECT count(*)::int FROM agent_inbox i WHERE i.grant_id = $1
              AND ($2::timestamptz IS NULL
                   OR i.created_at > $2)
              AND ($2::timestamptz IS NOT NULL
                   OR i.state = 'new'
                   OR (i.state = 'snoozed' AND i.snooze_until <= now()))) AS inbox,
           (SELECT count(*)::int FROM agent_questions q
             WHERE q.grant_id = $1 AND q.status = 'open') AS questions,
           (SELECT count(*)::int FROM proposals r
             WHERE r.grant_id = $1 AND r.source = 'agent' AND r.status = 'pending') AS reviews`,
        [grant, at],
      )
    ).rows[0];
    out.inbox = w.inbox;
    out.waiting = w.questions + w.reviews;
  }
  // A fresh connection: nothing to compare with yet.
  if (!at) return out;

  const top: Top[] = [];
  /** A fresh set of parameters for one query: the reach, and since when. */
  const fresh = () => {
    const params = new Params();
    const scope = scopeFor(ctx.spaces, params);
    return { params, scope, atP: params.add(at) };
  };

  if (ctx.spaces.personal) {
    const t = fresh();
    // Made or finished by an agent (any connection): not the person's own.
    const tasks = (
      await ctx.db.query<{
        id: string;
        title: string;
        added: boolean;
        done: boolean;
        at: Date;
      }>(
        `SELECT i.id, i.title, i.created_at > ${t.atP} AS added,
                (i.status = 'done' AND i.updated_at > ${t.atP}) AS done,
                i.updated_at AS at
           FROM items i
          WHERE i.team_id IS NULL AND i.kind = 'task'
            AND ${visibleItems("i", t.scope)}
            AND (i.created_at > ${t.atP} OR (i.status = 'done' AND i.updated_at > ${t.atP}))
            AND NOT EXISTS (SELECT 1 FROM agent_activity a
                 WHERE a.user_id = ${t.scope.user} AND a.at >= ${t.atP}
                   AND a.tier <> 'R' AND 'task:' || i.id = ANY (a.target_ids))
          ORDER BY i.updated_at DESC LIMIT 500`,
        t.params.values,
      )
    ).rows;
    for (const x of tasks) {
      if (x.added) out.added++;
      if (x.done) out.done++;
    }
    for (const x of tasks.filter((y) => y.done).slice(0, TOP))
      top.push({
        what: `You finished “${cleanTitle(x.title)}”`,
        url: refUrl({ type: "task", id: x.id }),
        at: x.at,
      });
    const d = fresh();
    const pages = (
      await ctx.db.query<{ id: string; title: string; at: Date; n: number }>(
        `SELECT d.id, d.title, d.updated_at AS at, count(*) OVER ()::int AS n
           FROM docs d
          WHERE d.team_id IS NULL AND ${visibleDocs("d", d.scope)}
            AND d.updated_at > ${d.atP} AND d.written_via IS NULL
          ORDER BY d.updated_at DESC LIMIT ${TOP}`,
        d.params.values,
      )
    ).rows;
    out.pages += pages[0]?.n ?? 0;
    for (const x of pages)
      top.push({
        what: `You edited “${cleanTitle(x.title) || "Untitled"}”`,
        url: refUrl({ type: "doc", id: x.id }),
        at: x.at,
      });
    // Other agents' changes in Personal: counted only (their summaries can
    // name things this connection doesn't reach).
    out.others += (
      await ctx.db.query<{ n: number }>(
        `SELECT coalesce(sum(greatest(a.changes, 1)), 0)::int AS n
           FROM agent_activity a
          WHERE a.user_id = $1 AND a.at > $2 AND a.tier <> 'R'
            AND a.outcome = 'ok' AND a.team_id IS NULL
            AND a.grant_id IS DISTINCT FROM $3::uuid`,
        [me, at, grant],
      )
    ).rows[0].n;
  }

  // Sessions the person moved themselves (their own, on tasks it can see).
  const b = fresh();
  out.moved = (
    await ctx.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM time_blocks b JOIN items i ON i.id = b.item_id
        WHERE b.user_id = ${b.scope.user} AND b.moved_at > ${b.atP}
          AND b.moved_via IS NULL AND ${visibleItems("i", b.scope)}`,
      b.params.values,
    )
  ).rows[0].n;

  if (teamIds.length) {
    const c = fresh();
    const teamsP = c.params.add(teamIds);
    const grantP = c.params.add(grant);
    const rows = (
      await ctx.db.query<{
        team_id: string;
        kind: string;
        action: string;
        object_id: string;
        title: string;
        mine: boolean;
        who: string | null;
        via: string | null;
        at: Date;
      }>(
        `SELECT c.team_id, c.kind, c.action, c.object_id, c.title, c.at,
                (c.user_id = ${c.scope.user} AND c.via_grant_id IS NULL) AS mine,
                who.name AS who, g.name AS via
           FROM team_changes c
           LEFT JOIN users who ON who.id = c.user_id
           LEFT JOIN agent_grants g ON g.id = c.via_grant_id
           LEFT JOIN items i ON c.kind <> 'page' AND i.id = c.object_id
           LEFT JOIN docs d ON c.kind = 'page' AND d.id = c.object_id
          WHERE c.team_id = ANY (${teamsP}::uuid[]) AND c.at > ${c.atP}
            AND c.via_grant_id IS DISTINCT FROM ${grantP}::uuid
            AND CASE WHEN c.kind = 'page'
                     THEN d.id IS NOT NULL AND ${visibleDocs("d", c.scope)}
                     ELSE i.id IS NOT NULL AND ${visibleItems("i", c.scope)} END
          ORDER BY c.at DESC LIMIT 500`,
        c.params.values,
      )
    ).rows;
    let shown = 0;
    for (const x of rows) {
      if (x.mine) {
        if (x.kind === "task" && x.action === "created") out.added++;
        else if (x.kind === "task" && x.action === "done") out.done++;
        else if (x.kind === "page") out.pages++;
        continue;
      }
      out.others++;
      if (shown++ < TOP)
        top.push({
          what: `${cleanTitle(x.who) || "Someone"}${x.via ? ` via ${cleanTitle(x.via)}` : ""} ${ACTION[x.action] ?? x.action} the ${KIND[x.kind] ?? x.kind} “${cleanTitle(x.title) || "Untitled"}” in ${teamName(x.team_id)}`,
          url: refUrl({
            type: x.kind === "page" ? "doc" : "task",
            id: x.object_id,
          }),
          at: x.at,
        });
    }
  }
  out.top = top
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, TOP)
    .map(({ what, url }) => ({ what, url }));
  return out;
}

/** The warm start in words, for get_context's text. */
export function warmMarkdown(
  w: Warm,
  teamName: (id: string | null) => string,
): string[] {
  const lines: string[] = [];
  if (w.profile)
    lines.push(
      "",
      `## About me for agents (${w.profile.id}, ${w.profile.url})`,
      w.profile.markdown,
    );
  else
    lines.push(
      "",
      'No "About me for agents" page yet: make one with create_doc (kind "profile") when you learn how they like to work.',
    );
  const learning = w.learning as LearningProfile;
  if (hasLearning(learning))
    lines.push(`Learning profile: ${learningText(learning)}.`);
  if (w.instructions.length)
    lines.push(
      "",
      "## Instructions (follow them in that space)",
      ...w.instructions.map(
        (i) =>
          `- ${teamName(i.space === "personal" ? null : i.space)}: ${i.text}`,
      ),
    );
  if (w.rules.length)
    lines.push(
      "",
      "## Standing rules (follow them)",
      ...w.rules.map(
        (r) =>
          `- ${r.kind ? `${AGENT_INBOX_KIND_LABELS[r.kind as AgentInboxKind]?.name ?? r.kind}: ` : ""}${r.text}`,
      ),
    );
  const s = w.since;
  lines.push("", "## Since we last spoke");
  if (!s.at)
    lines.push(
      `First time here: nothing to compare with yet.${s.inbox ? ` ${s.inbox} open in the inbox (get_inbox).` : ""}${s.waiting ? ` ${s.waiting} of your questions or suggestions wait on the person.` : ""}`,
    );
  else {
    lines.push(
      `Since ${s.at}: ${s.inbox} new in the inbox (get_inbox); they added ${s.added} task${s.added === 1 ? "" : "s"}, finished ${s.done}, edited ${s.pages} page${s.pages === 1 ? "" : "s"}, moved ${s.moved} session${s.moved === 1 ? "" : "s"}; ${s.others} change${s.others === 1 ? "" : "s"} by teammates or other agents; ${s.waiting} of your questions or suggestions wait on the person.`,
      ...s.top.map((t) => `- ${t.what}: ${t.url}`),
    );
  }
  lines.push(`Settings: ${appUrl()}/app/settings`);
  return lines;
}
