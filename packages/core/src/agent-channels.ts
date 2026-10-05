import { z } from "zod";

const workspaceId = z.string().regex(/^T[A-Z0-9]{2,63}$/);
const slackUserId = z.string().regex(/^[UW][A-Z0-9]{2,63}$/);
const botScopes = z.array(z.string().min(1).max(100)).min(1).max(100);
export const slackInstallationId = z.uuid();
export const slackChannelConnection = z
  .object({
    id: z.uuid(),
    workspace_id: workspaceId,
    workspace_name: z.string().min(1).max(200),
    external_user_id: slackUserId,
    bot_scopes: botScopes,
    dm_enabled: z.boolean(),
    version: z.number().int().positive(),
    disconnected: z.boolean(),
    token_expires_at: z.iso.datetime().nullable(),
    token_state: z.enum(["ready", "refreshing", "unknown", "reconnect"]),
  })
  .strict();
export type SlackChannelConnection = z.output<typeof slackChannelConnection>;

export const slackChannelStatus = z
  .object({
    configured: z.boolean(),
    connection: slackChannelConnection.nullable(),
  })
  .strict();
export const slackInstallationStart = z
  .object({
    id: z.uuid(),
    authorization_url: z
      .url()
      .max(4096)
      .refine((value) => {
        const url = new URL(value);
        return (
          url.origin === "https://slack.com" &&
          url.pathname === "/oauth/v2/authorize" &&
          !url.username &&
          !url.password &&
          !url.hash
        );
      }),
    expires_at: z.iso.datetime(),
  })
  .strict();
export const slackInstallationRequest = z
  .object({
    id: z.uuid(),
    state: z.enum([
      "pending",
      "exchanging",
      "ready",
      "done",
      "failed",
      "expired",
      "unavailable",
    ]),
    expires_at: z.iso.datetime(),
    identity: z
      .object({
        workspace_id: workspaceId,
        workspace_name: z.string().min(1).max(200),
        external_user_id: slackUserId,
        bot_scopes: botScopes,
      })
      .strict()
      .nullable(),
  })
  .strict();
/** Confirm the exact reviewed actor and current local connection version. */
export const slackInstallationConfirm = z
  .object({
    workspace_id: workspaceId,
    external_user_id: slackUserId,
    expected_bot_scopes: botScopes,
    expected_version: z.number().int().nonnegative(),
    dm_enabled: z.boolean(),
  })
  .strict();
export const slackChannelPermission = z
  .object({
    expected_version: z.number().int().positive(),
    dm_enabled: z.boolean(),
  })
  .strict();
export const slackChannelDisconnect = z
  .object({ expected_version: z.number().int().positive() })
  .strict();

export type SlackChannelStatus = z.output<typeof slackChannelStatus>;
export type SlackInstallationRequest = z.output<
  typeof slackInstallationRequest
>;
