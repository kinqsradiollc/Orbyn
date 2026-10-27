import {
  type AdminOverview,
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
} from "@orbyn/core";
import type { OrbynClient } from "../client.js";

// Saved views (DATA-01) and your own fields (ORG-02)
/** Every saved view you can see: yours and those shared with your teams. */

export function callListViews(this: OrbynClient) {
  return this.request<SavedView[]>("/views");
}

export function callCreateView(this: OrbynClient, input: SavedViewInput) {
  return this.request<SavedView>("/views", { method: "POST", body: input });
}

export function callUpdateView(
  this: OrbynClient,
  id: string,
  input: SavedViewUpdate,
) {
  return this.request<SavedView>(`/views/${id}`, {
    method: "PUT",
    body: input,
  });
}

export function callDeleteView(this: OrbynClient, id: string) {
  return this.request<void>(`/views/${id}`, { method: "DELETE" });
}

/** Pin a view to your own sidebar, or unpin it. */

export function callPinView(this: OrbynClient, id: string, pinned: boolean) {
  return this.request<void>(`/views/${id}/pin`, {
    method: "PUT",
    body: { pinned },
  });
}

/** A saved view's rows, as you see them. */

export function callRunView(this: OrbynClient, id: string, limit?: number) {
  return this.request<ViewResult>("/views/run", {
    method: "POST",
    body: limit ? { id, limit } : { id },
  });
}

/** The rows of a definition that isn't saved (a live list, a view being built). */

export function callRunDefinition(
  this: OrbynClient,
  definition: ViewDefinitionInput,
  limit?: number,
) {
  return this.request<ViewResult>("/views/run", {
    method: "POST",
    body: limit ? { definition, limit } : { definition },
  });
}

/** A saved view as CSV text, with the file name the server chose. */

export async function callExportViewCsv(this: OrbynClient, id: string) {
  const response = await this.raw(`/views/${id}/export.csv`);
  const disposition = response.headers.get("content-disposition") ?? "";
  const named = /filename="([^"]+)"/.exec(disposition)?.[1];
  return { text: await response.text(), name: named ?? "View.csv" };
}

/** Every field you can see, for pages and projects. */

export function callListFields(this: OrbynClient) {
  return this.request<CustomField[]>("/fields");
}

export function callCreateField(this: OrbynClient, input: CustomFieldInput) {
  return this.request<CustomField>("/fields", {
    method: "POST",
    body: input,
  });
}

export function callUpdateField(
  this: OrbynClient,
  id: string,
  input: CustomFieldUpdate,
) {
  return this.request<CustomField>(`/fields/${id}`, {
    method: "PUT",
    body: input,
  });
}

/** Removes a field and clears it everywhere it was set. */

export function callDeleteField(this: OrbynClient, id: string) {
  return this.request<void>(`/fields/${id}`, { method: "DELETE" });
}

/** A page's or project's fields and values, for its Info panel. */

export function callTargetFields(
  this: OrbynClient,
  target: FieldTarget,
  id: string,
) {
  return this.request<TargetFields>(
    `/fields/values?${new URLSearchParams({ target, id })}`,
  );
}

/** Set one field on a page or project; null clears it. */

export function callSetFieldValue(
  this: OrbynClient,
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

export function callFieldDates(this: OrbynClient, from: string, to: string) {
  return this.request<FieldDate[]>(
    `/fields/dates?${new URLSearchParams({ from, to })}`,
  );
}

// ---- admin (system admins only) ----

export function callAdminOverview(this: OrbynClient) {
  return this.request<AdminOverview>("/admin/overview");
}
