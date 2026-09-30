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
