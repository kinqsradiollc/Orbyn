import { z } from "zod";
import {
  chatgptModel,
  chatgptModelBinding,
  chatgptModelPreference,
} from "./chatgpt-models.js";

export const chatgptRegistrationId = z.union([z.literal("primary"), z.uuid()]);

/** Only usage reported by a completed Responses request, never an allowance estimate. */
export const chatgptPlanUsage = z
  .object({
    input_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    output_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    total_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict()
  .refine(
    (value) => value.total_tokens === value.input_tokens + value.output_tokens,
  );
export type ChatgptPlanUsage = z.output<typeof chatgptPlanUsage>;
export const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";
export const chatgptPlanVerification = z
  .object({
    binding: chatgptModelBinding,
    model: chatgptModel.shape.slug,
    verified_at: z.iso.datetime(),
    usage: chatgptPlanUsage.nullable(),
  })
  .strict();

/** Renderer-facing state contains identity/catalog metadata, never plan credentials. */
export const chatgptDesktopState = z
  .object({
    status: z.enum(["signed-out", "ready", "unavailable"]),
    busy: z.boolean(),
    user_id: z.uuid().nullable(),
    connections: z
      .array(
        z
          .object({
            registration_id: chatgptRegistrationId,
            binding: chatgptModelBinding,
            selected: z.boolean(),
            sharing_granted: z.boolean().nullable(),
          })
          .strict(),
      )
      .max(1000),
    selection: z
      .object({
        registrationId: chatgptRegistrationId.nullable(),
        revision: z.uuid().nullable(),
      })
      .strict()
      .nullable(),
    catalog: z
      .object({
        status: z.enum(["idle", "loading", "ready", "unavailable"]),
        models: z.array(chatgptModel.strict()).max(1000),
        preference: chatgptModelPreference.nullable(),
        saving: z.boolean(),
        error: z.string().max(2000).nullable(),
      })
      .strict()
      .nullable(),
    error: z.string().max(2000).nullable(),
    verification: chatgptPlanVerification.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "signed-out") {
      if (
        value.user_id !== null ||
        value.connections.length ||
        value.selection !== null ||
        value.catalog !== null ||
        value.busy ||
        value.error !== null ||
        value.verification !== undefined
      )
        ctx.addIssue({
          code: "custom",
          message: "Signed-out desktop state must be empty.",
        });
      return;
    }
    if (
      !value.user_id ||
      value.connections.some((c) => c.binding.user_id !== value.user_id)
    )
      ctx.addIssue({
        code: "custom",
        message: "Desktop connections belong to another Orbyn account.",
      });
    const selected = value.connections.filter((c) => c.selected);
    if (
      new Set(value.connections.map((c) => c.registration_id)).size !==
      value.connections.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Duplicate desktop registration.",
      });
    if (
      selected.length > 1 ||
      (selected.length === 1 &&
        value.selection?.registrationId !== selected[0].registration_id) ||
      (value.selection?.registrationId !== null &&
        value.selection?.registrationId !== undefined &&
        selected[0]?.registration_id !== value.selection.registrationId)
    )
      ctx.addIssue({ code: "custom", message: "Desktop selection changed." });
    if (
      value.verification &&
      (!selected[0] ||
        JSON.stringify(value.verification.binding) !==
          JSON.stringify(selected[0].binding))
    )
      ctx.addIssue({
        code: "custom",
        message: "Plan verification belongs to another account.",
      });
    if (
      value.catalog?.preference &&
      (!selected[0] ||
        JSON.stringify(value.catalog.preference.binding) !==
          JSON.stringify(selected[0].binding))
    )
      ctx.addIssue({
        code: "custom",
        message: "Desktop catalog belongs to another connection.",
      });
  });

/** These command inputs are metadata only. Orbyn session initialization has its own channel. */
export const chatgptDesktopCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("state") }).strict(),
  z.object({ action: z.literal("connect") }).strict(),
  z
    .object({ action: z.literal("connect-request"), requestId: z.uuid() })
    .strict(),
  z.object({ action: z.literal("cancel") }).strict(),
  z.object({ action: z.literal("refresh") }).strict(),
  z.object({ action: z.literal("verify-plan") }).strict(),
  z
    .object({
      action: z.literal("select"),
      registrationId: chatgptRegistrationId,
      selectionRevision: z.uuid().nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("reconnect"),
      registrationId: chatgptRegistrationId,
    })
    .strict(),
  z
    .object({
      action: z.literal("disconnect"),
      registrationId: chatgptRegistrationId,
    })
    .strict(),
  z
    .object({
      action: z.literal("set-default"),
      model: chatgptModel.shape.slug.nullable(),
      version: z.number().int().nonnegative(),
    })
    .strict(),
]);

export const chatgptDesktopDisconnect = z
  .object({
    state: chatgptDesktopState,
    remote_revocation_confirmed: z.boolean(),
  })
  .strict();
export type ChatgptDesktopState = z.output<typeof chatgptDesktopState>;
export type ChatgptDesktopCommand = z.input<typeof chatgptDesktopCommand>;
