import { z } from "zod";
import { chatgptModelBinding, chatgptModel } from "./chatgpt-models.js";
import { chatgptPlanUsage } from "./chatgpt-desktop.js";
import { chatgptExecutorFinish } from "./chatgpt-executors.js";

/** Only the server assigns conversation input; renderer commands cannot supply it. */
export const chatgptInferenceInput = z
  .object({
    instructions: z.string().max(1_000_000),
    max_output_tokens: z.number().int().min(1).max(65536).optional(),
    input: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().max(1_000_000),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();
export const chatgptInferenceAssignment = z
  .object({
    id: z.uuid(),
    job_id: z.uuid(),
    executor_id: z.uuid(),
    binding: chatgptModelBinding,
    enrollment_epoch: z.number().int().positive(),
    lease_epoch: z.number().int().positive(),
    model: chatgptModel.shape.slug,
    nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    request_hash: z.string().regex(/^[a-f0-9]{64}$/),
    expires_at: z.iso.datetime(),
    payload: chatgptInferenceInput,
  })
  .strict();
export type ChatgptInferenceAssignment = z.output<
  typeof chatgptInferenceAssignment
>;
export const chatgptInferenceResult = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("completed"),
      text: z.string().max(1_000_000),
      usage: chatgptPlanUsage.nullable(),
    })
    .strict(),
  z
    .object({
      status: z.literal("failed"),
      reason: z.enum([
        "eligibility",
        "usage_limit",
        "unavailable",
        "permission",
        "interrupted",
        "unknown",
      ]),
      phase: z.enum(["admission", "stream", "unknown"]),
      http_status: z.number().int().min(100).max(599).nullable(),
      provider_code: z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,128}$/)
        .nullable(),
    })
    .strict(),
]);
export const chatgptInferenceReceipt = z
  .object({
    request_id: z.uuid(),
    executor_id: z.uuid(),
    binding: chatgptModelBinding,
    enrollment_epoch: z.number().int().positive(),
    lease_epoch: z.number().int().positive(),
    model: chatgptModel.shape.slug,
    nonce: chatgptInferenceAssignment.shape.nonce,
    request_hash: chatgptInferenceAssignment.shape.request_hash,
    result: chatgptInferenceResult,
  })
  .strict();
export const chatgptInferencePublication = z
  .object({
    receipt: chatgptInferenceReceipt,
    proof_format: z.literal("sha256_v2").optional(),
    signature: chatgptExecutorFinish.shape.signature,
  })
  .strict();
/** Signature covers input identity, nonce, epochs and the exact bounded result. */
export function chatgptInferenceReceiptMessage(value: unknown): string {
  return JSON.stringify([
    "orbyn:executor:inference-result:v1",
    chatgptInferenceReceipt.parse(value),
  ]);
}

/** V2 signs a bounded digest of every receipt field; hashing stays in the credential-owning runtime. */
export const CHATGPT_INFERENCE_SIGNATURE_DOMAIN =
  "orbyn:executor:inference-result:v2";
export function chatgptInferenceSigningInput(value: unknown): string {
  return JSON.stringify([
    CHATGPT_INFERENCE_SIGNATURE_DOMAIN,
    chatgptInferenceReceipt.parse(value),
  ]);
}
