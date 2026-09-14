import { KINDS, PRIORITIES, STATUSES } from "@orbyn/core";

/**
 * The assistant's reply as a strict JSON Schema, sent as `response_format`
 * to providers flagged `structuredOutput: "json_schema"` (Maincode's Matilda
 * answers in prose unless given a schema). Strict schemas list every field as
 * required, so optional fields accept null; `dropNulls` removes those nulls
 * before validation so the usual defaults apply. The shape is exactly
 * `{ type, json_schema: { name, schema } }`: Matilda rejects unknown fields.
 */
const item = {
  title: { type: "string" },
  notes: { type: ["string", "null"] },
  kind: { type: ["string", "null"], enum: [...KINDS, null] },
  status: { type: ["string", "null"], enum: [...STATUSES, null] },
  priority: { type: ["string", "null"], enum: [...PRIORITIES, null] },
  due_at: {
    type: ["string", "null"],
    description:
      "Start or due time as ISO 8601 with the user's UTC offset for that date, for example 2026-09-18T18:00:00+10:00. Null when there is no time.",
  },
  end_at: {
    type: ["string", "null"],
    description: "End time in the same format, after due_at. Null if none.",
  },
  reminder_minutes: { type: ["integer", "null"] },
  team_id: { type: ["string", "null"] },
  progress: { type: ["integer", "null"] },
};

export const REPLY_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "orbyn_reply",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "actions"],
      properties: {
        summary: {
          type: "string",
          description: "Your reply to the user in plain, friendly sentences.",
        },
        actions: {
          type: "array",
          description:
            "Proposed changes. Empty unless the user asked to create, change or delete something.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["operation", "item_id", "version", "data"],
            properties: {
              operation: {
                type: "string",
                enum: ["create", "update", "delete"],
              },
              item_id: {
                type: ["string", "null"],
                description:
                  "The existing item's id for update and delete. Null for create.",
              },
              version: {
                type: ["integer", "null"],
                description:
                  "The existing item's version for update and delete. Null for create.",
              },
              data: {
                type: ["object", "null"],
                description:
                  "Every item field for create and update. Null for delete.",
                additionalProperties: false,
                required: Object.keys(item),
                properties: item,
              },
            },
          },
        },
      },
    },
  },
};

const ACTION_OPTIONAL = ["item_id", "version", "data"];
const DATA_DEFAULTED = [
  "notes",
  "kind",
  "status",
  "priority",
  "reminder_minutes",
  "progress",
];

const withoutNulls = (value: Record<string, unknown>, keys: string[]) => {
  const copy = { ...value };
  for (const key of keys) if (copy[key] === null) delete copy[key];
  return copy;
};

/**
 * Remove the nulls a strict schema forces onto optional or defaulted fields,
 * and any id or version a model invents for a new item: a create never has
 * either, and a made-up id is often not a valid UUID.
 */
export function dropNulls(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const reply = value as { actions?: unknown };
  if (!Array.isArray(reply.actions)) return value;
  return {
    ...reply,
    actions: reply.actions.map((action) => {
      if (!action || typeof action !== "object") return action;
      const cleaned = withoutNulls(
        action as Record<string, unknown>,
        ACTION_OPTIONAL,
      );
      if (cleaned.operation === "create") {
        delete cleaned.item_id;
        delete cleaned.version;
      }
      if (cleaned.data && typeof cleaned.data === "object")
        cleaned.data = withoutNulls(
          cleaned.data as Record<string, unknown>,
          DATA_DEFAULTED,
        );
      return cleaned;
    }),
  };
}
