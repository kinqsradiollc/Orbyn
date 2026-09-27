import {
  HttpError,
  type AgentGrant,
  type AgentToolset,
  type AgentTrustInput,
  type AgentInboxKind,
  type AgentInboxSettings,
  type AgentQuestion,
  type AgentRule,
  type AgentRuleInput,
  type AgentContextSettings,
  type PersonalAgentSettings,
  type AgentIdentityInput,
  type NewAgentWake,
  type ProposalStatus,
  type McpCatalog,
  type AgendaDay,
  type CaptureRequest,
  type CaptureResult,
  type LinkPreview,
  type DocTag,
  type PageTemplate,
  type PageTemplateFromDoc,
  type PageTemplateInput,
  type PageTemplateUpdate,
  type PageTemplateUse,
  type ItemSessions,
  type ItemContext,
  type PlannedFeed,
  type TodayList,
  type AdminOverview,
  type AdminAnalytics,
  type AdminUserDetail,
  type Announcement,
  type LegalAdminView,
  type AdminStorage,
  type ImportCapabilities,
  type ImportCreateInput,
  type ImportJob,
  type Rating,
  type RevisionPlan,
  type StudyCard,
  type StudyOverview,
  type SuggestedCard,
  type LegalDoc,
  type LegalDocument,
  type LegalSettingsUpdate,
  type LegalSummary,
  type PrivacyView,
  type RequestLogRow,
  type RequestSummary,
  type SweepView,
  type AdminDatabaseTable,
  type AdminDatabaseTableDetail,
  type AdminDatabaseRows,
  type Doc,
  type DocInfo,
  type TrashedDoc,
  type DocBlock,
  type DocKind,
  type DocComment,
  type DocAiAction,
  type DocAnswer,
  type DocSuggestion,
  type ExportFormat,
  type Proposed,
  type SearchHit,
  type FindHit,
  type LinkedHereList,
  type LinkOption,
  type LinkPill,
  type ObjectRef,
  resolveRefs,
  type HeadingOption,
  type LinkCard,
  type RelatedPage,
  type UnlinkedMention,
  type PageFile,
  type PageFileInput,
  type PageFileLink,
  type PageFilesUsage,
  type PageFileUpload,
  type DocSummary,
  type EventNoteRef,
  type DocVersion,
  type DocVersionChanges,
  type Favourite,
  type FavouriteKind,
  type StarredItem,
  type AccountPrefs,
  type AccountPrefsInput,
  type ConnectionMap,
  type TeamPolicies,
  type RecordingSummary,
  type ClipKey,
  type ClipDestinations,
  type ClipInput,
  type ClipResult,
  type CustomField,
  type CustomFieldInput,
  type CustomFieldUpdate,
  type FieldDate,
  type FieldTarget,
  type FieldValue,
  type SavedView,
  type SavedViewInput,
  type SavedViewUpdate,
  type TargetFields,
  type ViewDefinitionInput,
  type ViewResult,
  type Folder,
  type Project,
  type ProjectLink,
  type ProjectPlanning,
  type ProjectSession,
  type ProjectActivity,
  type ProjectCheckpoint,
  type ProjectSnapshot,
  type WorkRecord,
  type WorkRecordInput,
  type WorkRecordUpdate,
  type ProjectStatus,
  type AiModelList,
  type AiProvider,
  type AiProviderKind,
  type AiProvidersResponse,
  type AiSettings,
  type AiTestResult,
  type AdminUser,
  type AuditEntry,
  type AuthResponse,
  type Session,
  type TwoFactorStatus,
  type TwoFactorSetup,
  type TwoFactorEnabled,
  type ImportSummary,
  type ChatChannel,
  type Passkey,
  type InboxInfo,
  type ChatTurn,
  type ChatScope,
  type Credentials,
  type Item,
  type ItemDetail,
  type ItemPositionInput,
  type ItemSyncPage,
  type InviteBookingRequest,
  type OpenInvite,
  type OpenInviteInput,
  type Profile,
  type ProfileInput,
  type PublicInvite,
  type PublicProfile,
  type Status,
  type ItemInput,
  type Notice,
  type Page,
  type Proposal,
  type StatusReport,
  type Maintenance,
  type MaintenanceInput,
  type SystemSettingsUpdate,
  type SystemSettingsView,
  type UpdateInfo,
  type VersionInfo,
  type SystemRole,
  type Team,
  type TeamDetail,
  type TeamMember,
  type TeamRole,
  type User,
  type ApiKey,
  type AgentActivity,
  type ReviewApplied,
  type ReviewApproveInput,
  type ReviewInbox,
  type ReviewItem,
  type AgentKeyInput,
  type AgentSettings,
  type AgentSettingsUpdate,
  type AgentsOverview,
  type NewAgentKey,
  type TeamAgentAccess,
  type TeamAgentsView,
  type AdminAgentClient,
  type AdminAgentUsage,
  type OAuthCheck,
  type OAuthConsentInput,
  type OAuthRedirect,
  type OAuthRequest,
  type ReauthInput,
  type Reauthenticated,
  type BlockDuplicateInput,
  type BlockRescheduleInput,
  type PlanApplied,
  type PlanApplyInput,
  type BlockInput,
  type BlockOnDayInput,
  type BlockUpdate,
  type Booking,
  type BookingPage,
  type BookingPageInput,
  type BookingPageUpdate,
  type BookingReceipt,
  type BookingRequest,
  type BookingDetail,
  type BookingStats,
  type BookingView,
  type ManagedBooking,
  type CalendarFeed,
  type CalendarFeedSettings,
  type CalendarFeedSettingsInput,
  type CalendarSearch,
  type CalendarSubscription,
  type CalendarSubscriptionInput,
  type CalendarSubscriptionUpdate,
  type CalendarView,
  type EditScope,
  type QuickAddCreated,
  type QuickAddResult,
  type RsvpView,
  type UserAvailability,
  type EstimateModel,
  type PlannerLearning,
  type UpNext,
  type Frame,
  type FrameInput,
  type FrameUpdate,
  type Habit,
  type HabitBlock,
  type HabitInput,
  type HabitPlan,
  type HabitPlanInput,
  type HabitUpdate,
  type ItemSort,
  type ListInput,
  type ListUpdate,
  type MeetingSlot,
  type MemberAvailability,
  type MemberWorkload,
  type TeamAnalytics,
  type NewApiKey,
  type NewWebhook,
  type Place,
  type PlaceInput,
  type PlaceUpdate,
  type Plan,
  type PlannerAnalytics,
  type PlannerPrefs,
  type PlannerPrefsInput,
  type PlannerReview,
  type PlanPreviewInput,
  type PlanStaleness,
  type PlanTuneInput,
  type PublicBookingPage,
  type Tag,
  type TagInput,
  type TagUpdate,
  type TaskList,
  type TimeBlock,
  type Webhook,
  type WebhookInput,
  type WebhookTestResult,
  type WebhookUpdate,
  type DevicePresence,
  type DocViewer,
  type FocusCurrent,
  type FocusSession,
  type FocusState,
  type FocusSummary,
  type MemberPresence,
  type PresenceHeartbeat,
  type PresenceSettings,
  type TeamCapacity,
  type ProjectTemplate,
  type TemplateInput,
  type TemplateUpdate,
  type AttentionCheck,
  type FadingDoc,
  type ItemProof,
  type PlanReality,
  type ProgressReport,
  type ReentryBrief,
  type TaskAsk,
  type TeamAttention,
  type WhatIfInput,
  type WhatIfResult,
  type ExperimentEvidence,
  type SessionCheckIn,
  type SessionCheckInInput,
  type SessionCheckedIn,
  type ProjectMilestone,
  type MilestoneInput,
  type MilestoneUpdate,
  type PageMention,
  type OriginalsOverview,
  type ProjectChat,
  type ProjectChatInput,
  type ProjectChatSummary,
  type CaptureAssistInput,
  type CaptureAssistResult,
  type FirstRunInput,
  type FirstRunResult,
  type PageImportInput,
  type PagesImportSummary,
  type PublishInput,
  type PublishState,
  type TeamChangesPage,
} from "@orbyn/core";

/** News from `GET /events`: re-read what it names. */
export type LiveNews = {
  kind: "changed" | "focus" | "presence" | "doc_presence";
  /**
   * What a "changed" is about: pages, projects, lists and folders
   * (organize), templates, work records, the Review inbox, or items.
   * Absent on older news, which means anything may have changed.
   */
  area?:
    | "items"
    | "docs"
    | "projects"
    | "organize"
    | "templates"
    | "records"
    | "review";
  user?: string;
  team?: string;
  doc?: string;
  by?: string;
};

/**
 * What a document's stream says beyond its version: `trashed` when someone
 * moved it to Trash, so an editor that has it open can let it go.
 */
export type DocNews = {
  trashed: boolean;
  /** Only the page's tags changed; its words and version are as they were. */
  tags: boolean;
  /** Only a field value changed (the Info panel reads it afresh). */
  fields?: boolean;
  /** Who made the change, so an editor can skip its own saves ("" when unknown). */
  by: string;
};

/** "?scope=this&occurrence=…" for edits to part of a repeating item. */
const scopeQuery = (o: { scope?: EditScope; occurrence?: string }) => {
  if (!o.scope || o.scope === "all") return "";
  const q = new URLSearchParams({ scope: o.scope });
  if (o.occurrence) q.set("occurrence", o.occurrence);
  return `?${q}`;
};

/** After a write, reads ask for the primary database for this long. */
const READ_YOUR_WRITES_MS = 5000;
/** Pause before retrying a read that failed while a server copy restarted. */
const RETRY_DELAY_MS = 300;
/** How many unchanged-response bodies to remember for conditional GETs. */
const MAX_CACHED = 100;
/** Polling an assistant turn: first check, longest gap, and how long to wait in all. */
const CHAT_POLL_MS = 1200;
const CHAT_POLL_MAX_MS = 4000;
const CHAT_WAIT_MS = 15 * 60_000;

type ChatJob =
  | { state: "running" }
  | { state: "done"; proposal: Proposal }
  | { state: "failed"; status?: number; message: string };

/** What to say when a proxy answered instead of Orbyn (no JSON body). */
function proxyMessage(status: number): string {
  if (status === 504 || status === 524)
    return "That took too long to answer. Try again, or ask for less at once.";
  // The status goes to the console with the rest (errorDetail), not here.
  if (status >= 500)
    return "Orbyn is briefly unavailable. Try again in a moment.";
  return "Orbyn sent a reply it couldn't read. Try again.";
}

export type TokenSource = () =>
  string | null | undefined | Promise<string | null | undefined>;

export type OrbynClientOptions = {
  /** API origin, for example `http://localhost:8008` or `/api`. */
  baseUrl: string;
  /** Returns the current session token, or nothing when signed out. */
  getToken?: TokenSource;
  /** Per-request timeout. Defaults to 120s to outlast the assistant's 85s deadline. */
  timeoutMs?: number;
  /** Override fetch (tests, custom agents). Defaults to the global fetch. */
  fetch?: typeof fetch;
  /**
   * Fetch used for streaming reads, which need a readable `response.body`.
   * React Native's built-in fetch has no body stream, so the phone passes
   * `expo/fetch` here; everywhere else the ordinary fetch already does.
   */
  streamFetch?: typeof fetch;
};

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Send without the Authorization header even if a token exists. */
  anonymous?: boolean;
  /** Resolve with the body text instead of parsing JSON (CSV exports). */
  raw?: boolean;
  /** Send once: a retry with the same key gets the first answer back. */
  idempotencyKey?: string;
  /** Extra request headers. */
  headers?: Record<string, string>;
};

/**
 * Small typed wrapper over the Orbyn HTTP API. Every method resolves with the
 * parsed JSON body and rejects with an `HttpError` carrying the server status.
 */
export class OrbynClient {
  readonly baseUrl: string;
  private readonly getToken: TokenSource;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly streamFetch: typeof fetch;
  private lastWriteAt = 0;
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

  /**
   * A plain authenticated GET, for the few things that come back as a file
   * rather than as JSON. No caching and no retries: a download either
   * arrives or it is asked for again.
   */
  async raw(path: string): Promise<Response> {
    const token = await this.getToken();
    const response = await this.fetchImpl(this.baseUrl + path, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(this.timeoutMs),
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
    const token = options.anonymous ? null : await this.getToken();
    const key = `${token ?? ""} ${path}`;
    const cached = method === "GET" ? this.cache.get(key) : undefined;
    // Read-your-writes: right after this client writes, its reads go to the
    // primary database rather than a replica that may lag a moment behind.
    const fresh =
      method === "GET" && Date.now() - this.lastWriteAt < READ_YOUR_WRITES_MS;
    if (method !== "GET") this.lastWriteAt = Date.now();
    const send = () =>
      this.fetchImpl(this.baseUrl + path, {
        method,
        // Only declare a JSON body when there is one: the API rejects an empty
        // body labelled application/json (this broke logout and other bodyless calls).
        headers: {
          ...(options.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(cached ? { "If-None-Match": cached.etag } : {}),
          ...(fresh ? { "X-Orbyn-Consistency": "primary" } : {}),
          ...(idempotencyKey && method !== "GET"
            ? { "Idempotency-Key": idempotencyKey }
            : {}),
          "X-Orbyn-Editor": this.editorId,
          ...options.headers,
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(this.timeoutMs),
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
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        response = await send();
      }
    } catch (error) {
      if (!retryable || (error as Error).name === "TimeoutError") throw error;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      response = await send();
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
      throw new HttpError(
        response.status,
        error.message ||
          (response.status >= 500
            ? "Something went wrong on our side. Try again in a moment."
            : "That didn't work. Try again."),
        {
          detail: error.detail,
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

  // ---- health ----
  health() {
    return this.request<{ status: string }>("/health", { anonymous: true });
  }

  /** The public uptime report; no sign-in needed. */
  // ---- system: settings, maintenance, version ----
  /** Live settings and where each comes from (database or .env). */
  getSystemSettings() {
    return this.request<SystemSettingsView>("/admin/settings");
  }
  updateSystemSettings(body: SystemSettingsUpdate) {
    return this.request<SystemSettingsView>("/admin/settings", {
      method: "PUT",
      body,
    });
  }
  /** Sends a test email with the saved SMTP settings (to the admin by default). */
  sendTestEmail(to?: string) {
    return this.request<{ sent: true; to: string }>(
      "/admin/settings/test-email",
      { method: "POST", body: to ? { to } : {} },
    );
  }
  /** Public: whether maintenance mode is on, for banners (no sign-in needed). */
  getMaintenance() {
    return this.request<Maintenance>("/maintenance", { anonymous: true });
  }
  setMaintenance(body: MaintenanceInput) {
    return this.request<Maintenance>("/admin/maintenance", {
      method: "PUT",
      body,
    });
  }
  /** Public: the build the server is running. */
  getVersion() {
    return this.request<VersionInfo>("/version", { anonymous: true });
  }
  /** The running version against the newest commit on GitHub. */
  getUpdates() {
    return this.request<UpdateInfo>("/admin/updates");
  }

  getStatus() {
    return this.request<StatusReport>("/status", { anonymous: true });
  }

  // ---- auth ----
  register(input: Credentials) {
    return this.request<AuthResponse>("/auth/register", {
      method: "POST",
      body: input,
      anonymous: true,
    });
  }
  login(input: Pick<Credentials, "email" | "password"> & { code?: string }) {
    return this.request<AuthResponse>("/auth/login", {
      method: "POST",
      body: input,
      anonymous: true,
    });
  }
  logout() {
    return this.request<void>("/auth/logout", { method: "POST" });
  }
  /** Where you're signed in. */
  listSessions() {
    return this.request<Session[]>("/me/sessions");
  }
  /** Sign out one other device. */
  revokeSession(id: string) {
    return this.request<void>(`/me/sessions/${id}`, { method: "DELETE" });
  }
  /** Sign out everywhere except here. */
  revokeOtherSessions() {
    return this.request<{ signed_out: number }>("/me/sessions/revoke-others", {
      method: "POST",
    });
  }
  // ---- two-step verification ----
  getTwoFactor() {
    return this.request<TwoFactorStatus>("/me/2fa");
  }
  /** Begin setup: returns the secret and otpauth URI to add to an app. */
  setupTwoFactor() {
    return this.request<TwoFactorSetup>("/me/2fa/setup", { method: "POST" });
  }
  /** Confirm with a code; returns the one-time recovery codes. */
  enableTwoFactor(code: string) {
    return this.request<TwoFactorEnabled>("/me/2fa/enable", {
      method: "POST",
      body: { code },
    });
  }
  disableTwoFactor(password: string) {
    return this.request<void>("/me/2fa/disable", {
      method: "POST",
      body: { password },
    });
  }
  // ---- passkeys ----
  listPasskeys() {
    return this.request<Passkey[]>("/me/passkeys");
  }
  passkeyRegisterOptions() {
    return this.request<unknown>("/me/passkeys/options", { method: "POST" });
  }
  registerPasskey(response: unknown, name: string) {
    return this.request<{ ok: boolean }>("/me/passkeys", {
      method: "POST",
      body: { response, name },
    });
  }
  deletePasskey(id: string) {
    return this.request<void>(`/me/passkeys/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }
  /** Sign-in step 1: options + an opaque handle to send back. */
  passkeyLoginOptions(email?: string) {
    return this.request<{ handle: string; options: unknown }>(
      "/auth/passkey/options",
      { method: "POST", body: { email }, anonymous: true },
    );
  }
  /** Sign-in step 2: the assertion, returns a session. */
  passkeyLogin(handle: string, response: unknown) {
    return this.request<AuthResponse>("/auth/passkey", {
      method: "POST",
      body: { handle, response },
      anonymous: true,
    });
  }
  // ---- import / export ----
  /** Your planner data as a JSON archive to keep. */
  exportData() {
    return this.request<unknown>("/me/export");
  }
  /**
   * Everything, pages included, as a .zip: every page as Markdown in its
   * folders, projects, folders, imports, consent history and the planner
   * file. Comes back as a blob with the name the server chose.
   */
  async exportArchive() {
    const response = await this.raw("/me/export.zip");
    const disposition = response.headers.get("content-disposition") ?? "";
    const named = /filename="([^"]+)"/.exec(disposition)?.[1];
    return {
      blob: await response.blob(),
      name: named ?? "orbyn-export.zip",
    };
  }
  /** Bring items in from an Orbyn export or a CSV. Dry run by default. */
  importData(input: {
    format: "orbyn" | "csv" | "todoist" | "ticktick";
    data: string;
    dry_run?: boolean;
  }) {
    return this.request<ImportSummary>("/me/import", {
      method: "POST",
      body: input,
    });
  }
  // ---- chat delivery ----
  getChat() {
    return this.request<ChatChannel>("/me/chat");
  }
  setChat(kind: "slack" | "discord", url: string) {
    return this.request<ChatChannel>("/me/chat", {
      method: "PUT",
      body: { kind, url },
    });
  }
  disableChat() {
    return this.request<void>("/me/chat", { method: "DELETE" });
  }
  /** Post a test message to the connected chat webhook. */
  testChat() {
    return this.request<void>("/me/chat/test", { method: "POST" });
  }
  // ---- email to task ----
  getInbox() {
    return this.request<InboxInfo>("/me/inbox");
  }
  /** Turn on email-to-task, or roll to a fresh address. */
  rotateInbox() {
    return this.request<InboxInfo>("/me/inbox/rotate", { method: "POST" });
  }
  disableInbox() {
    return this.request<void>("/me/inbox", { method: "DELETE" });
  }
  /** Confirm an email address from a verification link (signed in or not). */
  verifyEmail(token: string) {
    return this.request<void>("/auth/verify-email", {
      method: "POST",
      body: { token },
      anonymous: true,
    });
  }
  /** Re-send the confirmation email to the signed-in, unconfirmed user. */
  resendVerification() {
    return this.request<void>("/auth/resend-verification", { method: "POST" });
  }
  /** Ask for a password-reset link. Always succeeds, whoever the email is. */
  forgotPassword(email: string) {
    return this.request<void>("/auth/forgot-password", {
      method: "POST",
      body: { email },
      anonymous: true,
    });
  }
  /** Set a new password from a reset link and sign in. */
  resetPassword(token: string, password: string) {
    return this.request<AuthResponse>("/auth/reset-password", {
      method: "POST",
      body: { token, password },
      anonymous: true,
    });
  }

  // ---- profile ----
  me() {
    return this.request<User>("/me");
  }
  updatePreferences(input: { email_reminders: boolean }) {
    return this.request<User>("/me", { method: "PUT", body: input });
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
    const q = new URLSearchParams();
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    if (params.offset !== undefined) q.set("offset", String(params.offset));
    for (const key of [
      "team_id",
      "q",
      "list_id",
      "tag_id",
      "assignee_id",
      "sort",
      "parent_id",
    ] as const)
      if (params[key]) q.set(key, params[key]!);
    const suffix = q.size ? `?${q}` : "";
    return this.request<Item[]>(`/items${suffix}`);
  }
  /**
   * Incremental sync: items changed after `updated_after` (or after a
   * previous page's `next_cursor`), oldest change first, and with
   * `include_deleted` the items deleted since.
   */
  syncItems(params: {
    updated_after?: string;
    cursor?: string;
    include_deleted?: boolean;
    limit?: number;
    team_id?: string;
  }) {
    const q = new URLSearchParams();
    // Without either, GET /items is the ordinary list, not a sync page.
    if (!params.updated_after && !params.cursor)
      throw new Error("syncItems needs updated_after or cursor");
    if (params.updated_after) q.set("updated_after", params.updated_after);
    if (params.cursor) q.set("cursor", params.cursor);
    if (params.include_deleted) q.set("include_deleted", "1");
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    if (params.team_id) q.set("team_id", params.team_id);
    return this.request<ItemSyncPage>(`/items?${q}`);
  }
  /** Move an item in its manual order (doesn't change its version). */
  moveItem(id: string, input: ItemPositionInput) {
    return this.request<Item>(`/items/${id}/position`, {
      method: "PUT",
      body: input,
    });
  }
  /** Add minutes worked (focus timer). */
  logTime(itemId: string, minutes: number) {
    return this.request<ItemDetail>(`/items/${itemId}/time`, {
      method: "POST",
      body: { minutes },
    });
  }
  /** Remove one occurrence of a repeating item. */
  skipOccurrence(itemId: string, occurrence: string) {
    return this.request<ItemDetail>(`/items/${itemId}/skip`, {
      method: "POST",
      body: { occurrence },
    });
  }

  // ---- lists and tags ----
  /**
   * Write today's agenda again from the calendar as it is now, opening with
   * the assistant's summary when a provider is connected. Replaces the
   * page's content. `brief` says whether the assistant wrote one.
   */
  rewriteAgenda(timezone?: string) {
    return this.request<Doc & { brief: boolean }>("/ai/agenda/today", {
      method: "POST",
      body: timezone ? { timezone } : {},
    });
  }
  /**
   * Today's agenda document, written on first ask each day (a POST: asking
   * writes it). `timezone` is the device's, adopted when you haven't picked
   * one in settings.
   */
  agendaToday(timezone?: string) {
    return this.request<Doc>("/agenda/today", {
      method: "POST",
      body: timezone ? { timezone } : {},
    });
  }
  /**
   * One day's agenda, for stepping back and forward. Reading never writes:
   * today's page is written on the spot here when it isn't there yet (as
   * `agendaToday` does); another day's `doc` is null until `writeAgenda`
   * writes it.
   */
  async agendaOn(date: string, timezone?: string) {
    const day = await this.request<AgendaDay>(`/agenda/${date}`);
    if (day.doc || date !== day.today) return day;
    return { ...day, doc: await this.writeAgenda(date, timezone) };
  }
  /** Write one day's agenda from the calendar (or get the one written). */
  writeAgenda(date: string, timezone?: string) {
    return this.request<Doc>(`/agenda/${date}`, {
      method: "POST",
      body: timezone ? { timezone } : {},
    });
  }
  /** Tell the server the device's zone; adopted unless you picked one. */
  reportTimeZone(timezone: string) {
    return this.request<{ adopted: boolean; timezone: string }>(
      "/me/timezone",
      { method: "POST", body: { timezone } },
    );
  }
  /**
   * The note for an event, created from a template the first time. For a
   * repeating event, `occurrence` (the calendar entry's) opens that class's
   * own note; without it, the series' note.
   */
  itemNote(itemId: string, occurrence?: string | null) {
    return this.request<Doc>(`/items/${itemId}/note`, {
      method: "POST",
      ...(occurrence ? { body: { occurrence } } : {}),
    });
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
    const ids = [...new Set(itemIds)];
    // The server takes 200 events at a time.
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 200)
      chunks.push(ids.slice(i, i + 200));
    const found = await Promise.all(
      chunks.map((chunk) =>
        this.request<EventNoteRef[]>(
          `/docs/event-notes?${new URLSearchParams({
            items: chunk.join(","),
            ...(range.from ? { from: range.from } : {}),
            ...(range.to ? { to: range.to } : {}),
          })}`,
        ),
      ),
    );
    return found.flat();
  }
  /**
   * Turn a page's open checklist lines into tasks: every one that isn't a
   * task yet, or only the lines named in `blockIds` ("Make task").
   */
  docToTasks(id: string, blockIds?: string[]) {
    return this.request<{
      created: number;
      items: Item[];
      /** The document as it now stands, with the new lines tied to tasks. */
      doc: Doc | null;
    }>(`/docs/${id}/tasks`, {
      method: "POST",
      ...(blockIds?.length ? { body: { block_ids: blockIds } } : {}),
    });
  }

  // Projects
  listProjects() {
    return this.request<Project[]>("/projects");
  }
  getProject(id: string) {
    return this.request<Project>(`/projects/${id}`);
  }
  listProjectLinks(id: string) {
    return this.request<ProjectLink[]>(`/projects/${id}/links`);
  }
  addProjectLink(id: string, input: { url: string; title?: string }) {
    return this.request<ProjectLink>(`/projects/${id}/links`, {
      method: "POST",
      body: input,
    });
  }
  removeProjectLink(id: string, linkId: string) {
    return this.request<void>(`/projects/${id}/links/${linkId}`, {
      method: "DELETE",
    });
  }
  /** Mark a project visit and return the prior visit for cross-device catch-up. */
  visitProject(id: string) {
    return this.request<{ since_at: string | null; visited_at: string }>(
      `/projects/${id}/visit`,
      { method: "POST" },
    );
  }
  projectPlanning(id: string) {
    return this.request<ProjectPlanning>(`/projects/${id}/planning`);
  }
  projectSessions(id: string) {
    return this.request<ProjectSession[]>(`/projects/${id}/sessions`);
  }
  /** Preview a project plan using only tasks assigned to the signed-in person. */
  /**
   * Preview a plan for your tasks in a project. `claimItemIds` are unassigned
   * team tasks you take on with it: they become yours and are planned too.
   */
  planProject(id: string, timezone?: string, claimItemIds: string[] = []) {
    return this.request<Plan>(`/projects/${id}/plan`, {
      method: "POST",
      body: {
        timezone,
        ...(claimItemIds.length ? { claim_item_ids: claimItemIds } : {}),
      },
    });
  }
  /** Recent changes to a project, with private task and note content omitted. */
  projectActivity(id: string, limit = 100) {
    return this.request<ProjectActivity[]>(
      `/projects/${id}/activity?limit=${Math.max(1, Math.min(200, limit))}`,
    );
  }
  /**
   * Keep a project out of the assistant (or let it back in). Owners and
   * admins of a team project, or the owner of a personal one.
   */
  setProjectAssistant(id: string, off: boolean) {
    return this.request<Project>(`/projects/${id}/assistant`, {
      method: "PUT",
      body: { off },
    });
  }
  /** A project's milestones, soonest first, rolled up for you. */
  projectMilestones(id: string) {
    return this.request<ProjectMilestone[]>(`/projects/${id}/milestones`);
  }
  createMilestone(projectId: string, input: MilestoneInput) {
    return this.request<ProjectMilestone>(`/projects/${projectId}/milestones`, {
      method: "POST",
      body: input,
    });
  }
  updateMilestone(projectId: string, id: string, input: MilestoneUpdate) {
    return this.request<ProjectMilestone>(
      `/projects/${projectId}/milestones/${id}`,
      { method: "PUT", body: input },
    );
  }
  deleteMilestone(projectId: string, id: string) {
    return this.request<void>(`/projects/${projectId}/milestones/${id}`, {
      method: "DELETE",
    });
  }
  /** Put a task in a milestone of its project, or take it out (null). */
  setItemMilestone(itemId: string, milestoneId: string | null) {
    return this.request<Item>(`/items/${itemId}/milestone`, {
      method: "PUT",
      body: { milestone_id: milestoneId },
    });
  }
  /** Your saved chats with the assistant about a project, newest first. */
  projectChats(projectId: string) {
    return this.request<ProjectChatSummary[]>(
      `/ai/projects/${projectId}/chats`,
    );
  }
  projectChat(id: string) {
    return this.request<ProjectChat>(`/ai/chats/${id}`);
  }
  /** Save a project chat after a reply; the same id updates the same chat. */
  saveProjectChat(id: string, input: ProjectChatInput) {
    return this.request<ProjectChatSummary>(`/ai/chats/${id}`, {
      method: "PUT",
      body: input,
    });
  }
  deleteProjectChat(id: string) {
    return this.request<void>(`/ai/chats/${id}`, { method: "DELETE" });
  }
  /** Checkpoints for the read-only project time machine, newest first. */
  projectCheckpoints(id: string, before?: string) {
    const cursor = before ? `?before=${before}` : "";
    return this.request<ProjectCheckpoint[]>(
      `/projects/${id}/time-machine/checkpoints${cursor}`,
    );
  }
  projectSnapshot(id: string, eventOrder: string) {
    return this.request<ProjectSnapshot>(
      `/projects/${id}/time-machine/${eventOrder}`,
    );
  }
  createProject(input: {
    name: string;
    summary?: string;
    team_id?: string | null;
    deadline?: string | null;
    stages?: string[];
  }) {
    return this.request<Project>("/projects", { method: "POST", body: input });
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
    },
  ) {
    return this.request<Project>(`/projects/${id}`, {
      method: "PUT",
      body: input,
    });
  }
  deleteProject(id: string) {
    return this.request<void>(`/projects/${id}`, { method: "DELETE" });
  }
  /**
   * Move a task into a project and stage, or pass null to unfile it. The
   * answer carries the task as it now stands.
   */
  setItemProject(
    itemId: string,
    input: { project_id: string | null; stage_id?: string | null },
  ) {
    return this.request<{ ok: true; item: Item }>(`/items/${itemId}/project`, {
      method: "PUT",
      body: input,
    });
  }
  /**
   * What a task hangs off and what hangs off it: its project and stage, the
   * page line it came from and the other pages about it (only pages you can
   * open).
   */
  itemContext(itemId: string) {
    return this.request<ItemContext>(`/items/${itemId}/context`);
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
    const q = new URLSearchParams();
    if (params.source_item_id) q.set("source_item_id", params.source_item_id);
    if (params.kind) q.set("kind", params.kind);
    if (params.project_id) q.set("project_id", params.project_id);
    if (params.owner_id) q.set("owner_id", params.owner_id);
    if (params.limit) q.set("limit", String(params.limit));
    return this.request<WorkRecord[]>(`/work-records?${q}`);
  }
  getWorkRecord(id: string) {
    return this.request<WorkRecord>(`/work-records/${id}`);
  }
  createWorkRecord(input: WorkRecordInput) {
    return this.request<WorkRecord>("/work-records", {
      method: "POST",
      body: input,
    });
  }
  updateWorkRecord(id: string, input: WorkRecordUpdate) {
    return this.request<WorkRecord>(`/work-records/${id}`, {
      method: "PUT",
      body: input,
    });
  }
  respondWorkRecord(id: string, decision: "accept" | "decline") {
    return this.request<WorkRecord>(`/work-records/${id}/respond`, {
      method: "POST",
      body: { decision },
    });
  }

  // Comments on a document
  listDocComments(docId: string) {
    return this.request<DocComment[]>(`/docs/${docId}/comments`);
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
    return this.request<DocComment>(`/docs/${docId}/comments`, {
      method: "POST",
      body: { body, ...anchor },
    });
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
    },
  ) {
    return this.request<DocSuggestion>(`/docs/${docId}/assist`, {
      method: "POST",
      body,
    });
  }
  /** Ask a question about one page, answered from that page alone. */
  askDoc(docId: string, question: string) {
    return this.request<DocAnswer>(`/docs/${docId}/ask`, {
      method: "POST",
      body: { question },
    });
  }

  // Proposed changes to a document
  listDocSuggestions(docId: string) {
    return this.request<DocSuggestion[]>(`/docs/${docId}/suggestions`);
  }
  /** Propose changes. Anyone who can read the document may propose. */
  proposeDocChanges(docId: string, changes: Proposed[], note = "") {
    return this.request<DocSuggestion[]>(`/docs/${docId}/suggestions`, {
      method: "POST",
      body: { changes, note },
    });
  }
  /** Take a proposal into the page, or leave it. Returns the page if taken. */
  decideDocSuggestion(docId: string, id: string, take: boolean) {
    return this.request<{ doc: Doc | null }>(
      `/docs/${docId}/suggestions/${id}`,
      { method: "POST", body: { take } },
    );
  }
  withdrawDocSuggestion(docId: string, id: string) {
    return this.request<void>(`/docs/${docId}/suggestions/${id}`, {
      method: "DELETE",
    });
  }

  /** People who can be named in a comment on this document. */
  /** "Mentioned in": the pages that name you, newest first. */
  mentions(limit = 50) {
    return this.request<PageMention[]>(`/me/mentions?limit=${limit}`);
  }
  /** "Keep the original": the setting, the space used, and the files. */
  originals() {
    return this.request<OriginalsOverview>("/me/originals");
  }
  setKeepOriginals(keep: boolean) {
    return this.request<{ keep: boolean }>("/me/originals", {
      method: "PUT",
      body: { keep },
    });
  }
  /** A page's kept original, as a file to save. */
  async downloadOriginal(docId: string) {
    const response = await this.raw(`/docs/${docId}/original`);
    const disposition = response.headers.get("content-disposition") ?? "";
    const star = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1];
    const plain = /filename="([^"]+)"/.exec(disposition)?.[1];
    return {
      blob: await response.blob(),
      name: star ? decodeURIComponent(star) : (plain ?? "original"),
    };
  }
  deleteOriginal(docId: string) {
    return this.request<void>(`/docs/${docId}/original`, { method: "DELETE" });
  }
  docPeople(docId: string) {
    return this.request<{ id: string; name: string; email: string }[]>(
      `/docs/${docId}/people`,
    );
  }
  resolveDocComment(docId: string, commentId: string, resolved: boolean) {
    return this.request<DocComment>(`/docs/${docId}/comments/${commentId}`, {
      method: "PUT",
      body: { resolved },
    });
  }
  deleteDocComment(docId: string, commentId: string) {
    return this.request<void>(`/docs/${docId}/comments/${commentId}`, {
      method: "DELETE",
    });
  }

  // Folders and favourites
  listFolders() {
    return this.request<Folder[]>("/folders");
  }
  createFolder(input: { name: string; team_id?: string | null }) {
    return this.request<Folder>("/folders", { method: "POST", body: input });
  }
  renameFolder(id: string, input: { name?: string; position?: number }) {
    return this.request<Folder>(`/folders/${id}`, {
      method: "PUT",
      body: input,
    });
  }
  deleteFolder(id: string) {
    return this.request<void>(`/folders/${id}`, { method: "DELETE" });
  }
  listFavourites() {
    return this.request<Favourite[]>("/favourites");
  }
  setFavourite(
    kind: FavouriteKind,
    targetId: string,
    starred: boolean,
    blockId?: string,
  ) {
    return this.request<void>("/favourites", {
      method: "PUT",
      body: {
        kind,
        target_id: targetId,
        starred,
        ...(blockId ? { block_id: blockId } : {}),
      },
    });
  }
  /** The Starred group: every star with its live title (NAV-07). */
  listStarred() {
    return this.request<StarredItem[]>("/starred");
  }

  // Choices that follow the account (NAV-08, NAV-09, SHR-08)
  getPrefs() {
    return this.request<AccountPrefs>("/me/prefs");
  }
  savePrefs(input: AccountPrefsInput) {
    return this.request<AccountPrefs>("/me/prefs", {
      method: "PUT",
      body: input,
    });
  }
  resetPrefs() {
    return this.request<void>("/me/prefs", { method: "DELETE" });
  }

  // Archiving and tidying the library (SRCH-03, ORG-03)
  archiveDoc(id: string, archived: boolean) {
    return this.request<Doc>(`/docs/${id}/archive`, {
      method: "PUT",
      body: { archived },
    });
  }
  archiveFolder(id: string, archived: boolean) {
    return this.request<{ id: string; archived_at: string | null }>(
      `/folders/${id}/archive`,
      { method: "PUT", body: { archived } },
    );
  }
  /** Move, archive or tag several pages at once. */
  bulkDocs(input: {
    ids: string[];
    folder_id?: string | null;
    archived?: boolean;
    tag_id?: string;
  }) {
    return this.request<{
      done: string[];
      skipped: { id: string; reason: string }[];
    }>("/docs/bulk", { method: "POST", body: input });
  }

  /** The Connections map around a page or project (CNV-02). */
  connectionMap(kind: "doc" | "project", id: string, depth: 1 | 2 = 1) {
    const q = new URLSearchParams({ kind, id, depth: String(depth) });
    return this.request<ConnectionMap>(`/links/map?${q}`);
  }

  /** A team's switches for publishing, the assistant and booking (OTH-04). */
  getTeamPolicies(teamId: string) {
    return this.request<TeamPolicies>(`/teams/${teamId}/policies`);
  }
  setTeamPolicies(
    teamId: string,
    input: Partial<Pick<TeamPolicies, "publishing" | "assistant" | "booking">>,
  ) {
    return this.request<TeamPolicies>(`/teams/${teamId}/policies`, {
      method: "PUT",
      body: input,
    });
  }

  /** A recording's summary and action items, from the assistant (CAP-10). */
  summariseRecording(fileId: string, transcript?: string) {
    return this.request<RecordingSummary>(`/ai/recordings/${fileId}/summary`, {
      method: "POST",
      body: transcript ? { transcript } : {},
    });
  }

  // The Orbyn Clipper (CAP-02)
  listClipKeys() {
    return this.request<ClipKey[]>("/me/clip-keys");
  }
  createClipKey(name?: string) {
    return this.request<{ key: string; clip_key: ClipKey }>("/me/clip-keys", {
      method: "POST",
      body: name ? { name } : {},
    });
  }
  deleteClipKey(id: string) {
    return this.request<void>(`/me/clip-keys/${id}`, { method: "DELETE" });
  }
  clipDestinations() {
    return this.request<ClipDestinations>("/clips/destinations");
  }
  clip(input: Partial<ClipInput> & Pick<ClipInput, "type" | "url">) {
    return this.request<ClipResult>("/clips", { method: "POST", body: input });
  }

  // Saved views (DATA-01) and your own fields (ORG-02)
  /** Every saved view you can see: yours and those shared with your teams. */
  listViews() {
    return this.request<SavedView[]>("/views");
  }
  createView(input: SavedViewInput) {
    return this.request<SavedView>("/views", { method: "POST", body: input });
  }
  updateView(id: string, input: SavedViewUpdate) {
    return this.request<SavedView>(`/views/${id}`, {
      method: "PUT",
      body: input,
    });
  }
  deleteView(id: string) {
    return this.request<void>(`/views/${id}`, { method: "DELETE" });
  }
  /** Pin a view to your own sidebar, or unpin it. */
  pinView(id: string, pinned: boolean) {
    return this.request<void>(`/views/${id}/pin`, {
      method: "PUT",
      body: { pinned },
    });
  }
  /** A saved view's rows, as you see them. */
  runView(id: string, limit?: number) {
    return this.request<ViewResult>("/views/run", {
      method: "POST",
      body: limit ? { id, limit } : { id },
    });
  }
  /** The rows of a definition that isn't saved (a live list, a view being built). */
  runDefinition(definition: ViewDefinitionInput, limit?: number) {
    return this.request<ViewResult>("/views/run", {
      method: "POST",
      body: limit ? { definition, limit } : { definition },
    });
  }
  /** A saved view as CSV text, with the file name the server chose. */
  async exportViewCsv(id: string) {
    const response = await this.raw(`/views/${id}/export.csv`);
    const disposition = response.headers.get("content-disposition") ?? "";
    const named = /filename="([^"]+)"/.exec(disposition)?.[1];
    return { text: await response.text(), name: named ?? "View.csv" };
  }
  /** Every field you can see, for pages and projects. */
  listFields() {
    return this.request<CustomField[]>("/fields");
  }
  createField(input: CustomFieldInput) {
    return this.request<CustomField>("/fields", {
      method: "POST",
      body: input,
    });
  }
  updateField(id: string, input: CustomFieldUpdate) {
    return this.request<CustomField>(`/fields/${id}`, {
      method: "PUT",
      body: input,
    });
  }
  /** Removes a field and clears it everywhere it was set. */
  deleteField(id: string) {
    return this.request<void>(`/fields/${id}`, { method: "DELETE" });
  }
  /** A page's or project's fields and values, for its Info panel. */
  targetFields(target: FieldTarget, id: string) {
    return this.request<TargetFields>(
      `/fields/values?${new URLSearchParams({ target, id })}`,
    );
  }
  /** Set one field on a page or project; null clears it. */
  setFieldValue(
    fieldId: string,
    target: FieldTarget,
    targetId: string,
    value: FieldValue,
  ) {
    return this.request<{ field_id: string; value: FieldValue }>(
      `/fields/${fieldId}/value`,
      { method: "PUT", body: { target, target_id: targetId, value } },
    );
  }
  /** Date fields shown on the calendar between two days (YYYY-MM-DD). */
  fieldDates(from: string, to: string) {
    return this.request<FieldDate[]>(
      `/fields/dates?${new URLSearchParams({ from, to })}`,
    );
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
    const params = new URLSearchParams({ q });
    for (const [k, v] of Object.entries(filter))
      if (v !== undefined) params.set(k, String(v));
    return this.request<SearchHit[]>(`/search?${params}`);
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
    const params = new URLSearchParams({ q });
    for (const [k, v] of Object.entries(filter))
      if (v !== undefined) params.set(k, String(v));
    return this.request<FindHit[]>(`/find?${params}`);
  }

  /**
   * What the link picker offers for the words typed after [[: pages, tasks,
   * events, projects and people (dates are worked out by the app).
   */
  pickLinks(q: string, limit?: number) {
    const params = new URLSearchParams({ q });
    if (limit !== undefined) params.set("limit", String(limit));
    return this.request<LinkOption[]>(`/links/pick?${params}`);
  }

  /** Link pills as they stand now: live titles, ticks, deadlines, deletions. */
  resolveLinks(refs: ObjectRef[]) {
    if (!refs.length) return Promise.resolve([] as LinkPill[]);
    const params = new URLSearchParams({ refs: resolveRefs(refs) });
    return this.request<LinkPill[]>(`/links/resolve?${params}`);
  }

  /** "Linked here": the places that link to a page, task, project or person. */
  linksHere(kind: "doc" | "task" | "event" | "project" | "person", id: string) {
    const params = new URLSearchParams({ kind, id });
    return this.request<LinkedHereList>(`/links/here?${params}`);
  }

  /** A link's hover card: enough to tick, reschedule or open it (LNK-07). */
  linkCard(ref: {
    kind: "doc" | "task" | "event" | "project";
    id: string;
    block?: string;
  }) {
    const params = new URLSearchParams({ kind: ref.kind, id: ref.id });
    if (ref.block) params.set("block", ref.block);
    return this.request<LinkCard>(`/links/card?${params}`);
  }

  /** Pages that say this page's or project's name without linking to it (LNK-06). */
  unlinkedMentions(kind: "doc" | "project", id: string) {
    const params = new URLSearchParams({ kind, id });
    return this.request<UnlinkedMention[]>(`/links/mentions?${params}`);
  }

  /** Make a mention a link, in the page it's in. */
  linkMention(input: {
    doc_id: string;
    block_id: string;
    matched: string;
    target: { kind: "doc" | "project"; id: string };
  }) {
    return this.request<{ doc_id: string; version: number }>(
      "/links/mentions/link",
      { method: "POST", body: input },
    );
  }

  /** Pages that read like this one, not linked either way yet (LNK-06). */
  relatedPages(docId: string) {
    const params = new URLSearchParams({ kind: "doc", id: docId });
    return this.request<RelatedPage[]>(`/links/related?${params}`);
  }

  /** A page's headings (and, with words, lines) for [[Page# (LNK-04). */
  pageHeadings(docId: string, q = "") {
    const params = new URLSearchParams({ doc: docId, q });
    return this.request<HeadingOption[]>(`/links/headings?${params}`);
  }

  /** Name a heading or line so a link can point at it. */
  anchorLine(docId: string, index: number, text: string) {
    return this.request<{ block_id: string }>(`/docs/${docId}/anchor`, {
      method: "POST",
      body: { index, text },
    });
  }

  /** A heading's section of a page (or the page's first lines), to embed. */
  docSection(docId: string, block?: string | null) {
    const params = new URLSearchParams();
    if (block) params.set("block", block);
    return this.request<{
      doc_id: string;
      title: string;
      block_id: string | null;
      missing: boolean;
      more: boolean;
      blocks: DocBlock[];
    }>(`/docs/${docId}/section${block ? `?${params}` : ""}`);
  }

  /** "Move to new page": these lines become a page, and a link takes their place. */
  extractToPage(
    docId: string,
    input: { block_ids: string[]; title?: string; version: number },
  ) {
    return this.request<{ doc: Doc; source: Doc }>(`/docs/${docId}/extract`, {
      method: "POST",
      body: input,
    });
  }

  /** "Merge into…": this page's lines go to the end of another. */
  mergeDoc(docId: string, into: string, version: number) {
    return this.request<{ doc: Doc; relinked: number }>(
      `/docs/${docId}/merge`,
      { method: "POST", body: { into, version } },
    );
  }

  /** The headings you folded on a page, on every device (EDT-14). */
  docFolds(docId: string) {
    return this.request<{ block_ids: string[] }>(`/docs/${docId}/folds`);
  }
  setDocFolds(docId: string, blockIds: string[]) {
    return this.request<{ block_ids: string[] }>(`/docs/${docId}/folds`, {
      method: "PUT",
      body: { block_ids: blockIds },
    });
  }

  /** A page's other names, such as a course code (LNK-03). */
  setDocAliases(docId: string, aliases: string[]) {
    return this.request<{ aliases: string[] }>(`/docs/${docId}/aliases`, {
      method: "PUT",
      body: { aliases },
    });
  }

  // ---- pictures and files in pages (EDT-01) ----
  /**
   * Add a picture or file to a page: its row, and where to send the bytes
   * (a path on this API's base URL, good for ten minutes and one upload).
   */
  createPageFile(docId: string, input: PageFileInput) {
    return this.request<PageFileUpload>(`/docs/${docId}/files`, {
      method: "POST",
      body: input,
    });
  }
  /** Send a picture's or file's bytes to the link from `createPageFile`. */
  async uploadPageFile(
    uploadPath: string,
    file: Blob | ArrayBuffer | Uint8Array,
    contentType: string,
  ): Promise<void> {
    return this.uploadImportFile(uploadPath, file, contentType);
  }
  /** A picture or file, with a link to show or download it for an hour. */
  pageFile(fileId: string) {
    return this.request<PageFileLink>(`/docs/files/${fileId}`);
  }
  /** The pictures and files on a page. */
  pageFiles(docId: string) {
    return this.request<PageFile[]>(`/docs/${docId}/files`);
  }
  /** Delete a picture or file for good. */
  deletePageFile(fileId: string) {
    return this.request<void>(`/docs/files/${fileId}`, { method: "DELETE" });
  }
  /** How much of your space pictures and files take. */
  filesUsage() {
    return this.request<PageFilesUsage>("/files/usage");
  }
  /** The full address of a path on this API (a file's link, say). */
  urlFor(path: string) {
    return this.baseUrl + path;
  }

  /** Something was opened: it leads the quick switcher's recent list. */
  recordRecent(kind: "doc" | "task" | "project", id: string) {
    return this.request<void>("/recents", {
      method: "POST",
      body: { kind, id },
    });
  }

  /**
   * A page as a file to keep. Comes back as a blob with the name the server
   * chose, so every client saves the same file under the same name.
   */
  async exportDoc(docId: string, format: ExportFormat) {
    const response = await this.raw(`/docs/${docId}/export?format=${format}`);
    const disposition = response.headers.get("content-disposition") ?? "";
    const named = /filename="([^"]+)"/.exec(disposition)?.[1];
    return { blob: await response.blob(), name: named ?? `document.${format}` };
  }

  // Documents
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
    const q = new URLSearchParams(
      Object.entries(filter).flatMap(([k, v]) => (v ? [[k, v]] : [])),
    ).toString();
    return this.request<DocSummary[]>(`/docs${q ? `?${q}` : ""}`);
  }
  getDoc(id: string) {
    return this.request<Doc>(`/docs/${id}`);
  }
  /** A page's Info panel: what it belongs to, tags, links, versions. */
  docInfo(id: string) {
    return this.request<DocInfo>(`/docs/${id}/info`);
  }
  /** Take a source off a page (H6b); the source stays for other pages. */
  removePageSource(docId: string, sourceId: string) {
    return this.request<void>(`/docs/${docId}/sources/${sourceId}`, {
      method: "DELETE",
    });
  }
  /** Put exactly these tags (by id) on a page. */
  setDocTags(id: string, tags: string[]) {
    return this.request<{ tags: DocTag[] }>(`/docs/${id}/tags`, {
      method: "PUT",
      body: { tags },
    });
  }
  /**
   * Add tags to a page by name, as typing "#physics" in a line does; a name
   * with no tag yet makes one. `added` says which names were new to it.
   */
  addDocTags(id: string, names: string[]) {
    return this.request<{ tags: DocTag[]; added: string[] }>(
      `/docs/${id}/tags`,
      { method: "POST", body: { names } },
    );
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
  }) {
    return this.request<Doc>("/docs", { method: "POST", body: input });
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
      version: number;
    },
    options: { ticksFrom?: number } = {},
  ) {
    return this.request<Doc>(`/docs/${id}`, {
      method: "PUT",
      body: input,
      ...(options.ticksFrom
        ? { headers: { "X-Orbyn-Ticks-From": String(options.ticksFrom) } }
        : {}),
    });
  }
  /** Move a page to Trash. It can be restored for `TRASH_DAYS` days. */
  deleteDoc(id: string) {
    return this.request<void>(`/docs/${id}`, { method: "DELETE" });
  }
  /** Pages in Trash, most recently deleted first. */
  listTrash() {
    return this.request<TrashedDoc[]>("/docs/trash");
  }
  /** Bring a page back from Trash, as it was. */
  restoreDoc(id: string) {
    return this.request<Doc>(`/docs/${id}/restore`, { method: "POST" });
  }
  /** Delete a page in Trash for good. There is no undo. */
  deleteDocForever(id: string) {
    return this.request<void>(`/docs/${id}/forever`, { method: "DELETE" });
  }

  /** Past states of a document, newest first, without their content. */
  listDocVersions(id: string) {
    return this.request<DocVersion[]>(`/docs/${id}/versions`);
  }
  /** One past state, with its content. */
  getDocVersion(id: string, version: number) {
    return this.request<Required<DocVersion>>(
      `/docs/${id}/versions/${version}`,
    );
  }
  /**
   * One past state for "Show changes": the version, the one kept before it,
   * and the sittings since (null when too many were kept since), in one read.
   */
  getDocVersionChanges(id: string, version: number) {
    return this.request<DocVersionChanges>(
      `/docs/${id}/versions/${version}/changes`,
    );
  }
  /** Put a past state back; it becomes a new version on top. */
  restoreDocVersion(id: string, version: number) {
    return this.request<Doc>(`/docs/${id}/versions/${version}/restore`, {
      method: "POST",
    });
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
  ): () => void {
    const abort = new AbortController();
    let stopped = false;
    const run = async () => {
      // Reconnect with a widening gap, so a server that is down is not
      // hammered by every open tab at once.
      let wait = 1_000;
      while (!stopped) {
        try {
          const token = await this.getToken();
          const response = await this.streamFetch(
            `${this.baseUrl}/events/docs/${id}`,
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
                  tags?: boolean;
                  fields?: boolean;
                  by?: string;
                };
                onChange(payload.version ?? 0, {
                  trashed: payload.trashed === true,
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

  listLists() {
    return this.request<TaskList[]>("/lists");
  }
  createList(input: ListInput) {
    return this.request<TaskList>("/lists", { method: "POST", body: input });
  }
  updateList(id: string, input: ListUpdate) {
    return this.request<TaskList>(`/lists/${id}`, {
      method: "PUT",
      body: input,
    });
  }
  deleteList(id: string) {
    return this.request<void>(`/lists/${id}`, { method: "DELETE" });
  }
  listTags() {
    return this.request<Tag[]>("/tags");
  }
  createTag(input: TagInput) {
    return this.request<Tag>("/tags", { method: "POST", body: input });
  }
  updateTag(id: string, input: TagUpdate) {
    return this.request<Tag>(`/tags/${id}`, { method: "PUT", body: input });
  }
  deleteTag(id: string) {
    return this.request<void>(`/tags/${id}`, { method: "DELETE" });
  }

  // ---- calendar, time blocks, planner ----
  /** Everything on the calendar in [from, to): occurrences, blocks, buffers and travel. */
  calendar(from: string, to: string) {
    const q = new URLSearchParams({ from, to });
    return this.request<CalendarView>(`/calendar?${q}`);
  }
  listBlocks(from: string, to: string) {
    const q = new URLSearchParams({ from, to });
    return this.request<TimeBlock[]>(`/blocks?${q}`);
  }
  /** Your sessions for one task, past ones too, with its deadline. Makes no plan. */
  itemSessions(itemId: string) {
    return this.request<ItemSessions>(`/items/${itemId}/sessions`);
  }
  createBlock(input: BlockInput) {
    return this.request<TimeBlock>("/blocks", { method: "POST", body: input });
  }
  /**
   * A session on a day (a task dropped on a calendar day): the first free
   * working time that day, or a 409 saying there's none.
   */
  createBlockOnDay(input: BlockOnDayInput) {
    return this.request<TimeBlock>("/blocks", { method: "POST", body: input });
  }
  updateBlock(id: string, input: BlockUpdate) {
    return this.request<TimeBlock>(`/blocks/${id}`, {
      method: "PUT",
      body: input,
    });
  }
  deleteBlock(id: string) {
    return this.request<void>(`/blocks/${id}`, { method: "DELETE" });
  }
  /** Sessions that ended in the last few days and wait for "how did it go?". */
  sessionCheckIns() {
    return this.request<SessionCheckIn[]>("/blocks/check-ins");
  }
  /** Say how a session went: done for today, need more, or skip. */
  checkInSession(id: string, input: SessionCheckInInput) {
    return this.request<SessionCheckedIn>(`/blocks/${id}/check-in`, {
      method: "POST",
      body: input,
    });
  }
  /** Mark a session started (from its reminder, or while it's on). */
  startSession(id: string, from: "app" | "reminder" = "app") {
    return this.request<{ id: string; item_id: string; started_at: string }>(
      `/blocks/${id}/start`,
      { method: "POST", body: { from } },
    );
  }
  /**
   * Move a block to the next free working time of the same length, one that
   * ends by its task's deadline when there is one. With `before_deadline`,
   * only such a time will do (409 when there's none).
   */
  rescheduleBlock(id: string, input: BlockRescheduleInput = {}) {
    return this.request<TimeBlock>(`/blocks/${id}/reschedule`, {
      method: "POST",
      body: input,
    });
  }
  /** Another block for the same task and length, at `start_at` or the next free time after it. */
  duplicateBlock(id: string, input: BlockDuplicateInput = {}) {
    return this.request<TimeBlock>(`/blocks/${id}/duplicate`, {
      method: "POST",
      body: input,
    });
  }
  /** Where your set-aside time went over the last `days`. */
  getAnalytics(days = 30) {
    return this.request<PlannerAnalytics>(`/planner/analytics?days=${days}`);
  }
  getPlannerPrefs() {
    return this.request<PlannerPrefs>("/planner/prefs");
  }
  updatePlannerPrefs(input: PlannerPrefsInput) {
    return this.request<PlannerPrefs>("/planner/prefs", {
      method: "PUT",
      body: input,
    });
  }
  /** What the planner has learned about how long your tasks really take. */
  getEstimates() {
    return this.request<EstimateModel>("/planner/estimates");
  }
  /** Everything the planner has learned from your history. */
  getLearning() {
    return this.request<PlannerLearning>("/planner/learning");
  }
  /** What to do now: the free time until your next event and tasks for it. */
  getUpNext() {
    return this.request<UpNext>("/planner/next");
  }
  /**
   * Today, planned and due in one list: events, your sessions, tasks due
   * today and late ones, and unfinished sessions from earlier days. The day
   * is your account's (the planner zone, as the agenda has it); `timezone`
   * (pass the device's) counts only while the account has none of its own.
   */
  today(timezone?: string) {
    const q = timezone ? `?${new URLSearchParams({ timezone })}` : "";
    return this.request<TodayList>(`/today${q}`);
  }
  /**
   * Your planned time, task by task, with each task's status: some tasks
   * (`item_ids`), or every open task that's yours to plan plus any with a
   * session in the window (`from`, `to`), whose sessions each lists.
   */
  planned(options: { item_ids?: string[]; from?: string; to?: string } = {}) {
    const q = new URLSearchParams();
    if (options.item_ids?.length) q.set("item_ids", options.item_ids.join(","));
    if (options.from && options.to) {
      q.set("from", options.from);
      q.set("to", options.to);
    }
    const text = q.toString();
    return this.request<PlannedFeed>(`/planned${text ? `?${text}` : ""}`);
  }
  /** Email yourself a digest now, to preview it. */
  sendTestDigest(kind: "morning" | "evening" = "morning") {
    return this.request<void>("/planner/digest/test", {
      method: "POST",
      body: { kind },
    });
  }
  listFrames() {
    return this.request<Frame[]>("/planner/frames");
  }
  createFrame(input: FrameInput) {
    return this.request<Frame>("/planner/frames", {
      method: "POST",
      body: input,
    });
  }
  updateFrame(id: string, input: FrameUpdate) {
    return this.request<Frame>(`/planner/frames/${id}`, {
      method: "PUT",
      body: input,
    });
  }
  deleteFrame(id: string) {
    return this.request<void>(`/planner/frames/${id}`, { method: "DELETE" });
  }
  // ---- habits ----
  listHabits() {
    return this.request<Habit[]>("/planner/habits");
  }
  createHabit(input: HabitInput) {
    return this.request<Habit>("/planner/habits", {
      method: "POST",
      body: input,
    });
  }
  updateHabit(id: string, input: HabitUpdate) {
    return this.request<Habit>(`/planner/habits/${id}`, {
      method: "PUT",
      body: input,
    });
  }
  deleteHabit(id: string) {
    return this.request<void>(`/planner/habits/${id}`, { method: "DELETE" });
  }
  /** Propose sessions for the active habits; nothing is saved. */
  planHabits(input: HabitPlanInput = {}) {
    return this.request<HabitPlan>("/planner/habits/plan", {
      method: "POST",
      body: input,
    });
  }
  /** Save proposed sessions, skipping any that now clash. */
  applyHabitPlan(
    blocks: { habit_id: string; start_at: string; end_at: string }[],
  ) {
    return this.request<HabitBlock[]>("/planner/habits/plan/apply", {
      method: "POST",
      body: { blocks },
    });
  }
  deleteHabitBlock(id: string) {
    return this.request<void>(`/planner/habits/blocks/${id}`, {
      method: "DELETE",
    });
  }
  /** Skip one date ("YYYY-MM-DD") of a frame. */
  skipFrame(id: string, date: string) {
    return this.request<Frame>(`/planner/frames/${id}/skip`, {
      method: "POST",
      body: { date },
    });
  }
  /** Bring back a skipped date of a frame. */
  unskipFrame(id: string, date: string) {
    return this.request<Frame>(`/planner/frames/${id}/unskip`, {
      method: "POST",
      body: { date },
    });
  }
  listPlaces() {
    return this.request<Place[]>("/planner/places");
  }
  createPlace(input: PlaceInput) {
    return this.request<Place>("/planner/places", {
      method: "POST",
      body: input,
    });
  }
  updatePlace(id: string, input: PlaceUpdate) {
    return this.request<Place>(`/planner/places/${id}`, {
      method: "PUT",
      body: input,
    });
  }
  deletePlace(id: string) {
    return this.request<void>(`/planner/places/${id}`, { method: "DELETE" });
  }
  /** A proposed plan; nothing is saved until `applyPlan`. */
  previewPlan(input: PlanPreviewInput = {}) {
    return this.request<Plan>("/planner/preview", {
      method: "POST",
      body: input,
    });
  }
  getPlan(id: string) {
    return this.request<Plan>(`/planner/plans/${id}`);
  }
  /** Tune a plan (tasks in or out, estimates, pinned blocks, keep-free, scope); returns the new plan that replaces it. */
  tunePlan(id: string, input: PlanTuneInput) {
    return this.request<Plan>(`/planner/plans/${id}`, {
      method: "PATCH",
      body: input,
    });
  }
  /** Whether the calendar or tasks changed since the plan was made. */
  planStale(id: string) {
    return this.request<PlanStaleness>(`/planner/plans/${id}/stale`);
  }
  /**
   * Save a plan: its new sessions, and the late sessions to move before
   * their deadline (`moves`, block ids; the ones the planner ticked when
   * omitted).
   */
  applyPlan(id: string, input: PlanApplyInput = {}) {
    return this.request<PlanApplied>(`/planner/plans/${id}/apply`, {
      method: "POST",
      body: input,
    });
  }
  /** Unfinished blocks, tasks at risk, and blocks that clash with events. */
  plannerReview() {
    return this.request<PlannerReview>("/planner/review");
  }
  /** A plan for unfinished work (all of it, or the given blocks). */
  rollForward(blockIds?: string[]) {
    return this.request<Plan>("/planner/roll-forward", {
      method: "POST",
      body: blockIds ? { block_ids: blockIds } : {},
    });
  }
  /**
   * Create (or replace) your private calendar subscription link, or with
   * `busy: true` the link that only shows when you're busy.
   */
  createCalendarFeed(options: { busy?: boolean } = {}) {
    return this.request<CalendarFeed>("/me/calendar-feed", {
      method: "POST",
      body: options.busy ? { busy: true } : {},
    });
  }
  deleteCalendarFeed(options: { busy?: boolean } = {}) {
    return this.request<void>(
      `/me/calendar-feed${options.busy ? "?busy=1" : ""}`,
      { method: "DELETE" },
    );
  }
  /** Which feed links are on, and whether the feed includes time blocks. */
  calendarFeedSettings() {
    return this.request<CalendarFeedSettings>("/me/calendar-feed");
  }
  updateCalendarFeedSettings(input: CalendarFeedSettingsInput) {
    return this.request<CalendarFeedSettings>("/me/calendar-feed", {
      method: "PUT",
      body: input,
    });
  }

  // ---- calendars from other apps (ICS links) ----
  listCalendarSubscriptions() {
    return this.request<CalendarSubscription[]>("/me/calendar-subscriptions");
  }
  createCalendarSubscription(input: CalendarSubscriptionInput) {
    return this.request<CalendarSubscription>("/me/calendar-subscriptions", {
      method: "POST",
      body: input,
    });
  }
  updateCalendarSubscription(id: string, input: CalendarSubscriptionUpdate) {
    return this.request<CalendarSubscription>(
      `/me/calendar-subscriptions/${id}`,
      { method: "PUT", body: input },
    );
  }
  deleteCalendarSubscription(id: string) {
    return this.request<void>(`/me/calendar-subscriptions/${id}`, {
      method: "DELETE",
    });
  }
  /** Fetch it now instead of waiting for the hourly refresh. */
  refreshCalendarSubscription(id: string) {
    return this.request<CalendarSubscription>(
      `/me/calendar-subscriptions/${id}/refresh`,
      { method: "POST" },
    );
  }

  /** Events matching words, a year either side of today unless a range is given. */
  searchCalendar(q: string, range: { from?: string; to?: string } = {}) {
    const params = new URLSearchParams({ q });
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
    return this.request<CalendarSearch>(`/calendar/search?${params}`);
  }
  /** Busy times of up to 10 people you share a team with (at most 31 days). */
  availability(userIds: string[], from: string, to: string) {
    const q = new URLSearchParams({ user_ids: userIds.join(","), from, to });
    return this.request<UserAvailability[]>(`/availability?${q}`);
  }

  // ---- invitations (public: the invitee's private link) ----
  getRsvp(token: string) {
    return this.request<RsvpView>(`/rsvp/${encodeURIComponent(token)}`, {
      anonymous: true,
    });
  }
  answerRsvp(token: string, status: "accepted" | "declined" | "tentative") {
    return this.request<RsvpView>(`/rsvp/${encodeURIComponent(token)}`, {
      method: "POST",
      body: { status },
      anonymous: true,
    });
  }

  // ---- team time ----
  teamAvailability(teamId: string, from: string, to: string) {
    const q = new URLSearchParams({ from, to });
    return this.request<MemberAvailability[]>(
      `/teams/${teamId}/availability?${q}`,
    );
  }
  teamWorkload(teamId: string, from: string, to: string) {
    const q = new URLSearchParams({ from, to });
    return this.request<MemberWorkload[]>(`/teams/${teamId}/workload?${q}`);
  }
  /** Team owners' analytics: set-aside time per member, over `days`. */
  teamAnalytics(teamId: string, days = 30) {
    return this.request<TeamAnalytics>(
      `/teams/${teamId}/analytics?days=${days}`,
    );
  }
  suggestMeetingTimes(
    teamId: string,
    params: { from: string; to: string; duration: number; user_ids?: string[] },
  ) {
    const q = new URLSearchParams({
      from: params.from,
      to: params.to,
      duration: String(params.duration),
    });
    if (params.user_ids?.length) q.set("user_ids", params.user_ids.join(","));
    return this.request<MeetingSlot[]>(`/teams/${teamId}/suggest?${q}`);
  }

  // ---- booking pages ----
  listBookingPages() {
    return this.request<BookingPage[]>("/booking-pages");
  }
  createBookingPage(input: BookingPageInput) {
    return this.request<BookingPage>("/booking-pages", {
      method: "POST",
      body: input,
    });
  }
  updateBookingPage(id: string, input: BookingPageUpdate) {
    return this.request<BookingPage>(`/booking-pages/${id}`, {
      method: "PUT",
      body: input,
    });
  }
  deleteBookingPage(id: string) {
    return this.request<void>(`/booking-pages/${id}`, { method: "DELETE" });
  }
  /** One page's upcoming and recent bookings (older apps; prefer `bookings`). */
  listBookings(pageId: string) {
    return this.request<Booking[]>(`/booking-pages/${pageId}/bookings`);
  }
  cancelBooking(pageId: string, bookingId: string) {
    return this.request<{ cancelled: boolean }>(
      `/booking-pages/${pageId}/bookings/${bookingId}/cancel`,
      { method: "POST" },
    );
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
    return this.request<BookingStats>(
      `/bookings/stats${pageId ? `?page_id=${pageId}` : ""}`,
    );
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
    const q = new URLSearchParams({ timezone: params.timezone });
    if (params.date) q.set("date", params.date);
    if (params.days) q.set("days", String(params.days));
    return this.request<
      Pick<PublicBookingPage, "timezone" | "duration" | "slots">
    >(`/bookings/${id}/slots?${q}`);
  }
  getBooking(id: string) {
    return this.request<BookingDetail>(`/bookings/${id}`);
  }
  approveBooking(id: string) {
    return this.request<BookingDetail>(`/bookings/${id}/approve`, {
      method: "POST",
    });
  }
  declineBooking(id: string, reason = "") {
    return this.request<BookingDetail>(`/bookings/${id}/decline`, {
      method: "POST",
      body: { reason },
    });
  }
  /** Cancel as a host; the booker is emailed with your reason. */
  cancelBookingAsHost(id: string, reason = "") {
    return this.request<BookingDetail>(`/bookings/${id}/cancel`, {
      method: "POST",
      body: { reason },
    });
  }
  rescheduleBooking(id: string, startAt: string) {
    return this.request<BookingDetail>(`/bookings/${id}/reschedule`, {
      method: "POST",
      body: { start_at: startAt },
    });
  }
  setBookingNoShow(id: string, noShow: boolean) {
    return this.request<BookingDetail>(`/bookings/${id}/no-show`, {
      method: "PUT",
      body: { no_show: noShow },
    });
  }
  setBookingNote(id: string, hostNote: string) {
    return this.request<BookingDetail>(`/bookings/${id}/note`, {
      method: "PUT",
      body: { host_note: hostNote },
    });
  }
  /** Public: a booking from the booker's manage link. */
  getManagedBooking(token: string) {
    return this.request<ManagedBooking>(
      `/book/manage/${encodeURIComponent(token)}`,
      { anonymous: true },
    );
  }
  /** Public: free times to move a booking to. */
  getRescheduleSlots(
    token: string,
    params: { date?: string; days?: number; timezone: string },
  ) {
    const q = new URLSearchParams({ timezone: params.timezone });
    if (params.date) q.set("date", params.date);
    if (params.days) q.set("days", String(params.days));
    return this.request<
      Pick<PublicBookingPage, "timezone" | "duration" | "slots">
    >(`/book/manage/${encodeURIComponent(token)}/slots?${q}`, {
      anonymous: true,
    });
  }
  /** Public: move a booking from its manage link. */
  rescheduleByToken(token: string, startAt: string) {
    return this.request<ManagedBooking>(
      `/book/manage/${encodeURIComponent(token)}/reschedule`,
      { method: "POST", body: { start_at: startAt }, anonymous: true },
    );
  }
  /** Public: cancel from the manage link. */
  cancelByManageToken(token: string, reason = "") {
    return this.request<ManagedBooking>(
      `/book/manage/${encodeURIComponent(token)}/cancel`,
      { method: "POST", body: { reason }, anonymous: true },
    );
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
    const q = new URLSearchParams({ timezone: params.timezone });
    if (params.duration) q.set("duration", String(params.duration));
    if (params.date) q.set("date", params.date);
    if (params.days) q.set("days", String(params.days));
    return this.request<PublicBookingPage>(
      `/book/${encodeURIComponent(slug)}?${q}`,
      { anonymous: true },
    );
  }
  /** Public: ask for a time on a booking page. */
  book(slug: string, input: BookingRequest) {
    return this.request<BookingReceipt>(`/book/${encodeURIComponent(slug)}`, {
      method: "POST",
      body: input,
      anonymous: true,
    });
  }
  /** Public: the link from the confirmation email. */
  confirmBooking(token: string) {
    return this.request<BookingReceipt>(
      `/book/confirm/${encodeURIComponent(token)}`,
      {
        method: "POST",
        anonymous: true,
      },
    );
  }
  /** Public: the cancel link from a booking email. */
  cancelBookingByToken(token: string) {
    return this.request<{ cancelled: boolean }>(
      `/book/cancel/${encodeURIComponent(token)}`,
      { method: "POST", anonymous: true },
    );
  }

  // ---- open invites ----
  listOpenInvites() {
    return this.request<OpenInvite[]>("/open-invites");
  }
  /** A one-off link offering hand-picked windows; its `url` is the link to send. */
  createOpenInvite(input: OpenInviteInput) {
    return this.request<OpenInvite>("/open-invites", {
      method: "POST",
      body: input,
    });
  }
  getOpenInvite(id: string) {
    return this.request<OpenInvite>(`/open-invites/${id}`);
  }
  /** Withdraw an invite (a booking made from it is cancelled). */
  cancelOpenInvite(id: string) {
    return this.request<void>(`/open-invites/${id}`, { method: "DELETE" });
  }
  /** Public: an open invite and its free times, from its link. */
  getPublicInvite(token: string, timezone: string) {
    return this.request<PublicInvite>(
      `/invite/${encodeURIComponent(token)}?${new URLSearchParams({ timezone })}`,
      { anonymous: true },
    );
  }
  /** Public: pick a time from an open invite (booked at once). */
  bookInvite(token: string, input: InviteBookingRequest) {
    return this.request<BookingReceipt>(
      `/invite/${encodeURIComponent(token)}`,
      { method: "POST", body: input, anonymous: true },
    );
  }

  // ---- profile page ----
  getProfile() {
    return this.request<Profile>("/me/profile");
  }
  /** `handle: null` removes your page. */
  updateProfile(input: ProfileInput) {
    return this.request<Profile>("/me/profile", { method: "PUT", body: input });
  }
  /** Public: someone's profile page and their booking pages. */
  getPublicProfile(handle: string) {
    return this.request<PublicProfile>(`/u/${encodeURIComponent(handle)}`, {
      anonymous: true,
    });
  }

  // ---- API keys and webhooks ----
  /** Public: the OpenAPI description of the API, as YAML. */
  openApiSpec() {
    return this.request<string>("/openapi.yaml", {
      anonymous: true,
      raw: true,
    });
  }
  listApiKeys() {
    return this.request<ApiKey[]>("/me/api-keys");
  }
  /** The returned `key` is shown once. */
  createApiKey(name: string) {
    return this.request<NewApiKey>("/me/api-keys", {
      method: "POST",
      body: { name },
    });
  }
  deleteApiKey(id: string) {
    return this.request<void>(`/me/api-keys/${id}`, { method: "DELETE" });
  }
  // ---- Connected agents (MCP) ----
  /** Your connected agents, the MCP address, and until when old keys work there. */
  agents() {
    return this.request<AgentsOverview>("/me/agents");
  }
  /** The MCP server's public description, for the developer page. */
  developerCatalog() {
    return this.request<McpCatalog>("/developers/mcp", { anonymous: true });
  }
  /** A connection's toolsets besides core (Settings → Connected agents). */
  setAgentToolsets(id: string, toolsets: AgentToolset[]) {
    return this.request<AgentGrant>(`/me/agents/${id}/toolsets`, {
      method: "PUT",
      body: { toolsets },
    });
  }
  /**
   * A connection's trust: full power, ask first or suggest only, per space,
   * and which ask-first items it may do alone (Settings → Connected agents).
   */
  setAgentTrust(id: string, input: AgentTrustInput) {
    return this.request<AgentGrant>(`/me/agents/${id}/trust`, {
      method: "PUT",
      body: input,
    });
  }
  /** What a connection is sent, its wake-up address and unread count (H0). */
  agentInbox(id: string) {
    return this.request<AgentInboxSettings>(`/me/agents/${id}/inbox`);
  }
  /** The kinds a connection is not sent ("Send to this agent" off). */
  setAgentInboxMutes(id: string, muted: AgentInboxKind[]) {
    return this.request<AgentInboxSettings>(`/me/agents/${id}/inbox`, {
      method: "PUT",
      body: { muted },
    });
  }
  /** Sets the wake-up address; the signing secret comes back once. */
  setAgentWake(id: string, url: string) {
    return this.request<NewAgentWake>(`/me/agents/${id}/wake`, {
      method: "PUT",
      body: { url },
    });
  }
  clearAgentWake(id: string) {
    return this.request<AgentInboxSettings>(`/me/agents/${id}/wake`, {
      method: "DELETE",
    });
  }
  /** Calls the wake-up address now and says what it answered. */
  testAgentWake(id: string) {
    return this.request<{
      ok: boolean;
      status: number | null;
      error: string | null;
    }>(`/me/agents/${id}/wake/test`, { method: "POST" });
  }
  /** The person's standing rules for their agents. */
  agentRules() {
    return this.request<AgentRule[]>("/me/agent-rules");
  }
  addAgentRule(input: AgentRuleInput) {
    return this.request<AgentRule>("/me/agent-rules", {
      method: "POST",
      body: input,
    });
  }
  updateAgentRule(id: string, input: AgentRuleInput) {
    return this.request<AgentRule>(`/me/agent-rules/${id}`, {
      method: "PUT",
      body: input,
    });
  }
  deleteAgentRule(id: string) {
    return this.request<void>(`/me/agent-rules/${id}`, { method: "DELETE" });
  }
  /** "About me for agents" and each space's instructions (H8). */
  agentContext() {
    return this.request<AgentContextSettings>("/me/agent-context");
  }
  agentSettings() {
    return this.request<PersonalAgentSettings>("/me/agent");
  }
  updateAgentSettings(input: AgentIdentityInput) {
    return this.request<PersonalAgentSettings>("/me/agent", {
      method: "PUT",
      body: input,
    });
  }
  /** Opens the About me page, making it first when there isn't one. */
  openAgentProfile() {
    return this.request<{ doc_id: string; title: string; created: boolean }>(
      "/me/agent-profile",
      { method: "POST" },
    );
  }
  /** Changes a space's instructions for agents (null: Personal). */
  setAgentInstructions(teamId: string | null, text: string) {
    return this.request<AgentContextSettings>(
      teamId ? `/teams/${teamId}/agent-instructions` : "/me/agent-instructions",
      { method: "PUT", body: { text } },
    );
  }
  /** Questions agents asked, waiting for an answer. */
  agentQuestions() {
    return this.request<AgentQuestion[]>("/me/questions");
  }
  /** Answers an agent's question (its card, or the push's buttons). */
  answerAgentQuestion(id: string, answer: string, via: "app" | "push" = "app") {
    return this.request<AgentQuestion>(`/me/questions/${id}/answer`, {
      method: "POST",
      body: { answer, via },
    });
  }
  /** A new agent key; the returned `key` is shown once. */
  createAgentKey(input: AgentKeyInput) {
    return this.request<NewAgentKey>("/me/agent-keys", {
      method: "POST",
      body: input,
    });
  }
  /** Revoke a connection (an agent key, or an old key's MCP access). */
  revokeAgent(id: string) {
    return this.request<void>(`/me/agents/${id}`, { method: "DELETE" });
  }
  /** Restore a connection Orbyn paused for misbehaving. */
  restoreAgent(id: string) {
    return this.request<void>(`/me/agents/${id}/restore`, { method: "POST" });
  }
  /** What one connection did, newest first. */
  agentActivity(id: string) {
    return this.request<AgentActivity[]>(`/me/agents/${id}/activity`);
  }
  /** Undo one change an agent made directly (from its activity). */
  undoAgentChange(activityId: string) {
    return this.request<{ undone: true; summary: string }>(
      `/me/agents/activity/${activityId}/undo`,
      { method: "POST" },
    );
  }
  /** Undo a whole job of one agent (a plan, or one call's changes). */
  undoAgentJob(grantId: string, job: string) {
    return this.request<{ undone: number }>(
      `/me/agents/${grantId}/jobs/${encodeURIComponent(job)}/undo`,
      { method: "POST" },
    );
  }
  // ---- The Review inbox ----
  /** What waits for approval, and what was decided lately. */
  reviewInbox() {
    return this.request<ReviewInbox>("/proposals");
  }
  /** How many proposals wait, for the badge. */
  reviewCount() {
    return this.request<{ pending: number }>("/proposals/count");
  }
  /** One proposal, each change checked against what is there now. */
  reviewItem(id: string) {
    return this.request<ReviewItem>(`/proposals/${id}`);
  }
  /** Approve a proposal (all of it, or `only` some of its changes). */
  approveReview(id: string, input: ReviewApproveInput = {}) {
    return this.request<ReviewApplied>(`/proposals/${id}/apply`, {
      method: "POST",
      body: input,
    });
  }
  /** Decline a proposal: nothing changes. */
  declineReview(id: string) {
    return this.request<void>(`/proposals/${id}/decline`, { method: "POST" });
  }
  /**
   * Approve or Decline from a notification's button: says how it ended,
   * even when it was already decided.
   */
  respondToReview(id: string, decision: "approve" | "decline") {
    return this.request<{ status: ProposalStatus }>(
      `/proposals/${id}/respond`,
      { method: "POST", body: { decision } },
    );
  }
  /** Team settings → Outside agents: the policy, and (managers) who connects. */
  teamAgents(teamId: string) {
    return this.request<TeamAgentsView>(`/teams/${teamId}/agents`);
  }
  // ---- Signing in with Orbyn (the consent page) ----
  /** What an app's sign-in request asks for; with your spaces when signed in. */
  oauthCheck(request: OAuthRequest) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(request))
      if (typeof v === "string") q.set(k, v);
    return this.request<OAuthCheck>(`/oauth/authorize/check?${q}`);
  }
  /** Allow the request: where to send the browser back, with a code. */
  oauthAllow(input: OAuthConsentInput) {
    return this.request<OAuthRedirect>("/oauth/authorize", {
      method: "POST",
      body: input,
    });
  }
  /** Decline the request: where to send the browser back, with an error. */
  oauthDeny(request: OAuthRequest) {
    return this.request<OAuthRedirect>("/oauth/authorize/deny", {
      method: "POST",
      body: { request },
    });
  }
  /** Passkey options for confirming it's you (without a new session). */
  reauthOptions() {
    return this.request<{ handle: string; options: unknown }>(
      "/me/reauth/options",
      { method: "POST", body: {} },
    );
  }
  /** Confirm it's you: password (and two-step code) or a passkey. */
  reauth(input: ReauthInput) {
    return this.request<Reauthenticated>("/me/reauth", {
      method: "POST",
      body: input,
    });
  }
  /** A team's cap on outside agents (owners and admins). */
  setTeamAgentAccess(teamId: string, agent_access: TeamAgentAccess) {
    return this.request<{ id: string; agent_access: TeamAgentAccess }>(
      `/teams/${teamId}/agent-access`,
      { method: "PUT", body: { agent_access } },
    );
  }
  listWebhooks() {
    return this.request<Webhook[]>("/me/webhooks");
  }
  /** The returned `secret` signs deliveries and is shown once. */
  createWebhook(input: WebhookInput) {
    return this.request<NewWebhook>("/me/webhooks", {
      method: "POST",
      body: input,
    });
  }
  updateWebhook(id: string, input: WebhookUpdate) {
    return this.request<Webhook>(`/me/webhooks/${id}`, {
      method: "PUT",
      body: input,
    });
  }
  deleteWebhook(id: string) {
    return this.request<void>(`/me/webhooks/${id}`, { method: "DELETE" });
  }
  testWebhook(id: string) {
    return this.request<WebhookTestResult>(`/me/webhooks/${id}/test`, {
      method: "POST",
    });
  }
  /** Follows pagination until the planner is fully loaded. */
  async listAllItems(pageSize = 500) {
    const all: Item[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = await this.listItems({ limit: pageSize, offset });
      all.push(...page);
      if (page.length < pageSize) break;
    }
    return all;
  }
  /** Create an item; `id` names it on the device (made offline). */
  createItem(input: Partial<ItemInput> & { title: string; id?: string }) {
    return this.request<Item>("/items", { method: "POST", body: input });
  }
  /**
   * Create an item from one line of text ("Lunch with @anna tomorrow 1pm
   * ;Cafe Roma"), parsed on the server without AI.
   */
  /** A shared link's title and site, looked up on the server for the share sheet. */
  linkPreview(url: string) {
    return this.request<LinkPreview>("/capture/preview", {
      method: "POST",
      body: { url },
    });
  }
  /**
   * Put a link or some text shared into Orbyn where it was sent: an Inbox
   * task, today's agenda, a page, a new page in a folder, or a project.
   */
  capture(input: CaptureRequest) {
    return this.request<CaptureResult>("/capture", {
      method: "POST",
      body: input,
    });
  }
  quickAdd(text: string, timezone?: string) {
    return this.request<QuickAddCreated>("/items/quick", {
      method: "POST",
      body: { text, ...(timezone ? { timezone } : {}) },
    });
  }
  /** What quick add would make of the text, with its chips. Nothing is saved. */
  previewQuickAdd(text: string, timezone?: string) {
    return this.request<QuickAddResult>("/items/quick", {
      method: "POST",
      body: { text, preview: true, ...(timezone ? { timezone } : {}) },
    });
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
    return this.request<Item>(`/items/${id}${scopeQuery(options)}`, {
      method: "PUT",
      body: input,
    });
  }
  deleteItem(
    id: string,
    version: number,
    options: { scope?: EditScope; occurrence?: string } = {},
  ) {
    const scope = scopeQuery(options).replace(/^\?/, "&");
    return this.request<void>(`/items/${id}?version=${version}${scope}`, {
      method: "DELETE",
    });
  }

  /** A task with its checklist steps and progress timeline. */
  getItem(id: string) {
    return this.request<ItemDetail>(`/items/${id}`);
  }
  addStep(itemId: string, input: { title: string }) {
    return this.request<ItemDetail>(`/items/${itemId}/steps`, {
      method: "POST",
      body: input,
    });
  }
  updateStep(
    itemId: string,
    stepId: string,
    input: { title?: string; done?: boolean },
  ) {
    return this.request<ItemDetail>(`/items/${itemId}/steps/${stepId}`, {
      method: "PUT",
      body: input,
    });
  }
  deleteStep(itemId: string, stepId: string) {
    return this.request<ItemDetail>(`/items/${itemId}/steps/${stepId}`, {
      method: "DELETE",
    });
  }
  /** Post a progress note, optionally changing status or progress. */
  postItemUpdate(
    itemId: string,
    input: { body?: string; status?: Status; progress?: number },
  ) {
    return this.request<ItemDetail>(`/items/${itemId}/updates`, {
      method: "POST",
      body: input,
    });
  }

  // ---- devices (mobile push) ----
  registerDevice(token: string) {
    return this.request<void>("/devices", { method: "POST", body: { token } });
  }
  removeDevice(token: string) {
    return this.request<void>("/devices", {
      method: "DELETE",
      body: { token },
    });
  }

  // ---- notifications ----
  listNotifications() {
    return this.request<Notice[]>("/notifications");
  }
  markNotificationRead(id: string) {
    return this.request<void>(`/notifications/${id}/read`, { method: "POST" });
  }

  // ---- AI assistant ----
  /** Whether the configured assistant can read with tools and draft pages. */
  aiCapabilities() {
    return this.request<{ enabled: boolean; tools: boolean }>(
      "/ai/capabilities",
    );
  }
  /** Draft a project (subtasks) from a prompt, as a proposal to review. */
  draftProject(
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
  async chat(
    message: string,
    timezone: string,
    history: ChatTurn[] = [],
    scope: ChatScope | null = null,
  ) {
    const { id } = await this.request<{ id: string }>("/ai/chat/start", {
      method: "POST",
      body: { message, timezone, history: history.slice(-12), scope },
    });
    const until = Date.now() + CHAT_WAIT_MS;
    let delay = CHAT_POLL_MS;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, CHAT_POLL_MAX_MS);
      const job = await this.request<ChatJob>(`/ai/chat/${id}`);
      if (job.state === "done") return job.proposal;
      if (job.state === "failed")
        throw new HttpError(job.status ?? 502, job.message);
    }
    throw new HttpError(
      504,
      "That took too long to answer. Try again, or ask for less at once.",
    );
  }
  applyProposal(id: string, options?: { give_tasks_deadlines?: boolean }) {
    // `project_id`: the project a drafted-project proposal made, else null.
    return this.request<{ applied: boolean; project_id: string | null }>(
      `/ai/proposals/${id}/apply`,
      {
        method: "POST",
        body: options ?? {},
      },
    );
  }

  // ---- teams ----
  listTeams() {
    return this.request<Team[]>("/teams");
  }
  createTeam(input: { name: string }) {
    return this.request<Team>("/teams", { method: "POST", body: input });
  }
  getTeam(id: string) {
    return this.request<TeamDetail>(`/teams/${id}`);
  }
  updateTeam(id: string, input: { name: string }) {
    return this.request<Team>(`/teams/${id}`, { method: "PUT", body: input });
  }
  deleteTeam(id: string) {
    return this.request<void>(`/teams/${id}`, { method: "DELETE" });
  }
  addTeamMember(teamId: string, input: { email: string; role?: TeamRole }) {
    return this.request<TeamMember>(`/teams/${teamId}/members`, {
      method: "POST",
      body: input,
    });
  }
  updateTeamMember(teamId: string, userId: string, input: { role: TeamRole }) {
    return this.request<TeamMember>(`/teams/${teamId}/members/${userId}`, {
      method: "PUT",
      body: input,
    });
  }
  /** Remove a member, or leave the team when `userId` is your own id. */
  removeTeamMember(teamId: string, userId: string) {
    return this.request<void>(`/teams/${teamId}/members/${userId}`, {
      method: "DELETE",
    });
  }

  // ---- admin (system admins only) ----
  adminOverview() {
    return this.request<AdminOverview>("/admin/overview");
  }
  /** How each service is answering over the last `hours`. */
  adminRequestSummary(hours = 24) {
    return this.request<RequestSummary>(
      `/admin/requests/summary?hours=${hours}`,
    );
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
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters))
      if (v !== undefined && v !== "" && v !== false) q.set(k, String(v));
    return this.request<{ rows: RequestLogRow[]; more: boolean }>(
      `/admin/requests${q.size ? `?${q}` : ""}`,
    );
  }
  adminAnalytics(days = 30) {
    return this.request<AdminAnalytics>(`/admin/analytics?days=${days}`);
  }
  adminUserDetail(id: string) {
    return this.request<AdminUserDetail>(`/admin/users/${id}`);
  }
  adminUpdateUserProfile(id: string, input: { name?: string; email?: string }) {
    return this.request<{ ok: true; verify_again: boolean }>(
      `/admin/users/${id}/profile`,
      { method: "PUT", body: input },
    );
  }
  /** Sign someone out on every device. */
  adminSignOutUser(id: string) {
    return this.request<{ ended: number }>(`/admin/users/${id}/sign-out`, {
      method: "POST",
    });
  }
  adminEndSession(id: string, sessionId: string) {
    return this.request<void>(`/admin/users/${id}/sessions/${sessionId}`, {
      method: "DELETE",
    });
  }
  /** Revoke one of an account's personal API keys (recorded in the audit log). */
  adminRevokeApiKey(id: string, keyId: string) {
    return this.request<void>(`/admin/users/${id}/api-keys/${keyId}`, {
      method: "DELETE",
    });
  }
  /** Admin: the apps that have signed in with Orbyn. */
  adminAgentClients() {
    return this.request<AdminAgentClient[]>("/admin/agents/clients");
  }
  /** Admin: agent use by app over the last `days`. */
  adminAgentUsage(days = 30) {
    return this.request<AdminAgentUsage>(`/admin/agents/usage?days=${days}`);
  }
  /** Admin: end one of an account's agent connections. */
  adminRevokeUserAgent(id: string, grantId: string) {
    return this.request<void>(`/admin/users/${id}/agents/${grantId}`, {
      method: "DELETE",
    });
  }
  /** Admin: the switches and limits for outside agents. */
  adminAgentSettings() {
    return this.request<AgentSettings>("/admin/agents");
  }
  adminUpdateAgentSettings(input: AgentSettingsUpdate) {
    return this.request<AgentSettings>("/admin/agents", {
      method: "PUT",
      body: input,
    });
  }
  /** A one-hour password reset link to pass on (also emailed when mail is set up). */
  adminResetLink(id: string) {
    return this.request<{
      link: string;
      expires_in_minutes: number;
      emailed: boolean;
    }>(`/admin/users/${id}/reset-link`, { method: "POST" });
  }
  adminResetTwoFactor(id: string) {
    return this.request<{ cleared: boolean }>(`/admin/users/${id}/reset-2fa`, {
      method: "POST",
    });
  }
  adminExportUser(id: string) {
    return this.request<unknown>(`/admin/users/${id}/export`);
  }
  // ---- study ----
  /** Cards due, pages with cards, exams, streak and weak spots. */
  study() {
    return this.request<StudyOverview>("/study");
  }
  /** Cards to review now (due, then today's new ones); one page with `docId`. */
  studyQueue(
    options: { docId?: string; limit?: number; ahead?: boolean } = {},
  ) {
    const q = new URLSearchParams();
    if (options.docId) q.set("doc_id", options.docId);
    if (options.limit) q.set("limit", String(options.limit));
    if (options.ahead) q.set("ahead", "true");
    const s = q.toString();
    return this.request<StudyCard[]>(`/study/queue${s ? `?${s}` : ""}`);
  }
  reviewCard(cardId: string, rating: Rating) {
    return this.request<StudyCard>(`/study/cards/${cardId}/review`, {
      method: "POST",
      body: { rating },
    });
  }
  /** Which pages you're revising for an exam. */
  setExamDecks(input: {
    key: string;
    title: string;
    starts_at: string;
    doc_ids: string[];
  }) {
    return this.request<StudyOverview>("/study/exams", {
      method: "PUT",
      body: input,
    });
  }
  /** Revision sessions before an exam, proposed into free time (nothing saved). */
  planRevision(input: { key: string; minutes?: number; timezone: string }) {
    return this.request<RevisionPlan>("/study/revision/plan", {
      method: "POST",
      body: input,
    });
  }
  /** Apply the approved sessions: a "Revise for …" task with them set aside. */
  applyRevision(input: {
    key: string;
    sessions: { start_at: string; end_at: string }[];
  }) {
    return this.request<{
      item_id: string;
      block_ids: string[];
      minutes: number;
    }>("/study/revision/apply", { method: "POST", body: input });
  }
  /** The assistant's suggested cards from a page — a proposal to tick. */
  suggestCards(docId: string, max?: number) {
    return this.request<{ cards: SuggestedCard[] }>(
      `/ai/study/pages/${docId}/cards`,
      { method: "POST", body: max ? { max } : {} },
    );
  }
  /** Grade a typed answer against the card and its page. */
  gradeAnswer(cardId: string, answer: string) {
    return this.request<{
      verdict: "correct" | "partly" | "wrong";
      feedback: string;
      suggested_rating: Rating;
    }>("/ai/study/grade", {
      method: "POST",
      body: { card_id: cardId, answer },
    });
  }
  explainCard(cardId: string) {
    return this.request<{ explanation: string; beyond_notes: boolean }>(
      `/ai/study/cards/${cardId}/explain`,
      { method: "POST", body: {} },
    );
  }
  // ---- importing files into Docs ----
  /**
   * Start importing a file: the import, and where to upload the file (a
   * path on this API's base URL, good for ten minutes and one upload).
   */
  createImport(input: ImportCreateInput) {
    return this.request<{
      import: ImportJob;
      upload_path: string;
      expires_at: string;
    }>("/imports", { method: "POST", body: input });
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
    return this.request<ImportJob[]>("/imports");
  }
  getImport(id: string) {
    return this.request<ImportJob>(`/imports/${id}`);
  }
  /** What this server can read (scans, photos, equations), before an upload. */
  importCapabilities() {
    return this.request<ImportCapabilities>("/imports/capabilities");
  }
  /** Admin → Storage: the database, the file store, the import queue. */
  adminStorage() {
    return this.request<AdminStorage>("/admin/storage");
  }
  /** Delete a stored upload now; its import is cancelled (audited). */
  adminDeleteStoredFile(importId: string) {
    return this.request<void>(`/admin/storage/files/${importId}`, {
      method: "DELETE",
    });
  }
  /** Run the file store's sweep now (audited). */
  adminSweepStorage() {
    return this.request<{ removed: number }>("/admin/storage/sweep", {
      method: "POST",
      body: {},
    });
  }
  /** Cancel an import still going, or clear a finished one from the list. */
  removeImport(id: string) {
    return this.request<void>(`/imports/${id}`, { method: "DELETE" });
  }
  // ---- terms, privacy and consent ----
  /** Who runs the service and the current Terms and Privacy versions. */
  legal() {
    return this.request<LegalSummary>("/legal", { anonymous: true });
  }
  legalDocument(doc: LegalDoc) {
    return this.request<LegalDocument>(`/legal/${doc}`, { anonymous: true });
  }
  /** Accept the Terms and Privacy Policy at this version. */
  acceptTerms(termsVersion: string) {
    return this.request<{ terms_version: string }>("/me/consent", {
      method: "POST",
      body: { terms_version: termsVersion },
    });
  }
  privacy() {
    return this.request<PrivacyView>("/me/privacy");
  }
  setPrivacy(input: { analytics_opt_out: boolean }) {
    return this.request<PrivacyView>("/me/privacy", {
      method: "PUT",
      body: input,
    });
  }
  /** Delete your own account for good. */
  deleteAccount(input: { password?: string; confirm_email?: string }) {
    return this.request<void>("/me", { method: "DELETE", body: input });
  }
  adminLegal() {
    return this.request<LegalAdminView>("/admin/legal");
  }
  updateLegal(input: LegalSettingsUpdate) {
    return this.request<LegalAdminView>("/admin/legal", {
      method: "PUT",
      body: input,
    });
  }
  /** The notice everyone sees, or null. */
  announcement() {
    return this.request<Announcement | null>("/announcement", {
      anonymous: true,
    });
  }
  setAnnouncement(input: {
    message: string;
    tone?: "info" | "warning";
    until?: string | null;
  }) {
    return this.request<Announcement>("/admin/announcement", {
      method: "PUT",
      body: input,
    });
  }
  /** What the sweeper keeps, for how long, and when it last ran. */
  adminSweep() {
    return this.request<SweepView>("/admin/sweep");
  }
  /** Days to keep, per kind of record; 0 keeps forever. */
  setRetention(days: Record<string, number>) {
    return this.request<SweepView>("/admin/sweep/retention", {
      method: "PUT",
      body: days,
    });
  }
  runSweep() {
    return this.request<SweepView>("/admin/sweep/run", { method: "POST" });
  }
  adminDatabaseTables() {
    return this.request<AdminDatabaseTable[]>("/admin/database/tables");
  }
  adminDatabaseTable(name: string) {
    return this.request<AdminDatabaseTableDetail>(
      `/admin/database/tables/${encodeURIComponent(name)}`,
    );
  }
  adminDatabaseRows(name: string, offset = 0) {
    return this.request<AdminDatabaseRows>(
      `/admin/database/tables/${encodeURIComponent(name)}/rows?offset=${offset}`,
    );
  }
  adminListUsers(
    params: { search?: string; limit?: number; offset?: number } = {},
  ) {
    const q = new URLSearchParams();
    if (params.search) q.set("search", params.search);
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    if (params.offset !== undefined) q.set("offset", String(params.offset));
    const suffix = q.size ? `?${q}` : "";
    return this.request<Page<AdminUser>>(`/admin/users${suffix}`);
  }
  adminUpdateUser(
    id: string,
    input: { role?: SystemRole; disabled?: boolean; email_verified?: boolean },
  ) {
    return this.request<AdminUser>(`/admin/users/${id}`, {
      method: "PUT",
      body: input,
    });
  }
  adminDeleteUser(id: string) {
    return this.request<void>(`/admin/users/${id}`, { method: "DELETE" });
  }
  adminListTeams() {
    return this.request<Team[]>("/admin/teams");
  }
  // ---- AI providers (system admins) ----
  listAiProviders() {
    return this.request<AiProvidersResponse>("/ai/providers");
  }
  createAiProvider(input: {
    kind: AiProviderKind;
    name: string;
    base_url?: string;
    api_key?: string;
    options?: { apiVersion?: string };
    enabled?: boolean;
  }) {
    return this.request<AiProvider>("/ai/providers", {
      method: "POST",
      body: input,
    });
  }
  /** Omit `api_key` to keep the saved key; send "" to remove it. */
  updateAiProvider(
    id: string,
    input: {
      name?: string;
      base_url?: string;
      api_key?: string;
      options?: { apiVersion?: string };
      enabled?: boolean;
    },
  ) {
    return this.request<AiProvider>(`/ai/providers/${id}`, {
      method: "PUT",
      body: input,
    });
  }
  deleteAiProvider(id: string) {
    return this.request<void>(`/ai/providers/${id}`, { method: "DELETE" });
  }
  /** Lists models using the provider's saved key. */
  listAiModels(id: string) {
    return this.request<AiModelList>(`/ai/providers/${id}/models`, {
      method: "POST",
    });
  }
  testAiProvider(id: string, model?: string) {
    return this.request<AiTestResult>(`/ai/providers/${id}/test`, {
      method: "POST",
      body: model ? { model } : {},
    });
  }
  /**
   * Search by meaning's own setup: on needs the model that measures text
   * and `accept` (every page is sent to the provider to be measured).
   */
  setSemanticSearch(input: {
    on: boolean;
    embedding_model?: string;
    accept?: boolean;
  }) {
    return this.request<AiSettings>("/ai/settings/semantic", {
      method: "PUT",
      body: input,
    });
  }
  updateAiSettings(input: { provider_id: string | null; model?: string }) {
    return this.request<AiSettings>("/ai/settings", {
      method: "PUT",
      body: input,
    });
  }

  adminListAudit(params: { limit?: number; offset?: number } = {}) {
    const q = new URLSearchParams();
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    if (params.offset !== undefined) q.set("offset", String(params.offset));
    const suffix = q.size ? `?${q}` : "";
    return this.request<Page<AuditEntry>>(`/admin/audit${suffix}`);
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
    return this.request<{ session: FocusSession; item: ItemDetail | null }>(
      "/focus/sessions",
      { method: "POST", body: input },
    );
  }
  focusSummary(from: Date, to: Date) {
    const q = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
    });
    return this.request<FocusSummary>(`/focus/summary?${q}`);
  }
  currentFocus() {
    return this.request<FocusCurrent | null>("/focus/current");
  }
  /** Share the session running here with your other devices. */
  setCurrentFocus(state: FocusState, device?: string, deviceId?: string) {
    return this.request<FocusCurrent>("/focus/current", {
      method: "PUT",
      body: {
        state,
        ...(device ? { device } : {}),
        ...(deviceId ? { device_id: deviceId } : {}),
      },
    });
  }
  clearCurrentFocus() {
    return this.request<void>("/focus/current", { method: "DELETE" });
  }

  // ---- presence ------------------------------------------------------------

  heartbeat(input: PresenceHeartbeat) {
    return this.request<{ ok: true }>("/presence/heartbeat", {
      method: "POST",
      body: input,
    });
  }
  leavePresence(deviceId: string) {
    return this.request<{ ok: true }>("/presence/leave", {
      method: "POST",
      body: { device_id: deviceId },
    });
  }
  listDevices() {
    return this.request<DevicePresence[]>("/presence/devices");
  }
  forgetDevice(deviceId: string) {
    return this.request<void>(
      `/presence/devices/${encodeURIComponent(deviceId)}`,
      { method: "DELETE" },
    );
  }
  presenceSettings() {
    return this.request<PresenceSettings>("/presence/settings");
  }
  updatePresenceSettings(input: PresenceSettings) {
    return this.request<PresenceSettings>("/presence/settings", {
      method: "PUT",
      body: input,
    });
  }
  teamPresence(teamId: string) {
    return this.request<MemberPresence[]>(`/teams/${teamId}/presence`);
  }
  docViewers(docId: string) {
    return this.request<DocViewer[]>(`/docs/${docId}/presence`);
  }

  // ---- team capacity -------------------------------------------------------

  /** Free working time per person per day (a month at most). */
  teamCapacity(teamId: string, from: Date, to: Date) {
    const q = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
    });
    return this.request<TeamCapacity>(`/teams/${teamId}/capacity?${q}`);
  }

  // ---- page templates ------------------------------------------------------

  /** Your page templates, your teams', and the starters everyone has. */
  listPageTemplates() {
    return this.request<PageTemplate[]>("/page-templates");
  }
  createPageTemplate(input: PageTemplateInput) {
    return this.request<PageTemplate>("/page-templates", {
      method: "POST",
      body: input,
    });
  }
  updatePageTemplate(id: string, input: PageTemplateUpdate) {
    return this.request<PageTemplate>(`/page-templates/${id}`, {
      method: "PUT",
      body: input,
    });
  }
  deletePageTemplate(id: string) {
    return this.request<void>(`/page-templates/${id}`, { method: "DELETE" });
  }
  /** Save a page as a template: its words, folder and tags, boxes unticked. */
  savePageAsTemplate(docId: string, input: PageTemplateFromDoc = {}) {
    return this.request<PageTemplate>(`/page-templates/from-doc/${docId}`, {
      method: "POST",
      body: input,
    });
  }
  /**
   * Make a page from a template, blanks filled in. With `make_tasks`, its
   * to-do lines become tasks (in the project, when one is chosen). For an
   * event that already has a note, that note comes back (`existing`) and
   * nothing new is made.
   */
  usePageTemplate(id: string, input: PageTemplateUse = {}) {
    return this.request<{
      doc: Doc;
      tasks_created: number;
      existing: boolean;
    }>(`/page-templates/${encodeURIComponent(id)}/use`, {
      method: "POST",
      body: input,
    });
  }

  // ---- project templates ---------------------------------------------------

  /** Your templates, your teams', and the starters everyone has. */
  listTemplates() {
    return this.request<ProjectTemplate[]>("/templates");
  }
  createTemplate(input: TemplateInput) {
    return this.request<ProjectTemplate>("/templates", {
      method: "POST",
      body: input,
    });
  }
  updateTemplate(id: string, input: TemplateUpdate) {
    return this.request<ProjectTemplate>(`/templates/${id}`, {
      method: "PUT",
      body: input,
    });
  }
  deleteTemplate(id: string) {
    return this.request<void>(`/templates/${id}`, { method: "DELETE" });
  }
  /** Save a project as a template: its tasks, their order, and its brief. */
  templateFromProject(projectId: string) {
    return this.request<ProjectTemplate>(
      `/templates/from-project/${projectId}`,
      { method: "POST" },
    );
  }
  /**
   * Start a project from a template. Answers with a proposal to review —
   * approve it with `applyProposal` — never a project yet.
   */
  useTemplate(
    id: string,
    input: { title?: string; team_id?: string | null } = {},
  ) {
    return this.request<Proposal>(`/templates/${encodeURIComponent(id)}/use`, {
      method: "POST",
      body: input,
    });
  }

  // ---- follow-through ------------------------------------------------------

  /** How much of what was planned lately got done, by weekday. */
  planReality() {
    return this.request<PlanReality>("/planner/reality");
  }
  /** What a change would do to the coming days. Nothing is saved. */
  whatIf(input: WhatIfInput) {
    return this.request<WhatIfResult>("/planner/what-if", {
      method: "POST",
      body: input,
    });
  }
  /** After time away: what happened meanwhile, or null. */
  reentry() {
    return this.request<ReentryBrief | null>("/me/reentry");
  }
  dismissReentry() {
    return this.request<{ ok: true }>("/me/reentry/dismiss", {
      method: "POST",
    });
  }
  /** Pages nobody has changed or confirmed in months. */
  fadingDocs(teamId?: string) {
    return this.request<FadingDoc[]>(
      `/docs/fading${teamId ? `?team_id=${teamId}` : ""}`,
    );
  }
  /** Say a page is still true, or that it needs updating (makes a task). */
  reviewDoc(
    id: string,
    input:
      { verdict: "still_true" } | { verdict: "needs_update"; note?: string },
  ) {
    return this.request<{ reviewed_at: string; task: Item | null }>(
      `/docs/${id}/review`,
      { method: "POST", body: input },
    );
  }
  listAsks() {
    return this.request<{
      to_me: TaskAsk[];
      from_me: TaskAsk[];
      recent: TaskAsk[];
    }>("/asks");
  }
  itemAsk(itemId: string) {
    return this.request<TaskAsk | null>(`/items/${itemId}/ask`);
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
    return this.request<TaskAsk>(`/asks/${id}/reply`, {
      method: "POST",
      body: input,
    });
  }
  /** Settle a suggestion: agree, keep the original, or withdraw the ask. */
  settleAsk(id: string, action: "agree" | "keep" | "withdraw", message = "") {
    return this.request<TaskAsk>(`/asks/${id}/settle`, {
      method: "POST",
      body: { action, message },
    });
  }
  teamAttention(teamId: string, week?: string) {
    return this.request<TeamAttention>(
      `/teams/${teamId}/attention${week ? `?week=${week}` : ""}`,
    );
  }
  setMeetingBudget(teamId: string, minutes: number | null) {
    return this.request<{ meeting_budget_minutes: number | null }>(
      `/teams/${teamId}/attention`,
      { method: "PUT", body: { meeting_budget_minutes: minutes } },
    );
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
    return this.request<AttentionCheck>(`/teams/${teamId}/attention/check`, {
      method: "POST",
      body: input,
    });
  }
  listProofs(itemId: string) {
    return this.request<ItemProof[]>(`/items/${itemId}/proofs`);
  }
  addProof(itemId: string, input: { url?: string | null; note?: string }) {
    return this.request<ItemProof>(`/items/${itemId}/proofs`, {
      method: "POST",
      body: { url: input.url ?? null, note: input.note ?? "" },
    });
  }
  deleteProof(itemId: string, proofId: string) {
    return this.request<void>(`/items/${itemId}/proofs/${proofId}`, {
      method: "DELETE",
    });
  }
  /** What got done between two times, with its proof; a team's, or yours. */
  progress(from: Date, to: Date, teamId?: string) {
    const q = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
      ...(teamId ? { team_id: teamId } : {}),
    });
    return this.request<ProgressReport>(`/progress?${q}`);
  }

  /** An experiment's before and after, measured. */
  experimentEvidence(id: string) {
    return this.request<ExperimentEvidence>(`/work-records/${id}/evidence`);
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
    const q = new URLSearchParams();
    if (params.team_id) q.set("team_id", params.team_id);
    if (params.hide_mine === false) q.set("hide_mine", "false");
    if (params.before) q.set("before", params.before);
    if (params.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return this.request<TeamChangesPage>(`/changes${qs ? `?${qs}` : ""}`);
  }

  /** Finish the first run (DSN-02): what Orbyn is for, and a starter. */
  finishFirstRun(input: FirstRunInput) {
    return this.request<FirstRunResult & { user: User }>("/me/first-run", {
      method: "POST",
      body: input,
    });
  }
  /** Not now: the first run isn't shown again. */
  skipFirstRun() {
    return this.request<User>("/me/first-run/skip", {
      method: "POST",
      body: {},
    });
  }

  /** Whether a page or folder is on the web, and whether you may publish it. */
  getPublish(kind: "doc" | "folder", id: string) {
    return this.request<PublishState>(`/${kind}s/${id}/publish`);
  }
  /** Put a page or folder on the web, or change how (SHR-05, SHR-06). */
  publish(kind: "doc" | "folder", id: string, input: PublishInput) {
    return this.request<PublishState>(`/${kind}s/${id}/publish`, {
      method: "PUT",
      body: input,
    });
  }
  /** Take it off the web; the address stops working at once. */
  unpublish(kind: "doc" | "folder", id: string) {
    return this.request<PublishState>(`/${kind}s/${id}/publish`, {
      method: "DELETE",
    });
  }
  /** A page's own description for its card on the web. */
  setWebDescription(docId: string, description: string) {
    return this.request<PublishState>(`/docs/${docId}/web-description`, {
      method: "PUT",
      body: { description },
    });
  }
  /** A team's switch for publishing, and how many of its pages are on the web. */
  getTeamPublishing(teamId: string) {
    return this.request<{
      allowed: boolean;
      published: number;
      can_change: boolean;
    }>(`/teams/${teamId}/publishing`);
  }
  setTeamPublishing(teamId: string, allowed: boolean) {
    return this.request<{
      allowed: boolean;
      published: number;
      can_change: boolean;
    }>(`/teams/${teamId}/publishing`, { method: "PUT", body: { allowed } });
  }

  /** A Markdown or Notion export into pages (DATA-08). Dry run by default. */
  importPages(input: PageImportInput) {
    return this.request<PagesImportSummary>("/imports/pages", {
      method: "POST",
      body: input,
    });
  }

  /** Summarise, or find deadlines in, a page or shared words (AI-01). */
  assistCapture(input: CaptureAssistInput) {
    return this.request<CaptureAssistResult>("/ai/assist", {
      method: "POST",
      body: input,
    });
  }
}
