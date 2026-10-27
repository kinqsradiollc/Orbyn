import {
  type CaptureAssistInput,
  type CaptureAssistResult,
  type CaptureRequest,
  type CaptureResult,
  type ClipDestinations,
  type ClipInput,
  type ClipKey,
  type ClipResult,
} from "@orbyn/core";
import type { OrbynClient } from "../client.js";

// The Orbyn Clipper (CAP-02)

export function callListClipKeys(this: OrbynClient) {
  return this.request<ClipKey[]>("/me/clip-keys");
}

export function callCreateClipKey(this: OrbynClient, name?: string) {
  return this.request<{ key: string; clip_key: ClipKey }>("/me/clip-keys", {
    method: "POST",
    body: name ? { name } : {},
  });
}

export function callDeleteClipKey(this: OrbynClient, id: string) {
  return this.request<void>(`/me/clip-keys/${id}`, { method: "DELETE" });
}

export function callClipDestinations(this: OrbynClient) {
  return this.request<ClipDestinations>("/clips/destinations");
}

export function callClip(
  this: OrbynClient,
  input: Partial<ClipInput> & Pick<ClipInput, "type" | "url">,
) {
  return this.request<ClipResult>("/clips", { method: "POST", body: input });
}

/**
 * Put a link or some text shared into Orbyn where it was sent: an Inbox
 * task, today's agenda, a page, a new page in a folder, or a project.
 */

export function callCapture(this: OrbynClient, input: CaptureRequest) {
  return this.request<CaptureResult>("/capture", {
    method: "POST",
    body: input,
  });
}

/** Summarise, or find deadlines in, a page or shared words (AI-01). */

export function callAssistCapture(
  this: OrbynClient,
  input: CaptureAssistInput,
) {
  return this.request<CaptureAssistResult>("/ai/assist", {
    method: "POST",
    body: input,
  });
}
