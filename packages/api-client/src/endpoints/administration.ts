import {
  type AdminAnalytics,
  type AdminDatabaseRows,
  type AdminDatabaseTable,
  type AdminDatabaseTableDetail,
  type AdminStorage,
  type AdminUserDetail,
  type Announcement,
  type LegalAdminView,
  type Maintenance,
  type MaintenanceInput,
  type RequestLogRow,
  type RequestSummary,
  type StatusReport,
  type SweepView,
  type SystemSettingsView,
  type VersionInfo,
} from "@orbyn/core";
import type { OrbynClient } from "../client.js";

export function callHealth(this: OrbynClient) {
  return this.request<{ status: string }>("/health", { anonymous: true });
}

/** The public uptime report; no sign-in needed. */
// ---- system: settings, maintenance, version ----
/** Live settings and where each comes from (database or .env). */

export function callGetSystemSettings(this: OrbynClient) {
  return this.request<SystemSettingsView>("/admin/settings");
}

/** Public: whether maintenance mode is on, for banners (no sign-in needed). */

export function callGetMaintenance(this: OrbynClient) {
  return this.request<Maintenance>("/maintenance", { anonymous: true });
}

export function callSetMaintenance(this: OrbynClient, body: MaintenanceInput) {
  return this.request<Maintenance>("/admin/maintenance", {
    method: "PUT",
    body,
  });
}

/** Public: the build the server is running. */

export function callGetVersion(this: OrbynClient) {
  return this.request<VersionInfo>("/version", { anonymous: true });
}

export function callGetStatus(this: OrbynClient) {
  return this.request<StatusReport>("/status", { anonymous: true });
}

// ---- devices (mobile push) ----

export function callRegisterDevice(this: OrbynClient, token: string) {
  return this.request<void>("/devices", { method: "POST", body: { token } });
}

export function callRemoveDevice(this: OrbynClient, token: string) {
  return this.request<void>("/devices", {
    method: "DELETE",
    body: { token },
  });
}

/** How each service is answering over the last `hours`. */

export function callAdminRequestSummary(this: OrbynClient, hours = 24) {
  return this.request<RequestSummary>(`/admin/requests/summary?hours=${hours}`);
}

/** The request log, newest first; `before` pages back. */

export function callAdminRequests(
  this: OrbynClient,
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

export function callAdminAnalytics(this: OrbynClient, days = 30) {
  return this.request<AdminAnalytics>(`/admin/analytics?days=${days}`);
}

export function callAdminUserDetail(this: OrbynClient, id: string) {
  return this.request<AdminUserDetail>(`/admin/users/${id}`);
}

/** Sign someone out on every device. */

export function callAdminSignOutUser(this: OrbynClient, id: string) {
  return this.request<{ ended: number }>(`/admin/users/${id}/sign-out`, {
    method: "POST",
  });
}

export function callAdminEndSession(
  this: OrbynClient,
  id: string,
  sessionId: string,
) {
  return this.request<void>(`/admin/users/${id}/sessions/${sessionId}`, {
    method: "DELETE",
  });
}

/** Revoke one of an account's personal API keys (recorded in the audit log). */

export function callAdminRevokeApiKey(
  this: OrbynClient,
  id: string,
  keyId: string,
) {
  return this.request<void>(`/admin/users/${id}/api-keys/${keyId}`, {
    method: "DELETE",
  });
}

/** A one-hour password reset link to pass on (also emailed when mail is set up). */

export function callAdminResetLink(this: OrbynClient, id: string) {
  return this.request<{
    link: string;
    expires_in_minutes: number;
    emailed: boolean;
  }>(`/admin/users/${id}/reset-link`, { method: "POST" });
}

export function callAdminResetTwoFactor(this: OrbynClient, id: string) {
  return this.request<{ cleared: boolean }>(`/admin/users/${id}/reset-2fa`, {
    method: "POST",
  });
}

export function callAdminExportUser(this: OrbynClient, id: string) {
  return this.request<unknown>(`/admin/users/${id}/export`);
}

/** Admin → Storage: the database, the file store, the import queue. */

export function callAdminStorage(this: OrbynClient) {
  return this.request<AdminStorage>("/admin/storage");
}

/** Delete a stored upload now; its import is cancelled (audited). */

export function callAdminDeleteStoredFile(this: OrbynClient, importId: string) {
  return this.request<void>(`/admin/storage/files/${importId}`, {
    method: "DELETE",
  });
}

/** Run the file store's sweep now (audited). */

export function callAdminSweepStorage(this: OrbynClient) {
  return this.request<{ removed: number }>("/admin/storage/sweep", {
    method: "POST",
    body: {},
  });
}

export function callAdminLegal(this: OrbynClient) {
  return this.request<LegalAdminView>("/admin/legal");
}

export function callSetAnnouncement(
  this: OrbynClient,
  input: {
    message: string;
    tone?: "info" | "warning";
    until?: string | null;
  },
) {
  return this.request<Announcement>("/admin/announcement", {
    method: "PUT",
    body: input,
  });
}

/** What the sweeper keeps, for how long, and when it last ran. */

export function callAdminSweep(this: OrbynClient) {
  return this.request<SweepView>("/admin/sweep");
}

/** Days to keep, per kind of record; 0 keeps forever. */

export function callSetRetention(
  this: OrbynClient,
  days: Record<string, number>,
) {
  return this.request<SweepView>("/admin/sweep/retention", {
    method: "PUT",
    body: days,
  });
}

export function callRunSweep(this: OrbynClient) {
  return this.request<SweepView>("/admin/sweep/run", { method: "POST" });
}

export function callAdminDatabaseTables(this: OrbynClient) {
  return this.request<AdminDatabaseTable[]>("/admin/database/tables");
}

export function callAdminDatabaseTable(this: OrbynClient, name: string) {
  return this.request<AdminDatabaseTableDetail>(
    `/admin/database/tables/${encodeURIComponent(name)}`,
  );
}

export function callAdminDatabaseRows(
  this: OrbynClient,
  name: string,
  offset = 0,
) {
  return this.request<AdminDatabaseRows>(
    `/admin/database/tables/${encodeURIComponent(name)}/rows?offset=${offset}`,
  );
}

export function callAdminDeleteUser(this: OrbynClient, id: string) {
  return this.request<void>(`/admin/users/${id}`, { method: "DELETE" });
}

export function callForgetDevice(this: OrbynClient, deviceId: string) {
  return this.request<void>(
    `/presence/devices/${encodeURIComponent(deviceId)}`,
    { method: "DELETE" },
  );
}
