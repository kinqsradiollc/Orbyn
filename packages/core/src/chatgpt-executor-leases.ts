import { z } from "zod";
import {
  chatgptModelBinding,
  chatgptModel,
  chatgptModelPreference,
} from "./chatgpt-models.js";
import {
  chatgptExecutorCatalog,
  chatgptExecutorFinish,
} from "./chatgpt-executors.js";

/** Exact enrolled device; owner and session are derived by the server. */
export const chatgptLeaseStart = z.object({ executor_id: z.uuid() }).strict();

/** One-use server proof bound to the current registration and lease generation. */
export const chatgptLeaseChallenge = z
  .object({
    id: z.uuid(),
    executor_id: z.uuid(),
    binding: chatgptModelBinding,
    enrollment_epoch: z.number().int().positive(),
    expected_lease_epoch: z.number().int().nonnegative(),
    proof_message: z.string().min(32).max(2048),
    expires_at: z.iso.datetime(),
  })
  .strict();

export const chatgptLeaseFinish = chatgptExecutorFinish;

/** Server-clock expiry; a lease is invalid after key renewal or session revocation. */
export const chatgptExecutorLease = z
  .object({
    executor_id: z.uuid(),
    binding: chatgptModelBinding,
    enrollment_epoch: z.number().int().positive(),
    lease_epoch: z.number().int().positive(),
    expires_at: z.iso.datetime(),
  })
  .strict();

/** Monotonic heartbeat sequence prevents a recorded signature extending a lease twice. */
export const chatgptLeaseHeartbeat = z
  .object({
    executor_id: z.uuid(),
    lease_epoch: z.number().int().positive(),
    sequence: z.number().int().positive(),
  })
  .strict();

export const chatgptLeaseRenewal = z
  .object({
    heartbeat: chatgptLeaseHeartbeat,
    signature: chatgptExecutorFinish.shape.signature,
  })
  .strict();

/** No arbitrary message, credential, endpoint or renderer identity can be supplied. */
export const chatgptCatalogPublication = z
  .object({
    catalog: chatgptExecutorCatalog,
    signature: chatgptExecutorFinish.shape.signature,
  })
  .strict();

export const CHATGPT_LEASE_HEARTBEAT_DOMAIN =
  "orbyn:executor:lease-heartbeat:v1";

/** Canonical small signed message shared by the device and verification service. */
export function chatgptLeaseHeartbeatMessage(value: unknown): string {
  return JSON.stringify([
    CHATGPT_LEASE_HEARTBEAT_DOMAIN,
    chatgptLeaseHeartbeat.parse(value),
  ]);
}

export type ChatgptExecutorLease = z.output<typeof chatgptExecutorLease>;
export type ChatgptLeaseHeartbeat = z.output<typeof chatgptLeaseHeartbeat>;

/** Explicit selection prevents choosing an arbitrary connected account/device. */
export const chatgptCatalogSelection = z
  .object({
    connection_id: z.uuid(),
    executor_id: z.uuid(),
  })
  .strict();

/** Credential-free catalog state; stale/offline entries cannot authorize defaults. */
export const chatgptCatalogRead = z
  .object({
    executor_id: z.uuid(),
    binding: chatgptModelBinding,
    status: z.enum(["ready", "offline", "stale", "unavailable"]),
    models: z.array(chatgptModel.strict()).max(1000),
    preference: chatgptModelPreference,
    capabilities: z
      .array(z.enum(["plan_inference_v1", "plan_inference_limits_v1"]))
      .max(2)
      .optional(),
    published_at: z.iso.datetime().nullable(),
    expires_at: z.iso.datetime().nullable(),
    sequence: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      JSON.stringify(value.binding) !== JSON.stringify(value.preference.binding)
    )
      ctx.addIssue({
        code: "custom",
        path: ["preference"],
        message: "Catalog and default bindings differ.",
      });
  });

export const chatgptCatalogDefaultUpdate = z
  .object({
    selection: chatgptCatalogSelection,
    preference: chatgptModelPreference,
  })
  .strict();

export const chatgptCatalogReceipt = z
  .object({
    executor_id: z.uuid(),
    lease_epoch: z.number().int().positive(),
    sequence: z.number().int().positive(),
    published_at: z.iso.datetime(),
  })
  .strict();

export type ChatgptLeaseStart = z.output<typeof chatgptLeaseStart>;
export type ChatgptLeaseRenewal = z.output<typeof chatgptLeaseRenewal>;
export type ChatgptCatalogPublication = z.output<
  typeof chatgptCatalogPublication
>;
export type ChatgptCatalogSelection = z.output<typeof chatgptCatalogSelection>;
export type ChatgptCatalogRead = z.output<typeof chatgptCatalogRead>;
export type ChatgptCatalogDefaultUpdate = z.output<
  typeof chatgptCatalogDefaultUpdate
>;
