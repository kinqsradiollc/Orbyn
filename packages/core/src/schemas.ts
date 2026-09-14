import { z } from "zod";
import { SYSTEM_ROLES, TEAM_ROLES } from "./rbac.js";
import { AI_PROVIDER_KINDS } from "./aiProviders.js";

export const KINDS = ["task", "event"] as const;
export const STATUSES = ["todo", "done"] as const;
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

/** Which provider and model the assistant uses; a null provider falls back to the server's .env. */
export const aiSettingsInput = z
  .object({
    provider_id: z.uuid().nullable(),
    model: z.string().trim().max(200).default(""),
  })
  .strict();

export const aiTestInput = z
  .object({ model: z.string().trim().max(200).optional() })
  .strict();
