/**
 * Your own fields on pages and projects (ORG-02): a small set of typed
 * fields kept in the Info panel, never written into a page's words (`::`
 * already makes a flashcard, so there is no inline syntax). A field belongs
 * to a space — your own, or a team's — and every page (or project) there
 * shares it, so saved views can filter, sort and group by it. Date fields
 * can show on the calendar as deadlines ("Essay due", DATA-07).
 */
import { z } from "zod";

export const FIELD_TYPES = [
  "text",
  "number",
  "date",
  "select",
  "person",
  "checkbox",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  select: "Choice",
  person: "Person",
  checkbox: "Checkbox",
};

/** What a field sits on. */
export const FIELD_TARGETS = ["page", "project"] as const;
export type FieldTarget = (typeof FIELD_TARGETS)[number];

/** The most fields one space may have for pages (and again for projects). */
export const MAX_FIELDS_PER_SPACE = 40;
/** The most choices a Choice field may offer. */
export const MAX_FIELD_OPTIONS = 30;
/** The longest a text value may be. */
export const MAX_FIELD_TEXT = 500;

export type CustomField = {
  id: string;
  /** Who made it. */
  user_id: string;
  /** The team whose pages or projects share it; null for your own. */
  team_id: string | null;
  team_name?: string | null;
  applies_to: FieldTarget;
  name: string;
  type: FieldType;
  /** The choices of a Choice field, in order; empty for any other type. */
  options: string[];
  /** A date field shown on the calendar as a deadline. */
  on_calendar: boolean;
  position: number;
  created_at: string;
  /** Whether you may rename it, change its choices or remove it. */
  can_manage?: boolean;
};

/** A field's value: text, a number, a day ("2026-10-02"), a choice, a person's id, or a tick. */
export type FieldValue = string | number | boolean | null;

/** The values of one page or project, by field id. */
export type FieldValues = Record<string, FieldValue>;

/** A page's or project's fields and their values, for its Info panel. */
export type TargetFields = {
  target: FieldTarget;
  target_id: string;
  team_id: string | null;
  fields: CustomField[];
  values: FieldValues;
  /** Whether you may change the values (and add fields here). */
  can_write: boolean;
  /** The people a Person field can name: you, or the team's members. */
  people: { id: string; name: string }[];
};

/** A date field's day on the calendar: "Essay due · Lab 3 notes". */
export type FieldDate = {
  field_id: string;
  field_name: string;
  target: FieldTarget;
  target_id: string;
  /** The page's or project's title. */
  title: string;
  /** "YYYY-MM-DD". */
  date: string;
  team_id: string | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: string) =>
  DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

const fieldName = z.string().trim().min(1).max(60);
const fieldOptions = z
  .array(z.string().trim().min(1).max(40))
  .max(MAX_FIELD_OPTIONS);

const uniqueOptions = (options: string[] | undefined) =>
  !options ||
  new Set(options.map((o) => o.toLowerCase())).size === options.length;

export const customFieldInput = z
  .object({
    name: fieldName,
    type: z.enum(FIELD_TYPES),
    applies_to: z.enum(FIELD_TARGETS),
    team_id: z.uuid().nullable().default(null),
    options: fieldOptions.default([]),
    on_calendar: z.boolean().default(false),
  })
  .strict()
  .superRefine((f, ctx) => {
    if (f.type === "select" && !f.options.length)
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "A choice field needs at least one choice.",
      });
    if (f.type !== "select" && f.options.length)
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "Only a choice field has choices.",
      });
    if (!uniqueOptions(f.options))
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "Each choice can only be listed once.",
      });
    if (f.on_calendar && f.type !== "date")
      ctx.addIssue({
        code: "custom",
        path: ["on_calendar"],
        message: "Only a date field can show on the calendar.",
      });
  });
export type CustomFieldInput = z.input<typeof customFieldInput>;

/** Renaming, new choices, the calendar switch or a new place in the list. */
export const customFieldUpdate = z
  .object({
    name: fieldName.optional(),
    options: fieldOptions.optional(),
    on_calendar: z.boolean().optional(),
    position: z.number().int().min(0).max(10_000).optional(),
  })
  .strict()
  .refine((f) => uniqueOptions(f.options), {
    path: ["options"],
    message: "Each choice can only be listed once.",
  });
export type CustomFieldUpdate = z.input<typeof customFieldUpdate>;

/** Setting (or clearing, with null) one field on one page or project. */
export const fieldValueInput = z
  .object({
    target: z.enum(FIELD_TARGETS),
    target_id: z.uuid(),
    value: z.union([
      z.string().max(MAX_FIELD_TEXT),
      z.number(),
      z.boolean(),
      z.null(),
    ]),
  })
  .strict();
export type FieldValueInput = z.input<typeof fieldValueInput>;

export const fieldValuesQuery = z.object({
  target: z.enum(FIELD_TARGETS),
  id: z.uuid(),
});

export const fieldDatesQuery = z
  .object({
    from: z.string().refine(isDay, "Use YYYY-MM-DD."),
    to: z.string().refine(isDay, "Use YYYY-MM-DD."),
  })
  .refine((q) => q.from <= q.to, "`from` must be before `to`.")
  .refine(
    (q) =>
      Date.parse(`${q.to}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`) <=
      400 * 86_400_000,
    "Ask for 400 days at most.",
  );

/**
 * A value made ready to keep: trimmed, of the field's type, and one of its
 * choices for a Choice field. Empty text and null clear the field. Whether a
 * person may be named is checked where the team's members are known.
 */
export function checkFieldValue(
  field: Pick<CustomField, "type" | "options" | "name">,
  value: FieldValue,
): { ok: true; value: FieldValue } | { ok: false; reason: string } {
  if (value === null) return { ok: true, value: null };
  const wrong = (what: string) => ({
    ok: false as const,
    reason: `${field.name} takes ${what}.`,
  });
  switch (field.type) {
    case "text": {
      if (typeof value !== "string") return wrong("text");
      const text = value.trim();
      return { ok: true, value: text || null };
    }
    case "number":
      if (typeof value === "string" && value.trim() === "")
        return { ok: true, value: null };
      {
        const n = typeof value === "string" ? Number(value) : value;
        if (typeof n !== "number" || !Number.isFinite(n))
          return wrong("a number");
        if (Math.abs(n) > 1e12) return wrong("a smaller number");
        return { ok: true, value: n };
      }
    case "date":
      if (typeof value !== "string") return wrong("a date (YYYY-MM-DD)");
      if (!value.trim()) return { ok: true, value: null };
      return isDay(value.trim())
        ? { ok: true, value: value.trim() }
        : wrong("a date (YYYY-MM-DD)");
    case "select": {
      if (typeof value !== "string") return wrong("one of its choices");
      if (!value.trim()) return { ok: true, value: null };
      const choice = field.options.find(
        (o) => o.toLowerCase() === value.trim().toLowerCase(),
      );
      return choice ? { ok: true, value: choice } : wrong("one of its choices");
    }
    case "person":
      if (typeof value !== "string" || !z.uuid().safeParse(value).success)
        return wrong("a person");
      return { ok: true, value };
    case "checkbox":
      if (typeof value !== "boolean") return wrong("a tick or no tick");
      return { ok: true, value };
  }
}

/** How a value reads in a table, a card or a CSV file. */
export function fieldValueText(
  field: Pick<CustomField, "type">,
  value: FieldValue | undefined,
  people: { id: string; name: string }[] = [],
): string {
  if (value === null || value === undefined) return "";
  switch (field.type) {
    case "checkbox":
      return value ? "Yes" : "No";
    case "person":
      return people.find((p) => p.id === value)?.name ?? "Someone";
    case "date": {
      if (typeof value !== "string" || !isDay(value)) return String(value);
      const d = new Date(`${value}T12:00:00Z`);
      return d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
    }
    case "number":
      return typeof value === "number"
        ? String(Math.round(value * 1000) / 1000)
        : String(value);
    default:
      return String(value);
  }
}

/** The fields that apply to a page or project in a space, in order. */
export function fieldsFor(
  fields: CustomField[],
  target: FieldTarget,
  teamId: string | null,
): CustomField[] {
  return fields
    .filter((f) => f.applies_to === target && f.team_id === teamId)
    .sort(
      (a, b) =>
        a.position - b.position ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
}
