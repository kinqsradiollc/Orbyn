import {
  type AiSettings,
  type CalendarSearch,
  type DocKind,
  type FindHit,
  type SearchHit,
} from "@orbyn/core";
import type { OrbynClient } from "../client.js";

/**
 * Search pages and tasks together, ranked. Filters narrow the same query
 * rather than choosing a different one, so a search with every filter off
 * is the same search.
 */

export function callSearch(
  this: OrbynClient,
  q: string,
  filter: {
    type?: "doc" | "task" | "project";
    kind?: DocKind;
    project?: string;
    tag?: string;
    team?: string;
    updated_after?: string;
    include_archived?: boolean;
    limit?: number;
  } = {},
) {
  const params = new URLSearchParams({ q });
  for (const [k, v] of Object.entries(filter))
    if (v !== undefined) params.set(k, String(v));
  return this.request<SearchHit[]>(`/search?${params}`);
}

/**
 * The quick switcher: pages, tasks and projects by name, from the first
 * letter. With no words, what you opened last (then what changed last).
 */

export function callFind(
  this: OrbynClient,
  q: string,
  filter: {
    type?: "doc" | "task" | "project";
    limit?: number;
    include_archived?: boolean;
  } = {},
) {
  const params = new URLSearchParams({ q });
  for (const [k, v] of Object.entries(filter))
    if (v !== undefined) params.set(k, String(v));
  return this.request<FindHit[]>(`/find?${params}`);
}

/** Events matching words, a year either side of today unless a range is given. */

export function callSearchCalendar(
  this: OrbynClient,
  q: string,
  range: { from?: string; to?: string } = {},
) {
  const params = new URLSearchParams({ q });
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
  return this.request<CalendarSearch>(`/calendar/search?${params}`);
}

export function callSetSemanticSearch(
  this: OrbynClient,
  input: {
    on: boolean;
    embedding_model?: string;
    embedding_provider_id?: string;
    expected_generation?: string;
    expected_provider_revision?: string;
    accept?: boolean;
  },
) {
  return this.request<AiSettings>("/ai/settings/semantic", {
    method: "PUT",
    body: input,
  });
}
