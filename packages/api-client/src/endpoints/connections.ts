import {
  type AgentContextSettings,
  type AgentInboxKind,
  type AgentInboxSettings,
  chatgptCatalogDefaultUpdate,
  type ChatgptCatalogDefaultUpdate,
  chatgptCatalogRead,
  chatgptCatalogSelection,
  type ChatgptCatalogSelection,
  chatgptConnection,
  chatgptConnectionChallenge,
  chatgptConnectionFinish,
  type ChatgptConnectionFinish,
  chatgptConnectionList,
  chatgptConnectionRefreshIdentity,
  chatgptConnectionStart,
  type ChatgptConnectionStart,
  chatgptConnectRequestStart,
  chatgptConnectRequestState,
  chatgptExecutorChallenge,
  chatgptExecutorEnrolled,
  chatgptExecutorFinish,
  type ChatgptExecutorFinish,
  chatgptExecutorLease,
  chatgptExecutorList,
  chatgptExecutorStart,
  type ChatgptExecutorStart,
  chatgptInferenceAssignment,
  chatgptInferencePublication,
  chatgptLeaseChallenge,
  chatgptLeaseFinish,
  chatgptLeaseRenewal,
  type ChatgptLeaseRenewal,
  chatgptLeaseStart,
  type ChatgptLeaseStart,
  chatgptModelPreference,
  chatgptUsageSummary,
  type McpCatalog,
  type OAuthCheck,
  type OAuthConsentInput,
  type OAuthRedirect,
  type OAuthRequest,
  pluginAiPermissionInput,
  type PluginAiPermissionInput,
  pluginAiPermissionView,
  slackChannelConnection,
  slackChannelDisconnect,
  slackChannelPermission,
  slackChannelStatus,
  slackInstallationConfirm,
  slackInstallationId,
  slackInstallationRequest,
  slackInstallationStart,
  teamsChannelStatus,
} from "@orbyn/core";
import type { OrbynClient } from "../client.js";

export async function callChatgptUsage(
  this: OrbynClient,
  signal?: AbortSignal,
) {
  return chatgptUsageSummary.parse(
    await this.request("/ai/connections/chatgpt/usage", {
      fresh: true,
      signal,
    }),
  );
}

export async function callStartChatgptConnectRequest(
  this: OrbynClient,
  signal?: AbortSignal,
) {
  return chatgptConnectRequestStart.parse(
    await this.request("/ai/connections/chatgpt/connect-requests", {
      method: "POST",
      body: {},
      signal,
    }),
  );
}

/** Teams OAuth identity review is separate from personal conversation linking and DM consent. */

export async function callTeamsChannel(
  this: OrbynClient,
  signal?: AbortSignal,
) {
  return teamsChannelStatus.parse(
    await this.request("/agent-channels/teams", { fresh: true, signal }),
  );
}

/** Read this owner's Slack mapping; installation and messages require separate consent. */

export async function callSlackChannel(
  this: OrbynClient,
  signal?: AbortSignal,
) {
  return slackChannelStatus.parse(
    await this.request("/agent-channels/slack", { fresh: true, signal }),
  );
}

export async function callStartSlackInstallation(
  this: OrbynClient,
  signal?: AbortSignal,
) {
  return slackInstallationStart.parse(
    await this.request("/agent-channels/slack/installations", {
      method: "POST",
      body: {},
      signal,
    }),
  );
}

export async function callSlackInstallation(
  this: OrbynClient,
  id: string,
  signal?: AbortSignal,
) {
  const requestId = slackInstallationId.parse(id);
  return slackInstallationRequest.parse(
    await this.request(`/agent-channels/slack/installations/${requestId}`, {
      fresh: true,
      signal,
    }),
  );
}

export async function callConfirmSlackInstallation(
  this: OrbynClient,
  id: string,
  input: unknown,
  signal?: AbortSignal,
) {
  const requestId = slackInstallationId.parse(id);
  return slackChannelConnection.parse(
    await this.request(
      `/agent-channels/slack/installations/${requestId}/confirm`,
      { method: "POST", body: slackInstallationConfirm.parse(input), signal },
    ),
  );
}

export async function callSetSlackDmPermission(
  this: OrbynClient,
  input: unknown,
  signal?: AbortSignal,
) {
  return slackChannelConnection.parse(
    await this.request("/agent-channels/slack/permission", {
      method: "PUT",
      body: slackChannelPermission.parse(input),
      signal,
    }),
  );
}

export async function callDisconnectSlack(
  this: OrbynClient,
  input: unknown,
  signal?: AbortSignal,
) {
  return slackChannelConnection.parse(
    await this.request("/agent-channels/slack/disconnect", {
      method: "POST",
      body: slackChannelDisconnect.parse(input),
      signal,
    }),
  );
}

export async function callChatgptConnectRequest(
  this: OrbynClient,
  id: string,
  signal?: AbortSignal,
) {
  return chatgptConnectRequestState.parse(
    await this.request(`/ai/connections/chatgpt/connect-requests/${id}`, {
      fresh: true,
      signal,
    }),
  );
}

export async function callClaimChatgptInference(
  this: OrbynClient,
  executorId: string,
  signal?: AbortSignal,
) {
  const result = await this.request("/ai/connections/chatgpt/inference/claim", {
    method: "POST",
    body: { executor_id: executorId },
    signal,
  });
  return result === null ? null : chatgptInferenceAssignment.parse(result);
}

export function callFinishChatgptInference(
  this: OrbynClient,
  publication: unknown,
  signal?: AbortSignal,
) {
  return this.request("/ai/connections/chatgpt/inference/result", {
    method: "POST",
    body: chatgptInferencePublication.parse(publication),
    signal,
  });
}

export function callPendingChatgptConnectRequests(
  this: OrbynClient,
  signal?: AbortSignal,
) {
  return this.request<{ id: string; expires_at: string }[]>(
    "/ai/connections/chatgpt/connect-requests/pending",
    { fresh: true, signal },
  );
}

export function callClaimChatgptConnectRequest(this: OrbynClient, id: string) {
  return this.request(`/ai/connections/chatgpt/connect-requests/${id}/claim`, {
    method: "POST",
    body: {},
  });
}

export function callFinishChatgptConnectRequest(
  this: OrbynClient,
  id: string,
  connectionId: string | null,
) {
  return this.request(`/ai/connections/chatgpt/connect-requests/${id}/finish`, {
    method: "POST",
    body: { connection_id: connectionId },
  });
}

/** Start a session-bound identity proof; plan credentials stay in the device runtime. */

export async function callStartChatgptConnection(
  this: OrbynClient,
  input: ChatgptConnectionStart = {},
  signal?: AbortSignal,
) {
  const result = await this.request<unknown>(
    "/ai/connections/chatgpt/challenges",
    {
      method: "POST",
      body: chatgptConnectionStart.parse(input),
      signal,
    },
  );
  return chatgptConnectionChallenge.parse(result);
}

/** Submit only an ID token for verification, never plan access or refresh credentials. */

export async function callFinishChatgptConnection(
  this: OrbynClient,
  input: ChatgptConnectionFinish,
  signal?: AbortSignal,
) {
  const result = await this.request<unknown>(
    "/ai/connections/chatgpt/complete",
    {
      method: "POST",
      body: chatgptConnectionFinish.parse(input),
      signal,
    },
  );
  return chatgptConnection.parse(result);
}

/** Verified identity metadata for the signed-in person; no cached account catalog. */
/** Enroll the credential-owning device using public proof metadata only. */

export async function callBeginChatgptExecutor(
  this: OrbynClient,
  input: ChatgptExecutorStart,
  signal?: AbortSignal,
) {
  return chatgptExecutorChallenge.parse(
    await this.request<unknown>(
      "/ai/connections/chatgpt/executors/challenges",
      { method: "POST", body: chatgptExecutorStart.parse(input), signal },
    ),
  );
}

export async function callFinishChatgptExecutor(
  this: OrbynClient,
  input: ChatgptExecutorFinish,
  signal?: AbortSignal,
) {
  return chatgptExecutorEnrolled.parse(
    await this.request<unknown>("/ai/connections/chatgpt/executors/complete", {
      method: "POST",
      body: chatgptExecutorFinish.parse(input),
      signal,
    }),
  );
}

export async function callBeginChatgptExecutorLease(
  this: OrbynClient,
  input: ChatgptLeaseStart,
  signal?: AbortSignal,
) {
  return chatgptLeaseChallenge.parse(
    await this.request<unknown>("/ai/connections/chatgpt/leases/challenges", {
      method: "POST",
      body: chatgptLeaseStart.parse(input),
      signal,
    }),
  );
}

export async function callFinishChatgptExecutorLease(
  this: OrbynClient,
  input: ChatgptExecutorFinish,
  signal?: AbortSignal,
) {
  return chatgptExecutorLease.parse(
    await this.request<unknown>("/ai/connections/chatgpt/leases/complete", {
      method: "POST",
      body: chatgptLeaseFinish.parse(input),
      signal,
    }),
  );
}

export async function callRenewChatgptExecutorLease(
  this: OrbynClient,
  input: ChatgptLeaseRenewal,
  signal?: AbortSignal,
) {
  return chatgptExecutorLease.parse(
    await this.request<unknown>("/ai/connections/chatgpt/leases/heartbeat", {
      method: "POST",
      body: chatgptLeaseRenewal.parse(input),
      signal,
    }),
  );
}

/** Always refresh executor presence; a cached list cannot authorize a default. */

export async function callChatgptModels(
  this: OrbynClient,
  input: ChatgptCatalogSelection,
  signal?: AbortSignal,
  includeCapabilities = false,
) {
  const selection = chatgptCatalogSelection.parse(input);
  const query = new URLSearchParams(selection);
  if (includeCapabilities) query.set("include_capabilities", "1");
  const result = chatgptCatalogRead.parse(
    await this.request<unknown>(`/models?${query}`, { fresh: true, signal }),
  );
  if (
    result.executor_id !== selection.executor_id ||
    result.binding.connection_id !== selection.connection_id
  )
    throw new Error("The ChatGPT catalog selection changed.");
  return result;
}

export async function callSelectChatgptDefault(
  this: OrbynClient,
  input: ChatgptCatalogDefaultUpdate,
  signal?: AbortSignal,
) {
  const value = chatgptCatalogDefaultUpdate.parse(input);
  const result = chatgptModelPreference.parse(
    await this.request<unknown>("/models/default", {
      method: "PUT",
      body: value,
      signal,
    }),
  );
  if (
    JSON.stringify(result.binding) !==
      JSON.stringify(value.preference.binding) ||
    result.version !== value.preference.version + 1 ||
    result.model !== value.preference.model
  )
    throw new Error("The ChatGPT default response changed.");
  return result;
}

/** Discover owned devices without provider credentials or signing keys. */

export async function callChatgptExecutors(
  this: OrbynClient,
  signal?: AbortSignal,
) {
  return chatgptExecutorList.parse(
    await this.request<unknown>(
      "/ai/connections/chatgpt/executors?details=device",
      {
        signal,
        fresh: true,
      },
    ),
  );
}

/** Verify replacement identity only; access/refresh credentials are never sent. */

export async function callVerifyChatgptRefreshIdentity(
  this: OrbynClient,
  input: { connection_id: string; id_token: string },
  signal?: AbortSignal,
) {
  const value = chatgptConnectionRefreshIdentity.parse(input);
  const result = chatgptConnection.parse(
    await this.request<unknown>("/ai/connections/chatgpt/refresh-identity", {
      method: "POST",
      body: value,
      signal,
    }),
  );
  if (result.id !== value.connection_id)
    throw new Error("The ChatGPT registration changed.");
  return result;
}

export async function callChatgptConnections(
  this: OrbynClient,
  signal?: AbortSignal,
) {
  return chatgptConnectionList.parse(
    await this.request<unknown>("/ai/connections/chatgpt", {
      signal,
      fresh: true,
    }),
  );
}

/** Disconnect a registration and invalidate pending sign-in attempts. */

export function callRevokeChatgptConnection(this: OrbynClient, id: string) {
  return this.request<void>(
    `/ai/connections/chatgpt/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

// ---- API keys and webhooks ----
/** Public: the OpenAPI description of the API, as YAML. */

export function callOpenApiSpec(this: OrbynClient) {
  return this.request<string>("/openapi.yaml", {
    anonymous: true,
    raw: true,
  });
}

/** The MCP server's public description, for the developer page. */

export function callDeveloperCatalog(this: OrbynClient) {
  return this.request<McpCatalog>("/developers/mcp", { anonymous: true });
}

/** Review explicit managed AI consent for an owned plugin connection. */

export async function callPluginAiPermission(
  this: OrbynClient,
  id: string,
  signal?: AbortSignal,
) {
  return pluginAiPermissionView.parse(
    await this.request<unknown>(`/me/agents/${id}/ai-permission`, {
      fresh: true,
      signal,
    }),
  );
}

/** Only the signed-in owner can enable or revoke provider-bound plugin AI. */

export async function callSetPluginAiPermission(
  this: OrbynClient,
  id: string,
  input: PluginAiPermissionInput,
  signal?: AbortSignal,
) {
  return pluginAiPermissionView.parse(
    await this.request<unknown>(`/me/agents/${id}/ai-permission`, {
      method: "PUT",
      body: pluginAiPermissionInput.parse(input),
      signal,
    }),
  );
}

/** What a connection is sent, its wake-up address and unread count (H0). */

export function callAgentInbox(this: OrbynClient, id: string) {
  return this.request<AgentInboxSettings>(`/me/agents/${id}/inbox`);
}

/** The kinds a connection is not sent ("Send to this agent" off). */

export function callSetAgentInboxMutes(
  this: OrbynClient,
  id: string,
  muted: AgentInboxKind[],
) {
  return this.request<AgentInboxSettings>(`/me/agents/${id}/inbox`, {
    method: "PUT",
    body: { muted },
  });
}

/** "About me for agents" and each space's instructions (H8). */

export function callAgentContext(this: OrbynClient) {
  return this.request<AgentContextSettings>("/me/agent-context");
}

// ---- Signing in with Orbyn (the consent page) ----
/** What an app's sign-in request asks for; with your spaces when signed in. */

export function callOauthCheck(this: OrbynClient, request: OAuthRequest) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(request))
    if (typeof v === "string") q.set(k, v);
  return this.request<OAuthCheck>(`/oauth/authorize/check?${q}`);
}

/** Allow the request: where to send the browser back, with a code. */

export function callOauthAllow(this: OrbynClient, input: OAuthConsentInput) {
  return this.request<OAuthRedirect>("/oauth/authorize", {
    method: "POST",
    body: input,
  });
}

/** Decline the request: where to send the browser back, with an error. */

export function callOauthDeny(this: OrbynClient, request: OAuthRequest) {
  return this.request<OAuthRedirect>("/oauth/authorize/deny", {
    method: "POST",
    body: { request },
  });
}
