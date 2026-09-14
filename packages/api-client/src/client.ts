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
  type ItemInput,
  type Notice,
  type Page,
  type Proposal,
  type StatusReport,
  type SystemRole,
  type Team,
  type TeamDetail,
  type TeamMember,
  type TeamRole,
  type User,
} from "@orbyn/core";

export type TokenSource = () =>
  string | null | undefined | Promise<string | null | undefined>;

export type OrbynClientOptions = {
  /** API origin, for example `http://localhost:8008` or `/api`. */
  baseUrl: string;
  /** Returns the current session token, or nothing when signed out. */
  getToken?: TokenSource;
  /** Per-request timeout. Defaults to 70s to outlast the AI provider timeout. */
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

  constructor(options: OrbynClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.getToken = options.getToken ?? (() => null);
    this.timeoutMs = options.timeoutMs ?? 70000;
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const token = options.anonymous ? null : await this.getToken();
    const response = await this.fetchImpl(this.baseUrl + path, {
      method: options.method ?? "GET",
      // Only declare a JSON body when there is one: the API rejects an empty
      // body labelled application/json (this broke logout and other bodyless calls).
      headers: {
        ...(options.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      const error = (await response
        .json()
        .catch(() => ({ message: "Unable to reach Orbyn" }))) as {
        message?: string;
      };
      throw new HttpError(response.status, error.message || "Request failed");
    }
    return response.status === 204 ? (undefined as T) : response.json();
  }

  // ---- health ----
  health() {
    return this.request<{ status: string }>("/health", { anonymous: true });
  }

  /** The public uptime report; no sign-in needed. */
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
    params: { limit?: number; offset?: number; team_id?: string } = {},
  ) {
    const q = new URLSearchParams();
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    if (params.offset !== undefined) q.set("offset", String(params.offset));
    if (params.team_id) q.set("team_id", params.team_id);
    const suffix = q.size ? `?${q}` : "";
    return this.request<Item[]>(`/items${suffix}`);
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
