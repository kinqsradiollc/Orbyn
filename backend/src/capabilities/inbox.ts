import { z } from "zod";
import {
  AGENT_INBOX_ACKS,
  AGENT_INBOX_DAYS,
  AGENT_INBOX_KINDS,
  AGENT_INBOX_KIND_LABELS,
  MAX_QUESTION_CHOICES,
  QUESTION_DEFAULT_HOURS,
  type AgentInboxKind,
  type AgentToolset,
} from "@orbyn/core";
import {
  Params,
  scopeFor,
  visibleDocs,
  visibleItems,
  visibleProjects,
  visibleRecords,
} from "../lib/visibility.js";
import {
  createQuestion,
  matchChoice,
  questionFor,
  recordChatAnswer,
  type QuestionRow,
} from "../modules/agent-inbox/questions.js";
import { OPEN_ITEM } from "../modules/agent-inbox/service.js";
import { READ, cursorInput } from "./common.js";
import {
  cleanTitle,
  fence,
  hiddenText,
  isOutside,
  localTime,
  type Provenance,
} from "./format.js";
import { policy, type Principal } from "./policy.js";
import { appUrl, refs } from "./refs.js";
import {
  CapabilityError,
  defineCapability,
  type CapabilityContext,
} from "./registry.js";
import { markNotices } from "./followthrough.js";
import {
  ADDS,
  clientRefInput,
  dbOf,
  idField,
  isoTime,
  refuseSecrets,
} from "./write.js";

/**
 * Everything routes to your agent (Agent 2, H0). Each connection has an
 * inbox: booking requests, mentions and comments, invites, deadlines at
 * risk, finished imports, study, tasks from email, the person's review
 * decisions on its suggestions, teammates' asks and answers to its own
 * questions. get_inbox reads it (what's not dealt with first), ack_inbox
 * marks items done, snoozed or dismissed, and ask_person puts a question to
 * the person: in the chat when the app can show a form, otherwise as a
 * card in Orbyn and a push. Items say what happened in plain words, link to
 * what they're about, suggest the tools to act with, and carry the
 * person's standing rules for that kind of thing.
 */

type ItemRow = {
  id: string;
  kind: AgentInboxKind;
  title: string;
  body: string;
  source: string;
  entity_type: string | null;
  entity_id: string | null;
  team_id: string | null;
  project_id: string | null;
  state: "new" | "done" | "snoozed" | "dismissed";
  snooze_until: Date | null;
  note: string | null;
  created_at: Date;
  open: boolean;
};

/** Tools that act on each kind, with the toolset each needs. */
const NEXT: Record<AgentInboxKind, [string, AgentToolset][]> = {
  booking: [
    ["get_bookings", "booking"],
    ["booking_action", "booking"],
  ],
  mention: [
    ["fetch", "core"],
    ["comment_on_doc", "workspace"],
  ],
  invite: [
    ["get_context", "core"],
    ["get_team", "teams"],
  ],
  deadline: [
    ["fetch", "core"],
    ["plan_schedule", "core"],
    ["schedule_sessions", "core"],
    ["update_tasks", "core"],
  ],
  import: [
    ["fetch", "core"],
    ["edit_doc", "core"],
    ["tasks_from_doc", "workspace"],
  ],
  study: [
    ["get_study", "study"],
    ["plan_revision", "study"],
  ],
  email_task: [
    ["fetch", "core"],
    ["update_tasks", "core"],
    ["complete_tasks", "core"],
  ],
  review: [["list_agent_changes", "core"]],
  ask: [
    ["get_follow_through", "followthrough"],
    ["answer_ask", "followthrough"],
  ],
  answer: [],
};

/** Kinds addressed to one connection, whatever space it reaches. */
const ADDRESSED = new Set<AgentInboxKind>(["review", "answer"]);

const ref = z.object({
  id: z.string(),
  uri: z.string().nullable(),
  url: z.string(),
});

const item = z.object({
  id: z.string(),
  kind: z.string(),
  at: z.string(),
  at_local: z.string(),
  state: z.string(),
  snooze_until: z.string().nullable(),
  what: z.string(),
  from: z.string(),
  refs: z.array(ref),
  next: z.array(z.string()),
  rules: z.array(z.string()),
  note: z.string().nullable(),
});

const questionOut = z.object({
  id: z.string(),
  question: z.string(),
  choices: z.array(z.string()),
  status: z.string(),
  answer: z.string().nullable(),
  answered_via: z.string().nullable(),
  expires_at: z.string(),
});

const questionState = (q: QuestionRow) => ({
  id: `question:${q.id}`,
  question: cleanTitle(q.question),
  choices: q.choices,
  status: q.status,
  answer: q.answer,
  answered_via: q.answered_via,
  expires_at: q.expires_at.toISOString(),
});

/** An inbox id: inbox:<n> or n. */
const inboxId = z
  .string()
  .trim()
  .max(30)
  .refine(
    (v) => /^(inbox:)?\d{1,18}$/.test(v),
    "Use an inbox:<n> id from get_inbox.",
  )
  .transform((v) => v.replace(/^inbox:/, ""));

/** A question id: question:<uuid> or the uuid. */
const questionId = z
  .string()
  .trim()
  .max(50)
  .refine(
    (v) =>
      /^(question:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        v,
      ),
    "Use a question:<id> from ask_person.",
  )
  .transform((v) => v.replace(/^question:/i, "").toLowerCase());

/** The fence label for words from `source`. */
const provenance = (source: string): Provenance =>
  source === "teammate" ? "teammate:a teammate" : (source as Provenance);

/** The item in plain words: fenced when others wrote it, hidden if asked. */
function whatHappened(p: Principal, r: ItemRow): string {
  const text = [cleanTitle(r.title), r.body.trim()].filter(Boolean).join("\n");
  if (r.source === "orbyn") return text;
  if (isOutside(r.source) && p.flags.hide_outside_content)
    return `${AGENT_INBOX_KIND_LABELS[r.kind].name}. ${hiddenText(r.source)}`;
  return fence(text, provenance(r.source));
}

/** Links to what an item is about. */
function refsOf(r: ItemRow): z.output<typeof ref>[] {
  if (!r.entity_id) return [];
  const id = r.entity_id;
  switch (r.entity_type) {
    case "task":
    case "doc":
    case "project":
    case "proposal":
      return [refs({ type: r.entity_type, id })];
    case "record":
      return [refs({ type: "record", id }, r.project_id)];
    case "booking":
    case "question":
    case "team":
      return [
        { id: `${r.entity_type}:${id}`, uri: null, url: `${appUrl()}/app` },
      ];
    default:
      return [];
  }
}

/** Items whose task, page, project or record `p` can no longer read. */
async function unreadable(
  ctx: CapabilityContext,
  rows: ItemRow[],
): Promise<Set<string>> {
  const gone = new Set<string>();
  const checks = {
    task: ["items", "i", visibleItems],
    doc: ["docs", "d", visibleDocs],
    project: ["projects", "p", visibleProjects],
    record: ["work_records", "w", visibleRecords],
  } as const;
  for (const [type, [table, alias, visible]] of Object.entries(checks)) {
    const ids = [
      ...new Set(
        rows
          .filter((r) => r.entity_type === type && r.entity_id)
          .map((r) => r.entity_id!),
      ),
    ];
    if (!ids.length) continue;
    const params = new Params();
    const scope = scopeFor(ctx.spaces, params);
    const at = params.add(ids);
    const seen = new Set(
      (
        await ctx.db.query<{ id: string }>(
          `SELECT ${alias}.id FROM ${table} ${alias}
            WHERE ${alias}.id = ANY (${at}::uuid[]) AND ${visible(alias, scope)}`,
          params.values,
        )
      ).rows.map((r) => r.id),
    );
    for (const r of rows)
      if (r.entity_type === type && r.entity_id && !seen.has(r.entity_id))
        gone.add(r.id);
  }
  return gone;
}

/** Whether `p` may still see an item: its space, and bookings' toolset. */
function reachable(p: Principal, r: ItemRow): boolean {
  if (r.kind === "booking" && !p.toolsets.includes("booking")) return false;
  if (ADDRESSED.has(r.kind)) return true;
  return policy.levelIn(p, r.team_id) !== null;
}

// --- get_inbox ------------------------------------------------------------------

export const getInbox = defineCapability({
  name: "get_inbox",
  title: "What happened for you",
  description: `This connection's inbox of what happened in Orbyn (bookings, mentions, invites, deadlines, imports, study, email tasks, review decisions, asks, answers to ask_person), open items first. Each item says what happened, with refs, next (tools to act with) and rules (the person's standing rules: follow them). Kept ${AGENT_INBOX_DAYS} days; mark items with ack_inbox. question looks up an ask_person question.`,
  input: z
    .object({
      kinds: z
        .array(
          z
            .string()
            .max(20)
            .refine(
              (k) => (AGENT_INBOX_KINDS as readonly string[]).includes(k),
              `Kinds are ${AGENT_INBOX_KINDS.join(", ")}.`,
            ),
        )
        .max(10)
        .optional(),
      include_done: z.boolean().default(false),
      question: questionId.optional(),
      limit: z.number().int().min(1).max(50).default(20),
      cursor: cursorInput,
    })
    .strict(),
  output: z.object({
    items: z.array(item),
    unread: z.number(),
    question: questionOut.nullable(),
    next_cursor: z.string().nullable(),
  }),
  annotations: READ,
  access: "read",
  toolset: "core",
  mode: "read",
  tier: "R",
  async run(ctx, a) {
    const p = ctx.principal;
    if (!p.grant_id)
      return {
        structured: { items: [], unread: 0, question: null, next_cursor: null },
        markdown: "Only a connected agent has an inbox.",
      };
    const question = a.question
      ? await questionFor(ctx.db, p.grant_id, p.user.id, a.question)
      : null;
    if (a.question && !question)
      throw new CapabilityError(
        "NOT_FOUND",
        "That isn't one of this connection's questions.",
        "ask_person returns the question's id.",
      );
    const offset = await ctx.cursor.open(a.cursor);
    const rows = (
      await ctx.db.query<ItemRow>(
        `SELECT i.id::text, i.kind, i.title, i.body, i.source, i.entity_type,
                i.entity_id::text, i.team_id::text, i.project_id::text, i.state,
                i.snooze_until, i.note, i.created_at, ${OPEN_ITEM("i")} AS open
           FROM agent_inbox i
          WHERE i.grant_id = $1 AND i.user_id = $2
            AND ($3::text[] IS NULL OR i.kind = ANY ($3::text[]))
            AND ($4::boolean OR ${OPEN_ITEM("i")})
          ORDER BY ${OPEN_ITEM("i")} DESC, i.created_at DESC, i.id DESC
          OFFSET $5 LIMIT $6`,
        [
          p.grant_id,
          p.user.id,
          a.kinds?.length ? a.kinds : null,
          a.include_done,
          offset,
          a.limit + 1,
        ],
      )
    ).rows;
    const more = rows.length > a.limit;
    const page = rows.slice(0, a.limit);
    const gone = await unreadable(ctx, page);
    const rules = (
      await ctx.db.query<{ kind: AgentInboxKind | null; text: string }>(
        "SELECT kind, text FROM agent_rules WHERE user_id = $1 ORDER BY created_at, id LIMIT 50",
        [p.user.id],
      )
    ).rows;
    const unread = (
      await ctx.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM agent_inbox i
          WHERE i.grant_id = $1 AND i.user_id = $2 AND ${OPEN_ITEM("i")}`,
        [p.grant_id, p.user.id],
      )
    ).rows[0].n;
    const canAck = policy.allows(p, {
      access: "suggest",
      toolset: "core",
    });
    const items = page
      .filter((r) => !gone.has(r.id) && reachable(p, r))
      .map((r) => ({
        id: `inbox:${r.id}`,
        kind: r.kind,
        at: r.created_at.toISOString(),
        at_local: localTime(r.created_at, ctx.timezone),
        state: r.open && r.state === "snoozed" ? ("new" as const) : r.state,
        snooze_until:
          r.state === "snoozed" && r.snooze_until && !r.open
            ? r.snooze_until.toISOString()
            : null,
        what: whatHappened(p, r),
        from: r.source,
        refs: refsOf(r),
        next: [
          ...NEXT[r.kind]
            .filter(([, toolset]) => p.toolsets.includes(toolset))
            .map(([tool]) => tool),
          ...(canAck ? ["ack_inbox"] : []),
        ],
        rules: rules
          .filter((x) => x.kind === null || x.kind === r.kind)
          .map((x) => cleanTitle(x.text)),
        note: r.note,
      }));
    const next = more ? await ctx.cursor.seal(offset + a.limit) : null;
    const lines = items.map(
      (x) =>
        `### ${x.id} · ${AGENT_INBOX_KIND_LABELS[x.kind].name} · ${x.at_local}${x.state !== "new" ? ` (${x.state})` : ""}\n${x.what}${x.refs.length ? `\nRefs: ${x.refs.map((r) => r.id).join(", ")}` : ""}${x.next.length ? `\nNext: ${x.next.join(", ")}` : ""}${x.rules.length ? `\nRules: ${x.rules.map((t) => `“${t}”`).join("; ")}` : ""}`,
    );
    const q = question ? questionState(question) : null;
    const markdown = [
      q
        ? `Question ${q.id}: ${q.status}${q.answer ? `, answered “${q.answer}”${q.answered_via ? ` (${q.answered_via})` : ""}` : ""}.`
        : null,
      `${unread} not dealt with.`,
      lines.length ? lines.join("\n\n") : "Nothing here.",
    ]
      .filter(Boolean)
      .join("\n\n");
    return {
      structured: { items, unread, question: q, next_cursor: next },
      markdown,
    };
  },
});

// --- ack_inbox -------------------------------------------------------------------

export const ackInbox = defineCapability({
  name: "ack_inbox",
  title: "Mark inbox items",
  description:
    "Marks up to 50 of this connection's inbox items (inbox:<n>): done, snooze (back at until) or dismiss, with an optional note. notices marks the person's in-app notices read (ids from get_follow_through or get_today, or \"all\").",
  input: z
    .object({
      ids: z.array(inboxId).max(50).optional(),
      action: z.enum(AGENT_INBOX_ACKS).optional(),
      until: isoTime.optional(),
      note: z.string().trim().max(500).optional(),
      notices: z
        .union([z.literal("all"), z.array(idField).min(1).max(100)])
        .optional(),
      client_ref: clientRefInput,
    })
    .strict(),
  output: z.object({
    acked: z.array(
      z.object({
        id: z.string(),
        state: z.string(),
        snooze_until: z.string().nullable(),
      }),
    ),
    missing: z.array(z.string()),
    notices_read: z.number(),
  }),
  annotations: ADDS,
  access: "suggest",
  toolset: "core",
  mode: "write",
  tier: "W1",
  async run(ctx, a) {
    const p = ctx.principal;
    const ids = [...new Set(a.ids ?? [])];
    if (!ids.length && !a.notices)
      throw new CapabilityError("INVALID", "Give inbox ids, or notices.");
    if (ids.length && !a.action)
      throw new CapabilityError(
        "INVALID",
        "Say what to do with them: done, snooze or dismiss.",
      );
    const notices = a.notices ? await markNotices(ctx, a.notices) : 0;
    if (!ids.length)
      return {
        structured: { acked: [], missing: [], notices_read: notices },
        markdown: `${notices} notice${notices === 1 ? "" : "s"} marked read.`,
        targets: [],
      };
    if (!p.grant_id)
      throw new CapabilityError(
        "INVALID",
        "Only a connected agent has an inbox.",
      );
    refuseSecrets(a.note);
    let until: Date | null = null;
    if (a.action === "snooze") {
      if (!a.until)
        throw new CapabilityError(
          "INVALID",
          "Snoozing needs until: when it should come back.",
        );
      until = new Date(a.until);
      if (until <= ctx.now)
        throw new CapabilityError("INVALID", "until must be in the future.");
    } else if (a.until)
      throw new CapabilityError("INVALID", "until is only for snooze.");
    const state =
      a.action === "done"
        ? "done"
        : a.action === "snooze"
          ? "snoozed"
          : "dismissed";
    const rows = (
      await dbOf(ctx).query<{
        id: string;
        state: string;
        snooze_until: Date | null;
      }>(
        `UPDATE agent_inbox SET state = $4, snooze_until = $5,
           note = coalesce($6, note), acked_at = now()
          WHERE grant_id = $1 AND user_id = $2 AND id = ANY ($3::bigint[])
          RETURNING id::text, state, snooze_until`,
        [p.grant_id, p.user.id, ids, state, until, a.note ?? null],
      )
    ).rows;
    const found = new Set(rows.map((r) => r.id));
    const acked = rows.map((r) => ({
      id: `inbox:${r.id}`,
      state: r.state,
      snooze_until: r.snooze_until?.toISOString() ?? null,
    }));
    const missing = ids.filter((i) => !found.has(i)).map((i) => `inbox:${i}`);
    return {
      structured: { acked, missing, notices_read: notices },
      markdown: `${acked.length} marked ${state}${until ? ` until ${localTime(until, ctx.timezone)}` : ""}.${missing.length ? ` Not in this inbox: ${missing.join(", ")}.` : ""}${a.notices ? ` ${notices} notice${notices === 1 ? "" : "s"} marked read.` : ""}`,
      targets: acked.map((x) => x.id),
    };
  },
});

// --- ask_person ------------------------------------------------------------------

const choiceText = z.string().trim().min(1).max(60);

export const askPerson = defineCapability({
  name: "ask_person",
  title: "Ask the person",
  description: `Asks your person a question: up to ${MAX_QUESTION_CHOICES} choices (none: yes/no), optional default (used if it runs out) and expiry (${QUESTION_DEFAULT_HOURS} h). Apps with forms answer in the chat at once; otherwise it returns status open and the answer arrives in get_inbox as an answer item (a card and push in Orbyn). question_id alone looks up its status.`,
  input: z
    .object({
      question: z.string().trim().min(1).max(300).optional(),
      detail: z.string().trim().max(1000).optional(),
      choices: z.array(choiceText).min(2).max(MAX_QUESTION_CHOICES).optional(),
      default: choiceText.optional(),
      expires_in_hours: z
        .number()
        .int()
        .min(1)
        .max(168)
        .default(QUESTION_DEFAULT_HOURS),
      question_id: questionId.optional(),
      client_ref: clientRefInput,
    })
    .strict(),
  output: z.object({
    question_id: z.string().nullable(),
    status: z.string(),
    answer: z.string().nullable(),
    answered_via: z.string().nullable(),
    choices: z.array(z.string()),
    expires_at: z.string().nullable(),
  }),
  annotations: ADDS,
  access: "suggest",
  toolset: "core",
  mode: "write",
  tier: "W1",
  async run(ctx, a) {
    const p = ctx.principal;
    const db = dbOf(ctx);
    if (!p.grant_id)
      throw new CapabilityError(
        "INVALID",
        "Only a connected agent can ask its person.",
      );
    const answerOf = (q: QuestionRow) => ({
      structured: {
        question_id: `question:${q.id}`,
        status: q.status,
        answer: q.answer,
        answered_via: q.answered_via,
        choices: q.choices,
        expires_at: q.status === "open" ? q.expires_at.toISOString() : null,
      },
      markdown:
        q.status === "open"
          ? `Asked (question:${q.id}): waiting for an answer in Orbyn until ${localTime(q.expires_at, ctx.timezone)}. The answer arrives in get_inbox as an "answer" item.`
          : q.status === "answered"
            ? `Answered: ${q.answer}${q.answered_via === "default" ? " (the default, as time ran out)" : ""}.`
            : "No answer in time.",
      targets: [`question:${q.id}`],
    });
    // A status lookup.
    if (a.question_id) {
      const q = await questionFor(db, p.grant_id, p.user.id, a.question_id);
      if (!q)
        throw new CapabilityError(
          "NOT_FOUND",
          "That isn't one of this connection's questions.",
        );
      return answerOf(q);
    }
    if (!a.question)
      throw new CapabilityError(
        "INVALID",
        "Give question (and choices, or none for yes/no), or question_id to look one up.",
      );
    refuseSecrets(a.question, a.detail, ...(a.choices ?? []));
    const given = a.choices ?? ["Yes", "No"];
    if (new Set(given.map((c) => c.toLowerCase())).size !== given.length)
      throw new CapabilityError("INVALID", "Each choice must be different.");
    const yesNo =
      given.length === 2 &&
      given[0].toLowerCase() === "yes" &&
      given[1].toLowerCase() === "no";
    const choices = yesNo ? ["Yes", "No"] : given;
    const fallback = a.default
      ? (choices.find((c) => c.toLowerCase() === a.default!.toLowerCase()) ??
        null)
      : null;
    if (a.default && !fallback)
      throw new CapabilityError(
        "INVALID",
        "default must be one of the choices.",
      );
    const question = {
      question: a.question,
      detail: a.detail ?? null,
      choices,
      yes_no: yesNo,
      default_choice: fallback,
    };
    // The app can show a form: ask in the chat.
    if (ctx.asking?.mode === "collect") {
      ctx.asking.question = question;
      ctx.asking.reasons.push({
        kind: "question",
        text: "your agent is asking you",
      });
      return {
        structured: {
          question_id: null,
          status: "open" as const,
          answer: null,
          answered_via: null,
          choices,
          expires_at: null,
        },
        markdown: "Asking the person.",
      };
    }
    // Answered (or not) in the chat.
    const chat = ctx.asking?.answer;
    if (chat) {
      if (chat.outcome !== "answered")
        return {
          structured: {
            question_id: null,
            status: chat.outcome,
            answer: null,
            answered_via: "chat",
            choices,
            expires_at: null,
          },
          markdown:
            chat.outcome === "declined"
              ? "The person chose not to answer in the chat."
              : "The person closed the question without answering.",
        };
      const picked =
        typeof chat.answer === "boolean"
          ? chat.answer
            ? choices[0]
            : choices[1]
          : matchChoice(
              { yes_no: yesNo, choices } as QuestionRow,
              String(chat.answer),
            );
      if (!picked)
        throw new CapabilityError(
          "INVALID",
          "The answer in the chat wasn't one of the choices.",
          "Ask again.",
        );
      const q = await recordChatAnswer(db, {
        grantId: p.grant_id,
        userId: p.user.id,
        question: a.question,
        detail: a.detail ?? null,
        choices,
        yesNo,
        defaultChoice: fallback,
        answer: picked,
      });
      return answerOf(q);
    }
    // Otherwise a card in Orbyn and a push.
    const q = await createQuestion(db, {
      grantId: p.grant_id,
      userId: p.user.id,
      question: a.question,
      detail: a.detail ?? null,
      choices,
      yesNo,
      defaultChoice: fallback,
      expiresAt: new Date(ctx.now.getTime() + a.expires_in_hours * 3_600_000),
    });
    return answerOf(q);
  },
});
