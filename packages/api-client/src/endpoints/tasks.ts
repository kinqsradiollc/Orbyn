import {
  type AdminUser,
  type ApiKey,
  type AuditEntry,
  type BlockUpdate,
  type CalendarFeedSettings,
  type CalendarFeedSettingsInput,
  type CalendarSubscription,
  type CalendarSubscriptionUpdate,
  type DevicePresence,
  type Doc,
  type EditScope,
  type Frame,
  type FrameUpdate,
  type Habit,
  type HabitUpdate,
  type Item,
  type ItemContext,
  type ItemDetail,
  type ItemInput,
  type ItemPositionInput,
  type ItemProof,
  type ItemSessions,
  type ItemSort,
  type ItemSyncPage,
  type LegalAdminView,
  type LegalSettingsUpdate,
  type ListInput,
  type ListUpdate,
  type NightShiftSettings,
  type Page,
  type Passkey,
  type Place,
  type PlaceUpdate,
  type PlannerPrefs,
  type PlannerPrefsInput,
  type PresenceSettings,
  type Profile,
  type ProfileInput,
  type QuickAddCreated,
  type Session,
  type StarredItem,
  type Status,
  type SystemRole,
  type SystemSettingsUpdate,
  type SystemSettingsView,
  type Tag,
  type TagInput,
  type TagUpdate,
  type TaskAsk,
  type TaskList,
  type TeamChangesPage,
  type TimeBlock,
  type UpdateInfo,
  type User,
  type Webhook,
  type WebhookUpdate,
} from "@orbyn/core";
import { RequestOptions, scopeQuery } from "../client-contracts.js";
import type { OrbynClient } from "../client.js";

export function callUpdateSystemSettings(
  this: OrbynClient,
  body: SystemSettingsUpdate,
) {
  return this.request<SystemSettingsView>("/admin/settings", {
    method: "PUT",
    body,
  });
}

/** The running version against the newest commit on GitHub. */

export function callGetUpdates(this: OrbynClient) {
  return this.request<UpdateInfo>("/admin/updates");
}

/** Where you're signed in. */

export function callListSessions(this: OrbynClient) {
  return this.request<Session[]>("/me/sessions");
}

// ---- passkeys ----

export function callListPasskeys(this: OrbynClient) {
  return this.request<Passkey[]>("/me/passkeys");
}

export function callUpdatePreferences(
  this: OrbynClient,
  input: { email_reminders: boolean },
) {
  return this.request<User>("/me", { method: "PUT", body: input });
}

// ---- items ----

export function callListItems(
  this: OrbynClient,
  params: {
    limit?: number;
    offset?: number;
    team_id?: string;
    /** Words in the title or notes. */
    q?: string;
    list_id?: string;
    tag_id?: string;
    assignee_id?: string;
    /** List order; newest first when omitted. Every item carries its `score`. */
    sort?: ItemSort;
    /** Only the subtasks of this task. */
    parent_id?: string;
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
    "sort",
    "parent_id",
  ] as const)
    if (params[key]) q.set(key, params[key]!);
  const suffix = q.size ? `?${q}` : "";
  return this.request<Item[]>(`/items${suffix}`);
}

/**
 * Incremental sync: items changed after `updated_after` (or after a
 * previous page's `next_cursor`), oldest change first, and with
 * `include_deleted` the items deleted since.
 */

export function callSyncItems(
  this: OrbynClient,
  params: {
    updated_after?: string;
    cursor?: string;
    include_deleted?: boolean;
    limit?: number;
    team_id?: string;
  },
  options: Pick<RequestOptions, "headers" | "fresh" | "signal"> = {},
) {
  const q = new URLSearchParams();
  // Without either, GET /items is the ordinary list, not a sync page.
  if (!params.updated_after && !params.cursor)
    throw new Error("syncItems needs updated_after or cursor");
  if (params.updated_after) q.set("updated_after", params.updated_after);
  if (params.cursor) q.set("cursor", params.cursor);
  if (params.include_deleted) q.set("include_deleted", "1");
  if (params.limit !== undefined) q.set("limit", String(params.limit));
  if (params.team_id) q.set("team_id", params.team_id);
  return this.request<ItemSyncPage>(`/items?${q}`, options);
}

/** One primary, repeatable-read planner snapshot; later deltas are best effort. */

export function callReconcileItems(this: OrbynClient) {
  return this.request<{ items: Item[]; updated_after: string }>(
    "/items/reconcile",
    {
      fresh: true,
      headers: { "x-orbyn-consistency": "primary" },
    },
  );
}

/** Move an item in its manual order (doesn't change its version). */

export function callMoveItem(
  this: OrbynClient,
  id: string,
  input: ItemPositionInput,
) {
  return this.request<Item>(`/items/${id}/position`, {
    method: "PUT",
    body: input,
  });
}

/** Add minutes worked (focus timer). */

export function callLogTime(
  this: OrbynClient,
  itemId: string,
  minutes: number,
) {
  return this.request<ItemDetail>(`/items/${itemId}/time`, {
    method: "POST",
    body: { minutes },
  });
}

/** Remove one occurrence of a repeating item. */

export function callSkipOccurrence(
  this: OrbynClient,
  itemId: string,
  occurrence: string,
) {
  return this.request<ItemDetail>(`/items/${itemId}/skip`, {
    method: "POST",
    body: { occurrence },
  });
}

/**
 * The note for an event, created from a template the first time. For a
 * repeating event, `occurrence` (the calendar entry's) opens that class's
 * own note; without it, the series' note.
 */

export function callItemNote(
  this: OrbynClient,
  itemId: string,
  occurrence?: string | null,
) {
  return this.request<Doc>(`/items/${itemId}/note`, {
    method: "POST",
    ...(occurrence ? { body: { occurrence } } : {}),
  });
}

/**
 * What a task hangs off and what hangs off it: its project and stage, the
 * page line it came from and the other pages about it (only pages you can
 * open).
 */

export function callItemContext(this: OrbynClient, itemId: string) {
  return this.request<ItemContext>(`/items/${itemId}/context`);
}

/** The Starred group: every star with its live title (NAV-07). */

export function callListStarred(this: OrbynClient) {
  return this.request<StarredItem[]>("/starred");
}

export function callListLists(this: OrbynClient) {
  return this.request<TaskList[]>("/lists");
}

export function callCreateList(this: OrbynClient, input: ListInput) {
  return this.request<TaskList>("/lists", { method: "POST", body: input });
}

export function callUpdateList(
  this: OrbynClient,
  id: string,
  input: ListUpdate,
) {
  return this.request<TaskList>(`/lists/${id}`, {
    method: "PUT",
    body: input,
  });
}

export function callDeleteList(this: OrbynClient, id: string) {
  return this.request<void>(`/lists/${id}`, { method: "DELETE" });
}

export function callListTags(this: OrbynClient) {
  return this.request<Tag[]>("/tags");
}

export function callCreateTag(this: OrbynClient, input: TagInput) {
  return this.request<Tag>("/tags", { method: "POST", body: input });
}

export function callUpdateTag(this: OrbynClient, id: string, input: TagUpdate) {
  return this.request<Tag>(`/tags/${id}`, { method: "PUT", body: input });
}

export function callDeleteTag(this: OrbynClient, id: string) {
  return this.request<void>(`/tags/${id}`, { method: "DELETE" });
}

export function callListBlocks(this: OrbynClient, from: string, to: string) {
  const q = new URLSearchParams({ from, to });
  return this.request<TimeBlock[]>(`/blocks?${q}`);
}

/** Your sessions for one task, past ones too, with its deadline. Makes no plan. */

export function callItemSessions(this: OrbynClient, itemId: string) {
  return this.request<ItemSessions>(`/items/${itemId}/sessions`);
}

export function callUpdateBlock(
  this: OrbynClient,
  id: string,
  input: BlockUpdate,
) {
  return this.request<TimeBlock>(`/blocks/${id}`, {
    method: "PUT",
    body: input,
  });
}

export function callUpdatePlannerPrefs(
  this: OrbynClient,
  input: PlannerPrefsInput,
) {
  return this.request<PlannerPrefs>("/planner/prefs", {
    method: "PUT",
    body: input,
  });
}

export function callListFrames(this: OrbynClient) {
  return this.request<Frame[]>("/planner/frames");
}

export function callUpdateFrame(
  this: OrbynClient,
  id: string,
  input: FrameUpdate,
) {
  return this.request<Frame>(`/planner/frames/${id}`, {
    method: "PUT",
    body: input,
  });
}

// ---- habits ----

export function callListHabits(this: OrbynClient) {
  return this.request<Habit[]>("/planner/habits");
}

export function callUpdateHabit(
  this: OrbynClient,
  id: string,
  input: HabitUpdate,
) {
  return this.request<Habit>(`/planner/habits/${id}`, {
    method: "PUT",
    body: input,
  });
}

export function callListPlaces(this: OrbynClient) {
  return this.request<Place[]>("/planner/places");
}

export function callUpdatePlace(
  this: OrbynClient,
  id: string,
  input: PlaceUpdate,
) {
  return this.request<Place>(`/planner/places/${id}`, {
    method: "PUT",
    body: input,
  });
}

export function callUpdateCalendarFeedSettings(
  this: OrbynClient,
  input: CalendarFeedSettingsInput,
) {
  return this.request<CalendarFeedSettings>("/me/calendar-feed", {
    method: "PUT",
    body: input,
  });
}

// ---- calendars from other apps (ICS links) ----

export function callListCalendarSubscriptions(this: OrbynClient) {
  return this.request<CalendarSubscription[]>("/me/calendar-subscriptions");
}

export function callUpdateCalendarSubscription(
  this: OrbynClient,
  id: string,
  input: CalendarSubscriptionUpdate,
) {
  return this.request<CalendarSubscription>(
    `/me/calendar-subscriptions/${id}`,
    { method: "PUT", body: input },
  );
}

/** `handle: null` removes your page. */

export function callUpdateProfile(this: OrbynClient, input: ProfileInput) {
  return this.request<Profile>("/me/profile", { method: "PUT", body: input });
}

export function callListApiKeys(this: OrbynClient) {
  return this.request<ApiKey[]>("/me/api-keys");
}

export function callUpdateNightShiftSettings(
  this: OrbynClient,
  input: NightShiftSettings,
) {
  return this.request<NightShiftSettings>("/me/assistant/night-shift", {
    method: "PUT",
    body: input,
  });
}

export function callListWebhooks(this: OrbynClient) {
  return this.request<Webhook[]>("/me/webhooks");
}

export function callUpdateWebhook(
  this: OrbynClient,
  id: string,
  input: WebhookUpdate,
) {
  return this.request<Webhook>(`/me/webhooks/${id}`, {
    method: "PUT",
    body: input,
  });
}

/** Follows pagination until the planner is fully loaded. */

export async function callListAllItems(this: OrbynClient, pageSize = 500) {
  const all: Item[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await this.listItems({ limit: pageSize, offset });
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all;
}

/** Create an item; `id` names it on the device (made offline). */

export function callCreateItem(
  this: OrbynClient,
  input: Partial<ItemInput> & { title: string; id?: string },
) {
  return this.request<Item>("/items", { method: "POST", body: input });
}

export function callQuickAdd(
  this: OrbynClient,
  text: string,
  timezone?: string,
) {
  return this.request<QuickAddCreated>("/items/quick", {
    method: "POST",
    body: { text, ...(timezone ? { timezone } : {}) },
  });
}

/**
 * Save an item. For one occurrence of a repeating item pass `scope: "this"`
 * (or `"following"` for it and every later one) and the `occurrence`.
 */

export function callUpdateItem(
  this: OrbynClient,
  id: string,
  input: ItemInput & { version: number },
  options: { scope?: EditScope; occurrence?: string } = {},
) {
  return this.request<Item>(`/items/${id}${scopeQuery(options)}`, {
    method: "PUT",
    body: input,
  });
}

export function callDeleteItem(
  this: OrbynClient,
  id: string,
  version: number,
  options: {
    scope?: EditScope;
    occurrence?: string;
    expectedBlocks?: { id: string; revision: number }[];
  } = {},
) {
  const scope = scopeQuery(options).replace(/^\?/, "&");
  return this.request<void>(`/items/${id}?version=${version}${scope}`, {
    method: "DELETE",
    ...(options.expectedBlocks
      ? { body: { expected_blocks: options.expectedBlocks } }
      : {}),
  });
}

/** Take a task back from your agent; a run working on it stops. */

export function callTakeTaskBack(this: OrbynClient, id: string) {
  return this.request<Item>(`/items/${id}/agent`, { method: "DELETE" });
}

/** A task with its checklist steps and progress timeline. */

export function callGetItem(this: OrbynClient, id: string) {
  return this.request<ItemDetail>(`/items/${id}`);
}

export function callAddStep(
  this: OrbynClient,
  itemId: string,
  input: { title: string },
) {
  return this.request<ItemDetail>(`/items/${itemId}/steps`, {
    method: "POST",
    body: input,
  });
}

export function callUpdateStep(
  this: OrbynClient,
  itemId: string,
  stepId: string,
  input: { title?: string; done?: boolean },
) {
  return this.request<ItemDetail>(`/items/${itemId}/steps/${stepId}`, {
    method: "PUT",
    body: input,
  });
}

export function callDeleteStep(
  this: OrbynClient,
  itemId: string,
  stepId: string,
) {
  return this.request<ItemDetail>(`/items/${itemId}/steps/${stepId}`, {
    method: "DELETE",
  });
}

/** Post a progress note, optionally changing status or progress. */

export function callPostItemUpdate(
  this: OrbynClient,
  itemId: string,
  input: { body?: string; status?: Status; progress?: number },
) {
  return this.request<ItemDetail>(`/items/${itemId}/updates`, {
    method: "POST",
    body: input,
  });
}

export function callAdminUpdateUserProfile(
  this: OrbynClient,
  id: string,
  input: { name?: string; email?: string },
) {
  return this.request<{ ok: true; verify_again: boolean }>(
    `/admin/users/${id}/profile`,
    { method: "PUT", body: input },
  );
}

export function callUpdateLegal(this: OrbynClient, input: LegalSettingsUpdate) {
  return this.request<LegalAdminView>("/admin/legal", {
    method: "PUT",
    body: input,
  });
}

export function callAdminListUsers(
  this: OrbynClient,
  params: { search?: string; limit?: number; offset?: number } = {},
) {
  const q = new URLSearchParams();
  if (params.search) q.set("search", params.search);
  if (params.limit !== undefined) q.set("limit", String(params.limit));
  if (params.offset !== undefined) q.set("offset", String(params.offset));
  const suffix = q.size ? `?${q}` : "";
  return this.request<Page<AdminUser>>(`/admin/users${suffix}`);
}

export function callAdminUpdateUser(
  this: OrbynClient,
  id: string,
  input: { role?: SystemRole; disabled?: boolean; email_verified?: boolean },
) {
  return this.request<AdminUser>(`/admin/users/${id}`, {
    method: "PUT",
    body: input,
  });
}

export function callAdminListAudit(
  this: OrbynClient,
  params: { limit?: number; offset?: number } = {},
) {
  const q = new URLSearchParams();
  if (params.limit !== undefined) q.set("limit", String(params.limit));
  if (params.offset !== undefined) q.set("offset", String(params.offset));
  const suffix = q.size ? `?${q}` : "";
  return this.request<Page<AuditEntry>>(`/admin/audit${suffix}`);
}

export function callListDevices(this: OrbynClient) {
  return this.request<DevicePresence[]>("/presence/devices");
}

export function callUpdatePresenceSettings(
  this: OrbynClient,
  input: PresenceSettings,
) {
  return this.request<PresenceSettings>("/presence/settings", {
    method: "PUT",
    body: input,
  });
}

export function callListAsks(this: OrbynClient) {
  return this.request<{
    to_me: TaskAsk[];
    from_me: TaskAsk[];
    recent: TaskAsk[];
  }>("/asks");
}

export function callItemAsk(this: OrbynClient, itemId: string) {
  return this.request<TaskAsk | null>(`/items/${itemId}/ask`);
}

/** Answer an ask: take it on, suggest another date, or say you can't. */

export function callReplyToAsk(
  this: OrbynClient,
  id: string,
  input:
    | { action: "accept"; message?: string }
    | {
        action: "counter";
        due_at?: string | null;
        estimate_minutes?: number | null;
        message?: string;
      }
    | { action: "decline"; message: string },
) {
  return this.request<TaskAsk>(`/asks/${id}/reply`, {
    method: "POST",
    body: input,
  });
}

/** Settle a suggestion: agree, keep the original, or withdraw the ask. */

export function callSettleAsk(
  this: OrbynClient,
  id: string,
  action: "agree" | "keep" | "withdraw",
  message = "",
) {
  return this.request<TaskAsk>(`/asks/${id}/settle`, {
    method: "POST",
    body: { action, message },
  });
}

export function callListProofs(this: OrbynClient, itemId: string) {
  return this.request<ItemProof[]>(`/items/${itemId}/proofs`);
}

export function callAddProof(
  this: OrbynClient,
  itemId: string,
  input: { url?: string | null; note?: string },
) {
  return this.request<ItemProof>(`/items/${itemId}/proofs`, {
    method: "POST",
    body: { url: input.url ?? null, note: input.note ?? "" },
  });
}

export function callDeleteProof(
  this: OrbynClient,
  itemId: string,
  proofId: string,
) {
  return this.request<void>(`/items/${itemId}/proofs/${proofId}`, {
    method: "DELETE",
  });
}

// ---- D4c: staying current, publishing, imports, assistant chips ----

/** Recent changes in your teams (SHR-02), newest first. */

export function callListChanges(
  this: OrbynClient,
  params: {
    team_id?: string;
    /** Leave out your own changes; on unless false. */
    hide_mine?: boolean;
    before?: string;
    limit?: number;
  } = {},
) {
  const q = new URLSearchParams();
  if (params.team_id) q.set("team_id", params.team_id);
  if (params.hide_mine === false) q.set("hide_mine", "false");
  if (params.before) q.set("before", params.before);
  if (params.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return this.request<TeamChangesPage>(`/changes${qs ? `?${qs}` : ""}`);
}
