import {
  HttpError,
  type AuthResponse,
  type Credentials,
  type Item,
  type ItemInput,
  type Notice,
  type Proposal,
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
      headers: {
        "Content-Type": "application/json",
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
  listItems(params: { limit?: number; offset?: number } = {}) {
    const q = new URLSearchParams();
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    if (params.offset !== undefined) q.set("offset", String(params.offset));
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
  chat(message: string, timezone: string) {
    return this.request<Proposal>("/ai/chat", {
      method: "POST",
      body: { message, timezone },
    });
  }
  applyProposal(id: string) {
    return this.request<{ applied: boolean }>(`/ai/proposals/${id}/apply`, {
      method: "POST",
    });
  }
}
