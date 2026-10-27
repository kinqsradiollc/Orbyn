import {
  type Announcement,
  type ExperimentEvidence,
  type ImportCreateInput,
  type ImportJob,
  type LegalSummary,
  type PageFilesUsage,
  type PresenceHeartbeat,
  type PresenceSettings,
} from "@orbyn/core";
import type { OrbynClient } from "../client.js";

/** "How did today go?": a line under Reflection on today's agenda. */

export function callAddReflection(this: OrbynClient, text: string) {
  return this.request<{ doc_id: string; reflection: string[] }>(
    "/me/home/reflection",
    { method: "POST", body: { text } },
  );
}

/** Make a mention a link, in the page it's in. */

export function callLinkMention(
  this: OrbynClient,
  input: {
    doc_id: string;
    block_id: string;
    matched: string;
    target: { kind: "doc" | "project"; id: string };
  },
) {
  return this.request<{ doc_id: string; version: number }>(
    "/links/mentions/link",
    { method: "POST", body: input },
  );
}

/** How much of your space pictures and files take. */

export function callFilesUsage(this: OrbynClient) {
  return this.request<PageFilesUsage>("/files/usage");
}

/** The full address of a path on this API (a file's link, say). */

export function callUrlFor(this: OrbynClient, path: string) {
  return this.baseUrl + path;
}

/** Something was opened: it leads the quick switcher's recent list. */

export function callRecordRecent(
  this: OrbynClient,
  kind: "doc" | "task" | "project",
  id: string,
) {
  return this.request<void>("/recents", {
    method: "POST",
    body: { kind, id },
  });
}

// ---- importing files into Docs ----
/**
 * Start importing a file: the import, and where to upload the file (a
 * path on this API's base URL, good for ten minutes and one upload).
 */

export function callCreateImport(this: OrbynClient, input: ImportCreateInput) {
  return this.request<{
    import: ImportJob;
    upload_path: string;
    expires_at: string;
  }>("/imports", { method: "POST", body: input });
}

// ---- terms, privacy and consent ----
/** Who runs the service and the current Terms and Privacy versions. */

export function callLegal(this: OrbynClient) {
  return this.request<LegalSummary>("/legal", { anonymous: true });
}

/** The notice everyone sees, or null. */

export function callAnnouncement(this: OrbynClient) {
  return this.request<Announcement | null>("/announcement", {
    anonymous: true,
  });
}

// ---- presence ------------------------------------------------------------

export function callHeartbeat(this: OrbynClient, input: PresenceHeartbeat) {
  return this.request<{ ok: true }>("/presence/heartbeat", {
    method: "POST",
    body: input,
  });
}

export function callLeavePresence(this: OrbynClient, deviceId: string) {
  return this.request<{ ok: true }>("/presence/leave", {
    method: "POST",
    body: { device_id: deviceId },
  });
}

export function callPresenceSettings(this: OrbynClient) {
  return this.request<PresenceSettings>("/presence/settings");
}

/** An experiment's before and after, measured. */

export function callExperimentEvidence(this: OrbynClient, id: string) {
  return this.request<ExperimentEvidence>(`/work-records/${id}/evidence`);
}
