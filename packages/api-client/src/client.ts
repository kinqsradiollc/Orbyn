import {
  HttpError,
  type AdminOverview,
  type Doc,
  type DocBlock,
  type DocKind,
  type DocSummary,
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
  type BlockDuplicateInput,
  type BlockInput,
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
} from "@orbyn/core";

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
  if (status >= 500) return `Unable to reach Orbyn (HTTP ${status}).`;
  return `Orbyn sent an unexpected reply (HTTP ${status}).`;
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
};

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Send without the Authorization header even if a token exists. */
  anonymous?: boolean;
  /** Resolve with the body text instead of parsing JSON (CSV exports). */
  raw?: boolean;
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
  private lastWriteAt = 0;
  /** Last body per signed-in path, for 304 Not Modified replies. */
  private readonly cache = new Map<string, { etag: string; text: string }>();

  constructor(options: OrbynClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.getToken = options.getToken ?? (() => null);
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
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
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    // A read that meets a copy being replaced during a deploy (502/503/504
    // or a dropped connection) is tried once more; reads never change data.
    // Writes are never retried, so nothing is saved twice.
    let response: Response;
    try {
      response = await send();
      if (method === "GET" && [502, 503, 504].includes(response.status)) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        response = await send();
      }
    } catch (error) {
      if (method !== "GET" || (error as Error).name === "TimeoutError")
        throw error;
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
      };
      throw new HttpError(response.status, error.message || "Request failed");
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
  /** Bring items in from an Orbyn export or a CSV. Dry run by default. */
  importData(input: {
    format: "orbyn" | "csv";
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
  // Documents
  listDocs() {
    return this.request<DocSummary[]>("/docs");
  }
  getDoc(id: string) {
    return this.request<Doc>(`/docs/${id}`);
  }
  createDoc(input: {
    title?: string;
    kind?: DocKind;
    team_id?: string | null;
    item_id?: string | null;
    content?: DocBlock[];
  }) {
    return this.request<Doc>("/docs", { method: "POST", body: input });
  }
  updateDoc(
    id: string,
    input: { title?: string; content?: DocBlock[]; version: number },
  ) {
    return this.request<Doc>(`/docs/${id}`, { method: "PUT", body: input });
  }
  deleteDoc(id: string) {
    return this.request<void>(`/docs/${id}`, { method: "DELETE" });
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
  createBlock(input: BlockInput) {
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
  /** Move a block to the next free working time of the same length. */
  rescheduleBlock(id: string) {
    return this.request<TimeBlock>(`/blocks/${id}/reschedule`, {
      method: "POST",
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
  applyPlan(id: string) {
    return this.request<{ blocks: TimeBlock[]; skipped: number }>(
      `/planner/plans/${id}/apply`,
      { method: "POST" },
    );
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
  createItem(input: Partial<ItemInput> & { title: string }) {
    return this.request<Item>("/items", { method: "POST", body: input });
  }
  /**
   * Create an item from one line of text ("Lunch with @anna tomorrow 1pm
   * ;Cafe Roma"), parsed on the server without AI.
   */
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
  /** Draft a project (subtasks) from a prompt, as a proposal to review. */
  draftProject(prompt: string, timezone: string) {
    return this.request<Proposal>("/ai/project", {
      method: "POST",
      body: { prompt, timezone },
    });
  }
  /**
   * Ask the assistant. Pass earlier turns in `history` for follow-up questions.
   * The turn runs on the server while this polls for the answer, so a slow
   * model (one on the user's own machine) is never cut off by a proxy's
   * limit on a single request, and a dropped poll is simply tried again.
   */
  async chat(message: string, timezone: string, history: ChatTurn[] = []) {
    const { id } = await this.request<{ id: string }>("/ai/chat/start", {
      method: "POST",
      body: { message, timezone, history: history.slice(-12) },
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
  applyProposal(id: string) {
    return this.request<{ applied: boolean }>(`/ai/proposals/${id}/apply`, {
      method: "POST",
    });
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
}
