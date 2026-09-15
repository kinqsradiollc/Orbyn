import { z } from "zod";
import { SYSTEM_ROLES, TEAM_ROLES } from "./rbac.js";
import { AI_PROVIDER_KINDS } from "./aiProviders.js";
import { isTimeZone, isValidRrule } from "./time.js";

export const KINDS = ["task", "event"] as const;
export const STATUSES = ["todo", "in_progress", "blocked", "done"] as const;
export const PRIORITIES = ["low", "medium", "high"] as const;
/** Largest reminder window: one week in minutes. */
export const MAX_REMINDER_MINUTES = 10080;

export const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((s) => s.toLowerCase()),
  password: z.string().min(10).max(128),
  name: z.string().trim().min(1).max(80).default("My space"),
});

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

export const itemData = z
  .object({
    title: z.string().trim().min(1).max(200),
    notes: z.string().max(10000).default(""),
    kind: z.enum(KINDS).default("task"),
    status: z.enum(STATUSES).default("todo"),
    priority: z.enum(PRIORITIES).default("medium"),
    due_at: z.iso.datetime({ offset: true }).nullable().default(null),
    end_at: z.iso.datetime({ offset: true }).nullable().default(null),
    reminder_minutes: z
      .number()
      .int()
      .min(0)
      .max(MAX_REMINDER_MINUTES)
      .default(30),
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
    /** Who on the team is doing a team task. */
    assignee_id: z.uuid().nullable().optional(),
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
    /** The time zone a repeating item keeps its wall-clock time in. */
    timezone: timeZoneField.optional(),
  })
  .strict()
  .refine(
    (d) =>
      !d.end_at || (!!d.due_at && Date.parse(d.end_at) > Date.parse(d.due_at)),
    "End must be after start",
  )
  .refine(
    (d) => d.kind !== "event" || !!d.due_at,
    "Events require a start time",
  )
  .refine((d) => !d.rrule || !!d.due_at, "Repeating items need a date")
  .refine(
    (d) => !d.assignee_id || !!d.team_id,
    "Only team items can be assigned to someone",
  );

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

export const chatRequest = z.object({
  message: z.string().trim().min(1).max(4000),
  timezone: z.string().max(80).default("UTC"),
  /** Most recent turns first-to-last; the server keeps only what it needs. */
  history: z.array(chatTurn).max(12).default([]),
});

export const preferences = z.object({ email_reminders: z.boolean() });

export const pagination = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const itemsQuery = pagination.extend({
  /** Only items shared with this team. */
  team_id: z.uuid().optional(),
  /** Words in the title or notes. */
  q: z.string().trim().max(100).optional(),
  list_id: z.uuid().optional(),
  tag_id: z.uuid().optional(),
  assignee_id: z.uuid().optional(),
});

const emailField = z
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());

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
  })
  .strict()
  .refine(
    (d) => d.role !== undefined || d.disabled !== undefined,
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

const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Colours look like #376c51");
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

const blockTimes = {
  start_at: instant,
  end_at: instant,
};
const blockSpan = (d: { start_at: string; end_at: string }) => {
  const ms = Date.parse(d.end_at) - Date.parse(d.start_at);
  return ms > 0 && ms <= 86_400_000;
};
const BLOCK_SPAN = "A block ends after it starts and lasts 24 hours at most";

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

export const BREAK_LEVELS = ["none", "light", "normal", "intense"] as const;

/** A saved set of what the calendar shows. */
export const calendarSetInput = z
  .object({
    id: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(40),
    personal: z.boolean().default(true),
    team_ids: z.array(z.uuid()).max(50).default([]),
    list_ids: z.array(z.uuid()).max(100).default([]),
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
    filters: frameFilters.default({
      priorities: [],
      list_ids: [],
      tag_ids: [],
      team_ids: [],
      min_minutes: null,
      max_minutes: null,
    }),
    color: color.optional(),
  })
  .strict()
  .refine(frameOrder, "A frame ends after it starts");
export const frameUpdate = z
  .object({
    name: frameFields.name.optional(),
    days: weekdays.optional(),
    start_time: clock.optional(),
    end_time: clock.optional(),
    filters: frameFilters.optional(),
    color: color.optional(),
    position: z.number().int().min(0).max(10000).optional(),
  })
  .strict()
  .refine(frameOrder, "A frame ends after it starts");

/** A place and how long it takes to get there, for travel time. */
export const placeInput = z
  .object({
    label: z.string().trim().min(1).max(60),
    /** Text found in an event's location, such as "Collins St" or "Office". */
    match: z.string().trim().min(1).max(200),
    travel_minutes: z.number().int().min(0).max(240),
  })
  .strict();
export const placeUpdate = z
  .object({
    label: z.string().trim().min(1).max(60).optional(),
    match: z.string().trim().min(1).max(200).optional(),
    travel_minutes: z.number().int().min(0).max(240).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, "Nothing to update");

/** Asking the planner for a plan. Omitted options use the saved preferences. */
export const planPreviewInput = z
  .object({
    /** First day, in the user's time zone; today when omitted. */
    start_date: dayKey.optional(),
    days: z.number().int().min(1).max(7).optional(),
    pad_percent: z.number().int().min(0).max(100).optional(),
    split: z.boolean().optional(),
    break_level: z.enum(BREAK_LEVELS).optional(),
    /** Only place tasks inside frames (when there are any). */
    use_frames: z.boolean().default(true),
    /** Times to leave empty, such as "keep Friday afternoon free". */
    keep_free: z
      .array(z.object({ start_at: instant, end_at: instant }).strict())
      .max(20)
      .default([]),
    /** Only plan these tasks. */
    item_ids: z.array(z.uuid()).max(200).optional(),
    exclude_item_ids: z.array(z.uuid()).max(200).default([]),
    /** The device's time zone, used until the user saves their own in settings. */
    timezone: timeZoneField.optional(),
  })
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
    /** Hosts approve each request before it's booked. */
    requires_approval: z.boolean().default(false),
    /** Bookers can move their booking from their manage link. */
    allow_reschedule: z.boolean().default(true),
    event_title: eventTitle.default("{page} with {name}"),
    /** Shown after booking and in the confirmation email. */
    confirmation_message: z.string().trim().max(1000).default(""),
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
    requires_approval: z.boolean().optional(),
    allow_reschedule: z.boolean().optional(),
    event_title: eventTitle.optional(),
    confirmation_message: z.string().trim().max(1000).optional(),
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
  "booking.requested",
  "booking.confirmed",
  "booking.rescheduled",
  "booking.cancelled",
] as const;
const webhookUrl = z
  .string()
  .trim()
  .max(500)
  .regex(/^https?:\/\/\S+$/i, "Webhook URLs start with https://");
export const webhookInput = z
  .object({
    url: webhookUrl,
    events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length),
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
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, "Nothing to update");
