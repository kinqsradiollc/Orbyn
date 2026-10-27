import {
  chatgptCatalogPublication,
  type ChatgptCatalogPublication,
  chatgptCatalogReceipt,
  type PublishInput,
  type PublishState,
} from "@orbyn/core";
import type { OrbynClient } from "../client.js";

// ---- health ----

export function callPublishingList(this: OrbynClient) {
  return this.request<import("@orbyn/core").PublishingListEntry[]>(
    "/admin/publishing",
  );
}

export function callPublishingGet(this: OrbynClient, id: string) {
  return this.request<import("@orbyn/core").PublishingDraft>(
    `/admin/publishing/${id}`,
  );
}

export function callPublishingCreate(this: OrbynClient) {
  return this.request<import("@orbyn/core").PublishingDraft>(
    "/admin/publishing",
    { method: "POST" },
  );
}

export function callPublishingSave(
  this: OrbynClient,
  id: string,
  version: number,
  content: import("@orbyn/core").PublishingContent,
) {
  return this.request<import("@orbyn/core").PublishingDraft>(
    `/admin/publishing/${id}`,
    { method: "PUT", body: { version, content } },
  );
}

export function callPublishingAction(
  this: OrbynClient,
  id: string,
  version: number,
  action: "publish" | "cancel" | "release" | "unrelease" | "delete" | "reset",
  at?: string,
) {
  return this.request<import("@orbyn/core").PublishingDraft | null>(
    `/admin/publishing/${id}/${at ? "schedule" : action}`,
    { method: "POST", body: { version, ...(at ? { at } : {}) } },
  );
}

export function callPublishingSuggest(
  this: OrbynClient,
  content: import("@orbyn/core").PublishingContent,
  instruction: string,
) {
  return this.request<{ text: string }>("/admin/publishing/suggest", {
    method: "POST",
    body: { content, instruction },
  });
}

export function callPublishingConnection(this: OrbynClient) {
  return this.request<import("@orbyn/core").PublishingConnection>(
    "/admin/publishing/linkedin",
  );
}

export function callPublishingConnect(this: OrbynClient) {
  return this.request<{ url: string }>("/admin/publishing/linkedin/connect", {
    method: "POST",
  });
}

export function callPublishingDisconnect(this: OrbynClient) {
  return this.request<void>("/admin/publishing/linkedin", {
    method: "DELETE",
  });
}

export function callPublishedUpdates(this: OrbynClient) {
  return this.request<import("@orbyn/core").PublishedUpdate[]>(
    "/changelog/updates",
    { anonymous: true },
  );
}

export async function callPublishChatgptModels(
  this: OrbynClient,
  input: ChatgptCatalogPublication,
  signal?: AbortSignal,
) {
  return chatgptCatalogReceipt.parse(
    await this.request<unknown>("/ai/connections/chatgpt/catalog", {
      method: "POST",
      body: chatgptCatalogPublication.parse(input),
      signal,
    }),
  );
}

/** Whether a page or folder is on the web, and whether you may publish it. */

export function callGetPublish(
  this: OrbynClient,
  kind: "doc" | "folder",
  id: string,
) {
  return this.request<PublishState>(`/${kind}s/${id}/publish`);
}

export function callPublishPageSelection(
  this: OrbynClient,
  id: string,
  input: import("@orbyn/core").PagePublicationInput,
) {
  return this.request<import("@orbyn/core").PagePublication>(
    `/docs/${id}/publication`,
    { method: "PUT", body: input },
  );
}

/** Put a page or folder on the web, or change how (SHR-05, SHR-06). */

export function callPublish(
  this: OrbynClient,
  kind: "doc" | "folder",
  id: string,
  input: PublishInput,
) {
  return this.request<PublishState>(`/${kind}s/${id}/publish`, {
    method: "PUT",
    body: input,
  });
}

/** Take it off the web; the address stops working at once. */

export function callUnpublish(
  this: OrbynClient,
  kind: "doc" | "folder",
  id: string,
) {
  return this.request<PublishState>(`/${kind}s/${id}/publish`, {
    method: "DELETE",
  });
}

/** A team's switch for publishing, and how many of its pages are on the web. */

export function callGetTeamPublishing(this: OrbynClient, teamId: string) {
  return this.request<{
    allowed: boolean;
    published: number;
    can_change: boolean;
  }>(`/teams/${teamId}/publishing`);
}

export function callSetTeamPublishing(
  this: OrbynClient,
  teamId: string,
  allowed: boolean,
) {
  return this.request<{
    allowed: boolean;
    published: number;
    can_change: boolean;
  }>(`/teams/${teamId}/publishing`, { method: "PUT", body: { allowed } });
}
