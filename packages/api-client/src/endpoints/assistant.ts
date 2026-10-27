import {
  type AdminAgentClient,
  type AdminAgentUsage,
  type AgentActivity,
  type AgentContextSettings,
  type AgentGrant,
  type AgentInboxSettings,
  type AgentKeyInput,
  type AgentQuestion,
  type AgentRoutine,
  type AgentRoutineInput,
  type AgentRoutineUpdate,
  type AgentRule,
  type AgentRuleInput,
  type AgentSettings,
  type AgentSettingsUpdate,
  type AgentsOverview,
  type AgentToolset,
  type AgentTrustInput,
  type AiChat,
  type AiChatSummary,
  type AiEmbeddingModelList,
  type AiModelList,
  type AiProvider,
  aiProviderChoice,
  aiProviderChoiceInput,
  type AiProviderKind,
  type AiProviderOptions,
  type AiProvidersResponse,
  type AiSettings,
  type AiTestResult,
  type ApprovalScopes,
  type AssistantActionRule,
  assistantActivityLane,
  type AssistantActivityLane,
  assistantActivityPage,
  assistantActivityQuery,
  assistantBudgetLane,
  assistantBudgets,
  assistantBudgetUpdate,
  assistantBudgetView,
  type AssistantBudgetView,
  assistantConversationAnswer,
  assistantConversationAnswerInput,
  assistantConversationDestination,
  assistantConversationDetails,
  assistantConversationHome,
  assistantConversationLocation,
  assistantConversationMuteInput,
  assistantConversationPage,
  assistantConversationPreferences,
  assistantConversationQuery,
  assistantConversationReadInput,
  assistantHandoff,
  assistantHandoffInput,
  assistantHandoffLane,
  type AssistantHandoffLane,
  assistantHandoffSource,
  type AssistantIdea,
  assistantProfiles,
  assistantRulesInput,
  assistantRulesSnapshot,
  assistantSavedHistory,
  assistantSavedHistoryQuery,
  assistantWorkControls,
  assistantWorkControlsInput,
  automationAgentIdentity,
  type AutomationAgentIdentity,
  type AutomationAgentLane,
  type ChatChannel,
  type ChatScope,
  type ChatTurn,
  HttpError,
  type Item,
  type LinkPreview,
  type ManagedAiUsageSummary,
  type NewAgentKey,
  type NewAgentWake,
  type OvernightNight,
  type OvernightRun,
  type PersonalAgentSettings,
  type Plan,
  type PlannerReview,
  type PlanPreviewInput,
  type Project,
  type ProjectChatInput,
  type ProjectChatSummary,
  type Proposal,
  type ProposalStatus,
  type QuickAddResult,
  type Rating,
  type RecordingSummary,
  type ReminderNudgeSettings,
  type ReviewApplied,
  type ReviewApproveInput,
  type ReviewInbox,
  type ReviewItem,
  type StudyCard,
  type TeamAgentAccess,
  type TeamAgentsView,
  type UpdateAiChatInput,
} from "@orbyn/core";
import {
  abortError,
  AssistantRunProgress,
  CHAT_POLL_MAX_MS,
  CHAT_POLL_MS,
  CHAT_WAIT_MS,
  CHAT_WAITING_MAX_MS,
  ChatJob,
  ChatResult,
  pause,
  RequestOptions,
} from "../client-contracts.js";
import type { OrbynClient } from "../client.js";

/** Durable explicit reminder decision; replaying the same choice returns its original receipt. */

export function callPerformReminderAction(
  this: OrbynClient,
  card: import("@orbyn/core").ReminderNudgeCard,
  action: import("@orbyn/core").ReminderNudgeCard["actions"][number],
  options: {
    day?: string;
    minutes?: number;
    chatId?: string;
    turnId?: string;
  } = {},
) {
  return this.reminderActionReceipt(card.id).then((previous) =>
    this.request<{
      id: string;
      message: string;
      undone: boolean;
      generation: number;
    }>("/me/assistant/reminder-actions", {
      method: "POST",
      body: {
        card,
        action,
        options,
        generation: previous
          ? previous.generation + (previous.undone ? 1 : 0)
          : 0,
      },
    }),
  );
}

export function callReminderActionReceipt(this: OrbynClient, nudgeId: string) {
  return this.request<{
    id: string;
    message: string;
    undone: boolean;
    generation: number;
  } | null>(`/me/assistant/reminder-actions/nudges/${nudgeId}`, {
    fresh: true,
  });
}

export function callUndoReminderAction(this: OrbynClient, id: string) {
  return this.request<void>(`/me/assistant/reminder-actions/${id}/undo`, {
    method: "POST",
    body: {},
  });
}

// ---- chat delivery ----

export function callGetChat(this: OrbynClient) {
  return this.request<ChatChannel>("/me/chat");
}

export function callSetChat(
  this: OrbynClient,
  kind: "slack" | "discord",
  url: string,
) {
  return this.request<ChatChannel>("/me/chat", {
    method: "PUT",
    body: { kind, url },
  });
}

export function callDisableChat(this: OrbynClient) {
  return this.request<void>("/me/chat", { method: "DELETE" });
}

/** Post a test message to the connected chat webhook. */

export function callTestChat(this: OrbynClient) {
  return this.request<void>("/me/chat/test", { method: "POST" });
}

/**
 * Keep a project out of the assistant (or let it back in). Owners and
 * admins of a team project, or the owner of a personal one.
 */

export function callSetProjectAssistant(
  this: OrbynClient,
  id: string,
  off: boolean,
) {
  return this.request<Project>(`/projects/${id}/assistant`, {
    method: "PUT",
    body: { off },
  });
}

/** Your saved chats with the assistant about a project, newest first. */

export function callProjectChats(this: OrbynClient, projectId: string) {
  return this.request<AiChatSummary[]>(`/ai/projects/${projectId}/chats`);
}

export async function callAiProviderChoice(
  this: OrbynClient,
  signal?: AbortSignal,
) {
  return aiProviderChoice.parse(
    await this.request("/ai/provider-choice", { fresh: true, signal }),
  );
}

/** Completed Orbyn request measurements, not account-wide ChatGPT quota. */

export function callManagedAiUsage(this: OrbynClient, signal?: AbortSignal) {
  return this.request<ManagedAiUsageSummary>("/ai/usage", {
    signal,
    fresh: true,
  });
}

export async function callSaveAiProviderChoice(
  this: OrbynClient,
  input: unknown,
  signal?: AbortSignal,
) {
  return aiProviderChoice.parse(
    await this.request("/ai/provider-choice", {
      method: "PUT",
      body: aiProviderChoiceInput.parse(input),
      signal,
    }),
  );
}

/** Your saved assistant chats, pinned first and then most recently used. */

export function callAiChats(
  this: OrbynClient,
  options: {
    search?: string;
    project_id?: string;
    limit?: number;
    kind?: "all" | "chat" | "work";
    conversation_only?: boolean;
  } = {},
) {
  const query = new URLSearchParams();
  if (options.search) query.set("search", options.search);
  if (options.project_id) query.set("project_id", options.project_id);
  if (options.kind) query.set("kind", options.kind);
  if (options.conversation_only !== undefined)
    query.set("conversation_only", String(options.conversation_only));
  if (options.limit) query.set("limit", String(options.limit));
  const suffix = query.size ? `?${query.toString()}` : "";
  return this.request<AiChatSummary[]>(`/ai/chats${suffix}`);
}

export function callProjectChat(this: OrbynClient, id: string) {
  return this.request<AiChat>(`/ai/chats/${id}`);
}

export function callAiChat(
  this: OrbynClient,
  id: string,
  signal?: AbortSignal,
) {
  return this.request<AiChat>(`/ai/chats/${id}`, { signal, fresh: true });
}

/** Save a project chat after a reply; the same id updates the same chat. */

export function callSaveProjectChat(
  this: OrbynClient,
  id: string,
  input: ProjectChatInput,
) {
  return this.request<ProjectChatSummary>(`/ai/chats/${id}`, {
    method: "PUT",
    body: input,
  });
}

export function callUpdateAiChat(
  this: OrbynClient,
  id: string,
  input: UpdateAiChatInput,
) {
  return this.request<AiChatSummary>(`/ai/chats/${id}`, {
    method: "PATCH",
    body: input,
  });
}

export function callSaveChatAsNote(this: OrbynClient, id: string) {
  return this.request<{ id: string; title: string }>(
    `/ai/chats/${id}/save-note`,
    { method: "POST" },
  );
}

export function callDeleteProjectChat(this: OrbynClient, id: string) {
  return this.request<void>(`/ai/chats/${id}`, { method: "DELETE" });
}

export function callListAgentRoutines(this: OrbynClient) {
  return this.request<AgentRoutine[]>("/me/agent-routines");
}

export function callCreateAgentRoutine(
  this: OrbynClient,
  input: AgentRoutineInput,
) {
  return this.request<AgentRoutine>("/me/agent-routines", {
    method: "POST",
    body: input,
  });
}

export function callUpdateAgentRoutine(
  this: OrbynClient,
  id: string,
  input: AgentRoutineUpdate,
) {
  return this.request<AgentRoutine>(`/me/agent-routines/${id}`, {
    method: "PUT",
    body: input,
  });
}

export function callDeleteAgentRoutine(this: OrbynClient, id: string) {
  return this.request<{ deleted: boolean }>(`/me/agent-routines/${id}`, {
    method: "DELETE",
  });
}

export function callAssistantApprovalScopes(this: OrbynClient) {
  return this.request<ApprovalScopes>("/me/assistant/approval-scopes");
}

export function callSetAssistantApprovalScopes(
  this: OrbynClient,
  input: ApprovalScopes,
) {
  return this.request<ApprovalScopes>("/me/assistant/approval-scopes", {
    method: "PUT",
    body: input,
  });
}

export function callAssistantIdeas(this: OrbynClient) {
  return this.request<AssistantIdea[]>("/me/assistant/ideas");
}

/** A recording's summary and action items, from the assistant (CAP-10). */

export function callSummariseRecording(
  this: OrbynClient,
  fileId: string,
  transcript?: string,
) {
  return this.request<RecordingSummary>(`/ai/recordings/${fileId}/summary`, {
    method: "POST",
    body: transcript ? { transcript } : {},
  });
}

/** A proposed plan; nothing is saved until `applyPlan`. */

export function callPreviewPlan(
  this: OrbynClient,
  input: PlanPreviewInput = {},
) {
  return this.request<Plan>("/planner/preview", {
    method: "POST",
    body: input,
  });
}

/** Unfinished blocks, tasks at risk, and blocks that clash with events. */

export function callPlannerReview(this: OrbynClient) {
  return this.request<PlannerReview>("/planner/review");
}

// ---- Connected agents (MCP) ----
/** Your connected agents, the MCP address, and until when old keys work there. */

export function callAgents(this: OrbynClient) {
  return this.request<AgentsOverview>("/me/agents");
}

/** A connection's toolsets besides core (Settings → Connected agents). */

export function callSetAgentToolsets(
  this: OrbynClient,
  id: string,
  toolsets: AgentToolset[],
) {
  return this.request<AgentGrant>(`/me/agents/${id}/toolsets`, {
    method: "PUT",
    body: { toolsets },
  });
}

/**
 * A connection's trust: full power, ask first or suggest only, per space,
 * and which ask-first items it may do alone (Settings → Connected agents).
 */

export function callSetAgentTrust(
  this: OrbynClient,
  id: string,
  input: AgentTrustInput,
) {
  return this.request<AgentGrant>(`/me/agents/${id}/trust`, {
    method: "PUT",
    body: input,
  });
}

/** Sets the wake-up address; the signing secret comes back once. */

export function callSetAgentWake(this: OrbynClient, id: string, url: string) {
  return this.request<NewAgentWake>(`/me/agents/${id}/wake`, {
    method: "PUT",
    body: { url },
  });
}

export function callClearAgentWake(this: OrbynClient, id: string) {
  return this.request<AgentInboxSettings>(`/me/agents/${id}/wake`, {
    method: "DELETE",
  });
}

/** Calls the wake-up address now and says what it answered. */

export function callTestAgentWake(this: OrbynClient, id: string) {
  return this.request<{
    ok: boolean;
    status: number | null;
    error: string | null;
  }>(`/me/agents/${id}/wake/test`, { method: "POST" });
}

/** The person's standing rules for their agents. */

export function callAgentRules(this: OrbynClient) {
  return this.request<AgentRule[]>("/me/agent-rules");
}

export function callAddAgentRule(this: OrbynClient, input: AgentRuleInput) {
  return this.request<AgentRule>("/me/agent-rules", {
    method: "POST",
    body: input,
  });
}

export function callUpdateAgentRule(
  this: OrbynClient,
  id: string,
  input: AgentRuleInput,
) {
  return this.request<AgentRule>(`/me/agent-rules/${id}`, {
    method: "PUT",
    body: input,
  });
}

export function callDeleteAgentRule(this: OrbynClient, id: string) {
  return this.request<void>(`/me/agent-rules/${id}`, { method: "DELETE" });
}

/** Fresh, account-bound identity for one independent automation runtime. */

export async function callAutomationAgentIdentity(
  this: OrbynClient,
  lane: AutomationAgentLane,
) {
  const saved = await this.request<AutomationAgentIdentity>(
    `/me/assistant/identity/${lane}`,
    { fresh: true },
  );
  const checked = automationAgentIdentity.parse(saved);
  if (checked.lane !== lane)
    throw new Error("Agent identity belongs to another runtime.");
  return checked;
}

export function callAgentSettings(
  this: OrbynClient,
  options?: Pick<RequestOptions, "fresh">,
) {
  return this.request<PersonalAgentSettings>("/me/agent", options);
}

export async function callAssistantWorkControls(this: OrbynClient) {
  return assistantWorkControls.parse(
    await this.request<unknown>("/me/assistant/work-controls", {
      fresh: true,
    }),
  );
}

export async function callUpdateAssistantWorkControls(
  this: OrbynClient,
  input: Partial<import("@orbyn/core").AssistantWorkControls>,
) {
  return assistantWorkControls.parse(
    await this.request<unknown>("/me/assistant/work-controls", {
      method: "PATCH",
      body: assistantWorkControlsInput.parse(input),
    }),
  );
}

/** Opens the About me page, making it first when there isn't one. */

export function callOpenAgentProfile(this: OrbynClient) {
  return this.request<{ doc_id: string; title: string; created: boolean }>(
    "/me/agent-profile",
    { method: "POST" },
  );
}

/** Changes a space's instructions for agents (null: Personal). */

export function callSetAgentInstructions(
  this: OrbynClient,
  teamId: string | null,
  text: string,
) {
  return this.request<AgentContextSettings>(
    teamId ? `/teams/${teamId}/agent-instructions` : "/me/agent-instructions",
    { method: "PUT", body: { text } },
  );
}

/** Questions agents asked, waiting for an answer. */

export function callAgentQuestions(this: OrbynClient) {
  return this.request<AgentQuestion[]>("/me/questions");
}

/** Answers an agent's question (its card, or the push's buttons). */

export function callAnswerAgentQuestion(
  this: OrbynClient,
  id: string,
  answer: string,
  via: "app" | "push" = "app",
) {
  return this.request<AgentQuestion>(`/me/questions/${id}/answer`, {
    method: "POST",
    body: { answer, via },
  });
}

/** A new agent key; the returned `key` is shown once. */

export function callCreateAgentKey(this: OrbynClient, input: AgentKeyInput) {
  return this.request<NewAgentKey>("/me/agent-keys", {
    method: "POST",
    body: input,
  });
}

/** Revoke a connection (an agent key, or an old key's MCP access). */

export function callRevokeAgent(this: OrbynClient, id: string) {
  return this.request<void>(`/me/agents/${id}`, { method: "DELETE" });
}

/** Restore a connection Orbyn paused for misbehaving. */

export function callRestoreAgent(this: OrbynClient, id: string) {
  return this.request<void>(`/me/agents/${id}/restore`, { method: "POST" });
}

/** What one connection did, newest first. */

export function callAgentActivity(this: OrbynClient, id: string) {
  return this.request<AgentActivity[]>(`/me/agents/${id}/activity`);
}

/** Undo one change an agent made directly (from its activity). */

export function callUndoAgentChange(this: OrbynClient, activityId: string) {
  return this.request<{ undone: true; summary: string }>(
    `/me/agents/activity/${activityId}/undo`,
    { method: "POST" },
  );
}

/** Undo a whole job of one agent (a plan, or one call's changes). */

export function callUndoAgentJob(
  this: OrbynClient,
  grantId: string,
  job: string,
) {
  return this.request<{ undone: number }>(
    `/me/agents/${grantId}/jobs/${encodeURIComponent(job)}/undo`,
    { method: "POST" },
  );
}

/**
 * What one assistant reply changed: the built-in assistant's activity for
 * `job` (a reply's `assistant_run.plan_job`), newest first.
 */

export async function callAssistantJobChanges(this: OrbynClient, job: string) {
  const { grants } = await this.agents();
  const grant = grants.find((g) => g.kind === "assistant");
  if (!grant) return { grantId: null, changes: [] as AgentActivity[] };
  const activity = await this.agentActivity(grant.id);
  return {
    grantId: grant.id,
    changes: activity.filter((a) => a.job === job),
  };
}

/** Current authorized work evidence, independent of device presence. */

export async function callAssistantProfiles(
  this: OrbynClient,
  signal?: AbortSignal,
) {
  return assistantProfiles.parse(
    await this.request<unknown>("/me/assistant/profiles", {
      fresh: true,
      signal,
    }),
  );
}

/** Owner-visible restrictions; saving requires the revision just read. */

export async function callAssistantRules(this: OrbynClient) {
  return assistantRulesSnapshot.parse(
    await this.request<unknown>("/me/assistant/rules", { fresh: true }),
  );
}

export async function callReplaceAssistantRules(
  this: OrbynClient,
  expectedRevision: number,
  rules: AssistantActionRule[],
) {
  const body = assistantRulesInput.parse({
    expected_revision: expectedRevision,
    rules,
  });
  return assistantRulesSnapshot.parse(
    await this.request<unknown>("/me/assistant/rules", {
      method: "PUT",
      body,
    }),
  );
}

/** Durable per-agent work estimates and start limits. */

export async function callAssistantBudgets(this: OrbynClient) {
  return assistantBudgets.parse(
    await this.request<unknown>("/me/assistant/budgets", { fresh: true }),
  );
}

export async function callReplaceAssistantBudget(
  this: OrbynClient,
  lane: "background" | "overnight",
  value: Pick<
    AssistantBudgetView,
    | "revision"
    | "daily_token_limit"
    | "hourly_start_limit"
    | "per_run_token_limit"
  >,
) {
  const parsedLane = assistantBudgetLane.parse(lane);
  const body = assistantBudgetUpdate.parse({
    expected_revision: value.revision,
    daily_token_limit: value.daily_token_limit,
    hourly_start_limit: value.hourly_start_limit,
    per_run_token_limit: value.per_run_token_limit,
  });
  return assistantBudgetView.parse(
    await this.request<unknown>(`/me/assistant/budgets/${parsedLane}`, {
      method: "PUT",
      body,
    }),
  );
}

export async function callRequestAssistantHandoff(
  this: OrbynClient,
  value: {
    producer_job_id: string;
    expected_producer_revision: string;
    recipient_lane: AssistantHandoffLane;
    title: string;
    instruction: string;
  },
) {
  return assistantHandoff.parse(
    await this.request<unknown>("/me/assistant/handoffs", {
      method: "POST",
      body: assistantHandoffInput.parse(value),
    }),
  );
}

export async function callAssistantHandoffSource(
  this: OrbynClient,
  jobId: string,
) {
  const result = await this.request<{ source: unknown; lane: unknown }>(
    `/me/assistant/handoffs/source/${encodeURIComponent(jobId)}`,
    { fresh: true },
  );
  return {
    source: assistantHandoffSource.parse(result.source),
    lane: assistantHandoffLane.parse(result.lane),
  };
}

export async function callAssistantHandoff(this: OrbynClient, id: string) {
  return assistantHandoff.parse(
    await this.request<unknown>(
      `/me/assistant/handoffs/${encodeURIComponent(id)}`,
      { fresh: true },
    ),
  );
}

// ---- The Review inbox ----

export async function callAssistantConversation(
  this: OrbynClient,
  signal?: AbortSignal,
) {
  return assistantConversationHome.parse(
    await this.request<unknown>("/me/assistant/conversation", {
      fresh: true,
      signal,
    }),
  );
}

export async function callAssistantConversationDeliveryPreferences(
  this: OrbynClient,
) {
  return assistantConversationPreferences.parse(
    await this.request<unknown>("/me/assistant/conversation/preferences", {
      fresh: true,
    }),
  );
}

export async function callSetAssistantConversationMuted(
  this: OrbynClient,
  muted: boolean,
) {
  return assistantConversationPreferences.parse(
    await this.request<unknown>("/me/assistant/conversation/preferences", {
      method: "PATCH",
      body: assistantConversationMuteInput.parse({ muted }),
    }),
  );
}

export async function callOpenAssistantConversation(
  this: OrbynClient,
  signal?: AbortSignal,
) {
  return assistantConversationDestination.parse(
    await this.request<unknown>("/me/assistant/conversation", {
      method: "POST",
      signal,
    }),
  );
}

export async function callAssistantConversationFeed(
  this: OrbynClient,
  destinationId: string,
  after = "0",
  limit = 50,
  signal?: AbortSignal,
  through?: string,
) {
  const query = assistantConversationQuery.parse({ after, limit, through });
  const page = assistantConversationPage.parse(
    await this.request<unknown>(
      `/me/assistant/conversations/${encodeURIComponent(destinationId)}?${new URLSearchParams({ after: query.after, limit: String(query.limit), ...(query.through ? { through: query.through } : {}) })}`,
      { fresh: true, signal },
    ),
  );
  if (
    page.destination.id !== destinationId ||
    page.entries.length > limit ||
    BigInt(page.cursor) < BigInt(after) ||
    (through !== undefined && BigInt(page.cursor) > BigInt(through)) ||
    page.entries.some((e) => BigInt(e.sequence) <= BigInt(after))
  )
    throw new Error(
      "Conversation response does not match the requested stream.",
    );
  return page;
}

export async function callAssistantConversationForChat(
  this: OrbynClient,
  chatId: string,
  signal?: AbortSignal,
) {
  const value = await this.request<unknown>(
    `/me/assistant/conversation/for-chat/${encodeURIComponent(chatId)}`,
    { fresh: true, signal },
  );
  if (value === null) return null;
  const destination = assistantConversationDestination.parse(value);
  if (destination.chat_id !== chatId)
    throw new Error("Conversation does not match the requested chat.");
  return destination;
}

export async function callAssistantSavedHistory(
  this: OrbynClient,
  destinationId: string,
  chatId: string,
  before?: number,
  version?: string,
  limit = 25,
) {
  const query = assistantSavedHistoryQuery.parse({ before, version, limit });
  const params = new URLSearchParams({ limit: String(query.limit) });
  if (query.before !== undefined) params.set("before", String(query.before));
  if (query.version) params.set("version", query.version);
  const page = assistantSavedHistory.parse(
    await this.request<unknown>(
      `/me/assistant/conversations/${encodeURIComponent(destinationId)}/history?${params}`,
      { fresh: true },
    ),
  );
  if (
    page.destination_id !== destinationId ||
    page.chat_id !== chatId ||
    (version && page.version !== version) ||
    page.turns.length > limit ||
    (before !== undefined && page.before !== null && page.before >= before)
  )
    throw new Error("Saved history does not match the requested conversation.");
  return page;
}

export async function callAssistantConversationDetails(
  this: OrbynClient,
  destinationId: string,
  entryId: string,
  signal?: AbortSignal,
) {
  const details = assistantConversationDetails.parse(
    await this.request<unknown>(
      `/me/assistant/conversations/${encodeURIComponent(destinationId)}/entries/${encodeURIComponent(entryId)}/details`,
      { fresh: true, signal },
    ),
  );
  if (details.destination_id !== destinationId || details.entry.id !== entryId)
    throw new Error("Details do not match the requested message.");
  return details;
}

export async function callAssistantConversationEntry(
  this: OrbynClient,
  destinationId: string,
  entryId: string,
  signal?: AbortSignal,
) {
  const location = assistantConversationLocation.parse(
    await this.request<unknown>(
      `/me/assistant/conversations/${encodeURIComponent(destinationId)}/entries/${encodeURIComponent(entryId)}`,
      { fresh: true, signal },
    ),
  );
  if (
    location.destination.id !== destinationId ||
    location.entry_id !== entryId
  )
    throw new Error("Conversation entry does not match its destination.");
  return location;
}

export async function callAnswerAssistantConversationQuestion(
  this: OrbynClient,
  destinationId: string,
  entryId: string,
  answer: string,
  turnId: string,
) {
  const result = assistantConversationAnswer.parse(
    await this.request<unknown>(
      `/me/assistant/conversations/${encodeURIComponent(destinationId)}/entries/${encodeURIComponent(entryId)}/answer`,
      {
        method: "POST",
        body: assistantConversationAnswerInput.parse({
          answer,
          turn_id: turnId,
        }),
      },
    ),
  );
  if (
    result.destination_id !== destinationId ||
    result.reply_to_entry_id !== entryId ||
    result.turn_id !== turnId
  )
    throw new Error("Answer receipt does not match the requested question.");
  return result;
}

export async function callAcknowledgeAssistantConversation(
  this: OrbynClient,
  destinationId: string,
  through: string,
) {
  const destination = assistantConversationDestination.parse(
    await this.request<unknown>(
      `/me/assistant/conversations/${encodeURIComponent(destinationId)}/read`,
      {
        method: "POST",
        body: assistantConversationReadInput.parse({ through }),
      },
    ),
  );
  if (destination.id !== destinationId)
    throw new Error(
      "Conversation acknowledgement does not match its destination.",
    );
  return destination;
}

/** Recover authorized execution activity with an owner/lane-scoped cursor. */

export async function callAssistantActivity(
  this: OrbynClient,
  lane: AssistantActivityLane,
  after = "0",
  limit = 50,
) {
  lane = assistantActivityLane.parse(lane);
  const query = assistantActivityQuery.parse({ after, limit });
  const page = assistantActivityPage.parse(
    await this.request<unknown>(
      `/me/assistant/activity/${lane}?${new URLSearchParams({ after: query.after, limit: String(query.limit) })}`,
      { fresh: true },
    ),
  );
  if (
    page.lane !== lane ||
    page.events.length > query.limit ||
    BigInt(page.cursor) < BigInt(after) ||
    page.events.some((event) => BigInt(event.sequence) <= BigInt(after))
  )
    throw new Error("Activity response does not match the requested stream.");
  return page;
}

/** What waits for approval, and what was decided lately. */

export function callReviewInbox(this: OrbynClient) {
  return this.request<ReviewInbox>("/proposals");
}

/** Latest night with its current Review and Undo states. */

export function callLatestAssistantNight(this: OrbynClient, id?: string) {
  return this.request<OvernightNight | null>(
    id ? `/me/assistant/nights/${id}` : "/me/assistant/nights/latest",
    { fresh: true },
  );
}

/** The person's channels and local quiet window for templated reminders. */

export function callReminderNudgeSettings(this: OrbynClient) {
  return this.request<ReminderNudgeSettings>("/me/assistant/reminder-nudges");
}

/** Stop future templated reminders for this card's source. */

export function callStopReminderNudge(this: OrbynClient, id: string) {
  return this.request<{ stopped: true }>(
    `/me/assistant/reminder-nudges/${id}/stop`,
    {
      method: "POST",
    },
  );
}

export function callUpdateReminderNudgeSettings(
  this: OrbynClient,
  input: ReminderNudgeSettings,
) {
  return this.request<ReminderNudgeSettings>("/me/assistant/reminder-nudges", {
    method: "PUT",
    body: input,
  });
}

/** Keep a finished run, applying all or selected held changes. */

export function callKeepAssistantNightRun(
  this: OrbynClient,
  id: string,
  input: { only?: number[]; steps?: string[] } = {},
) {
  return this.request<OvernightRun>(`/me/assistant/nights/runs/${id}/keep`, {
    method: "POST",
    body: input,
  });
}

/** Undo a run or selected changes from it; held work is declined. */

export function callUndoAssistantNightRun(
  this: OrbynClient,
  id: string,
  changes?: string[],
) {
  return this.request<OvernightRun>(`/me/assistant/nights/runs/${id}/undo`, {
    method: "POST",
    body: changes ? { changes } : {},
  });
}

/** Review a whole night in one transaction after the person's confirmation. */

export function callReviewAssistantNight(
  this: OrbynClient,
  id: string,
  action: "keep" | "undo",
  runs: { id: string; token: string }[],
) {
  return this.request<OvernightNight | null>(
    `/me/assistant/nights/${id}/${action}-all`,
    { method: "POST", body: { runs } },
  );
}

/** How many proposals wait, for the badge. */

export function callReviewCount(this: OrbynClient) {
  return this.request<{ pending: number }>("/proposals/count");
}

/** One proposal, each change checked against what is there now. */

export function callReviewItem(this: OrbynClient, id: string) {
  return this.request<ReviewItem>(`/proposals/${id}`);
}

/** Approve a proposal (all of it, or `only` some of its changes). */

export function callApproveReview(
  this: OrbynClient,
  id: string,
  input: ReviewApproveInput = {},
) {
  return this.request<ReviewApplied>(`/proposals/${id}/apply`, {
    method: "POST",
    body: input,
  });
}

/** Decline a proposal: nothing changes. */

export function callDeclineReview(this: OrbynClient, id: string) {
  return this.request<void>(`/proposals/${id}/decline`, { method: "POST" });
}

/**
 * Approve or Decline from a notification's button: says how it ended,
 * even when it was already decided.
 */

export function callRespondToReview(
  this: OrbynClient,
  id: string,
  decision: "approve" | "decline",
) {
  return this.request<{ status: ProposalStatus }>(`/proposals/${id}/respond`, {
    method: "POST",
    body: { decision },
  });
}

/** Team settings → Outside agents: the policy, and (managers) who connects. */

export function callTeamAgents(this: OrbynClient, teamId: string) {
  return this.request<TeamAgentsView>(`/teams/${teamId}/agents`);
}

/** A team's cap on outside agents (owners and admins). */

export function callSetTeamAgentAccess(
  this: OrbynClient,
  teamId: string,
  agent_access: TeamAgentAccess,
) {
  return this.request<{ id: string; agent_access: TeamAgentAccess }>(
    `/teams/${teamId}/agent-access`,
    { method: "PUT", body: { agent_access } },
  );
}

/**
 * Create an item from one line of text ("Lunch with @anna tomorrow 1pm
 * ;Cafe Roma"), parsed on the server without AI.
 */
/** A shared link's title and site, looked up on the server for the share sheet. */

export function callLinkPreview(this: OrbynClient, url: string) {
  return this.request<LinkPreview>("/capture/preview", {
    method: "POST",
    body: { url },
  });
}

/** What quick add would make of the text, with its chips. Nothing is saved. */

export function callPreviewQuickAdd(
  this: OrbynClient,
  text: string,
  timezone?: string,
) {
  return this.request<QuickAddResult>("/items/quick", {
    method: "POST",
    body: { text, preview: true, ...(timezone ? { timezone } : {}) },
  });
}

/**
 * Hand a task to your own agent (W3): it works on it in the background
 * and gives it back with a note. At most five at once.
 */

export function callHandTaskToAgent(
  this: OrbynClient,
  id: string,
  when: "now" | "tonight" = "now",
) {
  return this.request<Item>(`/items/${id}/agent`, {
    method: "POST",
    body: { when },
  });
}

/** Connected agents that made or changed tasks lately, for the board's lanes. */

export function callAgentWork(this: OrbynClient) {
  return this.request<{ grant_id: string; name: string; item_ids: string[] }[]>(
    "/me/agent-work",
  );
}

// ---- AI assistant ----
/** Whether the configured assistant can read with tools and draft pages. */

export function callAiCapabilities(this: OrbynClient) {
  return this.request<{ enabled: boolean; tools: boolean }>("/ai/capabilities");
}

/** Draft a project (subtasks) from a prompt, as a proposal to review. */

export function callDraftProject(
  this: OrbynClient,
  prompt: string,
  timezone: string,
  teamId?: string | null,
  details?: { summary?: string; deadline?: string | null },
) {
  return this.request<Proposal>("/ai/project", {
    method: "POST",
    body: {
      prompt,
      timezone,
      ...(teamId ? { team_id: teamId } : {}),
      ...details,
    },
  });
}

/**
 * Ask the assistant. Pass earlier turns in `history` for follow-up questions.
 * The turn runs on the server while this polls for the answer, so a slow
 * model (one on the user's own machine) is never cut off by a proxy's
 * limit on a single request, and a dropped poll is simply tried again.
 */

export async function callChat(
  this: OrbynClient,
  message: string,
  timezone: string,
  history: ChatTurn[] = [],
  scope: ChatScope | null = null,
  ids: {
    chatId?: string;
    turnId?: string;
    replyToEntryId?: string;
    replyExcerpt?: string;
  } = {},
  onProgress?: (progress: AssistantRunProgress) => void,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw abortError();
  const { id, chat_id, turn_id } = await this.request<{
    id: string;
    chat_id: string;
    turn_id: string;
  }>("/ai/chat/start", {
    method: "POST",
    body: {
      message,
      timezone,
      history: history.slice(-12),
      scope,
      ...(ids.chatId ? { chat_id: ids.chatId } : {}),
      ...(ids.turnId ? { turn_id: ids.turnId } : {}),
      ...(ids.replyExcerpt ? { reply_excerpt: ids.replyExcerpt } : {}),
      ...(ids.replyToEntryId ? { reply_to_entry_id: ids.replyToEntryId } : {}),
    },
  });
  return this.pollAssistantRun(
    id,
    { chatId: chat_id, turnId: turn_id },
    onProgress,
    signal,
  );
}

/** Attach to an existing server run without starting another turn. */

export async function callPollAssistantRun(
  this: OrbynClient,
  id: string,
  ids: { chatId: string; turnId: string },
  onProgress?: (progress: AssistantRunProgress) => void,
  signal?: AbortSignal,
) {
  const { chatId: chat_id, turnId: turn_id } = ids;
  if (signal?.aborted) throw abortError();
  const started = Date.now();
  let delay = CHAT_POLL_MS;
  let deadline = started + CHAT_WAIT_MS;
  let lastProgress = "";
  while (Date.now() < deadline) {
    await pause(delay, signal);
    delay = Math.min(delay * 1.5, CHAT_POLL_MAX_MS);
    let job: ChatJob;
    try {
      job = await this.request<ChatJob>(`/ai/chat/${id}`, {
        fresh: true,
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw abortError();
      const transient =
        error instanceof HttpError
          ? error.statusCode === 429 || error.statusCode >= 500
          : error instanceof Error &&
            ["TypeError", "TimeoutError", "AbortError"].includes(error.name);
      if (!transient) throw error;
      // Keep the same run attached across rate limits and network outages.
      // The existing deadline bounds retries; the pause remains abortable.
      if (error instanceof HttpError && error.statusCode === 429)
        delay = Math.min(
          error.retryAfterMs ?? 10000,
          Math.max(0, deadline - Date.now()),
        );
      continue;
    }
    if (signal?.aborted) throw abortError();
    if (job.state === "running" || job.state === "waiting") {
      const progress = {
        job_id: id,
        state: job.state,
        ...(job.progress?.label ? { label: job.progress.label } : {}),
        ...(job.progress?.step ? { step: job.progress.step } : {}),
        ...(job.state === "waiting" ? { waiting: job.waiting } : {}),
      } satisfies AssistantRunProgress;
      const serialized = JSON.stringify(progress);
      if (serialized !== lastProgress) onProgress?.(progress);
      lastProgress = serialized;
      // A question or approval can wait for the person longer than one run.
      // Capped, so an unanswered question never keeps this polling forever.
      if (job.state === "waiting")
        deadline = Math.min(
          Date.now() + CHAT_WAIT_MS,
          started + CHAT_WAITING_MAX_MS,
        );
      continue;
    }
    if (job.state === "done") {
      onProgress?.({ job_id: id, state: "done" });
      const proposal =
        job.proposal ??
        ({
          id: job.chat_id ?? chat_id,
          summary: job.answer ?? "",
          actions: [],
          session_change: null,
          decision_links: [],
          plan: null,
          sources: [],
          notes: [],
        } satisfies Proposal);
      return {
        proposal,
        chat_id: job.chat_id ?? chat_id,
        turn_id: job.turn_id ?? turn_id,
        trace: job.trace ?? [],
        ...(job.answer ? { answer: job.answer } : {}),
        ...(job.assistant_run ? { assistant_run: job.assistant_run } : {}),
      } satisfies ChatResult;
    }
    if (job.state === "failed")
      throw new HttpError(job.status ?? 502, job.message);
  }
  throw new HttpError(
    504,
    "That took too long to answer. Try again, or ask for less at once.",
  );
}

export function callAnswerAssistantRun(
  this: OrbynClient,
  id: string,
  answer: string,
  waitingId: string,
) {
  return this.request<{ accepted: boolean; job_id: string }>(
    `/ai/chat/${id}/answer`,
    { method: "POST", body: { answer, waiting_id: waitingId } },
  );
}

export function callApproveAssistantRun(
  this: OrbynClient,
  id: string,
  approved: boolean,
  waitingId: string,
  scope: "once" | "goal" | "routine" | "always" = "once",
) {
  return this.request<{ accepted: boolean; job_id: string }>(
    `/ai/chat/${id}/approve`,
    { method: "POST", body: { approved, scope, waiting_id: waitingId } },
  );
}

export function callStopAssistantRun(this: OrbynClient, id: string) {
  return this.request<{ stopped: boolean }>(`/ai/chat/${id}/stop`, {
    method: "POST",
    body: {},
  });
}

export function callApplyProposal(
  this: OrbynClient,
  id: string,
  options?: { give_tasks_deadlines?: boolean },
) {
  // `project_id`: the project a drafted-project proposal made, else null.
  return this.request<{ applied: boolean; project_id: string | null }>(
    `/ai/proposals/${id}/apply`,
    {
      method: "POST",
      body: options ?? {},
    },
  );
}

/** Admin: the apps that have signed in with Orbyn. */

export function callAdminAgentClients(this: OrbynClient) {
  return this.request<AdminAgentClient[]>("/admin/agents/clients");
}

/** Admin: agent use by app over the last `days`. */

export function callAdminAgentUsage(this: OrbynClient, days = 30) {
  return this.request<AdminAgentUsage>(`/admin/agents/usage?days=${days}`);
}

/** Admin: end one of an account's agent connections. */

export function callAdminRevokeUserAgent(
  this: OrbynClient,
  id: string,
  grantId: string,
) {
  return this.request<void>(`/admin/users/${id}/agents/${grantId}`, {
    method: "DELETE",
  });
}

/** Admin: the switches and limits for outside agents. */

export function callAdminAgentSettings(this: OrbynClient) {
  return this.request<AgentSettings>("/admin/agents");
}

export function callAdminUpdateAgentSettings(
  this: OrbynClient,
  input: AgentSettingsUpdate,
) {
  return this.request<AgentSettings>("/admin/agents", {
    method: "PUT",
    body: input,
  });
}

export function callReviewCard(
  this: OrbynClient,
  cardId: string,
  rating: Rating,
) {
  return this.request<StudyCard>(`/study/cards/${cardId}/review`, {
    method: "POST",
    body: { rating },
  });
}

/** Apply the approved sessions: a "Revise for …" task with them set aside. */

export function callApplyRevision(
  this: OrbynClient,
  input: {
    key: string;
    sessions: { start_at: string; end_at: string }[];
  },
) {
  return this.request<{
    item_id: string;
    item_version: number;
    block_versions: { id: string; revision: number }[];
    block_ids: string[];
    minutes: number;
  }>("/study/revision/apply", { method: "POST", body: input });
}

// ---- AI providers (system admins) ----

export function callListAiProviders(this: OrbynClient) {
  return this.request<AiProvidersResponse>("/ai/providers");
}

export function callCreateAiProvider(
  this: OrbynClient,
  input: {
    kind: AiProviderKind;
    name: string;
    base_url?: string;
    api_key?: string;
    options?: AiProviderOptions;
    enabled?: boolean;
  },
) {
  return this.request<AiProvider>("/ai/providers", {
    method: "POST",
    body: input,
  });
}

/** Omit `api_key` to keep the saved key; send "" to remove it. */

export function callUpdateAiProvider(
  this: OrbynClient,
  id: string,
  input: {
    name?: string;
    base_url?: string;
    api_key?: string;
    options?: AiProviderOptions;
    enabled?: boolean;
    expected_revision?: string;
  },
) {
  return this.request<AiProvider>(`/ai/providers/${id}`, {
    method: "PUT",
    body: input,
  });
}

export function callDeleteAiProvider(this: OrbynClient, id: string) {
  return this.request<void>(`/ai/providers/${id}`, { method: "DELETE" });
}

/** Lists models using the provider's saved key. */

export function callListAiModels(
  this: OrbynClient,
  id: string,
  expectedRevision?: string,
) {
  return this.request<AiModelList>(`/ai/providers/${id}/models`, {
    method: "POST",
    body: expectedRevision ? { expected_revision: expectedRevision } : {},
  });
}

/** Loads candidates for the independent embedding connection, without sending pages. */

export function callListAiEmbeddingModels(
  this: OrbynClient,
  id: string,
  expectedRevision: string,
) {
  return this.request<AiEmbeddingModelList>(
    `/ai/providers/${id}/embedding-models`,
    {
      method: "POST",
      body: { expected_revision: expectedRevision },
    },
  );
}

export function callTestAiProvider(
  this: OrbynClient,
  id: string,
  model?: string,
  expectedRevision?: string,
) {
  return this.request<AiTestResult>(`/ai/providers/${id}/test`, {
    method: "POST",
    body: {
      ...(model ? { model } : {}),
      ...(expectedRevision ? { expected_revision: expectedRevision } : {}),
    },
  });
}

/**
 * Search by meaning's own setup: on needs the model that measures text
 * and `accept` (every page is sent to the provider to be measured).
 */

export function callUpdateAiNightBudget(
  this: OrbynClient,
  input: {
    night_token_budget: number;
    expected_revision: string;
  },
) {
  return this.request<AiSettings>("/ai/settings/night-budget", {
    method: "PUT",
    body: input,
  });
}

export function callUpdateAiSettings(
  this: OrbynClient,
  input: {
    provider_id: string | null;
    model?: string;
    night_token_budget?: number;
  },
) {
  return this.request<AiSettings>("/ai/settings", {
    method: "PUT",
    body: input,
  });
}

/** Say a page is still true, or that it needs updating (makes a task). */

export function callReviewDoc(
  this: OrbynClient,
  id: string,
  input: { verdict: "still_true" } | { verdict: "needs_update"; note?: string },
) {
  return this.request<{ reviewed_at: string; task: Item | null }>(
    `/docs/${id}/review`,
    { method: "POST", body: input },
  );
}
