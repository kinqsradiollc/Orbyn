import { z } from "zod";
import { chatgptModel, chatgptModelBinding } from "./chatgpt-models.js";

/** Public Ed25519 SPKI only; binary/algorithm validation belongs to the server. */
export const chatgptExecutorStart = z
  .object({
    connection_id: z.uuid(),
    host_id: z.uuid(),
    public_key: z.string().regex(/^[A-Za-z0-9_-]{59}$/),
  })
  .strict();

/** Fresh exact-session challenge; signature verification is required before enrollment. */
export const chatgptExecutorChallenge = z
  .object({
    id: z.uuid(),
    binding: chatgptModelBinding,
    host_id: z.uuid(),
    public_key_fingerprint: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    proof_message: z.string().min(32).max(2048),
    expires_at: z.iso.datetime(),
  })
  .strict();

export const chatgptExecutorFinish = z
  .object({
    challenge_id: z.uuid(),
    signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
  })
  .strict();

/** A catalog is reported metadata, never proof that a provider request is authorized. */
export const chatgptExecutorCatalog = z
  .object({
    executor_id: z.uuid(),
    binding: chatgptModelBinding,
    lease_epoch: z.number().int().positive(),
    sequence: z.number().int().positive(),
    models: z.array(chatgptModel.strict()).max(1000),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    for (const model of value.models) {
      if (seen.has(model.slug))
        context.addIssue({
          code: "custom",
          path: ["models"],
          message: "Duplicate catalog model.",
        });
      seen.add(model.slug);
    }
  });

export type ChatgptExecutorStart = z.output<typeof chatgptExecutorStart>;
export type ChatgptExecutorChallenge = z.output<
  typeof chatgptExecutorChallenge
>;
export type ChatgptExecutorFinish = z.output<typeof chatgptExecutorFinish>;
export type ChatgptExecutorCatalog = z.output<typeof chatgptExecutorCatalog>;

export const CHATGPT_CATALOG_SIGNATURE_DOMAIN = "orbyn:executor:catalog:v1";

/** Canonical metadata for the runtime/server signature digest; never includes credentials. */
export function chatgptCatalogSigningInput(value: unknown): string {
  return JSON.stringify([
    CHATGPT_CATALOG_SIGNATURE_DOMAIN,
    chatgptExecutorCatalog.parse(value),
  ]);
}
