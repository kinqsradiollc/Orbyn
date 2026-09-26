import { z } from "zod";
import { SYSTEM_ROLES, TEAM_ROLES } from "./rbac.js";
import { AI_PROVIDER_KINDS } from "./aiProviders.js";
import { isTimeZone, isValidRrule } from "./time.js";
import { DOC_KINDS } from "./docs.js";
import { PROJECT_STATUSES } from "./projects.js";
import { FAVOURITE_KINDS } from "./folders.js";

/** When a session's reminder can go: as it starts, or minutes before. */
export const SESSION_REMINDER_MINUTES = [0, 5, 10, 15];

export const KINDS = ["task", "event"] as const;
export const STATUSES = [
  "todo",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
] as const;
/**
 * Statuses that close a task. Done is finished; cancelled is closed without
 * being done (no progress, no `item.completed`, and a repeating task stops).
 */
export const CLOSED_STATUSES = ["done", "cancelled"] as const;
/** Whether a status closes an item (done or cancelled). */
export const isClosed = (status: string) =>
  (CLOSED_STATUSES as readonly string[]).includes(status);
export const PRIORITIES = ["low", "medium", "high"] as const;
/** Largest reminder window: one week in minutes. */
export const MAX_REMINDER_MINUTES = 10080;

export const credentials = z.object({
  email: z
    .string()
    .trim()
    .pipe(z.email().max(254))
    .transform((s) => s.toLowerCase()),
  password: z.string().min(10).max(128),
  // A blank name means "use the default", not a validation error.
  name: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((s) => s || "My space"),
  /**
   * The Terms version the person agreed to on the sign-up form, having
   * confirmed they're old enough. Older apps don't send it; they're asked to
   * accept once signed in.
   */
  accept_terms: z.string().trim().min(1).max(40).optional(),
});

/** Signing in checks the password itself, not the sign-up rules, so a
 * wrong short password is "incorrect" (401), never a validation error. */
export const loginCredentials = z.object({
  email: credentials.shape.email,
  password: z.string().min(1).max(128),
  /** A two-step code (TOTP or a recovery code), when the account has it on. */
  code: z.string().trim().max(20).optional(),
});

/** Confirm two-step setup with a code from the authenticator app. */
export const twoFactorEnable = z
  .object({ code: z.string().trim().min(6).max(10) })
  .strict();
/** Turn two-step off; the password guards it. */
export const twoFactorDisable = z
  .object({ password: z.string().min(1).max(128) })
  .strict();

/** "I forgot my password": always answered the same way, whoever the email is. */
export const forgotPassword = z.object({ email: credentials.shape.email });

/** Setting a new password from a reset link. The password rules apply again. */
export const resetPassword = z.object({
  token: z.string().min(1).max(400),
  password: credentials.shape.password,
});

/** Confirming an email address from a verification link. */
export const emailToken = z.object({ token: z.string().min(1).max(400) });

/** WebAuthn payloads are validated by the server library; keep them loose here. */
const webauthnResponse = z.record(z.string(), z.unknown());
export const passkeyRegister = z
  .object({
    response: webauthnResponse,
    name: z.string().trim().max(60).default(""),
  })
  .strict();
export const passkeyAuthOptions = z
  .object({ email: z.string().trim().max(254).optional() })
  .strict();
export const passkeyAuth = z
  .object({ handle: z.string().min(1).max(200), response: webauthnResponse })
  .strict();

/** A video-call link; empty for none. */
const meetingUrl = z
  .string()
  .trim()
  .max(500)
  .refine(
    (v) => v === "" || /^https?:\/\/\S+$/i.test(v),
    "Meeting links start with https://",
  );
const timeZoneField = z
  .string()
  .trim()
  .max(80)
  .refine(isTimeZone, "Unknown time zone");
const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Colours look like #376c51");
const emailAddress = z
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());

/** Largest alert: four weeks before, in minutes. */
export const MAX_ALERT_MINUTES = 40320;
/** Alerts before an item, in minutes: up to 5, each at most four weeks. */
export const alertsField = z
  .array(z.number().int().min(0).max(MAX_ALERT_MINUTES))
  .max(5, "Up to 5 alerts")
  .transform((a) => [...new Set(a)].sort((x, y) => x - y));

/** Most links a task can carry. */
export const MAX_ITEM_LINKS = 20;
/** A web link on a task: http or https only. */
export const itemLinkInput = z
  .object({
    url: z
      .string()
      .trim()
      .max(2000)
      .regex(/^https?:\/\/\S+$/i, "Links start with http:// or https://"),
    title: z.string().trim().max(200).default(""),
  })
  .strict();

/** Someone invited to an event by email. */
export const attendeeInput = z
  .object({
    email: emailAddress,
    name: z.string().trim().max(120).optional(),
  })
  .strict();

export const itemData = z
  .object({
    title: z.string().trim().min(1).max(200),
    notes: z.string().max(10000).default(""),
    kind: z.enum(KINDS).default("task"),
    status: z.enum(STATUSES).default("todo"),
    priority: z.enum(PRIORITIES).default("medium"),
    due_at: z.iso.datetime({ offset: true }).nullable().default(null),
    end_at: z.iso.datetime({ offset: true }).nullable().default(null),
    /**
     * Older apps' single reminder. When a write gives it without `alerts`,
     * it sets the (smallest) alert. Responses carry the smallest alert, or
     * null when there are none; null in a request means "not given".
     */
    reminder_minutes: z.preprocess(
      (v) => (v === null ? undefined : v),
      z.number().int().min(0).max(MAX_REMINDER_MINUTES).optional(),
    ),
    /** Shared team this item belongs to; null for a personal item. */
    team_id: z.uuid().nullable().default(null),
    /** 0-100. Optional: omitted on edit keeps the saved value; checklists set it. */
    progress: z.number().int().min(0).max(100).optional(),
    // Planning fields. Like progress, each one omitted on edit keeps the
    // saved value, so older apps never clear them.
    /** How long the task should take, in minutes; the planner uses it. */
    estimate_minutes: z.number().int().min(1).max(10080).nullable().optional(),
    list_id: z.uuid().nullable().optional(),
    tag_ids: z.array(z.uuid()).max(20).optional(),
    /**
     * Tasks this one waits on. The planner will not place a task before every
     * prerequisite is finished or fully scheduled. Omitted on edit keeps what
     * is saved, the way the other planning fields do.
     */
    prerequisite_ids: z.array(z.uuid()).max(14).optional(),
    /** Who on the team is doing a team task. */
    assignee_id: z.uuid().nullable().optional(),
    /**
     * A number the task moves towards ("signups: 320 of 500"): a key result.
     * While a target is set, progress follows current / target. Omitted on
     * edit keeps what is saved; null clears it.
     */
    target_value: z.number().min(-1e12).max(1e12).nullable().optional(),
    current_value: z.number().min(-1e12).max(1e12).nullable().optional(),
    value_unit: z.string().trim().max(16).optional(),
    location: z.string().trim().max(300).optional(),
    meeting_url: meetingUrl.optional(),
    /** How the item repeats, for example "FREQ=WEEKLY;BYDAY=MO,WE". */
    rrule: z
      .string()
      .trim()
      .max(200)
      .refine(isValidRrule, "That repeat rule isn't supported")
      .nullable()
      .optional(),
    /** The time zone a repeating or all-day item keeps its wall-clock time in. */
    timezone: timeZoneField.optional(),
    // Event fields. Like the planning fields, omitted on edit keeps the saved value.
    /**
     * A whole-day item: `due_at` is local midnight in its time zone and
     * `end_at` the (exclusive) midnight it ends. Never busy.
     */
    all_day: z.boolean().optional(),
    /** Whether an event counts as busy (default true). Free events don't block time. */
    busy: z.boolean().optional(),
    /** Its own colour on the calendar; null uses the list's or the default. */
    color: hexColor.nullable().optional(),
    /** Minutes before `due_at` to remind, up to 5 (0 = at the time). */
    alerts: alertsField.optional(),
    /** People invited by email (events only, up to 50). */
    attendees: z
      .array(attendeeInput)
      .max(50, "Up to 50 people")
      .refine(
        (a) => new Set(a.map((x) => x.email)).size === a.length,
        "Invite each person once",
      )
      .optional(),
    /**
     * The task this one is a subtask of (tasks only, three levels at most,
     * in the same space as its parent). Omitted on edit keeps it; null
     * makes it a top-level task.
     */
    parent_id: z.uuid().nullable().optional(),
    /**
     * The project the item is filed in, in its own space (a team's project
     * for a team item, one of the owner's own for a personal item), and
     * which of its stages. Omitted on edit keeps what is saved; null takes it
     * out. A project given without a stage puts it in no stage, unless it is
     * the one it's already in. Moving to another space takes it out of the
     * old space's project.
     */
    project_id: z.uuid().nullable().optional(),
    stage_id: z.uuid().nullable().optional(),
    /** Web links on the item (up to 20). Sending the list replaces it. */
    links: z
      .array(itemLinkInput)
      .max(MAX_ITEM_LINKS, `Up to ${MAX_ITEM_LINKS} links`)
      .optional(),
  })
  .strict()
  .refine(
    (d) =>
      !d.end_at || (!!d.due_at && Date.parse(d.end_at) > Date.parse(d.due_at)),
    "End must be after start",
  )
  .refine((d) => !d.all_day || !!d.due_at, "All-day items need a date")
  .refine(
    (d) => !d.attendees?.length || d.kind === "event",
    "Only events can have people invited",
  )
  .refine(
    (d) => d.kind !== "event" || !!d.due_at,
    "Events require a start time",
  )
  .refine((d) => !d.rrule || !!d.due_at, "Repeating items need a date")
  .refine(
    (d) => !d.assignee_id || !!d.team_id,
    "Only team items can be assigned to someone",
  )
  .refine(
    (d) => !d.parent_id || d.kind === "task",
    "Only tasks can be subtasks",
  )
  .refine(
    (d) => !d.stage_id || d.project_id !== null,
    "A stage belongs to a project: pick the project too",
  );

// Documents. The body is the editor's block list; each block is validated so a
// malformed document can't be stored, and titles stay short enough to show in a
// list row.
/**
 * A line's name. Anything that points at a line — a comment, a task link —
 * points at this, so every kind of block carries one. Only checklist lines
 * used to, which meant a name given to a paragraph was quietly dropped on
 * the next save and everything hanging on it came loose.
 */
const named = { id: z.string().max(64).optional() };
/** How far a list line is tucked in; left out at the top level. */
const nested = { depth: z.number().int().min(0).max(3).optional() };

const docBlock = z.discriminatedUnion("type", [
  z.object({
    ...named,
    type: z.literal("heading"),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    text: z.string().max(2000),
  }),
  z.object({
    ...named,
    type: z.literal("paragraph"),
    text: z.string().max(10000),
  }),
  z.object({
    ...named,
    ...nested,
    type: z.literal("bullet"),
    text: z.string().max(4000),
  }),
  z.object({
    ...named,
    ...nested,
    type: z.literal("numbered"),
    text: z.string().max(4000),
    /** Where a list begins, when it isn't at 1. */
    start: z.number().int().min(0).max(99_999).optional(),
  }),
  z.object({
    ...named,
    ...nested,
    type: z.literal("todo"),
    text: z.string().max(4000),
    done: z.boolean(),
  }),
  z.object({ ...named, type: z.literal("quote"), text: z.string().max(4000) }),
  z.object({
    ...named,
    type: z.literal("code"),
    text: z.string().max(20000),
    lang: z.string().max(20).default(""),
  }),
  z.object({
    ...named,
    type: z.literal("math"),
    text: z.string().max(4000),
    check: z.boolean().optional(),
  }),
  z.object({ ...named, type: z.literal("divider") }),
]);

export const docContent = z.array(docBlock).max(2000);

export const docInput = z
  .object({
    title: z.string().trim().max(200).default("Untitled"),
    kind: z.enum(DOC_KINDS).default("doc"),
    team_id: z.uuid().nullable().default(null),
    item_id: z.uuid().nullable().default(null),
    content: docContent.default([]),
    folder_id: z.uuid().nullable().default(null),
    /** The project a note belongs to. */
    project_id: z.uuid().nullable().default(null),
    /** Tags, by id, from the vocabulary this person or team already has. */
    tags: z.array(z.uuid()).max(20).default([]),
  })
  .strict();

/**
 * Which checklist lines to turn into tasks. Left out, every open line that
 * isn't a task yet; given, only those lines ("Make task" on one line).
 */
export const docTasksInput = z
  .object({
    block_ids: z.array(z.string().min(1).max(64)).min(1).max(200).optional(),
  })
  .strict();

/** An edit. `version` guards against two tabs overwriting each other. */
export const docUpdate = z
  .object({
    title: z.string().trim().max(200).optional(),
    content: docContent.optional(),
    folder_id: z.uuid().nullable().optional(),
    project_id: z.uuid().nullable().optional(),
    tags: z.array(z.uuid()).max(20).optional(),
    version: z.number().int().positive(),
  })
  .strict();

// Projects. Stages are given by name and order; the server keeps their ids.
export const projectLinkInput = z
  .object({
    url: z
      .string()
      .trim()
      .max(2000)
      .refine((value) => {
        try {
          const parsed = new URL(value);
          return (
            (parsed.protocol === "https:" || parsed.protocol === "http:") &&
            !parsed.username &&
            !parsed.password
          );
        } catch {
          return false;
        }
      }, "Links must start with http:// or https:// and cannot include credentials."),
    title: z.string().trim().max(200).default(""),
  })
  .strict();

export const projectInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    summary: z.string().trim().max(2000).default(""),
    team_id: z.uuid().nullable().default(null),
    deadline: z.iso.datetime({ offset: true }).nullable().default(null),
    stages: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  })
  .strict();

export const projectUpdate = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    summary: z.string().trim().max(2000).optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
    deadline: z.iso.datetime({ offset: true }).nullable().optional(),
    doc_id: z.uuid().nullable().optional(),
    stages: z
      .array(
        z.object({
          id: z.uuid().optional(),
          name: z.string().trim().min(1).max(60),
        }),
      )
      .max(20)
      .optional(),
  })
  .strict();

/** Move a task into a project, a stage, or out of both. */
export const projectAssign = z
  .object({
    project_id: z.uuid().nullable(),
    stage_id: z.uuid().nullable().optional(),
  })
  .refine((d) => d.project_id !== null || !d.stage_id, {
    message: "A stage needs a project.",
  })
  .strict();

// Folders and favourites.
export const folderInput = z
  .object({
    name: z.string().trim().min(1).max(60),
    team_id: z.uuid().nullable().default(null),
  })
  .strict();

export const folderUpdate = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    position: z.number().int().min(0).max(999).optional(),
  })
  .strict();

export const favouriteInput = z
  .object({
    kind: z.enum(FAVOURITE_KINDS),
    target_id: z.uuid(),
    starred: z.boolean(),
  })
  .strict();

/** A remark on a document. One thread per document, so it survives edits. */
export const docCommentInput = z
  .object({
    body: z.string().trim().min(1).max(4000),
    /** The block being remarked on; left out for a remark about the page. */
    block_id: z.string().trim().min(1).max(64).optional(),
    /** What that line said at the time, so the remark still reads if it goes. */
    quote: z.string().trim().max(400).optional(),
    /**
     * The words being remarked on, as a character range into the block's
     * Markdown source. Left out for a remark about a whole line.
     */
    range_start: z.number().int().min(0).max(100_000).optional(),
    range_end: z.number().int().min(0).max(100_000).optional(),
    /** The remark this answers. Threads are one deep. */
    parent_id: z.uuid().optional(),
    /** People named in the body, chosen from the picker rather than typed. */
    mentions: z.array(z.uuid()).max(20).default([]),
  })
  .strict()
  .refine(
    (c) =>
      (c.range_start === undefined) === (c.range_end === undefined) &&
      (c.range_start === undefined || c.range_end! > c.range_start),
    { message: "A range needs a start before its end" },
  );

/**
 * What the assistant should do to a stretch of a page. Each one is a way of
 * asking for the same thing — words to put in place of these words — so they
 * all come back as proposals rather than as edits.
 */
export const DOC_AI_ACTIONS = [
  "improve",
  "shorten",
  "expand",
  "fix",
  "formal",
  "friendly",
  "direct",
  "summarise",
  "checklist",
  "continue",
  "custom",
] as const;
export type DocAiAction = (typeof DOC_AI_ACTIONS)[number];

export const docAssistRequest = z
  .object({
    block_id: z.string().trim().min(1).max(64),
    range_start: z.number().int().min(0).max(100_000),
    range_end: z.number().int().min(0).max(100_000),
    action: z.enum(DOC_AI_ACTIONS),
    /** Used when the action is "custom": what they actually asked for. */
    instruction: z.string().trim().max(500).default(""),
  })
  .strict()
  .refine((d) => d.range_end >= d.range_start, {
    message: "A range needs a start before its end",
  });

/** A question about one page, answered from that page alone. */
export const docAskRequest = z
  .object({ question: z.string().trim().min(1).max(1000) })
  .strict();

/** What to look for, and how to narrow it. */
export const searchQuery = z
  .object({
    q: z.string().trim().min(1).max(200),
    /**
     * "doc" searches pages only, "task" tasks only, "record" work records
     * (decisions and the like) only. By default pages and tasks, plus records
     * when searching one project.
     */
    type: z.enum(["doc", "task", "record"]).optional(),
    kind: z.enum(DOC_KINDS).optional(),
    project: z.uuid().optional(),
    tag: z.uuid().optional(),
    team: z.uuid().optional(),
    updated_after: z.iso.datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

/** How a list of pages may be narrowed. */
export const docListQuery = z
  .object({
    kind: z.enum(DOC_KINDS).optional(),
    project: z.uuid().optional(),
    tag: z.uuid().optional(),
  })
  .strict();

/**
 * Which time of a repeating event a note is for: the calendar entry's
 * `occurrence` (the class's first start; its new time works too when that
 * one class was moved). Left out, the note is the whole series' own.
 */
export const itemNoteInput = z
  .object({ occurrence: z.iso.datetime({ offset: true }).optional() })
  .strict();

/**
 * The notes some events have, for marking them: `items` is a comma-separated
 * list of event ids (at most 200), and `from`/`to` keep a repeating event's
 * class notes to the times being shown.
 */
export const eventNotesQuery = z
  .object({
    items: z
      .string()
      .transform((s) => [
        ...new Set(
          s
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
        ),
      ])
      .pipe(z.array(z.uuid()).min(1).max(200)),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export const docCommentUpdate = z.object({ resolved: z.boolean() }).strict();

/** Changes proposed to a page, sent together as one edit produced them. */
export const docSuggestionInput = z
  .object({
    changes: z
      .array(
        z.object({
          block_id: z.string().trim().min(1).max(64),
          kind: z.enum(["replace", "insert", "delete"]),
          range_start: z.number().int().min(0).max(100_000),
          range_end: z.number().int().min(0).max(100_000),
          text: z.string().max(10_000).default(""),
          quote: z.string().max(10_000).default(""),
        }),
      )
      .min(1)
      .max(50),
    note: z.string().trim().max(2000).default(""),
  })
  .strict()
  .refine((s) => s.changes.every((c) => c.range_end >= c.range_start), {
    message: "A change needs a start before its end",
  });

export const actionSchema = z
  .object({
    operation: z.enum(["create", "update", "delete"]),
    item_id: z.uuid().optional(),
    version: z.number().int().positive().optional(),
    data: itemData.optional(),
  })
  .strict()
  .refine(
    (a) => a.operation === "create" || (!!a.item_id && !!a.version),
    "Existing item and version required",
  )
  .refine((a) => a.operation === "delete" || !!a.data, "Item data required");

export const agentReply = z.object({
  summary: z.string().max(12000),
  actions: z.array(actionSchema).max(20).default([]),
});

/** One assistant-suggested change to the viewer's own session. */
export const sessionChangeSchema = z
  .discriminatedUnion("operation", [
    z.object({
      operation: z.literal("remove"),
      block_id: z.uuid(),
      item_id: z.uuid(),
      project_id: z.uuid().nullable().default(null),
      title: z.string().max(200),
      from_start_at: z.iso.datetime(),
      from_end_at: z.iso.datetime(),
    }),
    z.object({
      operation: z.literal("move"),
      block_id: z.uuid(),
      item_id: z.uuid(),
      project_id: z.uuid().nullable().default(null),
      title: z.string().max(200),
      from_start_at: z.iso.datetime(),
      from_end_at: z.iso.datetime(),
      start_at: z.iso.datetime(),
      end_at: z.iso.datetime(),
    }),
  ])
  .refine(
    (change) =>
      change.operation === "remove" ||
      (Date.parse(change.end_at) > Date.parse(change.start_at) &&
        Date.parse(change.end_at) - Date.parse(change.start_at) <=
          24 * 60 * 60_000),
    "A session must last more than zero and no more than 24 hours.",
  );
export type SessionChange = z.output<typeof sessionChangeSchema>;

export const deviceData = z.object({
  token: z
    .string()
    .max(250)
    .regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/),
});

/** One earlier turn of an assistant conversation, sent back for context. */
export const chatTurn = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(12000),
  })
  .strict();

export const chatScope = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), id: z.uuid() }),
  z.object({ kind: z.literal("task"), id: z.uuid() }),
]);
export type ChatScope = z.output<typeof chatScope>;

export const chatRequest = z.object({
  message: z.string().trim().min(1).max(4000),
  timezone: z.string().max(80).default("UTC"),
  /** Most recent turns first-to-last; the server keeps only what it needs. */
  history: z.array(chatTurn).max(12).default([]),
  scope: chatScope.nullable().default(null),
});

export const preferences = z.object({ email_reminders: z.boolean() });

/** Connect a Slack or Discord incoming webhook for chat delivery. */
export const chatWebhookInput = z
  .object({
    kind: z.enum(["slack", "discord"]),
    url: z.string().trim().min(1).max(500),
  })
  .strict();

/** Ask the assistant to draft a project (subtasks) for review. */
export const projectRequest = z.object({
  prompt: z.string().trim().min(1).max(2000),
  summary: z.string().trim().max(2000).optional(),
  deadline: z.iso.datetime({ offset: true }).nullable().optional(),
  timezone: z.string().max(80).default("UTC"),
  /** Draft it for a team: the project and its tasks become the team's once approved. */
  team_id: z.uuid().nullable().optional(),
});

/** Bring planner data in from an Orbyn export or a CSV. */
export const importInput = z
  .object({
    format: z.enum(["orbyn", "csv"]),
    data: z.string().min(1).max(5_000_000),
    /** Preview counts without writing anything. */
    dry_run: z.boolean().default(true),
  })
  .strict();

export const pagination = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

/**
 * Orders for `GET /items`. newest: created, newest first (the default).
 * score: the priority score, highest first. due: soonest due first. priority:
 * high to low. estimate: shortest first. title: A to Z. created: oldest first.
 * position: the manual order (`PUT /items/:id/position`).
 */
export const ITEM_SORTS = [
  "newest",
  "score",
  "due",
  "priority",
  "estimate",
  "title",
  "created",
  "position",
] as const;

const flag = z
  .enum(["0", "1", "true", "false"])
  .transform((v) => v === "1" || v === "true");

export const itemsQuery = pagination.extend({
  /** Only items shared with this team. */
  team_id: z.uuid().optional(),
  /** Words in the title or notes. */
  q: z.string().trim().max(100).optional(),
  list_id: z.uuid().optional(),
  tag_id: z.uuid().optional(),
  assignee_id: z.uuid().optional(),
  /** Only the subtasks of this task. */
  parent_id: z.uuid().optional(),
  sort: z.enum(ITEM_SORTS).default("newest"),
  /**
   * Incremental sync: items changed after this time, oldest change first,
   * as `{ items, deleted, next_cursor, has_more }`.
   */
  updated_after: z.iso.datetime({ offset: true }).optional(),
  /** Incremental sync: carry on from a previous page's `next_cursor`. */
  cursor: z
    .string()
    .trim()
    .max(200)
    .regex(/^[A-Za-z0-9_-]+$/, "That cursor isn't valid")
    .optional(),
  /** Incremental sync: also list items deleted since then. */
  include_deleted: flag.default(false),
});

/**
 * Where to put an item in its manual order: before or after another item in
 * the same place (same parent, else list, else space), or at an index.
 */
export const itemPositionInput = z
  .object({
    before_id: z.uuid().optional(),
    after_id: z.uuid().optional(),
    position: z.number().int().min(0).max(100000).optional(),
  })
  .strict()
  .refine(
    (d) =>
      [d.before_id, d.after_id, d.position].filter((v) => v !== undefined)
        .length === 1,
    "Give one of before_id, after_id or position",
  );

const emailField = emailAddress;

export const teamInput = z
  .object({ name: z.string().trim().min(1).max(80) })
  .strict();

export const memberInput = z
  .object({ email: emailField, role: z.enum(TEAM_ROLES).default("member") })
  .strict();

export const memberRoleInput = z.object({ role: z.enum(TEAM_ROLES) }).strict();

export const adminUserUpdate = z
  .object({
    role: z.enum(SYSTEM_ROLES).optional(),
    disabled: z.boolean().optional(),
    email_verified: z.boolean().optional(),
  })
  .strict()
  .refine(
    (d) =>
      d.role !== undefined ||
      d.disabled !== undefined ||
      d.email_verified !== undefined,
    "Nothing to update",
  );

export const adminUsersQuery = z.object({
  search: z.string().trim().max(100).default(""),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const auditQuery = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const baseUrl = z
  .string()
  .trim()
  .max(500)
  .refine(
    (v) => v === "" || /^https?:\/\//i.test(v),
    "Base URL must start with http:// or https://",
  );

/** Creating a provider. `api_key` is encrypted before it is stored. */
export const aiProviderInput = z
  .object({
    kind: z.enum(AI_PROVIDER_KINDS),
    name: z.string().trim().min(1).max(80),
    base_url: baseUrl.default(""),
    api_key: z.string().trim().max(4000).optional(),
    options: z
      .object({ apiVersion: z.string().trim().max(40).optional() })
      .strict()
      .default({}),
    enabled: z.boolean().default(true),
  })
  .strict();

/** Editing a provider. Omit `api_key` to keep the saved key; send "" to remove it. */
export const aiProviderUpdate = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    base_url: baseUrl.optional(),
    api_key: z.string().trim().max(4000).optional(),
    options: z
      .object({ apiVersion: z.string().trim().max(40).optional() })
      .strict()
      .optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

/** Which provider and model the assistant uses; a null provider turns the assistant off. */
export const aiSettingsInput = z
  .object({
    provider_id: z.uuid().nullable(),
    model: z.string().trim().max(200).default(""),
    /**
     * Whether to find pages by meaning as well as by words. Off unless
     * asked for: measuring a page means sending its words to the provider,
     * which is a decision for whoever runs the workspace.
     */
    semantic_search: z.boolean().optional(),
  })
  .strict();

/**
 * Search by meaning's own setup (`PUT /ai/settings/semantic`). Turning it
 * on needs a model that measures text and an admin accepting, each time,
 * that every page is sent to the provider to be measured.
 */
export const semanticSetupInput = z
  .object({
    on: z.boolean(),
    embedding_model: z.string().trim().max(200).optional(),
    accept: z.boolean().optional(),
  })
  .strict();

export const aiTestInput = z
  .object({ model: z.string().trim().max(200).optional() })
  .strict();

/** A checklist step on a task. */
export const stepInput = z
  .object({ title: z.string().trim().min(1).max(200) })
  .strict();

export const stepUpdate = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    done: z.boolean().optional(),
  })
  .strict()
  .refine(
    (d) => d.title !== undefined || d.done !== undefined,
    "Nothing to update",
  );

/** A progress note on a task, optionally changing its status or progress. */
export const progressUpdateInput = z
  .object({
    body: z.string().trim().max(2000).default(""),
    status: z.enum(STATUSES).optional(),
    progress: z.number().int().min(0).max(100).optional(),
  })
  .strict()
  .refine(
    (d) => d.body !== "" || d.status !== undefined || d.progress !== undefined,
    "Write an update, or change the status or progress",
  );

const origin = z
  .string()
  .trim()
  .max(200)
  .regex(
    /^https?:\/\/[^/\s]+$/,
    "Origins look like https://app.example.com (no path)",
  );

/**
 * Changing system settings. Every field is optional; `reset` returns fields
 * to their `.env` value. For the SMTP password: omit to keep, "" to remove.
 */
export const systemSettingsUpdate = z
  .object({
    cors_origins: z.array(origin).min(1).max(20).optional(),
    rate_limit_per_minute: z.number().int().min(0).max(100000).optional(),
    notifier_concurrency: z.number().int().min(1).max(64).optional(),
    status_interval_ms: z.number().int().min(5000).max(3600000).optional(),
    smtp: z
      .object({
        host: z.string().trim().max(200).optional(),
        port: z.number().int().min(1).max(65535).optional(),
        user: z.string().trim().max(200).optional(),
        password: z.string().max(500).optional(),
        secure: z.boolean().optional(),
        from: z.string().trim().max(200).optional(),
      })
      .strict()
      .optional(),
    reset: z
      .array(
        z.enum([
          "cors_origins",
          "rate_limit_per_minute",
          "notifier_concurrency",
          "status_interval_ms",
          "smtp",
        ]),
      )
      .max(5)
      .optional(),
  })
  .strict();

/** Switching maintenance mode on or off. */
export const maintenanceInput = z
  .object({
    enabled: z.boolean(),
    message: z.string().trim().max(500).default(""),
    until: z.iso.datetime({ offset: true }).nullable().default(null),
  })
  .strict();

/** Sending a test email with the current SMTP settings. */
export const testEmailInput = z
  .object({ to: z.email().max(254).optional() })
  .strict();

export type SystemSettingsUpdate = z.input<typeof systemSettingsUpdate>;
export type MaintenanceInput = z.input<typeof maintenanceInput>;

// ---- Planning: lists, tags, time blocks, the planner ------------------------

const color = hexColor;
const instant = z.iso.datetime({ offset: true });
const clock = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Times look like 09:30");
const dayKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates look like 2026-09-18");
const weekdays = z
  .array(z.number().int().min(0).max(6))
  .min(1)
  .max(7)
  .transform((d) => [...new Set(d)].sort());
const MAX_RANGE_MS = 62 * 86_400_000;

export const listInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    color: color.optional(),
    /** A team's shared list; null for a personal one. */
    team_id: z.uuid().nullable().default(null),
  })
  .strict();
export const listUpdate = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    color: color.optional(),
    position: z.number().int().min(0).max(10000).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, "Nothing to update");

export const tagInput = z
  .object({
    name: z.string().trim().min(1).max(40),
    color: color.optional(),
    team_id: z.uuid().nullable().default(null),
  })
  .strict();
export const tagUpdate = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    color: color.optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, "Nothing to update");

/** A time range for calendar reads: at most 62 days. */
export const rangeQuery = z
  .object({ from: instant, to: instant })
  .refine(
    (d) => Date.parse(d.to) > Date.parse(d.from),
    "End must be after start",
  )
  .refine(
    (d) => Date.parse(d.to) - Date.parse(d.from) <= MAX_RANGE_MS,
    "Ask for 62 days or fewer at a time",
  );

/** `GET /today`: the day in this zone (the planner's when left out). */
export const todayQuery = z.object({ timezone: timeZoneField.optional() });

/** Planned-feed tasks asked for at once, at most. */
export const PLANNED_MAX_IDS = 200;

/**
 * `GET /planned`: some tasks by id (`item_ids`, comma-separated), a window
 * whose sessions to list (`from` and `to`, together), or both.
 */
export const plannedQuery = z
  .object({
    item_ids: z
      .preprocess(
        (v) =>
          typeof v === "string"
            ? v
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : v,
        z.array(z.uuid()).min(1).max(PLANNED_MAX_IDS),
      )
      .optional(),
    from: instant.optional(),
    to: instant.optional(),
  })
  .refine((d) => !d.from === !d.to, "Give both from and to, or neither")
  .refine(
    (d) => !d.from || !d.to || Date.parse(d.to) > Date.parse(d.from),
    "End must be after start",
  )
  .refine(
    (d) =>
      !d.from || !d.to || Date.parse(d.to) - Date.parse(d.from) <= MAX_RANGE_MS,
    "Ask for 62 days or fewer at a time",
  );

const blockTimes = {
  start_at: instant,
  end_at: instant,
};
const blockSpan = (d: { start_at: string; end_at: string }) => {
  const ms = Date.parse(d.end_at) - Date.parse(d.start_at);
  return ms > 0 && ms <= 86_400_000;
};
const BLOCK_SPAN = "A session ends after it starts and lasts 24 hours at most";

/** Time set aside to work on a task. */
export const blockInput = z
  .object({ item_id: z.uuid(), ...blockTimes })
  .strict()
  .refine(blockSpan, BLOCK_SPAN);
export const blockUpdate = z
  .object(blockTimes)
  .strict()
  .refine(blockSpan, BLOCK_SPAN);

/** Minutes worked on a task (focus timer). */
export const timeLogInput = z
  .object({ minutes: z.number().int().min(1).max(1440) })
  .strict();

/** Remove one occurrence from a repeating item. */
export const skipOccurrenceInput = z.object({ occurrence: instant }).strict();

export const EDIT_SCOPES = ["this", "following", "all"] as const;

/**
 * Which occurrences of a repeating item an edit or delete touches: only
 * `occurrence`, it and every later one, or the whole series (the default).
 */
export const editScopeQuery = z
  .object({
    scope: z.enum(EDIT_SCOPES).default("all"),
    occurrence: instant.optional(),
  })
  .refine(
    (d) => d.scope === "all" || !!d.occurrence,
    "Say which occurrence to change",
  );

/** Text typed into the command bar ("Lunch with @anna tomorrow 1pm ;Cafe Roma"). */
export const quickAddInput = z
  .object({
    text: z.string().trim().min(1).max(500),
    /** The device's zone, for words like "tomorrow" and "3pm"; your planner zone when omitted. */
    timezone: timeZoneField.optional(),
    /** Only parse it; nothing is created. */
    preview: z.boolean().default(false),
  })
  .strict();

export const RSVP_STATUSES = ["accepted", "declined", "tentative"] as const;
/** An invitee's answer from their email link. */
export const rsvpInput = z.object({ status: z.enum(RSVP_STATUSES) }).strict();

/** A calendar from another app, by its iCalendar (ICS) link. */
const subscriptionUrl = z
  .string()
  .trim()
  .max(1000)
  .regex(
    /^(https?|webcal):\/\/\S+$/i,
    "Calendar links start with https:// or webcal://",
  )
  // webcal:// is https:// for calendar apps.
  .transform((u) => u.replace(/^webcal:\/\//i, "https://"));
/**
 * What a subscribed calendar holds. The kind picks sensible defaults when it
 * is added (see CALENDAR_KIND_DEFAULTS); every setting can be changed after.
 */
export const CALENDAR_KINDS = [
  "classes",
  "exams",
  "work",
  "meetings",
  "holidays",
  "other",
] as const;
/** Who else sees a subscription's busy time: teammates and your busy feed. */
export const CALENDAR_SHARING = ["busy", "hidden"] as const;

const subscriptionSettings = {
  kind: z.enum(CALENDAR_KINDS).optional(),
  /** Count its timed events as busy (planner, booking pages, teammates). */
  busy: z.boolean().optional(),
  /** Count its all-day events as busy for the whole day (exams, leave). */
  all_day_busy: z.boolean().optional(),
  /** Show it on the calendar and in agendas. Hidden ones still count as busy. */
  visible: z.boolean().optional(),
  /** Whether teammates and your busy feed see its busy time. */
  sharing: z.enum(CALENDAR_SHARING).optional(),
  /** Minutes before each event to remind you; null for no reminders. */
  reminder_minutes: z.number().int().min(0).max(10080).nullable().optional(),
};

export const calendarSubscriptionInput = z
  .object({
    url: subscriptionUrl,
    name: z.string().trim().min(1).max(80),
    color: color.optional(),
    ...subscriptionSettings,
  })
  .strict();
export const calendarSubscriptionUpdate = z
  .object({
    url: subscriptionUrl.optional(),
    name: z.string().trim().min(1).max(80).optional(),
    color: color.optional(),
    ...subscriptionSettings,
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, "Nothing to update");

/** What your private calendar feed includes. */
export const calendarFeedSettingsInput = z
  .object({
    /** Add your time blocks as "Focus: {task}". */
    include_blocks: z.boolean().optional(),
  })
  .strict();
/** Make a feed link: the full one, or one that only shows when you're busy. */
export const calendarFeedCreateInput = z
  .object({ busy: z.boolean().default(false) })
  .strict();

const MAX_SEARCH_MS = 800 * 86_400_000;
/** Find events by words, a year either side of today unless a range is given. */
export const calendarSearchQuery = z
  .object({
    q: z.string().trim().min(1).max(100),
    from: instant.optional(),
    to: instant.optional(),
  })
  .refine(
    (d) => !d.from || !d.to || Date.parse(d.to) > Date.parse(d.from),
    "End must be after start",
  )
  .refine(
    (d) =>
      !d.from ||
      !d.to ||
      Date.parse(d.to) - Date.parse(d.from) <= MAX_SEARCH_MS,
    "Search 800 days or fewer at a time",
  );

/** Teammates' busy times to show over your own calendar. */
export const availabilityQuery = z
  .object({
    /** Comma-separated user ids, up to 10. */
    user_ids: z.string().trim().min(1).max(400),
    from: instant,
    to: instant,
  })
  .refine(
    (d) => Date.parse(d.to) > Date.parse(d.from),
    "End must be after start",
  )
  .refine(
    (d) => Date.parse(d.to) - Date.parse(d.from) <= 31 * 86_400_000,
    "Ask for 31 days or fewer at a time",
  );

export const BREAK_LEVELS = ["none", "light", "normal", "intense"] as const;

/** A saved set of what the calendar shows. */
export const calendarSetInput = z
  .object({
    id: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(40),
    personal: z.boolean().default(true),
    team_ids: z.array(z.uuid()).max(50).default([]),
    list_ids: z.array(z.uuid()).max(100).default([]),
    /**
     * Subscribed calendars in the set. Missing means all of them (sets made
     * before subscriptions could be chosen); empty means none.
     */
    subscription_ids: z.array(z.uuid()).max(20).optional(),
  })
  .strict();

/**
 * Which events get buffers. `personal` (default true) takes your personal
 * events; `team_ids` takes those teams' events (all your teams when null or
 * omitted, none when empty); a non-empty `list_ids` keeps only events in
 * those lists; `min_minutes` skips shorter events; `only_with_others` keeps
 * only meetings: events with people invited, a meeting link, or a team.
 */
export const bufferScopeInput = z
  .object({
    personal: z.boolean().default(true),
    team_ids: z.array(z.uuid()).max(50).nullable().default(null),
    list_ids: z.array(z.uuid()).max(100).default([]),
    min_minutes: z.number().int().min(0).max(1440).default(0),
    only_with_others: z.boolean().default(false),
  })
  .strict();

export const plannerPrefsInput = z
  .object({
    timezone: timeZoneField.optional(),
    work_days: weekdays.optional(),
    work_start: clock.optional(),
    work_end: clock.optional(),
    pad_percent: z.number().int().min(0).max(100).optional(),
    split_after_minutes: z.number().int().min(15).max(480).optional(),
    min_block_minutes: z.number().int().min(5).max(240).optional(),
    break_level: z.enum(BREAK_LEVELS).optional(),
    horizon_days: z.number().int().min(1).max(7).optional(),
    buffer_before_minutes: z.number().int().min(0).max(120).optional(),
    buffer_after_minutes: z.number().int().min(0).max(120).optional(),
    adaptive_buffers: z.boolean().optional(),
    default_travel_minutes: z.number().int().min(0).max(240).optional(),
    extra_timezones: z.array(timeZoneField).max(3).optional(),
    calendar_sets: z.array(calendarSetInput).max(12).optional(),
    pinned_user_ids: z.array(z.uuid()).max(20).optional(),
    /** Warn this many days before a task is due with no time set aside; 0 turns it off. */
    deadline_notice_days: z.number().int().min(0).max(14).optional(),
    /** Where planner notices (roll forward, at risk, due soon, conflicts) go besides the app. */
    planner_notices: z
      .object({ push: z.boolean().optional(), email: z.boolean().optional() })
      .strict()
      .optional(),
    /** Alerts new items get when they're created without any; send a key to change it. */
    default_alerts: z
      .object({
        event: alertsField.optional(),
        task: alertsField.optional(),
        all_day: alertsField.optional(),
      })
      .strict()
      .optional(),
    /** When a task is completed, add the past time of its blocks to its time spent (once). */
    count_blocks_as_spent: z.boolean().optional(),
    /** Which events get buffers; replaces the saved scope. */
    buffer_scope: bufferScopeInput.optional(),
    /** Minutes added to every travel leg (0 to 30). */
    travel_padding_minutes: z.number().int().min(0).max(30).optional(),
    /** Scale each task's estimate by how long that kind of task really takes. */
    learn_estimates: z.boolean().optional(),
    learn_rhythm: z.boolean().optional(),
    balance_load: z.boolean().optional(),
    /** A reminder this many minutes before each session starts (0: as it starts); null: off. */
    session_reminder_minutes: z
      .number()
      .int()
      .refine((n) => SESSION_REMINDER_MINUTES.includes(n), {
        message:
          "Choose a reminder as the session starts, or 5, 10 or 15 minutes before.",
      })
      .nullable()
      .optional(),
    /** Morning agenda and evening review emails; send the keys you change. */
    digest: z
      .object({
        morning: z.boolean().optional(),
        evening: z.boolean().optional(),
        morning_time: clock.optional(),
        evening_time: clock.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Which tasks a frame takes. Empty lists mean "any". */
export const frameFilters = z
  .object({
    priorities: z.array(z.enum(PRIORITIES)).max(3).default([]),
    list_ids: z.array(z.uuid()).max(50).default([]),
    tag_ids: z.array(z.uuid()).max(50).default([]),
    team_ids: z.array(z.uuid()).max(50).default([]),
    /** Only tasks estimated at least / at most this long. */
    min_minutes: z.number().int().min(1).max(10080).nullable().default(null),
    max_minutes: z.number().int().min(1).max(10080).nullable().default(null),
  })
  .strict();

/** How a frame repeats; when set it wins over `days`. */
const frameRrule = z
  .string()
  .trim()
  .max(200)
  .refine(isValidRrule, "That repeat rule isn't supported");
/** Dates a frame is skipped on, in its time zone. */
const frameExdates = z
  .array(dayKey)
  .max(200)
  .transform((d) => [...new Set(d)].sort());

const frameFields = {
  name: z.string().trim().min(1).max(60),
  days: weekdays,
  start_time: clock,
  end_time: clock,
  filters: frameFilters,
  color: color,
};
const frameOrder = (d: { start_time?: string; end_time?: string }) =>
  !d.start_time || !d.end_time || d.end_time > d.start_time;
/** A recurring window reserved for a kind of work. */
export const frameInput = z
  .object({
    ...frameFields,
    /** Weekdays it repeats on; not needed when `rrule` is set. */
    days: weekdays.optional(),
    filters: frameFilters.default({
      priorities: [],
      list_ids: [],
      tag_ids: [],
      team_ids: [],
      min_minutes: null,
      max_minutes: null,
    }),
    color: color.optional(),
    /** For example "FREQ=MONTHLY;BYMONTHDAY=-1" (the last day of each month). */
    rrule: frameRrule.nullable().optional(),
    /** Busy frames block booking pages and teammates' meeting times. */
    busy: z.boolean().default(false),
    exdates: frameExdates.default([]),
    /** The zone its times are in; the owner's planner zone when null. */
    timezone: timeZoneField.nullable().optional(),
  })
  .strict()
  .refine(frameOrder, "A frame ends after it starts")
  .refine((d) => !!d.days || !!d.rrule, "Choose the days a frame repeats on");
export const frameUpdate = z
  .object({
    name: frameFields.name.optional(),
    days: weekdays.optional(),
    start_time: clock.optional(),
    end_time: clock.optional(),
    filters: frameFilters.optional(),
    color: color.optional(),
    position: z.number().int().min(0).max(10000).optional(),
    rrule: frameRrule.nullable().optional(),
    busy: z.boolean().optional(),
    exdates: frameExdates.optional(),
    timezone: timeZoneField.nullable().optional(),
  })
  .strict()
  .refine(frameOrder, "A frame ends after it starts");

/** Skip (or bring back) one date of a frame. */
export const frameSkipInput = z.object({ date: dayKey }).strict();

const HABIT_PERIODS = ["day", "week"] as const;
const habitOrder = (d: {
  window_start?: string | null;
  window_end?: string | null;
}) => !d.window_start || !d.window_end || d.window_end > d.window_start;
export const habitInput = z
  .object({
    name: z.string().trim().min(1).max(60),
    cadence: z.number().int().min(1).max(21),
    period: z.enum(HABIT_PERIODS).default("week"),
    duration_minutes: z.number().int().min(5).max(480),
    days: weekdays.default([0, 1, 2, 3, 4, 5, 6]),
    /** Time-of-day window; omit or null to use working hours. */
    window_start: clock.nullable().default(null),
    window_end: clock.nullable().default(null),
    priority: z.enum(PRIORITIES).default("medium"),
    active: z.boolean().default(true),
  })
  .strict()
  .refine(habitOrder, "A habit's window ends after it starts")
  .refine(
    (d) => d.cadence <= (d.period === "day" ? 6 : 21),
    "That's more sessions than the period can hold",
  );
export const habitUpdate = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    cadence: z.number().int().min(1).max(21).optional(),
    period: z.enum(HABIT_PERIODS).optional(),
    duration_minutes: z.number().int().min(5).max(480).optional(),
    days: weekdays.optional(),
    window_start: clock.nullable().optional(),
    window_end: clock.nullable().optional(),
    priority: z.enum(PRIORITIES).optional(),
    active: z.boolean().optional(),
    position: z.number().int().min(0).max(10000).optional(),
  })
  .strict()
  .refine(habitOrder, "A habit's window ends after it starts")
  .refine((d) => Object.keys(d).length > 0, "Nothing to update");

/** Ask the server to email you a digest now, to preview it. */
export const digestTestInput = z
  .object({ kind: z.enum(["morning", "evening"]).default("morning") })
  .strict();

/** Planning habits over a window of days. */
export const habitPlanInput = z
  .object({
    start_date: dayKey.optional(),
    days: z.number().int().min(1).max(14).default(7),
  })
  .strict();
export const habitApplyInput = z
  .object({
    blocks: z
      .array(
        z
          .object({
            habit_id: z.uuid(),
            start_at: instant,
            end_at: instant,
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();

export const TRAVEL_MODES = ["walk", "cycle", "transit", "drive"] as const;

/** A place and how long it takes to get there, for travel time. */
export const placeInput = z
  .object({
    label: z.string().trim().min(1).max(60),
    /** Text found in an event's location, such as "Collins St" or "Office". */
    match: z.string().trim().min(1).max(200),
    travel_minutes: z.number().int().min(0).max(240),
    /** How you get there (a label only). */
    mode: z.enum(TRAVEL_MODES).nullable().default(null),
    /** Travel minutes on weekdays 07:00-09:00 and 16:00-18:00; null: the same as usual. */
    peak_minutes: z.number().int().min(0).max(240).nullable().default(null),
  })
  .strict();
export const placeUpdate = z
  .object({
    label: z.string().trim().min(1).max(60).optional(),
    match: z.string().trim().min(1).max(200).optional(),
    travel_minutes: z.number().int().min(0).max(240).optional(),
    mode: z.enum(TRAVEL_MODES).nullable().optional(),
    peak_minutes: z.number().int().min(0).max(240).nullable().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, "Nothing to update");

/**
 * Which tasks a plan considers ("plan only Work"). `personal` (default true)
 * takes your personal tasks; `team_ids` takes team tasks assigned to you in
 * those teams (all your teams when omitted, none when empty); a non-empty
 * `list_ids` keeps only tasks in those lists.
 */
export const planScope = z
  .object({
    personal: z.boolean().default(true),
    team_ids: z.array(z.uuid()).max(50).optional(),
    list_ids: z.array(z.uuid()).max(100).default([]),
  })
  .strict();

const keepFree = z
  .array(z.object({ start_at: instant, end_at: instant }).strict())
  .max(20);

/** Asking the planner for a plan. Omitted options use the saved preferences. */
export const planPreviewInput = z
  .object({
    /** First day, in the user's time zone; today when omitted. */
    start_date: dayKey.optional(),
    /** Up to two weeks ahead, for the planner preview's days view. */
    days: z.number().int().min(1).max(14).optional(),
    pad_percent: z.number().int().min(0).max(100).optional(),
    split: z.boolean().optional(),
    break_level: z.enum(BREAK_LEVELS).optional(),
    /** Only place tasks inside frames (when there are any). */
    use_frames: z.boolean().default(true),
    /** Times to leave empty, such as "keep Friday afternoon free". */
    keep_free: keepFree.default([]),
    /** Only plan these tasks. */
    item_ids: z.array(z.uuid()).max(200).optional(),
    exclude_item_ids: z.array(z.uuid()).max(200).default([]),
    /** The device's time zone, used until the user saves their own in settings. */
    timezone: timeZoneField.optional(),
    /** Only tasks from these places (personal, some teams, some lists). */
    scope: planScope.optional(),
  })
  .strict();

const planEstimates = z
  .record(z.uuid(), z.number().int().min(1).max(10080))
  .refine((e) => Object.keys(e).length <= 200, "200 estimates at most");

/**
 * Tuning a plan before it's applied. Each field given replaces the plan's
 * current value (estimates merge by task); omitted fields keep it.
 */
export const planTuneInput = z
  .object({
    /** Tasks to add, even ones outside the scope or not assigned to you. */
    include_item_ids: z.array(z.uuid()).max(200).optional(),
    /** Tasks to leave out. */
    exclude_item_ids: z.array(z.uuid()).max(200).optional(),
    /** Minutes to plan each task for, instead of its estimate. */
    estimates: planEstimates.optional(),
    /** Also save those estimates on the tasks (only tasks you can edit). */
    save_estimates: z.boolean().default(false),
    keep_free: keepFree.optional(),
    /** Blocks to keep exactly where they are; the rest is planned around them. */
    pinned_blocks: z
      .array(
        z
          .object({ item_id: z.uuid(), ...blockTimes })
          .strict()
          .refine(blockSpan, BLOCK_SPAN),
      )
      .max(100)
      .optional(),
    scope: planScope.nullable().optional(),
  })
  .strict();

/** A copy of a block: at `start_at`, or the next free time after the original. */
export const blockDuplicateInput = z
  .object({ start_at: instant.optional() })
  .strict();

/**
 * Moving a session to the next free working time. With `before_deadline`,
 * only time that ends by its task's deadline will do (409 when there's none).
 */
export const blockRescheduleInput = z
  .object({ before_deadline: z.boolean().default(false) })
  .strict();

/**
 * Applying a plan. `moves` names the sessions to move before their deadline
 * (ids from the plan's `moves`); when omitted, the ones the planner ticked.
 */
export const planApplyInput = z
  .object({ moves: z.array(z.uuid()).max(200).optional() })
  .strict();

/** Move unfinished blocks forward; all of yesterday's and earlier when omitted. */
export const rollForwardInput = z
  .object({ block_ids: z.array(z.uuid()).max(100).optional() })
  .strict();

/** Times a set of teammates are all free. */
export const suggestQuery = z
  .object({
    from: instant,
    to: instant,
    duration: z.coerce.number().int().min(15).max(480),
    /** Comma-separated user ids; everyone in the team when omitted. */
    user_ids: z.string().max(2000).optional(),
  })
  .refine(
    (d) => Date.parse(d.to) > Date.parse(d.from),
    "End must be after start",
  )
  .refine(
    (d) => Date.parse(d.to) - Date.parse(d.from) <= 14 * 86_400_000,
    "Ask for 14 days or fewer at a time",
  );

// ---- Booking pages -----------------------------------------------------------

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(60)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers and single dashes",
  )
  // The web app uses these paths for booking links, so no page can have them.
  .refine(
    (s) => !["manage", "confirm", "cancel"].includes(s),
    "That link is reserved. Try another.",
  );
const durations = z.array(z.number().int().min(5).max(480)).min(1).max(4);
const coHosts = z
  .array(
    z
      .object({ user_id: z.uuid(), required: z.boolean().default(true) })
      .strict(),
  )
  .max(10);

const hoursRange = z
  .object({ start: clock, end: clock })
  .strict()
  .refine((r) => r.end > r.start, "Each range ends after it starts");

/** When a booking page offers times. */
export const bookingAvailability = z.discriminatedUnion("mode", [
  /** Each host's own working days and hours (Settings → Planning). */
  z.object({ mode: z.literal("working_hours") }).strict(),
  /** The page's own weekly hours in one time zone; hosts' busy time still counts. */
  z
    .object({
      mode: z.literal("custom"),
      timezone: timeZoneField,
      weekly: z
        .array(
          z
            .object({
              /** 0 = Sunday … 6 = Saturday. */
              day: z.number().int().min(0).max(6),
              start: clock,
              end: clock,
            })
            .strict()
            .refine((r) => r.end > r.start, "Each range ends after it starts"),
        )
        .max(42),
    })
    .strict(),
]);

/** A date with different hours, or none at all (closed). */
export const dateOverride = z
  .object({ date: dayKey, hours: z.array(hoursRange).max(6) })
  .strict();

export const QUESTION_TYPES = ["text", "long_text", "choice", "phone"] as const;

/** A question on the booking form. */
export const bookingQuestion = z
  .object({
    id: z
      .string()
      .trim()
      .regex(
        /^[a-z0-9_-]{1,40}$/,
        "Question ids use lowercase letters, numbers, - and _",
      ),
    label: z.string().trim().min(1).max(200),
    type: z.enum(QUESTION_TYPES),
    required: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(100)).max(12).default([]),
  })
  .strict()
  .refine(
    (q) => q.type !== "choice" || q.options.length >= 2,
    "A choice question needs at least two options",
  );

const questions = z
  .array(bookingQuestion)
  .max(10)
  .refine(
    (qs) => new Set(qs.map((q) => q.id)).size === qs.length,
    "Each question needs its own id",
  );
const overrides = z
  .array(dateOverride)
  .max(100)
  .refine(
    (os) => new Set(os.map((o) => o.date)).size === os.length,
    "Each date can have one override",
  );
export const SLOT_INTERVALS = [5, 10, 15, 20, 30, 60] as const;
const slotInterval = z
  .number()
  .int()
  .refine(
    (v) => (SLOT_INTERVALS as readonly number[]).includes(v),
    "Start times can be every 5, 10, 15, 20, 30 or 60 minutes",
  );
const bufferMinutes = z.number().int().min(0).max(120);
/** The title of the event hosts get: {page}, {name} and {email} are filled in. */
const eventTitle = z.string().trim().min(1).max(200);
/** Email the booker this many minutes before: up to 3 values, 10 minutes to a week. */
export const DEFAULT_BOOKER_REMINDERS = [1440, 60];
const remindBefore = z
  .array(z.number().int().min(10).max(10080))
  .max(3, "Up to 3 reminders")
  .transform((a) => [...new Set(a)].sort((x, y) => y - x));

export const routingRules = z
  .array(
    z
      .object({
        question_id: z.string().trim().min(1).max(40),
        equals: z.string().trim().min(1).max(200),
        host_user_id: z.uuid(),
      })
      .strict(),
  )
  .max(20);

export const bookingPageInput = z
  .object({
    slug,
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).default(""),
    durations,
    window_days: z.number().int().min(1).max(90).default(14),
    min_notice_minutes: z.number().int().min(0).max(20160).default(240),
    /** Older apps: one buffer for both sides. */
    buffer_minutes: bufferMinutes.optional(),
    buffer_before_minutes: bufferMinutes.optional(),
    buffer_after_minutes: bufferMinutes.optional(),
    slot_interval_minutes: slotInterval.default(15),
    max_per_day: z.number().int().min(1).max(50).nullable().default(null),
    max_per_week: z.number().int().min(1).max(200).nullable().default(null),
    location: z.string().trim().max(300).default(""),
    meeting_url: meetingUrl.default(""),
    active: z.boolean().default(true),
    co_hosts: coHosts.default([]),
    color: color.default("#376c51"),
    availability: bookingAvailability.default({ mode: "working_hours" }),
    date_overrides: overrides.default([]),
    questions: questions.default([]),
    /** How bookings are assigned across the hosts. */
    assignment: z.enum(["collective", "round_robin"]).default("collective"),
    /** Route a matching answer to a host (round-robin pages). */
    routing: routingRules.default([]),
    /** Hosts approve each request before it's booked. */
    requires_approval: z.boolean().default(false),
    /** Bookers can move their booking from their manage link. */
    allow_reschedule: z.boolean().default(true),
    event_title: eventTitle.default("{page} with {name}"),
    /** Shown after booking and in the confirmation email. */
    confirmation_message: z.string().trim().max(1000).default(""),
    /** A team's page: its owners and admins manage it, and its hosts are members. */
    team_id: z.uuid().nullable().default(null),
    /** Email the booker this many minutes before the meeting (a day and an hour by default). */
    remind_before_minutes: remindBefore.default(DEFAULT_BOOKER_REMINDERS),
  })
  .strict();
export const bookingPageUpdate = z
  .object({
    slug: slug.optional(),
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).optional(),
    durations: durations.optional(),
    window_days: z.number().int().min(1).max(90).optional(),
    min_notice_minutes: z.number().int().min(0).max(20160).optional(),
    buffer_minutes: bufferMinutes.optional(),
    buffer_before_minutes: bufferMinutes.optional(),
    buffer_after_minutes: bufferMinutes.optional(),
    slot_interval_minutes: slotInterval.optional(),
    max_per_day: z.number().int().min(1).max(50).nullable().optional(),
    max_per_week: z.number().int().min(1).max(200).nullable().optional(),
    location: z.string().trim().max(300).optional(),
    meeting_url: meetingUrl.optional(),
    active: z.boolean().optional(),
    co_hosts: coHosts.optional(),
    color: color.optional(),
    availability: bookingAvailability.optional(),
    date_overrides: overrides.optional(),
    questions: questions.optional(),
    assignment: z.enum(["collective", "round_robin"]).optional(),
    routing: routingRules.optional(),
    requires_approval: z.boolean().optional(),
    allow_reschedule: z.boolean().optional(),
    event_title: eventTitle.optional(),
    confirmation_message: z.string().trim().max(1000).optional(),
    team_id: z.uuid().nullable().optional(),
    remind_before_minutes: remindBefore.optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, "Nothing to update");

// ---- Open invites and profiles ----------------------------------------------------

const inviteWindow = z
  .object({ start_at: instant, end_at: instant })
  .strict()
  .refine(
    (w) => Date.parse(w.end_at) > Date.parse(w.start_at),
    "Each window ends after it starts",
  );

/** A one-off link offering hand-picked windows; the first to pick a time books it. */
export const openInviteInput = z
  .object({
    title: z.string().trim().min(1).max(120),
    duration: z.number().int().min(5).max(480),
    windows: z.array(inviteWindow).min(1).max(20, "Up to 20 windows"),
    location: z.string().trim().max(300).default(""),
    meeting_url: meetingUrl.default(""),
    /** Teammates who must also be free (up to 10, from your teams). */
    co_host_ids: z.array(z.uuid()).max(10).default([]),
    /** When the link stops working; the end of the last window at the latest. */
    expires_at: instant.optional(),
    remind_before_minutes: remindBefore.default(DEFAULT_BOOKER_REMINDERS),
  })
  .strict()
  .refine(
    (d) =>
      d.windows.some(
        (w) =>
          Date.parse(w.end_at) - Date.parse(w.start_at) >= d.duration * 60_000,
      ),
    "At least one window must fit the meeting",
  );

/** The times an open invite offers, shown in `timezone`. */
export const inviteQuery = z.object({
  timezone: timeZoneField.default("UTC"),
});

/** Someone picking a time from an open invite. */
export const inviteBookingRequest = z
  .object({
    start_at: instant,
    name: z.string().trim().min(1).max(120),
    email: emailField,
    note: z.string().trim().max(2000).default(""),
    timezone: timeZoneField.default("UTC"),
  })
  .strict();

/** Paths the web app uses, so no profile can have them as a handle. */
export const RESERVED_HANDLES = [
  "about",
  "admin",
  "api",
  "app",
  "book",
  "cancel",
  "confirm",
  "help",
  "invite",
  "login",
  "manage",
  "me",
  "orbyn",
  "register",
  "rsvp",
  "settings",
  "signup",
  "status",
  "support",
  "u",
  "www",
];

/** Your public profile page at /u/<handle>. */
export const profileInput = z
  .object({
    /** Null removes the page. */
    handle: z
      .string()
      .trim()
      .toLowerCase()
      .min(3)
      .max(40)
      .regex(
        /^[a-z0-9]+(-[a-z0-9]+)*$/,
        "Use lowercase letters, numbers and single dashes",
      )
      .refine(
        (h) => !RESERVED_HANDLES.includes(h),
        "That name is reserved. Try another.",
      )
      .nullable()
      .optional(),
    bio: z.string().trim().max(300).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, "Nothing to update");

/** The free times a public booking page offers. */
export const publicSlotsQuery = z.object({
  /** One of the page's lengths; the first one when omitted. */
  duration: z.coerce.number().int().min(5).max(480).optional(),
  /** First day shown, in `timezone`; today when omitted. */
  date: dayKey.optional(),
  days: z.coerce.number().int().min(1).max(14).default(7),
  timezone: timeZoneField.default("UTC"),
});

/** Someone outside Orbyn asking for a time. */
export const bookingRequest = z
  .object({
    start_at: instant,
    duration: z.number().int().min(5).max(480),
    name: z.string().trim().min(1).max(120),
    email: emailField,
    note: z.string().trim().max(2000).default(""),
    timezone: timeZoneField.default("UTC"),
    /** Answers to the page's questions, by question id. */
    answers: z.record(z.string().max(40), z.string().max(2000)).default({}),
  })
  .strict();

// ---- Tracking bookings ------------------------------------------------------------

export const BOOKING_VIEWS = [
  "upcoming",
  "needs_approval",
  "past",
  "cancelled",
  "all",
] as const;

/** Bookings across the pages you own or host. */
export const bookingsQuery = z.object({
  view: z.enum(BOOKING_VIEWS).default("upcoming"),
  page_id: z.uuid().optional(),
  /** Words in the booker's name or email. */
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const bookingStatsQuery = z.object({ page_id: z.uuid().optional() });

/** Declining or cancelling, with an optional reason the booker sees. */
export const bookingReason = z
  .object({ reason: z.string().trim().max(500).default("") })
  .strict();

/** Moving a booking to another free time of the same length. */
export const bookingReschedule = z.object({ start_at: instant }).strict();

/** A private note only hosts see. */
export const bookingNoteInput = z
  .object({ host_note: z.string().trim().max(4000) })
  .strict();

export const noShowInput = z.object({ no_show: z.boolean() }).strict();

/** Free times for moving a booking, from its manage link. */
export const rescheduleSlotsQuery = z.object({
  date: dayKey.optional(),
  days: z.coerce.number().int().min(1).max(14).default(7),
  timezone: timeZoneField.default("UTC"),
});

// ---- API keys and webhooks -----------------------------------------------------

export const apiKeyInput = z
  .object({ name: z.string().trim().min(1).max(80) })
  .strict();

export const WEBHOOK_EVENTS = [
  "item.created",
  "item.updated",
  "item.completed",
  "item.deleted",
  "block.scheduled",
  "block.updated",
  "block.deleted",
  "booking.requested",
  "booking.confirmed",
  "booking.rescheduled",
  "booking.cancelled",
  "event.starting",
  "block.started",
  "task.at_risk",
] as const;
const webhookUrl = z
  .string()
  .trim()
  .max(500)
  .regex(/^https?:\/\/\S+$/i, "Webhook URLs start with https://");
/** How many minutes before a busy event `event.starting` is sent (0 to 120). */
const leadMinutes = z.number().int().min(0).max(120);
export const webhookInput = z
  .object({
    url: webhookUrl,
    events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length),
    lead_minutes: leadMinutes.default(15),
  })
  .strict();
export const webhookUpdate = z
  .object({
    url: webhookUrl.optional(),
    events: z
      .array(z.enum(WEBHOOK_EVENTS))
      .min(1)
      .max(WEBHOOK_EVENTS.length)
      .optional(),
    active: z.boolean().optional(),
    lead_minutes: leadMinutes.optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, "Nothing to update");

// ---------------------------------------------------- sharing into Orbyn ---

/** A web link shared into Orbyn: http or https only. */
const sharedUrl = z
  .string()
  .trim()
  .max(2000)
  .regex(/^https?:\/\/\S+$/i, "Links start with http:// or https://");

/** Where something shared into Orbyn goes. */
export const captureDestination = z.discriminatedUnion("kind", [
  /** A task on its own ("Read: <title>" for a link). */
  z.object({ kind: z.literal("inbox") }).strict(),
  /** Today's agenda, at the end of its Notes. */
  z.object({ kind: z.literal("agenda") }).strict(),
  /** The end of a page. */
  z.object({ kind: z.literal("page"), doc_id: z.uuid() }).strict(),
  /** A new page, in a folder or unfiled (null). */
  z
    .object({ kind: z.literal("new_page"), folder_id: z.uuid().nullable() })
    .strict(),
  /** A task in a project. */
  z.object({ kind: z.literal("project"), project_id: z.uuid() }).strict(),
]);

/** A link or some text shared into Orbyn, and where it goes. */
export const captureInput = z
  .object({
    url: sharedUrl.nullable().optional(),
    text: z.string().max(10000).default(""),
    /** The linked page's title, when the app already has it. */
    title: z.string().trim().max(300).nullable().optional(),
    to: captureDestination,
    /** The device's zone, for which day "today's agenda" is. */
    timezone: timeZoneField.optional(),
  })
  .strict()
  .refine((d) => !!d.url || !!d.text.trim(), "Share a link or some text");

/** A link whose title and site to look up. */
export const linkPreviewInput = z.object({ url: sharedUrl }).strict();
