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

export const teamsInstallationId = z.uuid();
export const teamsChannelConnection = z
  .object({
    id: z.uuid(),
    display_name: z.string().min(1).max(200),
    tenant_id: z.uuid(),
    object_id: z.uuid(),
    version: z.number().int().positive(),
    dm_enabled: z.boolean(),
    state: z.enum([
      "awaiting_conversation",
      "linked",
      "reconnect",
      "disconnected",
    ]),
  })
  .strict();
export const teamsChannelStatus = z
  .object({
    configured: z.boolean(),
    delivery_available: z.boolean(),
    connection: teamsChannelConnection.nullable(),
  })
  .strict();
export const teamsInstallationStart = z
  .object({
    id: z.uuid(),
    authorization_url: z
      .url()
      .max(4096)
      .refine((value) => {
        const url = new URL(value);
        return (
          url.origin === "https://login.microsoftonline.com" &&
          url.pathname === "/organizations/oauth2/v2.0/authorize" &&
          !url.username &&
          !url.password &&
          !url.hash
        );
      }),
    expires_at: z.iso.datetime(),
  })
  .strict();
export const teamsInstallationRequest = z
  .object({
    id: z.uuid(),
    state: z.enum([
      "pending",
      "exchanging",
      "ready",
      "confirmed",
      "failed",
      "expired",
    ]),
    expires_at: z.iso.datetime(),
    identity: z
      .object({
        tenantId: z.uuid(),
        objectId: z.uuid(),
        subject: z.string().min(1).max(255),
        displayName: z.string().min(1).max(200),
      })
      .strict()
      .nullable(),
  })
  .strict();
export const teamsInstallationConfirm = z
  .object({
    expected_version: z.number().int().nonnegative(),
    tenant_id: z.uuid(),
    object_id: z.uuid(),
  })
  .strict();
export const teamsConversationChallenge = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    link_token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    link_expires_at: z.iso.datetime(),
    dm_enabled: z.literal(false),
  })
  .strict();
export const teamsChannelDisconnect = z
  .object({ expected_version: z.number().int().positive() })
  .strict();
export type TeamsChannelConnection = z.output<typeof teamsChannelConnection>;
export type TeamsChannelStatus = z.output<typeof teamsChannelStatus>;
export type TeamsInstallationRequest = z.output<
  typeof teamsInstallationRequest
>;

export const teamsChannelPermission = z
  .object({
    expected_version: z.number().int().positive(),
    dm_enabled: z.boolean(),
  })
  .strict();
