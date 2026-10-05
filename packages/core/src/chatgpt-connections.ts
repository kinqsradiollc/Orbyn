import { z } from "zod";
import { chatgptModelBinding } from "./chatgpt-models.js";

/** Credentials other than the short-lived identity proof are not accepted here. */
export const chatgptConnectionStart = z
  .object({
    client_id: chatgptModelBinding.shape.client_id.optional(),
  })
  .strict();
export const chatgptConnectionFinish = z
  .object({
    challenge_id: z.uuid(),
    client_id: chatgptModelBinding.shape.client_id,
    id_token: z.string().min(1).max(65_536),
  })
  .strict();
export const chatgptConnectionChallenge = z
  .object({
    id: z.uuid(),
    nonce: z.string().min(16).max(256),
    expires_at: z.iso.datetime(),
  })
  .strict();
export const chatgptConnection = z
  .object({
    id: z.uuid(),
    issuer: chatgptModelBinding.shape.issuer,
    subject: chatgptModelBinding.shape.subject,
    client_id: chatgptModelBinding.shape.client_id,
  })
  .strict();
export const chatgptConnectionList = z.array(
  chatgptConnection.extend({
    verified_at: z.iso.datetime(),
  }),
);
export type ChatgptConnection = z.output<typeof chatgptConnection>;
export type ChatgptConnectionStart = z.input<typeof chatgptConnectionStart>;
export type ChatgptConnectionFinish = z.input<typeof chatgptConnectionFinish>;

/** Handoff identifiers authorize nothing without the bound first-party Orbyn session. */
export const chatgptConnectRequestStart = z
  .object({
    id: z.uuid(),
    expires_at: z.iso.datetime(),
    launch_url: z.string(),
  })
  .strict()
  .refine(
    (value) => value.launch_url === `orbyn://chatgpt?request=${value.id}`,
  );
export const chatgptConnectRequestState = z
  .object({
    id: z.uuid(),
    state: z.enum(["pending", "claimed", "completed", "failed", "expired"]),
    connection_id: z.uuid().nullable(),
    expires_at: z.iso.datetime(),
  })
  .strict();
export const chatgptConnectRequestFinish = z
  .object({ connection_id: z.uuid().nullable() })
  .strict();

/** Shared app feedback; pending does not prove a desktop app is installed or online. */
export function chatgptConnectFeedback(
  phase: "starting" | "pending" | "claimed",
  elapsedMs = 0,
): { label: string; message: string } {
  if (phase === "starting")
    return {
      label: "Starting connection…",
      message: "Creating a ChatGPT sign-in request…",
    };
  if (phase === "claimed")
    return {
      label: "Complete sign-in…",
      message:
        "Orbyn desktop received the request. Complete ChatGPT sign-in in the browser it opens.",
    };
  return {
    label: "Waiting for Orbyn desktop…",
    message:
      elapsedMs >= 30_000
        ? "No desktop app has received this request yet. Open the updated Orbyn desktop app and sign into this Orbyn account."
        : "Keep Orbyn desktop open and signed into this Orbyn account. It will open ChatGPT sign-in when it receives the request.",
  };
}
