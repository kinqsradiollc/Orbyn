import {
  type AccountPrefsInput,
  type AgendaPrivatePermissionInput,
  type AgentIdentityInput,
  type AgentInboxKind,
  type AgentKeyInput,
  type AgentRoutineInput,
  type AgentRoutineUpdate,
  type AssistantRoutineRunsQuery,
  type AgentRuleInput,
  type AgentSettingsUpdate,
  type AgentToolset,
  type AgentTrustInput,
  type AiProviderKind,
  type AiProviderOptions,
  type ApprovalScopes,
  type AssistantActionRule,
  type AssistantActivityLane,
  type AssistantBudgetView,
  type AssistantHandoffLane,
  automationAgentIdentity,
  type AutomationAgentIdentity,
  type AutomationAgentIdentityInput,
  type AutomationAgentLane,
  type BlockDuplicateInput,
  type BlockInput,
  type BlockOnDayInput,
  type BlockRescheduleInput,
  type BlockUpdate,
  type Booking,
  type BookingPageInput,
  type BookingPageUpdate,
  type BookingRequest,
  type BookingView,
  type CalendarFeedSettingsInput,
  type CalendarSubscriptionInput,
  type CalendarSubscriptionUpdate,
  type CaptureAssistInput,
  type CaptureRequest,
  type ChatgptCatalogDefaultUpdate,
  type ChatgptCatalogPublication,
  type ChatgptCatalogSelection,
  type ChatgptConnectionFinish,
  type ChatgptConnectionStart,
  type ChatgptExecutorFinish,
  type ChatgptExecutorStart,
  type ChatgptLeaseRenewal,
  type ChatgptLeaseStart,
  type ChatScope,
  type ChatTurn,
  type ClipInput,
  type Credentials,
  type CustomFieldInput,
  type CustomFieldUpdate,
  type Doc,
  type DocAiAction,
  type DocAskSelection,
  type DocBlock,
  docContainerBlocks,
  docEditorUpdate,
  type DocEditorUpdate,
  type DocKind,
  type EditScope,
  type EventNoteRef,
  type ExportFormat,
  type FavouriteKind,
  type FieldTarget,
  type FieldValue,
  type FirstRunInput,
  type FocusSession,
  type FocusState,
  type FrameInput,
  type FrameUpdate,
  type GoalInput,
  type GoalUpdate,
  type HabitCheckInInput,
  type HabitInput,
  type HabitPlanInput,
  type HabitUpdate,
  HttpError,
  type ImportCreateInput,
  type InviteBookingRequest,
  type ItemInput,
  type ItemPositionInput,
  type ItemSort,
  type LegalDoc,
  type LegalSettingsUpdate,
  type ListInput,
  type ListUpdate,
  type LookInput,
  type MaintainedPageBindingInput,
  type MaintainedPageBindingUpdate,
  type MaintenanceInput,
  type MilestoneInput,
  type MilestoneUpdate,
  type NightShiftSettings,
  type OAuthConsentInput,
  type OAuthRequest,
  type ObjectRef,
  type OpenInviteInput,
  type Page,
  type PageFileInput,
  type PageImportInput,
  type PageTemplateFromDoc,
  type PageTemplateInput,
  type PageTemplateUpdate,
  type PageTemplateUse,
  parseVersionedDocContent,
  type PersonalAgentSettings,
  type PlaceInput,
  type PlaceUpdate,
  type PlanApplyInput,
  type PlannerPrefsInput,
  type PlanPreviewInput,
  type PlanTuneInput,
  type PluginAiPermissionInput,
  type PresenceHeartbeat,
  type PresenceSettings,
  type ProfileInput,
  type ProjectChatInput,
  type ProjectStatus,
  type Proposed,
  type PublishInput,
  type Rating,
  type ReauthInput,
  type ReminderNudgeSettings,
  type ReviewApproveInput,
  type SavedViewInput,
  type SavedViewUpdate,
  type SessionCheckInInput,
  type Status,
  type SystemRole,
  type SystemSettingsUpdate,
  type TagInput,
  type TagUpdate,
  type TeamAgentAccess,
  type TeamPolicies,
  type TeamRole,
  type TemplateInput,
  type TemplateUpdate,
  type UpdateAiChatInput,
  type VersionedDocContent,
  versionedDocRead,
  type ViewDefinitionInput,
  type WebhookInput,
  type WebhookUpdate,
  type WhatIfInput,
  type WorkRecord,
  type WorkRecordInput,
  type WorkRecordUpdate,
} from "@orbyn/core";
import {
  AssistantRunProgress,
  DocNews,
  LiveNews,
  MAX_CACHED,
  OrbynClientOptions,
  pause,
  proxyMessage,
  READ_YOUR_WRITES_MS,
  RequestOptions,
  RETRY_DELAY_MS,
  TokenSource,
} from "./client-contracts.js";
import * as account from "./endpoints/account.js";
import * as administration from "./endpoints/administration.js";
import * as assistant from "./endpoints/assistant.js";
import * as goalExecutions from "./endpoints/goal-executions.js";
import * as routineRetries from "./endpoints/routine-retries.js";
import * as routineQuiet from "./endpoints/routine-quiet-checks.js";
import * as routineSetup from "./endpoints/routine-setup.js";
import * as booking from "./endpoints/booking.js";
import * as capture from "./endpoints/capture.js";
import * as connections from "./endpoints/connections.js";
import * as documents from "./endpoints/documents.js";
import * as notifications from "./endpoints/notifications.js";
import * as planner from "./endpoints/planner.js";
import * as projects from "./endpoints/projects.js";
import * as publishing from "./endpoints/publishing.js";
import * as search from "./endpoints/search.js";
import * as study from "./endpoints/study.js";
import * as tasks from "./endpoints/tasks.js";
import * as teams from "./endpoints/teams.js";
import * as views from "./endpoints/views.js";
import * as workspace from "./endpoints/workspace.js";
export { abortError, isAbortError } from "./client-contracts.js";
export type {
  AssistantRunProgress,
  AssistantWaiting,
  ChatResult,
  DocNews,
  LiveNews,
  OrbynClientOptions,
  RequestOptions,
  TokenSource,
} from "./client-contracts.js";
export class OrbynClient {
  readonly baseUrl: string;
  private readonly getToken: TokenSource;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly streamFetch: typeof fetch;
  private lastWriteAt = 0;
  private readEpoch = 0;
  private readonly agentSettingsListeners = new Set<
    (settings: PersonalAgentSettings) => void
  >();
  private readonly automationIdentityListeners = new Set<
    (identity: AutomationAgentIdentity) => void
  >();
  /** Observe saves in this client; results are isolated from account changes. */
  onAutomationAgentIdentity(
    listener: (identity: AutomationAgentIdentity) => void,
  ) {
    this.automationIdentityListeners.add(listener);
    return () => {
      this.automationIdentityListeners.delete(listener);
    };
  }
  /** Concurrent ordinary reads share transport, but never mutable result objects. */
  private readonly pendingReads = new Map<
    string,
    Promise<string | undefined>
  >();
  /**
   * This client's own id, made fresh each time the app starts. Two tabs are
   * two editors, so the server can leave a tab out of the news about the
   * change that tab just made.
   */
  readonly editorId = `e${Math.random().toString(36).slice(2, 10)}`;
  /** The key for the next request, set by `once()`. */
  private nextKey: string | null = null;
  /** Last body per signed-in path, for 304 Not Modified replies. */
  private readonly cache = new Map<string, { etag: string; text: string }>();

  constructor(options: OrbynClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.getToken = options.getToken ?? (() => null);
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
    this.streamFetch = options.streamFetch ?? this.fetchImpl;
  }

  /** A guarded sibling transport mutated data: do not join pre-write reads or use a stale replica. */
  noteExternalMutation(): void {
    this.readEpoch++;
    this.lastWriteAt = Date.now();
  }

  /**
   * A plain authenticated GET, for the few things that come back as a file
   * rather than as JSON. No caching and no retries: a download either
   * arrives or it is asked for again.
   */
  async raw(
    path: string,
    options: {
      method?: "GET" | "POST";
      body?: unknown;
      signal?: AbortSignal;
    } = {},
  ): Promise<Response> {
    const token = await this.getToken();
    const response = await this.fetchImpl(this.baseUrl + path, {
      method: options.method ?? "GET",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(this.timeoutMs)])
        : AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      const problem = await response
        .json()
        .then((body: { message?: string }) => body.message)
        .catch(() => "");
      throw new HttpError(
        response.status,
        problem || "That file could not be made.",
      );
    }
    return response;
  }

  /**
   * Make one call with an Idempotency-Key, so sending it again (a replay
   * after being offline, a retry after a dropped connection) is answered
   * with the first result instead of doing it twice.
   *
   *   await client.once(key, () => client.createItem(input));
   */
  once<T>(key: string, call: () => Promise<T>): Promise<T> {
    this.nextKey = key;
    try {
      return call();
    } finally {
      this.nextKey = null;
    }
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    // Taken before anything awaits, so it belongs to this call alone.
    const idempotencyKey = options.idempotencyKey ?? this.nextKey;
    this.nextKey = null;
    const method = options.method ?? "GET";
    // A read begun after a mutation must not join an older in-flight read.
    const epoch = method === "GET" ? this.readEpoch : ++this.readEpoch;
    const token = options.anonymous ? null : await this.getToken();
    const share =
      method === "GET" &&
      !options.signal &&
      !options.headers &&
      !options.fresh &&
      !options.raw &&
      options.body === undefined;
    if (!share)
      return this.requestTransport<T>(path, options, token, idempotencyKey);
    const key = `${epoch} ${token ?? ""} ${path}`;
    const existing = this.pendingReads.get(key);
    if (existing) {
      const text = await existing;
      return (text === undefined ? undefined : JSON.parse(text)) as T;
    }
    if (this.pendingReads.size >= MAX_CACHED)
      return this.requestTransport<T>(path, options, token, idempotencyKey);
    const pending = this.requestTransport<T>(
      path,
      options,
      token,
      idempotencyKey,
    ).then((value) =>
      value === undefined ? undefined : JSON.stringify(value),
    );
    this.pendingReads.set(key, pending);
    try {
      const text = await pending;
      return (text === undefined ? undefined : JSON.parse(text)) as T;
    } finally {
      if (this.pendingReads.get(key) === pending) this.pendingReads.delete(key);
    }
  }

  private async requestTransport<T>(
    path: string,
    options: RequestOptions,
    token: string | null | undefined,
    idempotencyKey: string | null | undefined,
  ): Promise<T> {
    const method = options.method ?? "GET";
    const key = `${token ?? ""} ${path}`;
    const cached =
      method === "GET" && !options.fresh ? this.cache.get(key) : undefined;
    // Read-your-writes: right after this client writes, its reads go to the
    // primary database rather than a replica that may lag a moment behind.
    const fresh =
      method === "GET" && Date.now() - this.lastWriteAt < READ_YOUR_WRITES_MS;
    if (method !== "GET") this.lastWriteAt = Date.now();
    const send = () =>
      this.fetchImpl(this.baseUrl + path, {
        method,
        ...(options.fresh ? { cache: "no-store" as const } : {}),
        // Only declare a JSON body when there is one: the API rejects an empty
        // body labelled application/json (this broke logout and other bodyless calls).
        headers: {
          ...(options.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(cached ? { "If-None-Match": cached.etag } : {}),
          ...(options.fresh ? { "Cache-Control": "no-cache" } : {}),
          ...(fresh ? { "X-Orbyn-Consistency": "primary" } : {}),
          ...(idempotencyKey && method !== "GET"
            ? { "Idempotency-Key": idempotencyKey }
            : {}),
          "X-Orbyn-Editor": this.editorId,
          ...options.headers,
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal
          ? AbortSignal.any([
              options.signal,
              AbortSignal.timeout(this.timeoutMs),
            ])
          : AbortSignal.timeout(this.timeoutMs),
      });
    // A read that meets a copy being replaced during a deploy (502/503/504
    // or a dropped connection) is tried once more; reads never change data.
    // Writes are retried only with an Idempotency-Key, which the server
    // answers once however many times it arrives; without one, never.
    const retryable = method === "GET" || !!idempotencyKey;
    let response: Response;
    try {
      response = await send();
      if (retryable && [502, 503, 504].includes(response.status)) {
        await pause(RETRY_DELAY_MS, options.signal);
        response = await send();
      }
    } catch (error) {
      if (
        !retryable ||
        options.signal?.aborted ||
        (error as Error).name === "TimeoutError"
      )
        throw error;
      await pause(RETRY_DELAY_MS, options.signal);
      response = await send();
    }
    // A refresh may meet the previous tab's allowance. Reads wait for the
    // server's stated recovery time and try once; writes are never replayed
    // for a 429. A missing or excessive delay stays an actionable error.
    if (method === "GET" && response.status === 429) {
      const header = response.headers.get("Retry-After");
      const seconds = header === null || !header.trim() ? NaN : Number(header);
      const delay = Number.isFinite(seconds)
        ? seconds >= 0
          ? seconds * 1000
          : NaN
        : header && Number.isFinite(Date.parse(header))
          ? Math.max(0, Date.parse(header) - Date.now())
          : NaN;
      if (
        Number.isFinite(delay) &&
        delay <= Math.min(60_000, this.timeoutMs / 2)
      ) {
        await response.body?.cancel();
        await pause(delay, options.signal);
        response = await send();
      }
    }
    // Nothing changed since last time: reuse the body we already have. It is
    // parsed afresh so callers can never mutate the remembered copy.
    if (response.status === 304 && cached)
      return (options.raw ? cached.text : JSON.parse(cached.text)) as T;
    if (!response.ok) {
      // A body that isn't JSON came from something in front of Orbyn: a
      // proxy's HTML error page (Cloudflare's 524 when a reply took too long).
      const error = (await response
        .json()
        .catch(() => ({ message: proxyMessage(response.status) }))) as {
        message?: string;
        detail?: string;
        request_id?: string;
      };
      const retryAfter = response.headers.get("Retry-After");
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      const retryAfterMs =
        retryAfter === null
          ? undefined
          : Number.isFinite(seconds)
            ? Math.max(0, seconds * 1000)
            : Number.isFinite(Date.parse(retryAfter))
              ? Math.max(0, Date.parse(retryAfter) - Date.now())
              : undefined;
      throw new HttpError(
        response.status,
        error.message ||
          (response.status >= 500
            ? "Something went wrong on our side. Try again in a moment."
            : "That didn't work. Try again."),
        {
          detail: error.detail,
          retryAfterMs,
          request: {
            method,
            path: path.split("?")[0],
            id: error.request_id ?? response.headers.get("X-Request-Id"),
          },
        },
      );
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    const etag = response.headers.get("ETag");
    if (method === "GET" && etag) {
      this.cache.delete(key);
      this.cache.set(key, { etag, text });
      if (this.cache.size > MAX_CACHED)
        this.cache.delete(this.cache.keys().next().value as string);
    }
    return (options.raw ? text : JSON.parse(text)) as T;
  }

  /** Durable explicit reminder decision; replaying the same choice returns its original receipt. */
  performReminderAction(
    card: import("@orbyn/core").ReminderNudgeCard,
    action: import("@orbyn/core").ReminderNudgeCard["actions"][number],
    options: {
      day?: string;
      minutes?: number;
      chatId?: string;
      turnId?: string;
    } = {},
  ) {
    return assistant.callPerformReminderAction.call(
      this,
      card,
      action,
      options,
    );
  }
  reminderActionReceipt(nudgeId: string) {
    return assistant.callReminderActionReceipt.call(this, nudgeId);
  }
  undoReminderAction(id: string) {
    return assistant.callUndoReminderAction.call(this, id);
  }

  // ---- health ----
  publishingList() {
    return publishing.callPublishingList.call(this);
  }
  publishingGet(id: string) {
    return publishing.callPublishingGet.call(this, id);
  }
  publishingCreate() {
    return publishing.callPublishingCreate.call(this);
  }
  publishingSave(
    id: string,
    version: number,
    content: import("@orbyn/core").PublishingContent,
  ) {
    return publishing.callPublishingSave.call(this, id, version, content);
  }
  publishingAction(
    id: string,
    version: number,
    action: "publish" | "cancel" | "release" | "unrelease" | "delete" | "reset",
    at?: string,
  ) {
    return publishing.callPublishingAction.call(this, id, version, action, at);
  }
  publishingSuggest(
    content: import("@orbyn/core").PublishingContent,
    instruction: string,
  ) {
    return publishing.callPublishingSuggest.call(this, content, instruction);
  }
  publishingConnection() {
    return publishing.callPublishingConnection.call(this);
  }
  publishingConnect() {
    return publishing.callPublishingConnect.call(this);
  }
  publishingDisconnect() {
    return publishing.callPublishingDisconnect.call(this);
  }
  publishedUpdates() {
    return publishing.callPublishedUpdates.call(this);
  }

  health() {
    return administration.callHealth.call(this);
  }

  /** The public uptime report; no sign-in needed. */
  // ---- system: settings, maintenance, version ----
  /** Live settings and where each comes from (database or .env). */
  getSystemSettings() {
    return administration.callGetSystemSettings.call(this);
  }
  updateSystemSettings(body: SystemSettingsUpdate) {
    return tasks.callUpdateSystemSettings.call(this, body);
  }
  /** Sends a test email with the saved SMTP settings (to the admin by default). */
  sendTestEmail(to?: string) {
    return account.callSendTestEmail.call(this, to);
  }
  /** Public: whether maintenance mode is on, for banners (no sign-in needed). */
  getMaintenance() {
    return administration.callGetMaintenance.call(this);
  }
  setMaintenance(body: MaintenanceInput) {
    return administration.callSetMaintenance.call(this, body);
  }
  /** Public: the build the server is running. */
  getVersion() {
    return administration.callGetVersion.call(this);
  }
  /** The running version against the newest commit on GitHub. */
  getUpdates() {
    return tasks.callGetUpdates.call(this);
  }

  getStatus() {
    return administration.callGetStatus.call(this);
  }

  // ---- auth ----
  register(input: Credentials) {
    return account.callRegister.call(this, input);
  }
  login(input: Pick<Credentials, "email" | "password"> & { code?: string }) {
    return account.callLogin.call(this, input);
  }
  logout() {
    return account.callLogout.call(this);
  }
  /** Where you're signed in. */
  listSessions() {
    return tasks.callListSessions.call(this);
  }
  /** Sign out one other device. */
  revokeSession(id: string) {
    return account.callRevokeSession.call(this, id);
  }
  /** Sign out everywhere except here. */
  revokeOtherSessions() {
    return account.callRevokeOtherSessions.call(this);
  }
  // ---- two-step verification ----
  getTwoFactor() {
    return account.callGetTwoFactor.call(this);
  }
  /** Begin setup: returns the secret and otpauth URI to add to an app. */
  setupTwoFactor() {
    return account.callSetupTwoFactor.call(this);
  }
  /** Confirm with a code; returns the one-time recovery codes. */
  enableTwoFactor(code: string) {
    return account.callEnableTwoFactor.call(this, code);
  }
  disableTwoFactor(password: string) {
    return account.callDisableTwoFactor.call(this, password);
  }
  // ---- passkeys ----
  listPasskeys() {
    return tasks.callListPasskeys.call(this);
  }
  passkeyRegisterOptions() {
    return account.callPasskeyRegisterOptions.call(this);
  }
  registerPasskey(response: unknown, name: string) {
    return account.callRegisterPasskey.call(this, response, name);
  }
  deletePasskey(id: string) {
    return account.callDeletePasskey.call(this, id);
  }
  /** Sign-in step 1: options + an opaque handle to send back. */
  passkeyLoginOptions(email?: string) {
    return account.callPasskeyLoginOptions.call(this, email);
  }
  /** Sign-in step 2: the assertion, returns a session. */
  passkeyLogin(handle: string, response: unknown) {
    return account.callPasskeyLogin.call(this, handle, response);
  }
  // ---- import / export ----
  /** Your planner data as a JSON archive to keep. */
  exportData() {
    return account.callExportData.call(this);
  }
  /**
   * Everything, pages included, as a .zip: every page as Markdown in its
   * folders, projects, folders, imports, consent history and the planner
   * file. Comes back as a blob with the name the server chose.
   */
  async exportArchive() {
    return account.callExportArchive.call(this);
  }
  /** Bring items in from an Orbyn export or a CSV. Dry run by default. */
  importData(input: {
    format: "orbyn" | "csv" | "todoist" | "ticktick";
    data: string;
    dry_run?: boolean;
  }) {
    return account.callImportData.call(this, input);
  }
  // ---- chat delivery ----
  getChat() {
    return assistant.callGetChat.call(this);
  }
  setChat(kind: "slack" | "discord", url: string) {
    return assistant.callSetChat.call(this, kind, url);
  }
  disableChat() {
    return assistant.callDisableChat.call(this);
  }
  /** Post a test message to the connected chat webhook. */
  testChat() {
    return assistant.callTestChat.call(this);
  }
  // ---- email to task ----
  getInbox() {
    return account.callGetInbox.call(this);
  }
  /** Turn on email-to-task, or roll to a fresh address. */
  rotateInbox() {
    return account.callRotateInbox.call(this);
  }
  disableInbox() {
    return account.callDisableInbox.call(this);
  }
  /** Confirm an email address from a verification link (signed in or not). */
  verifyEmail(token: string) {
    return account.callVerifyEmail.call(this, token);
  }
  /** Re-send the confirmation email to the signed-in, unconfirmed user. */
  resendVerification() {
    return account.callResendVerification.call(this);
  }
  /** Ask for a password-reset link. Always succeeds, whoever the email is. */
  forgotPassword(email: string) {
    return account.callForgotPassword.call(this, email);
  }
  /** Set a new password from a reset link and sign in. */
  resetPassword(token: string, password: string) {
    return account.callResetPassword.call(this, token, password);
  }

  // ---- profile ----
  me(options: Pick<RequestOptions, "fresh" | "signal"> = {}) {
    return account.callMe.call(this, options);
  }
  updatePreferences(input: { email_reminders: boolean }) {
    return tasks.callUpdatePreferences.call(this, input);
  }

  // ---- items ----
  listItems(
    params: {
      limit?: number;
      offset?: number;
      team_id?: string;
      /** Words in the title or notes. */
      q?: string;
      list_id?: string;
      tag_id?: string;
      assignee_id?: string;
      /** List order; newest first when omitted. Every item carries its `score`. */
      sort?: ItemSort;
      /** Only the subtasks of this task. */
      parent_id?: string;
    } = {},
  ) {
    return tasks.callListItems.call(this, params);
  }
  /**
   * Incremental sync: items changed after `updated_after` (or after a
   * previous page's `next_cursor`), oldest change first, and with
   * `include_deleted` the items deleted since.
   */
  syncItems(
    params: {
      updated_after?: string;
      cursor?: string;
      include_deleted?: boolean;
      limit?: number;
      team_id?: string;
    },
    options: Pick<RequestOptions, "headers" | "fresh" | "signal"> = {},
  ) {
    return tasks.callSyncItems.call(this, params, options);
  }
  /** One primary, repeatable-read planner snapshot; later deltas are best effort. */
  reconcileItems() {
    return tasks.callReconcileItems.call(this);
  }
  /** Move an item in its manual order (doesn't change its version). */
  moveItem(id: string, input: ItemPositionInput) {
    return tasks.callMoveItem.call(this, id, input);
  }
  /** Add minutes worked (focus timer). */
  logTime(itemId: string, minutes: number) {
    return tasks.callLogTime.call(this, itemId, minutes);
  }
  /** Remove one occurrence of a repeating item. */
  skipOccurrence(itemId: string, occurrence: string) {
    return tasks.callSkipOccurrence.call(this, itemId, occurrence);
  }

  // ---- lists and tags ----
  /**
   * Write today's agenda again from the calendar as it is now, opening with
   * the assistant's summary when a provider is connected. Replaces the
   * page's content. `brief` says whether the assistant wrote one.
   */
  rewriteAgenda(timezone?: string) {
    return planner.callRewriteAgenda.call(this, timezone);
  }
  /** Read explicit scheduled-plan permission, independently of email/digest preferences. */
  async agendaPrivatePermission(signal?: AbortSignal) {
    return planner.callAgendaPrivatePermission.call(this, signal);
  }
  /** Grant/revoke only the reviewed current account/device/model selection. */
  async setAgendaPrivatePermission(
    input: AgendaPrivatePermissionInput,
    signal?: AbortSignal,
  ) {
    return planner.callSetAgendaPrivatePermission.call(this, input, signal);
  }
  /** Read private scheduled summary status without exposing execution context. */
  async agendaPrivateSummary(signal?: AbortSignal) {
    return planner.callAgendaPrivateSummary.call(this, signal);
  }
  /**
   * Today's agenda document, written on first ask each day (a POST: asking
   * writes it). `timezone` is the device's, adopted when you haven't picked
   * one in settings.
   */
  agendaToday(timezone?: string) {
    return planner.callAgendaToday.call(this, timezone);
  }
  /**
   * One day's agenda, for stepping back and forward. Reading never writes:
   * today's page is written on the spot here when it isn't there yet (as
   * `agendaToday` does); another day's `doc` is null until `writeAgenda`
   * writes it.
   */
  async agendaOn(date: string, timezone?: string) {
    return planner.callAgendaOn.call(this, date, timezone);
  }
  /** Write one day's agenda from the calendar (or get the one written). */
  writeAgenda(date: string, timezone?: string) {
    return planner.callWriteAgenda.call(this, date, timezone);
  }
  /** Tell the server the device's zone; adopted unless you picked one. */
  reportTimeZone(timezone: string) {
    return planner.callReportTimeZone.call(this, timezone);
  }
  /**
   * The note for an event, created from a template the first time. For a
   * repeating event, `occurrence` (the calendar entry's) opens that class's
   * own note; without it, the series' note.
   */
  itemNote(itemId: string, occurrence?: string | null) {
    return tasks.callItemNote.call(this, itemId, occurrence);
  }
  /**
   * The notes these events have, to mark them (`eventNoteFor` finds an
   * entry's). `from`/`to` keep a repeating event's class notes to the
   * times shown.
   */
  async eventNotes(
    itemIds: string[],
    range: { from?: string; to?: string } = {},
  ): Promise<EventNoteRef[]> {
    return documents.callEventNotes.call(this, itemIds, range);
  }
  /**
   * Turn a page's open checklist lines into tasks: every one that isn't a
   * task yet, or only the lines named in `blockIds` ("Make task").
   */
  docToTasks(id: string, blockIds?: string[]) {
    return documents.callDocToTasks.call(this, id, blockIds);
  }

  // Projects
  listProjects() {
    return projects.callListProjects.call(this);
  }
  getProject(id: string) {
    return projects.callGetProject.call(this, id);
  }
  listProjectLinks(id: string) {
    return projects.callListProjectLinks.call(this, id);
  }
  addProjectLink(id: string, input: { url: string; title?: string }) {
    return projects.callAddProjectLink.call(this, id, input);
  }
  removeProjectLink(id: string, linkId: string) {
    return projects.callRemoveProjectLink.call(this, id, linkId);
  }
  /** Mark a project visit and return the prior visit for cross-device catch-up. */
  visitProject(id: string) {
    return projects.callVisitProject.call(this, id);
  }
  projectPlanning(id: string) {
    return projects.callProjectPlanning.call(this, id);
  }
  projectSessions(id: string) {
    return projects.callProjectSessions.call(this, id);
  }
  /** Preview a project plan using only tasks assigned to the signed-in person. */
  /**
   * Preview a plan for your tasks in a project. `claimItemIds` are unassigned
   * team tasks you take on with it: they become yours and are planned too.
   */
  planProject(id: string, timezone?: string, claimItemIds: string[] = []) {
    return projects.callPlanProject.call(this, id, timezone, claimItemIds);
  }
  /** Recent changes to a project, with private task and note content omitted. */
  projectActivity(id: string, limit = 100) {
    return projects.callProjectActivity.call(this, id, limit);
  }
  /**
   * Keep a project out of the assistant (or let it back in). Owners and
   * admins of a team project, or the owner of a personal one.
   */
  setProjectAssistant(id: string, off: boolean) {
    return assistant.callSetProjectAssistant.call(this, id, off);
  }
  /** A project's milestones, soonest first, rolled up for you. */
  projectMilestones(id: string) {
    return projects.callProjectMilestones.call(this, id);
  }
  createMilestone(projectId: string, input: MilestoneInput) {
    return projects.callCreateMilestone.call(this, projectId, input);
  }
  updateMilestone(projectId: string, id: string, input: MilestoneUpdate) {
    return projects.callUpdateMilestone.call(this, projectId, id, input);
  }
  deleteMilestone(projectId: string, id: string) {
    return projects.callDeleteMilestone.call(this, projectId, id);
  }
  /** Put a task in a milestone of its project, or take it out (null). */
  setItemMilestone(itemId: string, milestoneId: string | null) {
    return projects.callSetItemMilestone.call(this, itemId, milestoneId);
  }
  /** Your saved chats with the assistant about a project, newest first. */
  projectChats(projectId: string) {
    return assistant.callProjectChats.call(this, projectId);
  }
  async aiProviderChoice(signal?: AbortSignal) {
    return assistant.callAiProviderChoice.call(this, signal);
  }
  /** Completed Orbyn request measurements, not account-wide ChatGPT quota. */
  managedAiUsage(signal?: AbortSignal) {
    return assistant.callManagedAiUsage.call(this, signal);
  }
  async chatgptUsage(signal?: AbortSignal) {
    return connections.callChatgptUsage.call(this, signal);
  }
  async saveAiProviderChoice(input: unknown, signal?: AbortSignal) {
    return assistant.callSaveAiProviderChoice.call(this, input, signal);
  }
  async startChatgptConnectRequest(signal?: AbortSignal) {
    return connections.callStartChatgptConnectRequest.call(this, signal);
  }
  /** Teams OAuth identity review is separate from personal conversation linking and DM consent. */
  async teamsChannel(signal?: AbortSignal) {
    return connections.callTeamsChannel.call(this, signal);
  }
  async startTeamsInstallation(signal?: AbortSignal) {
    return teams.callStartTeamsInstallation.call(this, signal);
  }
  async teamsInstallation(id: string, signal?: AbortSignal) {
    return teams.callTeamsInstallation.call(this, id, signal);
  }
  async confirmTeamsInstallation(
    id: string,
    input: unknown,
    signal?: AbortSignal,
  ) {
    return teams.callConfirmTeamsInstallation.call(this, id, input, signal);
  }
  async restartTeamsConversationLink(input: unknown, signal?: AbortSignal) {
    return teams.callRestartTeamsConversationLink.call(this, input, signal);
  }
  async setTeamsDmPermission(input: unknown, signal?: AbortSignal) {
    return teams.callSetTeamsDmPermission.call(this, input, signal);
  }
  async disconnectTeams(input: unknown, signal?: AbortSignal) {
    return teams.callDisconnectTeams.call(this, input, signal);
  }
  /** Read this owner's Slack mapping; installation and messages require separate consent. */
  async slackChannel(signal?: AbortSignal) {
    return connections.callSlackChannel.call(this, signal);
  }
  async startSlackInstallation(signal?: AbortSignal) {
    return connections.callStartSlackInstallation.call(this, signal);
  }
  async slackInstallation(id: string, signal?: AbortSignal) {
    return connections.callSlackInstallation.call(this, id, signal);
  }
  async confirmSlackInstallation(
    id: string,
    input: unknown,
    signal?: AbortSignal,
  ) {
    return connections.callConfirmSlackInstallation.call(
      this,
      id,
      input,
      signal,
    );
  }
  async setSlackDmPermission(input: unknown, signal?: AbortSignal) {
    return connections.callSetSlackDmPermission.call(this, input, signal);
  }
  async disconnectSlack(input: unknown, signal?: AbortSignal) {
    return connections.callDisconnectSlack.call(this, input, signal);
  }
  async chatgptConnectRequest(id: string, signal?: AbortSignal) {
    return connections.callChatgptConnectRequest.call(this, id, signal);
  }
  async claimChatgptInference(executorId: string, signal?: AbortSignal) {
    return connections.callClaimChatgptInference.call(this, executorId, signal);
  }
  finishChatgptInference(publication: unknown, signal?: AbortSignal) {
    return connections.callFinishChatgptInference.call(
      this,
      publication,
      signal,
    );
  }
  pendingChatgptConnectRequests(signal?: AbortSignal) {
    return connections.callPendingChatgptConnectRequests.call(this, signal);
  }
  claimChatgptConnectRequest(id: string) {
    return connections.callClaimChatgptConnectRequest.call(this, id);
  }
  finishChatgptConnectRequest(id: string, connectionId: string | null) {
    return connections.callFinishChatgptConnectRequest.call(
      this,
      id,
      connectionId,
    );
  }
  /** Start a session-bound identity proof; plan credentials stay in the device runtime. */
  async startChatgptConnection(
    input: ChatgptConnectionStart = {},
    signal?: AbortSignal,
  ) {
    return connections.callStartChatgptConnection.call(this, input, signal);
  }
  /** Submit only an ID token for verification, never plan access or refresh credentials. */
  async finishChatgptConnection(
    input: ChatgptConnectionFinish,
    signal?: AbortSignal,
  ) {
    return connections.callFinishChatgptConnection.call(this, input, signal);
  }
  /** Verified identity metadata for the signed-in person; no cached account catalog. */
  /** Enroll the credential-owning device using public proof metadata only. */
  async beginChatgptExecutor(
    input: ChatgptExecutorStart,
    signal?: AbortSignal,
  ) {
    return connections.callBeginChatgptExecutor.call(this, input, signal);
  }
  async finishChatgptExecutor(
    input: ChatgptExecutorFinish,
    signal?: AbortSignal,
  ) {
    return connections.callFinishChatgptExecutor.call(this, input, signal);
  }
  async beginChatgptExecutorLease(
    input: ChatgptLeaseStart,
    signal?: AbortSignal,
  ) {
    return connections.callBeginChatgptExecutorLease.call(this, input, signal);
  }
  async finishChatgptExecutorLease(
    input: ChatgptExecutorFinish,
    signal?: AbortSignal,
  ) {
    return connections.callFinishChatgptExecutorLease.call(this, input, signal);
  }
  async renewChatgptExecutorLease(
    input: ChatgptLeaseRenewal,
    signal?: AbortSignal,
  ) {
    return connections.callRenewChatgptExecutorLease.call(this, input, signal);
  }
  async publishChatgptModels(
    input: ChatgptCatalogPublication,
    signal?: AbortSignal,
  ) {
    return publishing.callPublishChatgptModels.call(this, input, signal);
  }
  /** Always refresh executor presence; a cached list cannot authorize a default. */
  async chatgptModels(
    input: ChatgptCatalogSelection,
    signal?: AbortSignal,
    includeCapabilities = false,
  ) {
    return connections.callChatgptModels.call(
      this,
      input,
      signal,
      includeCapabilities,
    );
  }
  async selectChatgptDefault(
    input: ChatgptCatalogDefaultUpdate,
    signal?: AbortSignal,
  ) {
    return connections.callSelectChatgptDefault.call(this, input, signal);
  }

  /** Discover owned devices without provider credentials or signing keys. */
  async chatgptExecutors(signal?: AbortSignal) {
    return connections.callChatgptExecutors.call(this, signal);
  }

  /** Verify replacement identity only; access/refresh credentials are never sent. */
  async verifyChatgptRefreshIdentity(
    input: { connection_id: string; id_token: string },
    signal?: AbortSignal,
  ) {
    return connections.callVerifyChatgptRefreshIdentity.call(
      this,
      input,
      signal,
    );
  }

  async chatgptConnections(signal?: AbortSignal) {
    return connections.callChatgptConnections.call(this, signal);
  }
  /** Disconnect a registration and invalidate pending sign-in attempts. */
  revokeChatgptConnection(id: string) {
    return connections.callRevokeChatgptConnection.call(this, id);
  }
  /** Your saved assistant chats, pinned first and then most recently used. */
  aiChats(
    options: {
      search?: string;
      project_id?: string;
      limit?: number;
      kind?: "all" | "chat" | "work";
      conversation_only?: boolean;
    } = {},
  ) {
    return assistant.callAiChats.call(this, options);
  }
  projectChat(id: string) {
    return assistant.callProjectChat.call(this, id);
  }
  aiChat(id: string, signal?: AbortSignal) {
    return assistant.callAiChat.call(this, id, signal);
  }
  /** Save a project chat after a reply; the same id updates the same chat. */
  saveProjectChat(id: string, input: ProjectChatInput) {
    return assistant.callSaveProjectChat.call(this, id, input);
  }
  updateAiChat(id: string, input: UpdateAiChatInput) {
    return assistant.callUpdateAiChat.call(this, id, input);
  }
  saveChatAsNote(id: string) {
    return assistant.callSaveChatAsNote.call(this, id);
  }
  deleteProjectChat(id: string) {
    return assistant.callDeleteProjectChat.call(this, id);
  }
  startGoalExecution(
    id: string,
    input: import("@orbyn/core").GoalExecutionStartInput,
  ) {
    return goalExecutions.callStartGoalExecution.call(this, id, input);
  }
  goalExecutions(
    id: string,
    query: import("@orbyn/core").GoalExecutionHistoryQuery = {},
  ) {
    return goalExecutions.callGoalExecutions.call(this, id, query);
  }
  goalExecution(id: string) {
    return goalExecutions.callGoalExecution.call(this, id);
  }
  goalExecutionAttempts(
    id: string,
    query: import("@orbyn/core").GoalExecutionHistoryQuery = {},
  ) {
    return goalExecutions.callGoalExecutionAttempts.call(this, id, query);
  }
  pauseGoalExecution(
    id: string,
    input: import("@orbyn/core").GoalExecutionControlInput,
  ) {
    return goalExecutions.callPauseGoalExecution.call(this, id, input);
  }
  resumeGoalExecution(
    id: string,
    input: import("@orbyn/core").GoalExecutionResumeInput,
  ) {
    return goalExecutions.callResumeGoalExecution.call(this, id, input);
  }
  stopGoalExecution(
    id: string,
    input: import("@orbyn/core").GoalExecutionControlInput,
  ) {
    return goalExecutions.callStopGoalExecution.call(this, id, input);
  }
  acceptGoalExecution(
    id: string,
    input: import("@orbyn/core").GoalExecutionAcceptInput,
  ) {
    return goalExecutions.callAcceptGoalExecution.call(this, id, input);
  }
  listGoals() {
    return projects.callListGoals.call(this);
  }
  createGoal(input: GoalInput) {
    return projects.callCreateGoal.call(this, input);
  }
  updateGoal(id: string, input: GoalUpdate) {
    return projects.callUpdateGoal.call(this, id, input);
  }
  deleteGoal(id: string) {
    return projects.callDeleteGoal.call(this, id);
  }
  /** Current unfinished owned tasks linked to this goal, with unbooked effort. */
  goalWork(id: string) {
    return projects.callGoalWork.call(this, id);
  }
  goalCheckins(id: string) {
    return projects.callGoalCheckins.call(this, id);
  }
  listAgentRoutines() {
    return assistant.callListAgentRoutines.call(this);
  }
  routineQuietPolicy(id: string) {
    return routineQuiet.callRoutineQuietPolicy.call(this, id);
  }
  updateRoutineQuietPolicy(
    id: string,
    input: Parameters<typeof routineQuiet.callUpdateRoutineQuietPolicy>[1],
  ) {
    return routineQuiet.callUpdateRoutineQuietPolicy.call(this, id, input);
  }
  routineQuietChecks(routineId: string, occurrenceId: string) {
    return routineQuiet.callRoutineQuietChecks.call(
      this,
      routineId,
      occurrenceId,
    );
  }
  routineRetryPolicy(id: string) {
    return routineRetries.callRoutineRetryPolicy.call(this, id);
  }
  updateRoutineRetryPolicy(
    id: string,
    input: import("@orbyn/core").RoutineRetryPolicyUpdateInput,
  ) {
    return routineRetries.callUpdateRoutineRetryPolicy.call(this, id, input);
  }
  routineRecovery(routineId: string, occurrenceId: string) {
    return routineRetries.callRoutineRecovery.call(
      this,
      routineId,
      occurrenceId,
    );
  }
  stopRoutineRecovery(
    routineId: string,
    occurrenceId: string,
    input: import("@orbyn/core").RoutineRecoveryStopInput,
  ) {
    return routineRetries.callStopRoutineRecovery.call(
      this,
      routineId,
      occurrenceId,
      input,
    );
  }
  listAgentRoutineRuns(id: string, query: AssistantRoutineRunsQuery = {}) {
    return assistant.callListAgentRoutineRuns.call(this, id, query);
  }
  createAgentRoutine(input: AgentRoutineInput) {
    return assistant.callCreateAgentRoutine.call(this, input);
  }
  routineSetupContext() {
    return routineSetup.callRoutineSetupContext.call(this);
  }
  setupAgentRoutine(
    input: Parameters<typeof routineSetup.callSetupAgentRoutine>[0],
  ) {
    return routineSetup.callSetupAgentRoutine.call(this, input);
  }
  updateAgentRoutine(id: string, input: AgentRoutineUpdate) {
    return assistant.callUpdateAgentRoutine.call(this, id, input);
  }
  deleteAgentRoutine(id: string) {
    return assistant.callDeleteAgentRoutine.call(this, id);
  }
  assistantApprovalScopes() {
    return assistant.callAssistantApprovalScopes.call(this);
  }
  setAssistantApprovalScopes(input: ApprovalScopes) {
    return assistant.callSetAssistantApprovalScopes.call(this, input);
  }
  assistantIdeas() {
    return assistant.callAssistantIdeas.call(this);
  }
  /** Checkpoints for the read-only project time machine, newest first. */
  projectCheckpoints(id: string, before?: string) {
    return projects.callProjectCheckpoints.call(this, id, before);
  }
  projectSnapshot(id: string, eventOrder: string) {
    return projects.callProjectSnapshot.call(this, id, eventOrder);
  }
  createProject(input: {
    name: string;
    summary?: string;
    team_id?: string | null;
    deadline?: string | null;
    stages?: string[];
  }) {
    return projects.callCreateProject.call(this, input);
  }
  updateProject(
    id: string,
    input: {
      name?: string;
      summary?: string;
      status?: ProjectStatus;
      deadline?: string | null;
      doc_id?: string | null;
      stages?: { id?: string; name: string }[];
      /** Other names, such as a course code (LNK-03). */
      aliases?: string[];
      /** A cover picture (W6); null takes it off. */
      cover_file_id?: string | null;
      /** An emoji or "icon:<name>" (W6); null takes it off. */
      icon?: string | null;
    },
  ) {
    return projects.callUpdateProject.call(this, id, input);
  }
  deleteProject(id: string) {
    return projects.callDeleteProject.call(this, id);
  }
  /**
   * Move a task into a project and stage, or pass null to unfile it. The
   * answer carries the task as it now stands.
   */
  setItemProject(
    itemId: string,
    input: {
      version: number;
      project_id: string | null;
      stage_id?: string | null;
    },
  ) {
    return projects.callSetItemProject.call(this, itemId, input);
  }
  /**
   * What a task hangs off and what hangs off it: its project and stage, the
   * page line it came from and the other pages about it (only pages you can
   * open).
   */
  itemContext(itemId: string) {
    return tasks.callItemContext.call(this, itemId);
  }

  /** Promises, decisions, experiments and meeting outcomes visible to this user. */
  listWorkRecords(
    params: {
      kind?: WorkRecord["kind"];
      project_id?: string;
      owner_id?: string;
      source_item_id?: string;
      limit?: number;
    } = {},
  ) {
    return projects.callListWorkRecords.call(this, params);
  }
  getWorkRecord(id: string) {
    return projects.callGetWorkRecord.call(this, id);
  }
  createWorkRecord(input: WorkRecordInput) {
    return projects.callCreateWorkRecord.call(this, input);
  }
  updateWorkRecord(id: string, input: WorkRecordUpdate) {
    return projects.callUpdateWorkRecord.call(this, id, input);
  }
  respondWorkRecord(id: string, decision: "accept" | "decline") {
    return projects.callRespondWorkRecord.call(this, id, decision);
  }

  // Comments on a document
  listDocComments(docId: string) {
    return documents.callListDocComments.call(this, docId);
  }
  /**
   * `anchor` ties the remark to words in one block; without it, to the page.
   * `parent_id` makes it a reply, and `mentions` are the people named in it.
   */
  addDocComment(
    docId: string,
    body: string,
    anchor?: {
      block_id?: string;
      quote?: string;
      range_start?: number;
      range_end?: number;
      parent_id?: string;
      mentions?: string[];
    },
  ) {
    return documents.callAddDocComment.call(this, docId, body, anchor);
  }

  /**
   * Ask the assistant for words in place of a stretch of a page. What comes
   * back is a proposal like any other — nothing changes until it is taken.
   */
  assistDoc(
    docId: string,
    body: {
      block_id: string;
      range_start: number;
      range_end: number;
      action: DocAiAction;
      instruction?: string;
      version?: number;
      quote?: string;
    },
  ) {
    return documents.callAssistDoc.call(this, docId, body);
  }
  /** Ask a question about one page, answered from that page alone. */
  askDoc(docId: string, question: string, selection?: DocAskSelection) {
    return documents.callAskDoc.call(this, docId, question, selection);
  }

  // Proposed changes to a document
  listDocSuggestions(docId: string) {
    return documents.callListDocSuggestions.call(this, docId);
  }
  /** Propose changes. Anyone who can read the document may propose. */
  proposeDocChanges(docId: string, changes: Proposed[], note = "") {
    return documents.callProposeDocChanges.call(this, docId, changes, note);
  }
  /** Take a proposal into the page, or leave it. Returns the page if taken. */
  decideDocSuggestion(docId: string, id: string, take: boolean) {
    return documents.callDecideDocSuggestion.call(this, docId, id, take);
  }
  withdrawDocSuggestion(docId: string, id: string) {
    return documents.callWithdrawDocSuggestion.call(this, docId, id);
  }

  /** People who can be named in a comment on this document. */
  /** "Mentioned in": the pages that name you, newest first. */
  mentions(limit = 50) {
    return account.callMentions.call(this, limit);
  }
  /** "Keep the original": the setting, the space used, and the files. */
  originals() {
    return documents.callOriginals.call(this);
  }
  setKeepOriginals(keep: boolean) {
    return documents.callSetKeepOriginals.call(this, keep);
  }
  /** A page's kept original, as a file to save. */
  async downloadOriginal(docId: string) {
    return documents.callDownloadOriginal.call(this, docId);
  }
  deleteOriginal(docId: string) {
    return documents.callDeleteOriginal.call(this, docId);
  }
  docPeople(docId: string) {
    return documents.callDocPeople.call(this, docId);
  }
  resolveDocComment(
    docId: string,
    commentId: string,
    resolved: boolean,
    expectedRevision?: number,
  ) {
    return documents.callResolveDocComment.call(
      this,
      docId,
      commentId,
      resolved,
      expectedRevision,
    );
  }
  deleteDocComment(docId: string, commentId: string) {
    return documents.callDeleteDocComment.call(this, docId, commentId);
  }

  // Folders and favourites
  listFolders() {
    return documents.callListFolders.call(this);
  }
  createFolder(input: { name: string; team_id?: string | null }) {
    return documents.callCreateFolder.call(this, input);
  }
  renameFolder(id: string, input: { name?: string; position?: number }) {
    return documents.callRenameFolder.call(this, id, input);
  }
  deleteFolder(id: string) {
    return documents.callDeleteFolder.call(this, id);
  }
  listFavourites() {
    return documents.callListFavourites.call(this);
  }
  setFavourite(
    kind: FavouriteKind,
    targetId: string,
    starred: boolean,
    blockId?: string,
  ) {
    return documents.callSetFavourite.call(
      this,
      kind,
      targetId,
      starred,
      blockId,
    );
  }
  /** The Starred group: every star with its live title (NAV-07). */
  listStarred() {
    return tasks.callListStarred.call(this);
  }

  // Choices that follow the account (NAV-08, NAV-09, SHR-08)
  getPrefs() {
    return account.callGetPrefs.call(this);
  }
  savePrefs(input: AccountPrefsInput) {
    return account.callSavePrefs.call(this, input);
  }
  resetPrefs() {
    return account.callResetPrefs.call(this);
  }

  // Home (W1)
  /** Home's panels: active goals, next routine runs, today's brief and reflection. */
  getHome() {
    return account.callGetHome.call(this);
  }
  /** "How did today go?": a line under Reflection on today's agenda. */
  addReflection(text: string) {
    return workspace.callAddReflection.call(this, text);
  }

  // Covers and icons (W6)
  /** A page's cover and icon; null takes one off. Its version stays. */
  setDocLook(docId: string, look: LookInput) {
    return documents.callSetDocLook.call(this, docId, look);
  }
  /** Your pictures, newest first, to choose a cover from. */
  myPictures() {
    return account.callMyPictures.call(this);
  }

  // Archiving and tidying the library (SRCH-03, ORG-03)
  archiveDoc(id: string, archived: boolean) {
    return documents.callArchiveDoc.call(this, id, archived);
  }
  archiveFolder(id: string, archived: boolean) {
    return documents.callArchiveFolder.call(this, id, archived);
  }
  /** Move, archive or tag several pages at once. */
  bulkDocs(input: {
    ids: string[];
    folder_id?: string | null;
    archived?: boolean;
    tag_id?: string;
  }) {
    return documents.callBulkDocs.call(this, input);
  }

  /** The Connections map around a page or project (CNV-02). */
  connectionMap(kind: "doc" | "project", id: string, depth: 1 | 2 = 1) {
    return documents.callConnectionMap.call(this, kind, id, depth);
  }

  /** A team's switches for publishing, the assistant and booking (OTH-04). */
  getTeamPolicies(teamId: string) {
    return teams.callGetTeamPolicies.call(this, teamId);
  }
  setTeamPolicies(
    teamId: string,
    input: Partial<Pick<TeamPolicies, "publishing" | "assistant" | "booking">>,
  ) {
    return teams.callSetTeamPolicies.call(this, teamId, input);
  }

  /** A recording's summary and action items, from the assistant (CAP-10). */
  summariseRecording(fileId: string, transcript?: string) {
    return assistant.callSummariseRecording.call(this, fileId, transcript);
  }

  // The Orbyn Clipper (CAP-02)
  listClipKeys() {
    return capture.callListClipKeys.call(this);
  }
  createClipKey(name?: string) {
    return capture.callCreateClipKey.call(this, name);
  }
  deleteClipKey(id: string) {
    return capture.callDeleteClipKey.call(this, id);
  }
  clipDestinations() {
    return capture.callClipDestinations.call(this);
  }
  clip(input: Partial<ClipInput> & Pick<ClipInput, "type" | "url">) {
    return capture.callClip.call(this, input);
  }

  // Saved views (DATA-01) and your own fields (ORG-02)
  /** Every saved view you can see: yours and those shared with your teams. */
  listViews() {
    return views.callListViews.call(this);
  }
  createView(input: SavedViewInput) {
    return views.callCreateView.call(this, input);
  }
  updateView(id: string, input: SavedViewUpdate) {
    return views.callUpdateView.call(this, id, input);
  }
  deleteView(id: string) {
    return views.callDeleteView.call(this, id);
  }
  /** Pin a view to your own sidebar, or unpin it. */
  pinView(id: string, pinned: boolean) {
    return views.callPinView.call(this, id, pinned);
  }
  /** A saved view's rows, as you see them. */
  runView(id: string, limit?: number) {
    return views.callRunView.call(this, id, limit);
  }
  /** The rows of a definition that isn't saved (a live list, a view being built). */
  runDefinition(definition: ViewDefinitionInput, limit?: number) {
    return views.callRunDefinition.call(this, definition, limit);
  }
  /** A saved view as CSV text, with the file name the server chose. */
  async exportViewCsv(id: string) {
    return views.callExportViewCsv.call(this, id);
  }
  /** Every field you can see, for pages and projects. */
  listFields() {
    return views.callListFields.call(this);
  }
  createField(input: CustomFieldInput) {
    return views.callCreateField.call(this, input);
  }
  updateField(id: string, input: CustomFieldUpdate) {
    return views.callUpdateField.call(this, id, input);
  }
  /** Removes a field and clears it everywhere it was set. */
  deleteField(id: string) {
    return views.callDeleteField.call(this, id);
  }
  /** A page's or project's fields and values, for its Info panel. */
  targetFields(target: FieldTarget, id: string) {
    return views.callTargetFields.call(this, target, id);
  }
  /** Set one field on a page or project; null clears it. */
  setFieldValue(
    fieldId: string,
    target: FieldTarget,
    targetId: string,
    value: FieldValue,
  ) {
    return views.callSetFieldValue.call(this, fieldId, target, targetId, value);
  }
  /** Date fields shown on the calendar between two days (YYYY-MM-DD). */
  fieldDates(from: string, to: string) {
    return views.callFieldDates.call(this, from, to);
  }

  /**
   * Search pages and tasks together, ranked. Filters narrow the same query
   * rather than choosing a different one, so a search with every filter off
   * is the same search.
   */
  search(
    q: string,
    filter: {
      type?: "doc" | "task" | "project";
      kind?: DocKind;
      project?: string;
      tag?: string;
      team?: string;
      updated_after?: string;
      include_archived?: boolean;
      limit?: number;
    } = {},
  ) {
    return search.callSearch.call(this, q, filter);
  }

  /**
   * The quick switcher: pages, tasks and projects by name, from the first
   * letter. With no words, what you opened last (then what changed last).
   */
  find(
    q: string,
    filter: {
      type?: "doc" | "task" | "project";
      limit?: number;
      include_archived?: boolean;
    } = {},
  ) {
    return search.callFind.call(this, q, filter);
  }

  /**
   * What the link picker offers for the words typed after [[: pages, tasks,
   * events, projects and people (dates are worked out by the app).
   */
  pickLinks(q: string, limit?: number) {
    return documents.callPickLinks.call(this, q, limit);
  }

  /** Link pills as they stand now: live titles, ticks, deadlines, deletions. */
  resolveLinks(refs: ObjectRef[]) {
    return documents.callResolveLinks.call(this, refs);
  }

  /** "Linked here": the places that link to a page, task, project or person. */
  linksHere(kind: "doc" | "task" | "event" | "project" | "person", id: string) {
    return documents.callLinksHere.call(this, kind, id);
  }

  /** A link's hover card: enough to tick, reschedule or open it (LNK-07). */
  linkCard(ref: {
    kind: "doc" | "task" | "event" | "project";
    id: string;
    block?: string;
  }) {
    return documents.callLinkCard.call(this, ref);
  }

  /** Pages that say this page's or project's name without linking to it (LNK-06). */
  unlinkedMentions(kind: "doc" | "project", id: string) {
    return documents.callUnlinkedMentions.call(this, kind, id);
  }

  /** Make a mention a link, in the page it's in. */
  linkMention(input: {
    doc_id: string;
    block_id: string;
    matched: string;
    target: { kind: "doc" | "project"; id: string };
  }) {
    return workspace.callLinkMention.call(this, input);
  }

  /** Pages that read like this one, not linked either way yet (LNK-06). */
  relatedPages(docId: string) {
    return documents.callRelatedPages.call(this, docId);
  }

  /** A page's headings (and, with words, lines) for [[Page# (LNK-04). */
  pageHeadings(docId: string, q = "") {
    return documents.callPageHeadings.call(this, docId, q);
  }

  /** Name a heading or line so a link can point at it. */
  anchorLine(docId: string, index: number, text: string, version?: number) {
    return documents.callAnchorLine.call(this, docId, index, text, version);
  }

  /** A heading's section of a page (or the page's first lines), to embed. */
  docSection(docId: string, block?: string | null) {
    return documents.callDocSection.call(this, docId, block);
  }

  /** "Move to new page": these lines become a page, and a link takes their place. */
  extractToPage(
    docId: string,
    input: { block_ids: string[]; title?: string; version: number },
  ) {
    return documents.callExtractToPage.call(this, docId, input);
  }

  /** "Merge into…": this page's lines go to the end of another. */
  mergeDoc(docId: string, into: string, version: number) {
    return documents.callMergeDoc.call(this, docId, into, version);
  }

  /** The headings you folded on a page, on every device (EDT-14). */
  docFolds(docId: string) {
    return documents.callDocFolds.call(this, docId);
  }
  setDocFolds(docId: string, blockIds: string[]) {
    return documents.callSetDocFolds.call(this, docId, blockIds);
  }

  /** A page's other names, such as a course code (LNK-03). */
  setDocAliases(docId: string, aliases: string[]) {
    return documents.callSetDocAliases.call(this, docId, aliases);
  }

  // ---- pictures and files in pages (EDT-01) ----
  /**
   * Add a picture or file to a page: its row, and where to send the bytes
   * (a path on this API's base URL, good for ten minutes and one upload).
   */
  createPageFile(docId: string, input: PageFileInput) {
    return documents.callCreatePageFile.call(this, docId, input);
  }
  /** Send a picture's or file's bytes to the link from `createPageFile`. */
  async uploadPageFile(
    uploadPath: string,
    file: Blob | ArrayBuffer | Uint8Array,
    contentType: string,
  ): Promise<void> {
    return documents.callUploadPageFile.call(
      this,
      uploadPath,
      file,
      contentType,
    );
  }
  /** A picture or file, with a link to show or download it for an hour. */
  pageFile(fileId: string) {
    return documents.callPageFile.call(this, fileId);
  }
  /** The pictures and files on a page. */
  pageFiles(docId: string) {
    return documents.callPageFiles.call(this, docId);
  }
  /** Delete a picture or file for good. */
  deletePageFile(fileId: string) {
    return documents.callDeletePageFile.call(this, fileId);
  }
  /** How much of your space pictures and files take. */
  filesUsage() {
    return workspace.callFilesUsage.call(this);
  }
  /** The full address of a path on this API (a file's link, say). */
  urlFor(path: string) {
    return workspace.callUrlFor.call(this, path);
  }

  /** Something was opened: it leads the quick switcher's recent list. */
  recordRecent(kind: "doc" | "task" | "project", id: string) {
    return workspace.callRecordRecent.call(this, kind, id);
  }

  /**
   * A page as a file to keep. Comes back as a blob with the name the server
   * chose, so every client saves the same file under the same name.
   * An expected version rejects concurrent changes rather than silently exporting another revision.
   */
  async exportDoc(
    docId: string,
    format: ExportFormat,
    options: { version?: number } = {},
  ) {
    return documents.callExportDoc.call(this, docId, format, options);
  }

  /** Compile an authorized document draft; source is retained by the owning editor. */
  async compileDocLatex(
    id: string,
    input: { source: string; version: number },
    signal?: AbortSignal,
  ) {
    return documents.callCompileDocLatex.call(this, id, input, signal);
  }

  // Documents
  /** Read full structured ownership with explicit format capability and fresh revision/visibility. */
  async getDocContent(id: string, options: { signal?: AbortSignal } = {}) {
    return documents.callGetDocContent.call(this, id, options);
  }
  /** Save the complete content tree once; unsupported structure must not fall back to flat writes. */
  async updateDocContent(
    id: string,
    version: number,
    document: VersionedDocContent,
    options: { signal?: AbortSignal; ticksFrom?: number } = {},
  ) {
    return documents.callUpdateDocContent.call(
      this,
      id,
      version,
      document,
      options,
    );
  }
  /** Every page you can see, newest edit first, optionally narrowed. */
  listDocs(
    filter: {
      kind?: DocKind;
      project?: string;
      tag?: string;
      /** Archived pages: "include" lists them too, "only" nothing else. */
      archived?: "include" | "only";
    } = {},
  ) {
    return documents.callListDocs.call(this, filter);
  }
  /** Private ownership and schedules for selected page blocks. */
  listPageMaintenanceRuns(docId: string) {
    return documents.callListPageMaintenanceRuns.call(this, docId);
  }
  stopPageMaintenanceRun(docId: string, runId: string) {
    return documents.callStopPageMaintenanceRun.call(this, docId, runId);
  }
  decidePageMaintenanceRun(
    docId: string,
    runId: string,
    waitingId: string,
    approved: boolean,
  ) {
    return documents.callDecidePageMaintenanceRun.call(
      this,
      docId,
      runId,
      waitingId,
      approved,
    );
  }
  listPageMaintenance(docId: string) {
    return documents.callListPageMaintenance.call(this, docId);
  }
  createPageMaintenance(docId: string, body: MaintainedPageBindingInput) {
    return documents.callCreatePageMaintenance.call(this, docId, body);
  }
  updatePageMaintenance(
    docId: string,
    bindingId: string,
    body: MaintainedPageBindingUpdate,
  ) {
    return documents.callUpdatePageMaintenance.call(
      this,
      docId,
      bindingId,
      body,
    );
  }
  deletePageMaintenance(
    docId: string,
    bindingId: string,
    expectedRevision: number,
  ) {
    return documents.callDeletePageMaintenance.call(
      this,
      docId,
      bindingId,
      expectedRevision,
    );
  }
  getDoc(id: string, options: Pick<RequestOptions, "fresh" | "signal"> = {}) {
    return documents.callGetDoc.call(this, id, options);
  }
  /** Read metadata and complete editor ownership from one fresh authorized revision. */
  async getDocForEditor(id: string, options: { signal?: AbortSignal } = {}) {
    id = versionedDocRead.shape.id.parse(id).toLowerCase();
    const result = await this.request<Doc>(`/docs/${id}`, {
      fresh: true,
      signal: options.signal,
      headers: { "x-orbyn-doc-formats": "1,2" },
    });
    return this.docEditorResult(result, id);
  }
  /** Save complete content and ordinary metadata atomically, without a second revision or flat fallback. */
  async updateDocForEditor(
    id: string,
    value: DocEditorUpdate,
    options: { signal?: AbortSignal; ticksFrom?: number } = {},
  ) {
    id = versionedDocRead.shape.id.parse(id).toLowerCase();
    const body = docEditorUpdate.parse(value);
    const result = await this.request<Doc>(`/docs/${id}`, {
      method: "PUT",
      body,
      signal: options.signal,
      headers: {
        "x-orbyn-doc-formats": "1,2",
        ...(options.ticksFrom !== undefined
          ? { "x-orbyn-ticks-from": String(options.ticksFrom) }
          : {}),
      },
    });
    const read = this.docEditorResult(result, id);
    if (read.version !== body.version + 1)
      throw new Error("Unexpected saved document revision.");
    return read;
  }
  private docEditorResult(result: Doc, id: string) {
    if (result.id?.toLowerCase() !== id)
      throw new Error("Unexpected document identity.");
    const read = versionedDocRead.parse({
      id: result.id,
      title: result.title,
      version: result.version,
      document: result.document,
    });
    const document = read.document;
    const blocks =
      document.format === 1
        ? document.blocks
        : docContainerBlocks(document.nodes, { projected: true });
    const projection = parseVersionedDocContent(
      { format: 1, blocks: result.content },
      { projected: true },
    );
    if (
      projection.format !== 1 ||
      JSON.stringify(projection.blocks) !== JSON.stringify(blocks)
    )
      throw new Error("Document ownership and visible content do not match.");
    return { ...result, document };
  }
  /** A page's Info panel: what it belongs to, tags, links, versions. */
  docInfo(id: string) {
    return documents.callDocInfo.call(this, id);
  }
  /** Take a source off a page (H6b); the source stays for other pages. */
  removePageSource(docId: string, sourceId: string) {
    return documents.callRemovePageSource.call(this, docId, sourceId);
  }
  /** Put exactly these tags (by id) on a page. */
  setDocTags(id: string, tags: string[]) {
    return documents.callSetDocTags.call(this, id, tags);
  }
  /**
   * Add tags to a page by name, as typing "#physics" in a line does; a name
   * with no tag yet makes one. `added` says which names were new to it.
   */
  addDocTags(id: string, names: string[]) {
    return documents.callAddDocTags.call(this, id, names);
  }
  createDoc(input: {
    title?: string;
    kind?: DocKind;
    team_id?: string | null;
    item_id?: string | null;
    folder_id?: string | null;
    project_id?: string | null;
    tags?: string[];
    content?: DocBlock[];
    /** Made inside this page (W5): its space's, it takes that page's folder. */
    parent_id?: string | null;
  }) {
    return documents.callCreateDoc.call(this, input);
  }
  /** Create a page with complete ownership in one server transaction. */
  async createDocForEditor(
    input: Parameters<OrbynClient["createDoc"]>[0],
    document: Extract<VersionedDocContent, { format: 2 }>,
  ) {
    if (input.content !== undefined)
      throw new Error("Specify either content or a complete document.");
    const result = await this.request<Doc>("/docs", {
      method: "POST",
      body: { ...input, document },
      headers: { "x-orbyn-doc-formats": "1,2" },
    });
    return this.docEditorResult(result, result.id.toLowerCase());
  }
  /**
   * Save a page. An editor passes `ticksFrom`, the version of the page its
   * checklist ticks were taken from (the version it last read or saved when
   * the content was put together), so a tick made on a line as it now stands
   * counts, and one carried over from before doesn't count twice.
   */
  updateDoc(
    id: string,
    input: {
      title?: string;
      content?: DocBlock[];
      folder_id?: string | null;
      project_id?: string | null;
      tags?: string[];
      /** The page it sits inside (W5), or null for its folder's top level. */
      parent_id?: string | null;
      /** Its place among the pages beside it after the move, 0 first. */
      position?: number;
      version: number;
    },
    options: { ticksFrom?: number } = {},
  ) {
    return documents.callUpdateDoc.call(this, id, input, options);
  }
  /**
   * Move a page in the library's tree (W5): inside another page
   * (`parent_id`), to a folder's top level (`folder_id`, with `parent_id`
   * null), and/or to `position` among the pages there. Reads the page's
   * version first, so a list that is a moment old can still move it.
   */
  async moveDoc(
    id: string,
    to: {
      parent_id?: string | null;
      folder_id?: string | null;
      position?: number;
    },
  ) {
    return documents.callMoveDoc.call(this, id, to);
  }
  /** Move a page to Trash. It can be restored for `TRASH_DAYS` days. */
  deleteDoc(id: string) {
    return documents.callDeleteDoc.call(this, id);
  }
  /** Permanently forget a private Memory topic, including its source links. */
  forgetMemory(id: string) {
    return documents.callForgetMemory.call(this, id);
  }
  /** Pages in Trash, most recently deleted first. */
  listTrash() {
    return documents.callListTrash.call(this);
  }
  /** Bring a page back from Trash, as it was. */
  restoreDoc(id: string) {
    return documents.callRestoreDoc.call(this, id);
  }
  /** Delete a page in Trash for good. There is no undo. */
  deleteDocForever(id: string) {
    return documents.callDeleteDocForever.call(this, id);
  }

  /** Past states of a document, newest first, without their content. */
  listDocVersions(id: string) {
    return documents.callListDocVersions.call(this, id);
  }
  /** One past state, with its content. */
  getDocVersion(id: string, version: number) {
    return documents.callGetDocVersion.call(this, id, version);
  }
  /**
   * One past state for "Show changes": the version, the one kept before it,
   * and the sittings since (null when too many were kept since), in one read.
   */
  getDocVersionChanges(id: string, version: number) {
    return documents.callGetDocVersionChanges.call(this, id, version);
  }
  /** Put a past state back; it becomes a new version on top. */
  async restoreDocVersion(id: string, version: number) {
    const result = await this.request<Doc>(
      `/docs/${id}/versions/${version}/restore`,
      {
        method: "POST",
        headers: { "x-orbyn-doc-formats": "1,2" },
      },
    );
    return this.docEditorResult(result, id.toLowerCase());
  }

  /**
   * Watch a document for changes made elsewhere. Calls `onChange` with the
   * version the document has reached and who moved it on: another editor's
   * id, "task" when a task tied to one of its lines was finished or reopened
   * somewhere else, or "agenda" when the day's agenda was written again
   * from the calendar. The caller then re-reads it. Returns a function that
   * stops watching.
   *
   * This reads the stream with `fetch` rather than `EventSource`, which
   * cannot carry an Authorization header and would force the token into the
   * URL, where proxies and logs would keep it.
   */
  watchDoc(
    id: string,
    onChange: (version: number, news: DocNews) => void,
    /** Set to also receive CRDT updates as they land (base64, in seq
     * order). `seq` is the reader's watermark: pass it back as `since`
     * when the stream reconnects, so nothing is served twice. */
    onUpdate?: (update: string, seq: number, by: string) => void,
  ): () => void {
    const abort = new AbortController();
    let stopped = false;
    // The reader's watermark in the page's CRDT log: every reconnect asks
    // the server only for what came after this, and every update past it
    // moves it on.
    let lastSeq = 0;
    const run = async () => {
      // Reconnect with a widening gap, so a server that is down is not
      // hammered by every open tab at once.
      let wait = 1_000;
      while (!stopped) {
        try {
          const token = await this.getToken();
          const response = await this.streamFetch(
            `${this.baseUrl}/events/docs/${id}${onUpdate ? `?since=${lastSeq}` : ""}`,
            {
              headers: {
                accept: "text/event-stream",
                "X-Orbyn-Editor": this.editorId,
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              signal: abort.signal,
            },
          );
          // A document that is gone, or that this reader may not see, is not
          // worth coming back to.
          if (response.status === 404 || response.status === 403) return;
          // The gateway's stream limit: wait out its Retry-After rather
          // than treating the address as unhealthy (see watchEvents).
          if (response.status === 429) {
            const header = response.headers.get("Retry-After");
            const seconds = header === null ? NaN : Number(header);
            const delay =
              Number.isFinite(seconds) && seconds >= 0
                ? Math.min(seconds * 1000, 60_000)
                : 5_000;
            await response.body?.cancel();
            if (stopped) return;
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          // No body stream means this runtime cannot read one at all, which
          // retrying will never fix. Give up quietly rather than reconnecting
          // for as long as the page is open — on a phone that is the battery.
          if (!response.ok) throw new Error(`stream ${response.status}`);
          if (!response.body) return;
          wait = 1_000;
          const reader = response.body.getReader();
          const decode = new TextDecoder();
          let buffer = "";
          while (!stopped) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decode.decode(value, { stream: true });
            // Events are separated by a blank line; keep any partial tail.
            const parts = buffer.split("\n\n");
            buffer = parts.pop() ?? "";
            for (const part of parts) {
              const line = part.split("\n").find((l) => l.startsWith("data:"));
              if (!line) continue;
              try {
                const payload = JSON.parse(line.slice(5)) as {
                  version?: number;
                  trashed?: boolean;
                  forgotten?: boolean;
                  tags?: boolean;
                  fields?: boolean;
                  by?: string;
                  // CRDT update rows carry their own shape: the binary
                  // update as base64, its place in the log, and who wrote.
                  update?: string;
                  seq?: number;
                };
                if (payload.update !== undefined && onUpdate) {
                  const seq = typeof payload.seq === "number" ? payload.seq : 0;
                  if (seq > lastSeq) lastSeq = seq;
                  onUpdate(payload.update, seq, payload.by ?? "");
                  continue;
                }
                onChange(payload.version ?? 0, {
                  trashed: payload.trashed === true,
                  forgotten: payload.forgotten === true,
                  tags: payload.tags === true,
                  fields: payload.fields === true,
                  by: typeof payload.by === "string" ? payload.by : "",
                });
              } catch {
                // A half-written event: the next one will bring us up to date.
              }
            }
          }
        } catch {
          if (stopped) return;
        }
        if (stopped) return;
        await new Promise((r) => setTimeout(r, wait));
        wait = Math.min(wait * 2, 30_000);
      }
    };
    void run();
    return () => {
      stopped = true;
      abort.abort();
    };
  }

  /**
   * Push one batch of CRDT updates for a page. The bytes are opaque here:
   * they are Yjs updates the editors on each side make sense of. Sent with
   * the editor id, so a reader can skip its own echo.
   */
  sendDocUpdates(id: string, updates: string[]): Promise<void> {
    return documents.callSendDocUpdates.call(this, id, updates);
  }

  /** The page's CRDT updates past `since`, oldest first, as base64. */
  listDocUpdates(id: string, since: number) {
    return documents.callListDocUpdates.call(this, id, since);
  }

  listLists() {
    return tasks.callListLists.call(this);
  }
  createList(input: ListInput) {
    return tasks.callCreateList.call(this, input);
  }
  updateList(id: string, input: ListUpdate) {
    return tasks.callUpdateList.call(this, id, input);
  }
  deleteList(id: string) {
    return tasks.callDeleteList.call(this, id);
  }
  listTags() {
    return tasks.callListTags.call(this);
  }
  createTag(input: TagInput) {
    return tasks.callCreateTag.call(this, input);
  }
  updateTag(id: string, input: TagUpdate) {
    return tasks.callUpdateTag.call(this, id, input);
  }
  deleteTag(id: string) {
    return tasks.callDeleteTag.call(this, id);
  }

  // ---- calendar, time blocks, planner ----
  /** Everything on the calendar in [from, to): occurrences, blocks, buffers and travel. */
  calendar(from: string, to: string) {
    return planner.callCalendar.call(this, from, to);
  }
  listBlocks(from: string, to: string) {
    return tasks.callListBlocks.call(this, from, to);
  }
  /** Your sessions for one task, past ones too, with its deadline. Makes no plan. */
  itemSessions(itemId: string) {
    return tasks.callItemSessions.call(this, itemId);
  }
  createBlock(input: BlockInput) {
    return planner.callCreateBlock.call(this, input);
  }
  /**
   * A session on a day (a task dropped on a calendar day): the first free
   * working time that day, or a 409 saying there's none.
   */
  createBlockOnDay(input: BlockOnDayInput) {
    return planner.callCreateBlockOnDay.call(this, input);
  }
  updateBlock(id: string, input: BlockUpdate) {
    return tasks.callUpdateBlock.call(this, id, input);
  }
  deleteBlock(id: string, expectedRevision?: number) {
    return planner.callDeleteBlock.call(this, id, expectedRevision);
  }
  /** Sessions that ended in the last few days and wait for "how did it go?". */
  sessionCheckIns() {
    return planner.callSessionCheckIns.call(this);
  }
  /** Say how a session went: done for today, need more, or skip. */
  checkInSession(id: string, input: SessionCheckInInput) {
    return planner.callCheckInSession.call(this, id, input);
  }
  /** Mark a session started (from its reminder, or while it's on). */
  startSession(id: string, from: "app" | "reminder" = "app") {
    return account.callStartSession.call(this, id, from);
  }
  /**
   * Move a block to the next free working time of the same length, one that
   * ends by its task's deadline when there is one. With `before_deadline`,
   * only such a time will do (409 when there's none).
   */
  rescheduleBlock(id: string, input: BlockRescheduleInput = {}) {
    return planner.callRescheduleBlock.call(this, id, input);
  }
  /** Another block for the same task and length, at `start_at` or the next free time after it. */
  duplicateBlock(id: string, input: BlockDuplicateInput = {}) {
    return planner.callDuplicateBlock.call(this, id, input);
  }
  /** Where your set-aside time went over the last `days`. */
  getAnalytics(days = 30) {
    return planner.callGetAnalytics.call(this, days);
  }
  getPlannerPrefs() {
    return planner.callGetPlannerPrefs.call(this);
  }
  updatePlannerPrefs(input: PlannerPrefsInput) {
    return tasks.callUpdatePlannerPrefs.call(this, input);
  }
  /** What the planner has learned about how long your tasks really take. */
  getEstimates() {
    return planner.callGetEstimates.call(this);
  }
  /** Everything the planner has learned from your history. */
  getLearning() {
    return planner.callGetLearning.call(this);
  }
  /** What to do now: the free time until your next event and tasks for it. */
  getUpNext() {
    return planner.callGetUpNext.call(this);
  }
  /**
   * Today, planned and due in one list: events, your sessions, tasks due
   * today and late ones, and unfinished sessions from earlier days. The day
   * is your account's (the planner zone, as the agenda has it); `timezone`
   * (pass the device's) counts only while the account has none of its own.
   */
  today(timezone?: string) {
    return planner.callToday.call(this, timezone);
  }
  /**
   * Your planned time, task by task, with each task's status: some tasks
   * (`item_ids`), or every open task that's yours to plan plus any with a
   * session in the window (`from`, `to`), whose sessions each lists.
   */
  planned(options: { item_ids?: string[]; from?: string; to?: string } = {}) {
    return planner.callPlanned.call(this, options);
  }
  /** Email yourself a digest now, to preview it. */
  sendTestDigest(kind: "morning" | "evening" = "morning") {
    return planner.callSendTestDigest.call(this, kind);
  }
  listFrames() {
    return tasks.callListFrames.call(this);
  }
  createFrame(input: FrameInput) {
    return planner.callCreateFrame.call(this, input);
  }
  updateFrame(id: string, input: FrameUpdate) {
    return tasks.callUpdateFrame.call(this, id, input);
  }
  deleteFrame(id: string) {
    return planner.callDeleteFrame.call(this, id);
  }
  // ---- habits ----
  listHabits() {
    return tasks.callListHabits.call(this);
  }
  createHabit(input: HabitInput) {
    return planner.callCreateHabit.call(this, input);
  }
  updateHabit(id: string, input: HabitUpdate) {
    return tasks.callUpdateHabit.call(this, id, input);
  }
  deleteHabit(id: string) {
    return planner.callDeleteHabit.call(this, id);
  }
  /** Propose sessions for the active habits; nothing is saved. */
  planHabits(input: HabitPlanInput = {}) {
    return planner.callPlanHabits.call(this, input);
  }
  /** Save proposed sessions, skipping any that now clash. */
  applyHabitPlan(
    blocks: { habit_id: string; start_at: string; end_at: string }[],
  ) {
    return planner.callApplyHabitPlan.call(this, blocks);
  }
  /** Record a habit session, or undo it against its current version. */
  getHabitBlock(id: string) {
    return planner.callGetHabitBlock.call(this, id);
  }
  checkInHabitBlock(id: string, input: HabitCheckInInput) {
    return planner.callCheckInHabitBlock.call(this, id, input);
  }
  deleteHabitBlock(id: string, version?: number) {
    return planner.callDeleteHabitBlock.call(this, id, version);
  }
  /** Skip one date ("YYYY-MM-DD") of a frame. */
  skipFrame(id: string, date: string) {
    return planner.callSkipFrame.call(this, id, date);
  }
  /** Bring back a skipped date of a frame. */
  unskipFrame(id: string, date: string) {
    return planner.callUnskipFrame.call(this, id, date);
  }
  listPlaces() {
    return tasks.callListPlaces.call(this);
  }
  createPlace(input: PlaceInput) {
    return planner.callCreatePlace.call(this, input);
  }
  updatePlace(id: string, input: PlaceUpdate) {
    return tasks.callUpdatePlace.call(this, id, input);
  }
  deletePlace(id: string) {
    return planner.callDeletePlace.call(this, id);
  }
  /** A proposed plan; nothing is saved until `applyPlan`. */
  previewPlan(input: PlanPreviewInput = {}) {
    return assistant.callPreviewPlan.call(this, input);
  }
  getPlan(id: string) {
    return planner.callGetPlan.call(this, id);
  }
  /** Tune a plan (tasks in or out, estimates, pinned blocks, keep-free, scope); returns the new plan that replaces it. */
  tunePlan(id: string, input: PlanTuneInput) {
    return planner.callTunePlan.call(this, id, input);
  }
  /** Whether the calendar or tasks changed since the plan was made. */
  planStale(id: string) {
    return planner.callPlanStale.call(this, id);
  }
  /**
   * Save a plan: its new sessions, and the late sessions to move before
   * their deadline (`moves`, block ids; the ones the planner ticked when
   * omitted).
   */
  applyPlan(id: string, input: PlanApplyInput = {}) {
    return planner.callApplyPlan.call(this, id, input);
  }
  /** Unfinished blocks, tasks at risk, and blocks that clash with events. */
  plannerReview() {
    return assistant.callPlannerReview.call(this);
  }
  /** A plan for unfinished work (all of it, or the given blocks). */
  rollForward(blockIds?: string[]) {
    return planner.callRollForward.call(this, blockIds);
  }
  /**
   * Create (or replace) your private calendar subscription link, or with
   * `busy: true` the link that only shows when you're busy.
   */
  createCalendarFeed(options: { busy?: boolean } = {}) {
    return planner.callCreateCalendarFeed.call(this, options);
  }
  deleteCalendarFeed(options: { busy?: boolean } = {}) {
    return planner.callDeleteCalendarFeed.call(this, options);
  }
  /** Which feed links are on, and whether the feed includes time blocks. */
  calendarFeedSettings() {
    return planner.callCalendarFeedSettings.call(this);
  }
  updateCalendarFeedSettings(input: CalendarFeedSettingsInput) {
    return tasks.callUpdateCalendarFeedSettings.call(this, input);
  }

  // ---- calendars from other apps (ICS links) ----
  listCalendarSubscriptions() {
    return tasks.callListCalendarSubscriptions.call(this);
  }
  createCalendarSubscription(input: CalendarSubscriptionInput) {
    return planner.callCreateCalendarSubscription.call(this, input);
  }
  updateCalendarSubscription(id: string, input: CalendarSubscriptionUpdate) {
    return tasks.callUpdateCalendarSubscription.call(this, id, input);
  }
  deleteCalendarSubscription(id: string) {
    return planner.callDeleteCalendarSubscription.call(this, id);
  }
  /** Fetch it now instead of waiting for the hourly refresh. */
  refreshCalendarSubscription(id: string) {
    return planner.callRefreshCalendarSubscription.call(this, id);
  }

  /** Events matching words, a year either side of today unless a range is given. */
  searchCalendar(q: string, range: { from?: string; to?: string } = {}) {
    return search.callSearchCalendar.call(this, q, range);
  }
  /** Busy times of up to 10 people you share a team with (at most 31 days). */
  availability(userIds: string[], from: string, to: string) {
    return booking.callAvailability.call(this, userIds, from, to);
  }

  // ---- invitations (public: the invitee's private link) ----
  getRsvp(token: string) {
    return booking.callGetRsvp.call(this, token);
  }
  answerRsvp(token: string, status: "accepted" | "declined" | "tentative") {
    return booking.callAnswerRsvp.call(this, token, status);
  }

  // ---- team time ----
  teamAvailability(teamId: string, from: string, to: string) {
    return booking.callTeamAvailability.call(this, teamId, from, to);
  }
  teamWorkload(teamId: string, from: string, to: string) {
    return teams.callTeamWorkload.call(this, teamId, from, to);
  }
  /** Team owners' analytics: set-aside time per member, over `days`. */
  teamAnalytics(teamId: string, days = 30) {
    return teams.callTeamAnalytics.call(this, teamId, days);
  }
  suggestMeetingTimes(
    teamId: string,
    params: { from: string; to: string; duration: number; user_ids?: string[] },
  ) {
    return booking.callSuggestMeetingTimes.call(this, teamId, params);
  }

  // ---- booking pages ----
  listBookingPages() {
    return booking.callListBookingPages.call(this);
  }
  createBookingPage(input: BookingPageInput) {
    return booking.callCreateBookingPage.call(this, input);
  }
  updateBookingPage(id: string, input: BookingPageUpdate) {
    return booking.callUpdateBookingPage.call(this, id, input);
  }
  deleteBookingPage(id: string) {
    return booking.callDeleteBookingPage.call(this, id);
  }
  /** One page's upcoming and recent bookings (older apps; prefer `bookings`). */
  listBookings(pageId: string) {
    return booking.callListBookings.call(this, pageId);
  }
  cancelBooking(pageId: string, bookingId: string) {
    return booking.callCancelBooking.call(this, pageId, bookingId);
  }

  // ---- tracking bookings ----
  private bookingsQuery(params: {
    view?: BookingView;
    page_id?: string;
    q?: string;
    limit?: number;
    offset?: number;
  }) {
    const q = new URLSearchParams();
    if (params.view) q.set("view", params.view);
    if (params.page_id) q.set("page_id", params.page_id);
    if (params.q) q.set("q", params.q);
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    if (params.offset !== undefined) q.set("offset", String(params.offset));
    return q.size ? `?${q}` : "";
  }
  /** Bookings across the pages you own or host. */
  bookings(
    params: {
      view?: BookingView;
      page_id?: string;
      q?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    return this.request<Page<Booking>>(
      `/bookings${this.bookingsQuery(params)}`,
    );
  }
  bookingStats(pageId?: string) {
    return booking.callBookingStats.call(this, pageId);
  }
  /** The same bookings as CSV text, for spreadsheets. */
  exportBookingsCsv(
    params: { view?: BookingView; page_id?: string; q?: string } = {},
  ) {
    return this.request<string>(
      `/bookings/export.csv${this.bookingsQuery(params)}`,
      { raw: true },
    );
  }
  /** Free times a host can move a booking to (ignores its own time and notice). */
  getBookingSlots(
    id: string,
    params: { date?: string; days?: number; timezone: string },
  ) {
    return booking.callGetBookingSlots.call(this, id, params);
  }
  getBooking(id: string) {
    return booking.callGetBooking.call(this, id);
  }
  approveBooking(id: string) {
    return booking.callApproveBooking.call(this, id);
  }
  declineBooking(id: string, reason = "") {
    return booking.callDeclineBooking.call(this, id, reason);
  }
  /** Cancel as a host; the booker is emailed with your reason. */
  cancelBookingAsHost(id: string, reason = "") {
    return booking.callCancelBookingAsHost.call(this, id, reason);
  }
  rescheduleBooking(id: string, startAt: string) {
    return booking.callRescheduleBooking.call(this, id, startAt);
  }
  setBookingNoShow(id: string, noShow: boolean) {
    return booking.callSetBookingNoShow.call(this, id, noShow);
  }
  setBookingNote(id: string, hostNote: string) {
    return booking.callSetBookingNote.call(this, id, hostNote);
  }
  /** Public: a booking from the booker's manage link. */
  getManagedBooking(token: string) {
    return booking.callGetManagedBooking.call(this, token);
  }
  /** Public: free times to move a booking to. */
  getRescheduleSlots(
    token: string,
    params: { date?: string; days?: number; timezone: string },
  ) {
    return booking.callGetRescheduleSlots.call(this, token, params);
  }
  /** Public: move a booking from its manage link. */
  rescheduleByToken(token: string, startAt: string) {
    return booking.callRescheduleByToken.call(this, token, startAt);
  }
  /** Public: cancel from the manage link. */
  cancelByManageToken(token: string, reason = "") {
    return booking.callCancelByManageToken.call(this, token, reason);
  }
  /** Public: a booking page and its free times (no sign-in). Without a
   * `duration`, the page's first length is shown. */
  getPublicBookingPage(
    slug: string,
    params: {
      duration?: number;
      date?: string;
      days?: number;
      timezone: string;
    },
  ) {
    return booking.callGetPublicBookingPage.call(this, slug, params);
  }
  /** Public: ask for a time on a booking page. */
  book(slug: string, input: BookingRequest) {
    return booking.callBook.call(this, slug, input);
  }
  /** Public: the link from the confirmation email. */
  confirmBooking(token: string) {
    return booking.callConfirmBooking.call(this, token);
  }
  /** Public: the cancel link from a booking email. */
  cancelBookingByToken(token: string) {
    return booking.callCancelBookingByToken.call(this, token);
  }

  // ---- open invites ----
  listOpenInvites() {
    return booking.callListOpenInvites.call(this);
  }
  /** A one-off link offering hand-picked windows; its `url` is the link to send. */
  createOpenInvite(input: OpenInviteInput) {
    return booking.callCreateOpenInvite.call(this, input);
  }
  getOpenInvite(id: string) {
    return booking.callGetOpenInvite.call(this, id);
  }
  /** Withdraw an invite (a booking made from it is cancelled). */
  cancelOpenInvite(id: string) {
    return booking.callCancelOpenInvite.call(this, id);
  }
  /** Public: an open invite and its free times, from its link. */
  getPublicInvite(token: string, timezone: string) {
    return booking.callGetPublicInvite.call(this, token, timezone);
  }
  /** Public: pick a time from an open invite (booked at once). */
  bookInvite(token: string, input: InviteBookingRequest) {
    return booking.callBookInvite.call(this, token, input);
  }

  // ---- profile page ----
  getProfile() {
    return account.callGetProfile.call(this);
  }
  /** `handle: null` removes your page. */
  updateProfile(input: ProfileInput) {
    return tasks.callUpdateProfile.call(this, input);
  }
  /** Public: someone's profile page and their booking pages. */
  getPublicProfile(handle: string) {
    return account.callGetPublicProfile.call(this, handle);
  }

  // ---- API keys and webhooks ----
  /** Public: the OpenAPI description of the API, as YAML. */
  openApiSpec() {
    return connections.callOpenApiSpec.call(this);
  }
  listApiKeys() {
    return tasks.callListApiKeys.call(this);
  }
  /** The returned `key` is shown once. */
  createApiKey(name: string) {
    return account.callCreateApiKey.call(this, name);
  }
  deleteApiKey(id: string) {
    return account.callDeleteApiKey.call(this, id);
  }
  // ---- Connected agents (MCP) ----
  /** Your connected agents, the MCP address, and until when old keys work there. */
  agents() {
    return assistant.callAgents.call(this);
  }
  /** The MCP server's public description, for the developer page. */
  developerCatalog() {
    return connections.callDeveloperCatalog.call(this);
  }
  /** Review explicit managed AI consent for an owned plugin connection. */
  async pluginAiPermission(id: string, signal?: AbortSignal) {
    return connections.callPluginAiPermission.call(this, id, signal);
  }
  /** Only the signed-in owner can enable or revoke provider-bound plugin AI. */
  async setPluginAiPermission(
    id: string,
    input: PluginAiPermissionInput,
    signal?: AbortSignal,
  ) {
    return connections.callSetPluginAiPermission.call(this, id, input, signal);
  }
  /** A connection's toolsets besides core (Settings → Connected agents). */
  setAgentToolsets(id: string, toolsets: AgentToolset[]) {
    return assistant.callSetAgentToolsets.call(this, id, toolsets);
  }
  /**
   * A connection's trust: full power, ask first or suggest only, per space,
   * and which ask-first items it may do alone (Settings → Connected agents).
   */
  setAgentTrust(id: string, input: AgentTrustInput) {
    return assistant.callSetAgentTrust.call(this, id, input);
  }
  /** What a connection is sent, its wake-up address and unread count (H0). */
  agentInbox(id: string) {
    return connections.callAgentInbox.call(this, id);
  }
  /** The kinds a connection is not sent ("Send to this agent" off). */
  setAgentInboxMutes(id: string, muted: AgentInboxKind[]) {
    return connections.callSetAgentInboxMutes.call(this, id, muted);
  }
  /** Sets the wake-up address; the signing secret comes back once. */
  setAgentWake(id: string, url: string) {
    return assistant.callSetAgentWake.call(this, id, url);
  }
  clearAgentWake(id: string) {
    return assistant.callClearAgentWake.call(this, id);
  }
  /** Calls the wake-up address now and says what it answered. */
  testAgentWake(id: string) {
    return assistant.callTestAgentWake.call(this, id);
  }
  /** The person's standing rules for their agents. */
  agentRules() {
    return assistant.callAgentRules.call(this);
  }
  addAgentRule(input: AgentRuleInput) {
    return assistant.callAddAgentRule.call(this, input);
  }
  updateAgentRule(id: string, input: AgentRuleInput) {
    return assistant.callUpdateAgentRule.call(this, id, input);
  }
  deleteAgentRule(id: string) {
    return assistant.callDeleteAgentRule.call(this, id);
  }
  /** "About me for agents" and each space's instructions (H8). */
  agentContext() {
    return connections.callAgentContext.call(this);
  }
  /** Fresh, account-bound identity for one independent automation runtime. */
  async automationAgentIdentity(lane: AutomationAgentLane) {
    return assistant.callAutomationAgentIdentity.call(this, lane);
  }
  async updateAutomationAgentIdentity(
    lane: AutomationAgentLane,
    input: AutomationAgentIdentityInput,
  ) {
    const token = await this.getToken();
    const saved = await this.request<AutomationAgentIdentity>(
      `/me/assistant/identity/${lane}`,
      { method: "PUT", body: input },
    );
    const checked = automationAgentIdentity.parse(saved);
    if (checked.lane !== lane)
      throw new Error("Agent identity belongs to another runtime.");
    if (token === (await this.getToken())) {
      for (const listener of this.automationIdentityListeners)
        listener(structuredClone(checked));
    }
    return checked;
  }
  agentSettings(options?: Pick<RequestOptions, "fresh">) {
    return assistant.callAgentSettings.call(this, options);
  }
  /** Keep mounted assistant surfaces current after a settings save in this client. */
  onAgentSettings(listener: (settings: PersonalAgentSettings) => void) {
    this.agentSettingsListeners.add(listener);
    return () => {
      this.agentSettingsListeners.delete(listener);
    };
  }
  async assistantWorkControls() {
    return assistant.callAssistantWorkControls.call(this);
  }
  async updateAssistantWorkControls(
    input: Partial<import("@orbyn/core").AssistantWorkControls>,
  ) {
    return assistant.callUpdateAssistantWorkControls.call(this, input);
  }
  /** The person's optional night window and morning review preference. */
  nightShiftSettings() {
    return account.callNightShiftSettings.call(this);
  }
  updateNightShiftSettings(input: NightShiftSettings) {
    return tasks.callUpdateNightShiftSettings.call(this, input);
  }
  async updateAgentSettings(input: AgentIdentityInput) {
    const token = await this.getToken();
    const saved = await this.request<PersonalAgentSettings>("/me/agent", {
      method: "PUT",
      body: input,
    });
    if (token === (await this.getToken())) {
      for (const listener of this.agentSettingsListeners)
        listener(structuredClone(saved));
    }
    return saved;
  }
  /** Opens the About me page, making it first when there isn't one. */
  openAgentProfile() {
    return assistant.callOpenAgentProfile.call(this);
  }
  /** Changes a space's instructions for agents (null: Personal). */
  setAgentInstructions(teamId: string | null, text: string) {
    return assistant.callSetAgentInstructions.call(this, teamId, text);
  }
  /** Questions agents asked, waiting for an answer. */
  agentQuestions() {
    return assistant.callAgentQuestions.call(this);
  }
  /** Answers an agent's question (its card, or the push's buttons). */
  answerAgentQuestion(id: string, answer: string, via: "app" | "push" = "app") {
    return assistant.callAnswerAgentQuestion.call(this, id, answer, via);
  }
  /** A new agent key; the returned `key` is shown once. */
  createAgentKey(input: AgentKeyInput) {
    return assistant.callCreateAgentKey.call(this, input);
  }
  /** Revoke a connection (an agent key, or an old key's MCP access). */
  revokeAgent(id: string) {
    return assistant.callRevokeAgent.call(this, id);
  }
  /** Restore a connection Orbyn paused for misbehaving. */
  restoreAgent(id: string) {
    return assistant.callRestoreAgent.call(this, id);
  }
  /** What one connection did, newest first. */
  agentActivity(id: string) {
    return assistant.callAgentActivity.call(this, id);
  }
  /** Undo one change an agent made directly (from its activity). */
  undoAgentChange(activityId: string) {
    return assistant.callUndoAgentChange.call(this, activityId);
  }
  /** Undo a whole job of one agent (a plan, or one call's changes). */
  undoAgentJob(grantId: string, job: string) {
    return assistant.callUndoAgentJob.call(this, grantId, job);
  }
  /**
   * What one assistant reply changed: the built-in assistant's activity for
   * `job` (a reply's `assistant_run.plan_job`), newest first.
   */
  async assistantJobChanges(job: string) {
    return assistant.callAssistantJobChanges.call(this, job);
  }
  /** Current authorized work evidence, independent of device presence. */
  async assistantProfiles(signal?: AbortSignal) {
    return assistant.callAssistantProfiles.call(this, signal);
  }
  /** Owner-visible restrictions; saving requires the revision just read. */
  async assistantRules() {
    return assistant.callAssistantRules.call(this);
  }
  async replaceAssistantRules(
    expectedRevision: number,
    rules: AssistantActionRule[],
  ) {
    return assistant.callReplaceAssistantRules.call(
      this,
      expectedRevision,
      rules,
    );
  }
  /** Durable per-agent work estimates and start limits. */
  async assistantBudgets() {
    return assistant.callAssistantBudgets.call(this);
  }
  async replaceAssistantBudget(
    lane: "background" | "overnight",
    value: Pick<
      AssistantBudgetView,
      | "revision"
      | "daily_token_limit"
      | "hourly_start_limit"
      | "per_run_token_limit"
    >,
  ) {
    return assistant.callReplaceAssistantBudget.call(this, lane, value);
  }
  async requestAssistantHandoff(value: {
    producer_job_id: string;
    expected_producer_revision: string;
    recipient_lane: AssistantHandoffLane;
    title: string;
    instruction: string;
  }) {
    return assistant.callRequestAssistantHandoff.call(this, value);
  }
  async assistantHandoffSource(jobId: string) {
    return assistant.callAssistantHandoffSource.call(this, jobId);
  }
  async assistantHandoff(id: string) {
    return assistant.callAssistantHandoff.call(this, id);
  }
  // ---- The Review inbox ----
  async assistantConversation(signal?: AbortSignal) {
    return assistant.callAssistantConversation.call(this, signal);
  }
  async assistantConversationDeliveryPreferences() {
    return assistant.callAssistantConversationDeliveryPreferences.call(this);
  }
  async setAssistantConversationMuted(muted: boolean) {
    return assistant.callSetAssistantConversationMuted.call(this, muted);
  }
  async openAssistantConversation(signal?: AbortSignal) {
    return assistant.callOpenAssistantConversation.call(this, signal);
  }
  async assistantConversationFeed(
    destinationId: string,
    after = "0",
    limit = 50,
    signal?: AbortSignal,
    through?: string,
  ) {
    return assistant.callAssistantConversationFeed.call(
      this,
      destinationId,
      after,
      limit,
      signal,
      through,
    );
  }
  async assistantConversationForChat(chatId: string, signal?: AbortSignal) {
    return assistant.callAssistantConversationForChat.call(
      this,
      chatId,
      signal,
    );
  }
  async assistantSavedHistory(
    destinationId: string,
    chatId: string,
    before?: number,
    version?: string,
    limit = 25,
  ) {
    return assistant.callAssistantSavedHistory.call(
      this,
      destinationId,
      chatId,
      before,
      version,
      limit,
    );
  }
  async assistantConversationDetails(
    destinationId: string,
    entryId: string,
    signal?: AbortSignal,
  ) {
    return assistant.callAssistantConversationDetails.call(
      this,
      destinationId,
      entryId,
      signal,
    );
  }
  async assistantConversationEntry(
    destinationId: string,
    entryId: string,
    signal?: AbortSignal,
  ) {
    return assistant.callAssistantConversationEntry.call(
      this,
      destinationId,
      entryId,
      signal,
    );
  }
  async answerAssistantConversationQuestion(
    destinationId: string,
    entryId: string,
    answer: string,
    turnId: string,
  ) {
    return assistant.callAnswerAssistantConversationQuestion.call(
      this,
      destinationId,
      entryId,
      answer,
      turnId,
    );
  }
  async acknowledgeAssistantConversation(
    destinationId: string,
    through: string,
  ) {
    return assistant.callAcknowledgeAssistantConversation.call(
      this,
      destinationId,
      through,
    );
  }
  /** Recover authorized execution activity with an owner/lane-scoped cursor. */
  async assistantActivity(
    lane: AssistantActivityLane,
    after = "0",
    limit = 50,
  ) {
    return assistant.callAssistantActivity.call(this, lane, after, limit);
  }
  /** What waits for approval, and what was decided lately. */
  reviewInbox() {
    return assistant.callReviewInbox.call(this);
  }
  /** Latest night with its current Review and Undo states. */
  latestAssistantNight(id?: string) {
    return assistant.callLatestAssistantNight.call(this, id);
  }
  /** The person's channels and local quiet window for templated reminders. */
  reminderNudgeSettings() {
    return assistant.callReminderNudgeSettings.call(this);
  }
  /** Stop future templated reminders for this card's source. */
  stopReminderNudge(id: string) {
    return assistant.callStopReminderNudge.call(this, id);
  }
  updateReminderNudgeSettings(input: ReminderNudgeSettings) {
    return assistant.callUpdateReminderNudgeSettings.call(this, input);
  }
  /** Keep a finished run, applying all or selected held changes. */
  keepAssistantNightRun(
    id: string,
    input: { only?: number[]; steps?: string[] } = {},
  ) {
    return assistant.callKeepAssistantNightRun.call(this, id, input);
  }
  /** Undo a run or selected changes from it; held work is declined. */
  undoAssistantNightRun(id: string, changes?: string[]) {
    return assistant.callUndoAssistantNightRun.call(this, id, changes);
  }
  /** Review a whole night in one transaction after the person's confirmation. */
  reviewAssistantNight(
    id: string,
    action: "keep" | "undo",
    runs: { id: string; token: string }[],
  ) {
    return assistant.callReviewAssistantNight.call(this, id, action, runs);
  }
  /** How many proposals wait, for the badge. */
  reviewCount() {
    return assistant.callReviewCount.call(this);
  }
  /** One proposal, each change checked against what is there now. */
  reviewItem(id: string) {
    return assistant.callReviewItem.call(this, id);
  }
  /** Approve a proposal (all of it, or `only` some of its changes). */
  approveReview(id: string, input: ReviewApproveInput = {}) {
    return assistant.callApproveReview.call(this, id, input);
  }
  /** Decline a proposal: nothing changes. */
  declineReview(id: string) {
    return assistant.callDeclineReview.call(this, id);
  }
  /**
   * Approve or Decline from a notification's button: says how it ended,
   * even when it was already decided.
   */
  respondToReview(id: string, decision: "approve" | "decline") {
    return assistant.callRespondToReview.call(this, id, decision);
  }
  /** Team settings → Outside agents: the policy, and (managers) who connects. */
  teamAgents(teamId: string) {
    return assistant.callTeamAgents.call(this, teamId);
  }
  // ---- Signing in with Orbyn (the consent page) ----
  /** What an app's sign-in request asks for; with your spaces when signed in. */
  oauthCheck(request: OAuthRequest) {
    return connections.callOauthCheck.call(this, request);
  }
  /** Allow the request: where to send the browser back, with a code. */
  oauthAllow(input: OAuthConsentInput) {
    return connections.callOauthAllow.call(this, input);
  }
  /** Decline the request: where to send the browser back, with an error. */
  oauthDeny(request: OAuthRequest) {
    return connections.callOauthDeny.call(this, request);
  }
  /** Passkey options for confirming it's you (without a new session). */
  reauthOptions() {
    return account.callReauthOptions.call(this);
  }
  /** Confirm it's you: password (and two-step code) or a passkey. */
  reauth(input: ReauthInput) {
    return account.callReauth.call(this, input);
  }
  /** A team's cap on outside agents (owners and admins). */
  setTeamAgentAccess(teamId: string, agent_access: TeamAgentAccess) {
    return assistant.callSetTeamAgentAccess.call(this, teamId, agent_access);
  }
  listWebhooks() {
    return tasks.callListWebhooks.call(this);
  }
  /** The returned `secret` signs deliveries and is shown once. */
  createWebhook(input: WebhookInput) {
    return account.callCreateWebhook.call(this, input);
  }
  updateWebhook(id: string, input: WebhookUpdate) {
    return tasks.callUpdateWebhook.call(this, id, input);
  }
  deleteWebhook(id: string) {
    return account.callDeleteWebhook.call(this, id);
  }
  testWebhook(id: string) {
    return account.callTestWebhook.call(this, id);
  }
  /** Follows pagination until the planner is fully loaded. */
  async listAllItems(pageSize = 500) {
    return tasks.callListAllItems.call(this, pageSize);
  }
  /** Create an item; `id` names it on the device (made offline). */
  createItem(input: Partial<ItemInput> & { title: string; id?: string }) {
    return tasks.callCreateItem.call(this, input);
  }
  /**
   * Create an item from one line of text ("Lunch with @anna tomorrow 1pm
   * ;Cafe Roma"), parsed on the server without AI.
   */
  /** A shared link's title and site, looked up on the server for the share sheet. */
  linkPreview(url: string) {
    return assistant.callLinkPreview.call(this, url);
  }
  /**
   * Put a link or some text shared into Orbyn where it was sent: an Inbox
   * task, today's agenda, a page, a new page in a folder, or a project.
   */
  capture(input: CaptureRequest) {
    return capture.callCapture.call(this, input);
  }
  quickAdd(text: string, timezone?: string) {
    return tasks.callQuickAdd.call(this, text, timezone);
  }
  /** What quick add would make of the text, with its chips. Nothing is saved. */
  previewQuickAdd(text: string, timezone?: string) {
    return assistant.callPreviewQuickAdd.call(this, text, timezone);
  }
  /**
   * Save an item. For one occurrence of a repeating item pass `scope: "this"`
   * (or `"following"` for it and every later one) and the `occurrence`.
   */
  updateItem(
    id: string,
    input: ItemInput & { version: number },
    options: { scope?: EditScope; occurrence?: string } = {},
  ) {
    return tasks.callUpdateItem.call(this, id, input, options);
  }
  deleteItem(
    id: string,
    version: number,
    options: {
      scope?: EditScope;
      occurrence?: string;
      expectedBlocks?: { id: string; revision: number }[];
    } = {},
  ) {
    return tasks.callDeleteItem.call(this, id, version, options);
  }

  /**
   * Hand a task to your own agent (W3): it works on it in the background
   * and gives it back with a note. At most five at once.
   */
  handTaskToAgent(id: string, when: "now" | "tonight" = "now") {
    return assistant.callHandTaskToAgent.call(this, id, when);
  }
  /** Take a task back from your agent; a run working on it stops. */
  takeTaskBack(id: string) {
    return tasks.callTakeTaskBack.call(this, id);
  }
  /** Connected agents that made or changed tasks lately, for the board's lanes. */
  agentWork() {
    return assistant.callAgentWork.call(this);
  }

  /** A task with its checklist steps and progress timeline. */
  getItem(id: string) {
    return tasks.callGetItem.call(this, id);
  }
  addStep(itemId: string, input: { title: string }) {
    return tasks.callAddStep.call(this, itemId, input);
  }
  updateStep(
    itemId: string,
    stepId: string,
    input: { title?: string; done?: boolean },
  ) {
    return tasks.callUpdateStep.call(this, itemId, stepId, input);
  }
  deleteStep(itemId: string, stepId: string) {
    return tasks.callDeleteStep.call(this, itemId, stepId);
  }
  /** Post a progress note, optionally changing status or progress. */
  postItemUpdate(
    itemId: string,
    input: { body?: string; status?: Status; progress?: number },
  ) {
    return tasks.callPostItemUpdate.call(this, itemId, input);
  }

  // ---- devices (mobile push) ----
  registerDevice(token: string) {
    return administration.callRegisterDevice.call(this, token);
  }
  removeDevice(token: string) {
    return administration.callRemoveDevice.call(this, token);
  }

  // ---- notifications ----
  listNotifications() {
    return notifications.callListNotifications.call(this);
  }
  markNotificationRead(id: string) {
    return notifications.callMarkNotificationRead.call(this, id);
  }

  // ---- AI assistant ----
  /** Whether the configured assistant can read with tools and draft pages. */
  aiCapabilities() {
    return assistant.callAiCapabilities.call(this);
  }
  /** Draft a project (subtasks) from a prompt, as a proposal to review. */
  draftProject(
    prompt: string,
    timezone: string,
    teamId?: string | null,
    details?: { summary?: string; deadline?: string | null },
  ) {
    return assistant.callDraftProject.call(
      this,
      prompt,
      timezone,
      teamId,
      details,
    );
  }
  /**
   * Ask the assistant. Pass earlier turns in `history` for follow-up questions.
   * The turn runs on the server while this polls for the answer, so a slow
   * model (one on the user's own machine) is never cut off by a proxy's
   * limit on a single request, and a dropped poll is simply tried again.
   */
  async chat(
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
    return assistant.callChat.call(
      this,
      message,
      timezone,
      history,
      scope,
      ids,
      onProgress,
      signal,
    );
  }

  /** Attach to an existing server run without starting another turn. */
  async pollAssistantRun(
    id: string,
    ids: { chatId: string; turnId: string },
    onProgress?: (progress: AssistantRunProgress) => void,
    signal?: AbortSignal,
  ) {
    return assistant.callPollAssistantRun.call(
      this,
      id,
      ids,
      onProgress,
      signal,
    );
  }
  answerAssistantRun(id: string, answer: string, waitingId: string) {
    return assistant.callAnswerAssistantRun.call(this, id, answer, waitingId);
  }
  approveAssistantRun(
    id: string,
    approved: boolean,
    waitingId: string,
    scope: "once" | "goal" | "routine" | "always" = "once",
  ) {
    return assistant.callApproveAssistantRun.call(
      this,
      id,
      approved,
      waitingId,
      scope,
    );
  }
  stopAssistantRun(id: string) {
    return assistant.callStopAssistantRun.call(this, id);
  }
  applyProposal(id: string, options?: { give_tasks_deadlines?: boolean }) {
    return assistant.callApplyProposal.call(this, id, options);
  }

  // ---- teams ----
  listTeams() {
    return teams.callListTeams.call(this);
  }
  createTeam(input: { name: string }) {
    return teams.callCreateTeam.call(this, input);
  }
  getTeam(id: string) {
    return teams.callGetTeam.call(this, id);
  }
  updateTeam(id: string, input: { name: string }) {
    return teams.callUpdateTeam.call(this, id, input);
  }
  deleteTeam(id: string) {
    return teams.callDeleteTeam.call(this, id);
  }
  addTeamMember(teamId: string, input: { email: string; role?: TeamRole }) {
    return teams.callAddTeamMember.call(this, teamId, input);
  }
  updateTeamMember(teamId: string, userId: string, input: { role: TeamRole }) {
    return teams.callUpdateTeamMember.call(this, teamId, userId, input);
  }
  /** Remove a member, or leave the team when `userId` is your own id. */
  removeTeamMember(teamId: string, userId: string) {
    return teams.callRemoveTeamMember.call(this, teamId, userId);
  }

  // ---- admin (system admins only) ----
  adminOverview() {
    return views.callAdminOverview.call(this);
  }
  /** How each service is answering over the last `hours`. */
  adminRequestSummary(hours = 24) {
    return administration.callAdminRequestSummary.call(this, hours);
  }
  /** The request log, newest first; `before` pages back. */
  adminRequests(
    filters: {
      service?: string;
      status?: "2xx" | "3xx" | "4xx" | "5xx";
      route?: string;
      user?: string;
      request_id?: string;
      slow?: boolean;
      before?: number;
      limit?: number;
    } = {},
  ) {
    return administration.callAdminRequests.call(this, filters);
  }
  adminAnalytics(days = 30) {
    return administration.callAdminAnalytics.call(this, days);
  }
  adminUserDetail(id: string) {
    return administration.callAdminUserDetail.call(this, id);
  }
  adminUpdateUserProfile(id: string, input: { name?: string; email?: string }) {
    return tasks.callAdminUpdateUserProfile.call(this, id, input);
  }
  /** Sign someone out on every device. */
  adminSignOutUser(id: string) {
    return administration.callAdminSignOutUser.call(this, id);
  }
  adminEndSession(id: string, sessionId: string) {
    return administration.callAdminEndSession.call(this, id, sessionId);
  }
  /** Revoke one of an account's personal API keys (recorded in the audit log). */
  adminRevokeApiKey(id: string, keyId: string) {
    return administration.callAdminRevokeApiKey.call(this, id, keyId);
  }
  /** Admin: the apps that have signed in with Orbyn. */
  adminAgentClients() {
    return assistant.callAdminAgentClients.call(this);
  }
  /** Admin: agent use by app over the last `days`. */
  adminAgentUsage(days = 30) {
    return assistant.callAdminAgentUsage.call(this, days);
  }
  /** Admin: end one of an account's agent connections. */
  adminRevokeUserAgent(id: string, grantId: string) {
    return assistant.callAdminRevokeUserAgent.call(this, id, grantId);
  }
  /** Admin: the switches and limits for outside agents. */
  adminAgentSettings() {
    return assistant.callAdminAgentSettings.call(this);
  }
  adminUpdateAgentSettings(input: AgentSettingsUpdate) {
    return assistant.callAdminUpdateAgentSettings.call(this, input);
  }
  /** A one-hour password reset link to pass on (also emailed when mail is set up). */
  adminResetLink(id: string) {
    return administration.callAdminResetLink.call(this, id);
  }
  adminResetTwoFactor(id: string) {
    return administration.callAdminResetTwoFactor.call(this, id);
  }
  adminExportUser(id: string) {
    return administration.callAdminExportUser.call(this, id);
  }
  // ---- study ----
  /** Cards due, pages with cards, exams, streak and weak spots. */
  study() {
    return study.callStudy.call(this);
  }
  /** Cards to review now (due, then today's new ones); one page with `docId`. */
  studyQueue(
    options: { docId?: string; limit?: number; ahead?: boolean } = {},
  ) {
    return study.callStudyQueue.call(this, options);
  }
  reviewCard(cardId: string, rating: Rating) {
    return assistant.callReviewCard.call(this, cardId, rating);
  }
  /** Which pages you're revising for an exam. */
  setExamDecks(input: {
    key: string;
    title: string;
    starts_at: string;
    doc_ids: string[];
  }) {
    return study.callSetExamDecks.call(this, input);
  }
  /** Revision sessions before an exam, proposed into free time (nothing saved). */
  planRevision(input: { key: string; minutes?: number; timezone: string }) {
    return planner.callPlanRevision.call(this, input);
  }
  /** Apply the approved sessions: a "Revise for …" task with them set aside. */
  applyRevision(input: {
    key: string;
    sessions: { start_at: string; end_at: string }[];
  }) {
    return assistant.callApplyRevision.call(this, input);
  }
  /** The assistant's suggested cards from a page — a proposal to tick. */
  suggestCards(docId: string, max?: number) {
    return study.callSuggestCards.call(this, docId, max);
  }
  /** Grade a typed answer against the card and its page. */
  gradeAnswer(cardId: string, answer: string) {
    return study.callGradeAnswer.call(this, cardId, answer);
  }
  explainCard(cardId: string) {
    return study.callExplainCard.call(this, cardId);
  }
  // ---- importing files into Docs ----
  /**
   * Start importing a file: the import, and where to upload the file (a
   * path on this API's base URL, good for ten minutes and one upload).
   */
  createImport(input: ImportCreateInput) {
    return workspace.callCreateImport.call(this, input);
  }
  /**
   * Send the file itself to the upload link from `createImport`. The file
   * goes to the file store, which queues it for the converter.
   */
  async uploadImportFile(
    uploadPath: string,
    file: Blob | ArrayBuffer | Uint8Array,
    contentType: string,
  ): Promise<void> {
    const response = await this.fetchImpl(this.baseUrl + uploadPath, {
      method: "PUT",
      headers: { "Content-Type": contentType || "application/octet-stream" },
      body: file as BodyInit,
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!response.ok) {
      const problem = await response
        .json()
        .then((body: { message?: string }) => body.message)
        .catch(() => "");
      throw new HttpError(
        response.status,
        problem || "The file couldn't be uploaded. Please try again.",
      );
    }
  }
  /** Your imports: everything still going, and the last week's. */
  listImports() {
    return documents.callListImports.call(this);
  }
  getImport(id: string) {
    return documents.callGetImport.call(this, id);
  }
  /** What this server can read (scans, photos, equations), before an upload. */
  importCapabilities() {
    return documents.callImportCapabilities.call(this);
  }
  /** Admin → Storage: the database, the file store, the import queue. */
  adminStorage() {
    return administration.callAdminStorage.call(this);
  }
  /** Delete a stored upload now; its import is cancelled (audited). */
  adminDeleteStoredFile(importId: string) {
    return administration.callAdminDeleteStoredFile.call(this, importId);
  }
  /** Run the file store's sweep now (audited). */
  adminSweepStorage() {
    return administration.callAdminSweepStorage.call(this);
  }
  /** Cancel an import still going, or clear a finished one from the list. */
  removeImport(id: string) {
    return documents.callRemoveImport.call(this, id);
  }
  // ---- terms, privacy and consent ----
  /** Who runs the service and the current Terms and Privacy versions. */
  legal() {
    return workspace.callLegal.call(this);
  }
  legalDocument(doc: LegalDoc) {
    return documents.callLegalDocument.call(this, doc);
  }
  /** Accept the Terms and Privacy Policy at this version. */
  acceptTerms(termsVersion: string) {
    return account.callAcceptTerms.call(this, termsVersion);
  }
  privacy() {
    return account.callPrivacy.call(this);
  }
  setPrivacy(input: { analytics_opt_out: boolean }) {
    return account.callSetPrivacy.call(this, input);
  }
  /** Delete your own account for good. */
  deleteAccount(input: { password?: string; confirm_email?: string }) {
    return account.callDeleteAccount.call(this, input);
  }
  adminLegal() {
    return administration.callAdminLegal.call(this);
  }
  updateLegal(input: LegalSettingsUpdate) {
    return tasks.callUpdateLegal.call(this, input);
  }
  /** The notice everyone sees, or null. */
  announcement() {
    return workspace.callAnnouncement.call(this);
  }
  setAnnouncement(input: {
    message: string;
    tone?: "info" | "warning";
    until?: string | null;
  }) {
    return administration.callSetAnnouncement.call(this, input);
  }
  /** What the sweeper keeps, for how long, and when it last ran. */
  adminSweep() {
    return administration.callAdminSweep.call(this);
  }
  /** Days to keep, per kind of record; 0 keeps forever. */
  setRetention(days: Record<string, number>) {
    return administration.callSetRetention.call(this, days);
  }
  runSweep() {
    return administration.callRunSweep.call(this);
  }
  adminDatabaseTables() {
    return administration.callAdminDatabaseTables.call(this);
  }
  adminDatabaseTable(name: string) {
    return administration.callAdminDatabaseTable.call(this, name);
  }
  adminDatabaseRows(name: string, offset = 0) {
    return administration.callAdminDatabaseRows.call(this, name, offset);
  }
  adminListUsers(
    params: { search?: string; limit?: number; offset?: number } = {},
  ) {
    return tasks.callAdminListUsers.call(this, params);
  }
  adminUpdateUser(
    id: string,
    input: { role?: SystemRole; disabled?: boolean; email_verified?: boolean },
  ) {
    return tasks.callAdminUpdateUser.call(this, id, input);
  }
  adminDeleteUser(id: string) {
    return administration.callAdminDeleteUser.call(this, id);
  }
  adminListTeams() {
    return teams.callAdminListTeams.call(this);
  }
  // ---- AI providers (system admins) ----
  listAiProviders() {
    return assistant.callListAiProviders.call(this);
  }
  createAiProvider(input: {
    kind: AiProviderKind;
    name: string;
    base_url?: string;
    api_key?: string;
    options?: AiProviderOptions;
    enabled?: boolean;
  }) {
    return assistant.callCreateAiProvider.call(this, input);
  }
  /** Omit `api_key` to keep the saved key; send "" to remove it. */
  updateAiProvider(
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
    return assistant.callUpdateAiProvider.call(this, id, input);
  }
  deleteAiProvider(id: string) {
    return assistant.callDeleteAiProvider.call(this, id);
  }
  /** Lists models using the provider's saved key. */
  listAiModels(id: string, expectedRevision?: string) {
    return assistant.callListAiModels.call(this, id, expectedRevision);
  }
  /** Loads candidates for the independent embedding connection, without sending pages. */
  listAiEmbeddingModels(id: string, expectedRevision: string) {
    return assistant.callListAiEmbeddingModels.call(this, id, expectedRevision);
  }
  testAiProvider(id: string, model?: string, expectedRevision?: string) {
    return assistant.callTestAiProvider.call(this, id, model, expectedRevision);
  }
  /**
   * Search by meaning's own setup: on needs the model that measures text
   * and `accept` (every page is sent to the provider to be measured).
   */
  updateAiNightBudget(input: {
    night_token_budget: number;
    expected_revision: string;
  }) {
    return assistant.callUpdateAiNightBudget.call(this, input);
  }
  setSemanticSearch(input: {
    on: boolean;
    embedding_model?: string;
    embedding_provider_id?: string;
    expected_generation?: string;
    expected_provider_revision?: string;
    accept?: boolean;
  }) {
    return search.callSetSemanticSearch.call(this, input);
  }
  updateAiSettings(input: {
    provider_id: string | null;
    model?: string;
    night_token_budget?: number;
  }) {
    return assistant.callUpdateAiSettings.call(this, input);
  }

  adminListAudit(params: { limit?: number; offset?: number } = {}) {
    return tasks.callAdminListAudit.call(this, params);
  }

  // ---- live news -----------------------------------------------------------

  /**
   * Follow the server's news for this person — something changed, a focus
   * session moved, someone came or went — and call `onNews` for each. It
   * reconnects with a widening gap; `onOpen` runs on every (re)connection, so
   * the app can catch up on anything it missed while away.
   */
  watchEvents(
    onNews: (news: LiveNews) => void,
    onOpen?: () => void,
  ): () => void {
    const abort = new AbortController();
    let stopped = false;
    const run = async () => {
      let wait = 1_000;
      while (!stopped) {
        try {
          const token = await this.getToken();
          if (!token) return;
          const response = await this.streamFetch(`${this.baseUrl}/events`, {
            headers: {
              accept: "text/event-stream",
              "X-Orbyn-Editor": this.editorId,
              Authorization: `Bearer ${token}`,
            },
            signal: abort.signal,
          });
          if (response.status === 401 || response.status === 403) return;
          // The gateway limits streams per address, and a home's devices
          // share one: wait out its Retry-After instead of climbing the
          // backoff, and try again on the next tick of the same gap.
          if (response.status === 429) {
            const header = response.headers.get("Retry-After");
            const seconds = header === null ? NaN : Number(header);
            const delay =
              Number.isFinite(seconds) && seconds >= 0
                ? Math.min(seconds * 1000, 60_000)
                : 5_000;
            await response.body?.cancel();
            if (stopped) return;
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          if (!response.ok) throw new Error(`stream ${response.status}`);
          if (!response.body) return;
          wait = 1_000;
          onOpen?.();
          const reader = response.body.getReader();
          const decode = new TextDecoder();
          let buffer = "";
          while (!stopped) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decode.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop() ?? "";
            for (const part of parts) {
              const line = part.split("\n").find((l) => l.startsWith("data:"));
              if (!line) continue;
              try {
                onNews(JSON.parse(line.slice(5)) as LiveNews);
              } catch {
                // A half-written event: the next one catches up.
              }
            }
          }
        } catch {
          if (stopped) return;
        }
        if (stopped) return;
        await new Promise((r) => setTimeout(r, wait));
        wait = Math.min(wait * 2, 60_000);
      }
    };
    void run();
    return () => {
      stopped = true;
      abort.abort();
    };
  }

  // ---- focus sessions ------------------------------------------------------

  /** Keep a finished (or cut short) phase; work minutes go to the task. */
  saveFocusSession(input: Omit<FocusSession, "item_title">) {
    return planner.callSaveFocusSession.call(this, input);
  }
  activitySummary(days: 30 | 90 | 365 = 90) {
    return account.callActivitySummary.call(this, days);
  }
  focusSummary(from: Date, to: Date) {
    return planner.callFocusSummary.call(this, from, to);
  }
  currentFocus() {
    return planner.callCurrentFocus.call(this);
  }
  /** Share the session running here with your other devices. */
  setCurrentFocus(state: FocusState, device?: string, deviceId?: string) {
    return planner.callSetCurrentFocus.call(this, state, device, deviceId);
  }
  clearCurrentFocus() {
    return planner.callClearCurrentFocus.call(this);
  }

  // ---- presence ------------------------------------------------------------

  heartbeat(input: PresenceHeartbeat) {
    return workspace.callHeartbeat.call(this, input);
  }
  leavePresence(deviceId: string) {
    return workspace.callLeavePresence.call(this, deviceId);
  }
  listDevices() {
    return tasks.callListDevices.call(this);
  }
  forgetDevice(deviceId: string) {
    return administration.callForgetDevice.call(this, deviceId);
  }
  presenceSettings() {
    return workspace.callPresenceSettings.call(this);
  }
  updatePresenceSettings(input: PresenceSettings) {
    return tasks.callUpdatePresenceSettings.call(this, input);
  }
  teamPresence(teamId: string) {
    return teams.callTeamPresence.call(this, teamId);
  }
  docViewers(docId: string) {
    return documents.callDocViewers.call(this, docId);
  }

  // ---- team capacity -------------------------------------------------------

  /** Free working time per person per day (a month at most). */
  teamCapacity(teamId: string, from: Date, to: Date) {
    return teams.callTeamCapacity.call(this, teamId, from, to);
  }

  // ---- page templates ------------------------------------------------------

  /** Your page templates, your teams', and the starters everyone has. */
  listPageTemplates() {
    return documents.callListPageTemplates.call(this);
  }
  createPageTemplate(input: PageTemplateInput) {
    return documents.callCreatePageTemplate.call(this, input);
  }
  updatePageTemplate(id: string, input: PageTemplateUpdate) {
    return documents.callUpdatePageTemplate.call(this, id, input);
  }
  deletePageTemplate(id: string) {
    return documents.callDeletePageTemplate.call(this, id);
  }
  /** Save a page as a template: its words, folder and tags, boxes unticked. */
  savePageAsTemplate(docId: string, input: PageTemplateFromDoc = {}) {
    return documents.callSavePageAsTemplate.call(this, docId, input);
  }
  /**
   * Make a page from a template, blanks filled in. With `make_tasks`, its
   * to-do lines become tasks (in the project, when one is chosen). For an
   * event that already has a note, that note comes back (`existing`) and
   * nothing new is made.
   */
  usePageTemplate(id: string, input: PageTemplateUse = {}) {
    return documents.callUsePageTemplate.call(this, id, input);
  }

  // ---- project templates ---------------------------------------------------

  /** Your templates, your teams', and the starters everyone has. */
  listTemplates() {
    return projects.callListTemplates.call(this);
  }
  createTemplate(input: TemplateInput) {
    return projects.callCreateTemplate.call(this, input);
  }
  updateTemplate(id: string, input: TemplateUpdate) {
    return projects.callUpdateTemplate.call(this, id, input);
  }
  deleteTemplate(id: string) {
    return projects.callDeleteTemplate.call(this, id);
  }
  /** Save a project as a template: its tasks, their order, and its brief. */
  templateFromProject(projectId: string) {
    return projects.callTemplateFromProject.call(this, projectId);
  }
  /**
   * Start a project from a template. Answers with a proposal to review —
   * approve it with `applyProposal` — never a project yet.
   */
  useTemplate(
    id: string,
    input: { title?: string; team_id?: string | null } = {},
  ) {
    return projects.callUseTemplate.call(this, id, input);
  }

  // ---- follow-through ------------------------------------------------------

  /** How much of what was planned lately got done, by weekday. */
  planReality() {
    return planner.callPlanReality.call(this);
  }
  /** What a change would do to the coming days. Nothing is saved. */
  whatIf(input: WhatIfInput) {
    return planner.callWhatIf.call(this, input);
  }
  /** After time away: what happened meanwhile, or null. */
  reentry() {
    return projects.callReentry.call(this);
  }
  dismissReentry() {
    return projects.callDismissReentry.call(this);
  }
  /** Pages nobody has changed or confirmed in months. */
  fadingDocs(teamId?: string) {
    return documents.callFadingDocs.call(this, teamId);
  }
  /** Say a page is still true, or that it needs updating (makes a task). */
  reviewDoc(
    id: string,
    input:
      { verdict: "still_true" } | { verdict: "needs_update"; note?: string },
  ) {
    return assistant.callReviewDoc.call(this, id, input);
  }
  listAsks() {
    return tasks.callListAsks.call(this);
  }
  itemAsk(itemId: string) {
    return tasks.callItemAsk.call(this, itemId);
  }
  /** Answer an ask: take it on, suggest another date, or say you can't. */
  replyToAsk(
    id: string,
    input:
      | { action: "accept"; message?: string }
      | {
          action: "counter";
          due_at?: string | null;
          estimate_minutes?: number | null;
          message?: string;
        }
      | { action: "decline"; message: string },
  ) {
    return tasks.callReplyToAsk.call(this, id, input);
  }
  /** Settle a suggestion: agree, keep the original, or withdraw the ask. */
  settleAsk(id: string, action: "agree" | "keep" | "withdraw", message = "") {
    return tasks.callSettleAsk.call(this, id, action, message);
  }
  teamAttention(teamId: string, week?: string) {
    return teams.callTeamAttention.call(this, teamId, week);
  }
  setMeetingBudget(teamId: string, minutes: number | null) {
    return booking.callSetMeetingBudget.call(this, teamId, minutes);
  }
  checkAttention(
    teamId: string,
    input: {
      start_at: string;
      end_at: string;
      user_ids?: string[];
      item_id?: string;
    },
  ) {
    return teams.callCheckAttention.call(this, teamId, input);
  }
  listProofs(itemId: string) {
    return tasks.callListProofs.call(this, itemId);
  }
  addProof(itemId: string, input: { url?: string | null; note?: string }) {
    return tasks.callAddProof.call(this, itemId, input);
  }
  deleteProof(itemId: string, proofId: string) {
    return tasks.callDeleteProof.call(this, itemId, proofId);
  }
  /** What got done between two times, with its proof; a team's, or yours. */
  progress(from: Date, to: Date, teamId?: string) {
    return planner.callProgress.call(this, from, to, teamId);
  }

  /** An experiment's before and after, measured. */
  experimentEvidence(id: string) {
    return workspace.callExperimentEvidence.call(this, id);
  }

  // ---- D4c: staying current, publishing, imports, assistant chips ----

  /** Recent changes in your teams (SHR-02), newest first. */
  listChanges(
    params: {
      team_id?: string;
      /** Leave out your own changes; on unless false. */
      hide_mine?: boolean;
      before?: string;
      limit?: number;
    } = {},
  ) {
    return tasks.callListChanges.call(this, params);
  }

  /** Finish the first run (DSN-02): what Orbyn is for, and a starter. */
  finishFirstRun(input: FirstRunInput) {
    return account.callFinishFirstRun.call(this, input);
  }
  /** Not now: the first run isn't shown again. */
  skipFirstRun() {
    return account.callSkipFirstRun.call(this);
  }

  /** Whether a page or folder is on the web, and whether you may publish it. */
  getPublish(kind: "doc" | "folder", id: string) {
    return publishing.callGetPublish.call(this, kind, id);
  }
  getPagePublication(id: string) {
    return documents.callGetPagePublication.call(this, id);
  }
  publishPageSelection(
    id: string,
    input: import("@orbyn/core").PagePublicationInput,
  ) {
    return publishing.callPublishPageSelection.call(this, id, input);
  }
  revokePagePublication(id: string) {
    return documents.callRevokePagePublication.call(this, id);
  }
  /** Put a page or folder on the web, or change how (SHR-05, SHR-06). */
  publish(kind: "doc" | "folder", id: string, input: PublishInput) {
    return publishing.callPublish.call(this, kind, id, input);
  }
  /** Take it off the web; the address stops working at once. */
  unpublish(kind: "doc" | "folder", id: string) {
    return publishing.callUnpublish.call(this, kind, id);
  }
  /** A page's own description for its card on the web. */
  setWebDescription(docId: string, description: string) {
    return documents.callSetWebDescription.call(this, docId, description);
  }
  /** A team's switch for publishing, and how many of its pages are on the web. */
  getTeamPublishing(teamId: string) {
    return publishing.callGetTeamPublishing.call(this, teamId);
  }
  setTeamPublishing(teamId: string, allowed: boolean) {
    return publishing.callSetTeamPublishing.call(this, teamId, allowed);
  }

  /** A Markdown or Notion export into pages (DATA-08). Dry run by default. */
  importPages(input: PageImportInput) {
    return documents.callImportPages.call(this, input);
  }

  /** Summarise, or find deadlines in, a page or shared words (AI-01). */
  assistCapture(input: CaptureAssistInput) {
    return capture.callAssistCapture.call(this, input);
  }
}
