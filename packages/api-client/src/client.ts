import {
  HttpError,
  type AdminOverview,
  type AiModelList,
  type AiProvider,
  type AiProviderKind,
  type AiProvidersResponse,
  type AiSettings,
  type AiTestResult,
  type AdminUser,
  type AuditEntry,
  type AuthResponse,
  type ChatTurn,
  type Credentials,
  type Item,
  type ItemDetail,
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
  type BlockInput,
  type BlockUpdate,
  type Booking,
  type BookingPage,
  type BookingPageInput,
  type BookingPageUpdate,
  type BookingReceipt,
  type BookingRequest,
  type CalendarFeed,
  type CalendarView,
  type Frame,
  type FrameInput,
  type FrameUpdate,
  type ListInput,
  type ListUpdate,
  type MeetingSlot,
  type MemberAvailability,
  type MemberWorkload,
  type NewApiKey,
  type NewWebhook,
  type Place,
  type PlaceInput,
  type PlaceUpdate,
  type Plan,
  type PlannerPrefs,
  type PlannerPrefsInput,
  type PlannerReview,
  type PlanPreviewInput,
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

/** After a write, reads ask for the primary database for this long. */
const READ_YOUR_WRITES_MS = 5000;
/** Pause before retrying a read that failed while a server copy restarted. */
const RETRY_DELAY_MS = 300;
/** How many unchanged-response bodies to remember for conditional GETs. */
const MAX_CACHED = 100;

export type TokenSource = () =>
  string | null | undefined | Promise<string | null | undefined>;

export type OrbynClientOptions = {
  /** API origin, for example `http://localhost:8008` or `/api`. */
  baseUrl: string;
  /** Returns the current session token, or nothing when signed out. */
  getToken?: TokenSource;
  /** Per-request timeout. Defaults to 120s to outlast the assistant's 110s deadline. */
  timeoutMs?: number;
  /** Override fetch (tests, custom agents). Defaults to the global fetch. */
  fetch?: typeof fetch;
};

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Send without the Authorization header even if a token exists. */
  anonymous?: boolean;
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
    if (response.status === 304 && cached) return JSON.parse(cached.text) as T;
    if (!response.ok) {
      const error = (await response
        .json()
        .catch(() => ({ message: "Unable to reach Orbyn" }))) as {
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
    return JSON.parse(text) as T;
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
  login(input: Pick<Credentials, "email" | "password">) {
    return this.request<AuthResponse>("/auth/login", {
      method: "POST",
      body: input,
      anonymous: true,
    });
  }
  logout() {
    return this.request<void>("/auth/logout", { method: "POST" });
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
    ] as const)
      if (params[key]) q.set(key, params[key]!);
    const suffix = q.size ? `?${q}` : "";
    return this.request<Item[]>(`/items${suffix}`);
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
  getPlannerPrefs() {
    return this.request<PlannerPrefs>("/planner/prefs");
  }
  updatePlannerPrefs(input: PlannerPrefsInput) {
    return this.request<PlannerPrefs>("/planner/prefs", {
      method: "PUT",
      body: input,
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
  /** Create (or replace) your private calendar subscription link. */
  createCalendarFeed() {
    return this.request<CalendarFeed>("/me/calendar-feed", { method: "POST" });
  }
  deleteCalendarFeed() {
    return this.request<void>("/me/calendar-feed", { method: "DELETE" });
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
  listBookings(pageId: string) {
    return this.request<Booking[]>(`/booking-pages/${pageId}/bookings`);
  }
  cancelBooking(pageId: string, bookingId: string) {
    return this.request<{ cancelled: boolean }>(
      `/booking-pages/${pageId}/bookings/${bookingId}/cancel`,
      { method: "POST" },
    );
  }
  /** Public: a booking page and its free times (no sign-in). */
  getPublicBookingPage(
    slug: string,
    params: {
      duration: number;
      date?: string;
      days?: number;
      timezone: string;
    },
  ) {
    const q = new URLSearchParams({
      duration: String(params.duration),
      timezone: params.timezone,
    });
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

  // ---- API keys and webhooks ----
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
  updateItem(id: string, input: ItemInput & { version: number }) {
    return this.request<Item>(`/items/${id}`, { method: "PUT", body: input });
  }
  deleteItem(id: string, version: number) {
    return this.request<void>(`/items/${id}?version=${version}`, {
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
  /** Ask the assistant. Pass earlier turns in `history` for follow-up questions. */
  chat(message: string, timezone: string, history: ChatTurn[] = []) {
    return this.request<Proposal>("/ai/chat", {
      method: "POST",
      body: { message, timezone, history: history.slice(-12) },
    });
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
    input: { role?: SystemRole; disabled?: boolean },
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
