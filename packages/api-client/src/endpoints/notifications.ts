import { type Notice } from "@orbyn/core";
import type { OrbynClient } from "../client.js";

// ---- notifications ----

export function callListNotifications(this: OrbynClient) {
  return this.request<Notice[]>("/notifications");
}

export function callMarkNotificationRead(this: OrbynClient, id: string) {
  return this.request<void>(`/notifications/${id}/read`, { method: "POST" });
}
