import {
  addDays,
  allDayRange,
  freshItem,
  fromDateTimeLocal,
  localDateKey,
  toDateTimeLocal,
  type Item,
  type ItemInput,
  type Kind,
  type Priority,
  type QuickAddDraft,
  type Status,
} from "@orbyn/core";
import {
  deviceTimeZone,
  ESTIMATES,
  repeatDraft,
  repeatProblem,
  rruleFromDraft,
  type RepeatDraft,
} from "./format";

export type OccurrenceRef = {
  occurrence: string;
  start_at: string;
  end_at: string | null;
};
export type Invitee = { email: string; name?: string; status?: string };
export type LinkDraft = { url: string; title: string };
export type Measure = { target: string; current: string; unit: string };

/** The whole form as text and choices, so a failed save loses nothing. */
export type Draft = {
  title: string;
  notes: string;
  kind: Kind;
  priority: Priority;
  status: Status;
  teamId: string | null;
  listId: string | null;
  tagIds: string[];
  waitsOn: string[];
  assigneeId: string | null;
  estimate: string;
  customEstimate: boolean;
  allDay: boolean;
  due: string;
  end: string;
  startDay: string;
  endDay: string;
  busy: boolean;
  color: string | null;
  /** Null: nobody changed the alerts of a new item (it gets your defaults). */
  alerts: number[] | null;
  location: string;
  meetingUrl: string;
  repeat: RepeatDraft;
  measure: Measure;
  links: LinkDraft[];
  invitees: Invitee[];
};

export const today = () => localDateKey(new Date(), deviceTimeZone());

export function draftFrom(
  base: Item | ItemInput,
  saved: boolean,
  occurrence?: OccurrenceRef | null,
): Draft {
  const zone = base.timezone ?? deviceTimeZone();
  const start = occurrence?.start_at ?? base.due_at;
  const end = occurrence ? occurrence.end_at : base.end_at;
  const allDay = !!base.all_day;
  const estimate = base.estimate_minutes ?? null;
  return {
    title: base.title,
    notes: base.notes ?? "",
    kind: base.kind,
    priority: base.priority,
    status: base.status,
    teamId: base.team_id ?? null,
    listId: base.list_id ?? null,
    tagIds: base.tag_ids ?? [],
    waitsOn: base.prerequisite_ids ?? [],
    assigneeId: base.assignee_id ?? null,
    estimate: estimate === null ? "" : String(estimate),
    customEstimate: !!estimate && !ESTIMATES.includes(estimate),
    allDay,
    due: allDay ? "" : toDateTimeLocal(start),
    end: allDay ? "" : toDateTimeLocal(end),
    startDay: allDay && start ? localDateKey(new Date(start), zone) : "",
    endDay:
      allDay && end ? localDateKey(new Date(Date.parse(end) - 1), zone) : "",
    busy: base.busy ?? true,
    color: base.color ?? null,
    alerts: saved
      ? (base.alerts ??
        (base.reminder_minutes != null ? [base.reminder_minutes] : []))
      : (base.alerts ?? null),
    location: base.location ?? "",
    meetingUrl: base.meeting_url ?? "",
    repeat: repeatDraft(base.rrule, base.due_at),
    measure: {
      target: base.target_value == null ? "" : String(base.target_value),
      current: base.current_value == null ? "" : String(base.current_value),
      unit: base.value_unit ?? "",
    },
    links: (base.links ?? []).map((l) => ({
      url: l.url,
      title: l.title ?? "",
    })),
    invitees: ((base.attendees ?? []) as Invitee[]).map((a) => ({
      email: a.email,
      name: a.name || undefined,
      status: a.status,
    })),
  };
}

export const blankItem = (prefill?: Partial<ItemInput>): ItemInput => ({
  ...freshItem(),
  ...prefill,
});

/**
 * What a new item starts from when quick-add words meet a prefill. The parser
 * always fills in `kind` and `team_id`, so those are only worth taking when
 * the words said something: it can infer an event but never asks for a task,
 * and it names a team only through a list or a tag.
 */
export function withQuickAdd(
  prefill: Partial<ItemInput> | undefined,
  parsed: QuickAddDraft | undefined,
  chips: readonly { kind: string }[] = [],
): Partial<ItemInput> & { title?: string } {
  if (!parsed) return { ...prefill };
  const { kind, team_id: typedTeam, ...typed } = parsed;
  // Words like "meeting" make the parser supply a date of its own. A time
  // that came with the item stands unless one was really typed.
  const typedWhen = chips.some((chip) =>
    ["date", "time", "duration", "all_day"].includes(chip.kind),
  );
  if (prefill?.due_at && !typedWhen) {
    delete typed.due_at;
    delete typed.end_at;
    delete typed.all_day;
  }
  const merged: Partial<ItemInput> & { title?: string } = {
    ...prefill,
    ...typed,
  };
  merged.kind = kind === "event" ? "event" : (prefill?.kind ?? kind);
  const before = prefill?.team_id ?? null;
  const said = !!typed.list_id || !!typedTeam;
  merged.team_id = said ? (typedTeam ?? null) : before;
  // A typed date replaces the prefilled span rather than half of it.
  if (typed.due_at) {
    if (!typed.end_at) merged.end_at = null;
    if (!typed.all_day) merged.all_day = false;
  }
  if (merged.team_id !== before) {
    if (!typed.list_id) merged.list_id = null;
    if (!typed.assignee_id) merged.assignee_id = null;
    delete merged.project_id;
    delete merged.stage_id;
    delete merged.parent_id;
  }
  // Tags and people the words found belong to the place they were read in.
  if (merged.team_id !== (typedTeam ?? null)) {
    delete merged.tag_ids;
    delete merged.assignee_id;
  }
  return merged;
}

/** Fields the form doesn't show, kept from what a new item was started with. */
export const carriedFields = (base: ItemInput, teamId: string | null) =>
  (base.team_id ?? null) === teamId
    ? {
        ...(base.parent_id ? { parent_id: base.parent_id } : {}),
        ...(base.project_id ? { project_id: base.project_id } : {}),
        ...(base.stage_id ? { stage_id: base.stage_id } : {}),
      }
    : {};

export function datesOf(d: Draft, zone: string) {
  if (d.allDay) {
    if (!d.startDay) return { due_at: null, end_at: null };
    const last = d.endDay && d.endDay >= d.startDay ? d.endDay : d.startDay;
    return allDayRange(d.startDay, last, zone);
  }
  return {
    due_at: fromDateTimeLocal(d.due || null),
    end_at: fromDateTimeLocal(d.end || null),
  };
}

/** Switching to all day keeps the dates, and back gives a working hour. */
export function withAllDay(d: Draft, on: boolean): Draft {
  if (on === d.allDay) return d;
  if (on) {
    const start = d.due ? d.due.slice(0, 10) : today();
    const end = d.end ? d.end.slice(0, 10) : start;
    return {
      ...d,
      allDay: true,
      startDay: start,
      endDay: end > start ? end : start,
    };
  }
  return {
    ...d,
    allDay: false,
    due: d.due || `${d.startDay || today()}T09:00`,
  };
}

/** Moves a whole-day task, keeping how many days it spans. */
export function withAllDayDue(d: Draft, due: string): Draft {
  const days =
    d.startDay && d.endDay > d.startDay
      ? Math.round((Date.parse(d.endDay) - Date.parse(d.startDay)) / 86_400_000)
      : 0;
  return { ...d, startDay: due ? addDays(due, -days) : "", endDay: due };
}

export const inTeam = (d: Draft, next: string | null): Draft => ({
  ...d,
  teamId: next,
  // Lists, tags and the assignee belong to the old place.
  listId: null,
  tagIds: [],
  assigneeId: null,
});

type Built = { data: ItemInput; error?: undefined } | { error: string };

/** The item to send, or what stops it being saved. */
export function buildInput(
  d: Draft,
  base: Item | ItemInput,
  known: { links: boolean; invitees: boolean },
  initialRepeat: string,
): Built {
  const title = d.title.trim();
  if (!title) return { error: "Add a title." };
  const problem = repeatProblem(d.repeat);
  if (problem) return { error: problem };
  const minutes = d.estimate.trim() === "" ? null : Number(d.estimate);
  if (
    d.customEstimate &&
    (minutes === null ||
      !Number.isInteger(minutes) ||
      minutes < 1 ||
      minutes > 10080)
  )
    return { error: "Use 1–10,080 whole minutes for the estimate." };
  const zone = base.timezone ?? deviceTimeZone();
  if (d.allDay && !d.startDay) return { error: "All-day items need a date." };
  const { due_at, end_at } = datesOf(d, zone);
  if (d.kind === "event" && !due_at)
    return { error: "Events need a start time." };
  if (end_at && (!due_at || Date.parse(end_at) <= Date.parse(due_at)))
    return { error: "The end must be after the start." };
  if (d.meetingUrl.trim() && !/^https?:\/\/\S+$/i.test(d.meetingUrl.trim()))
    return { error: "Meeting links start with https://" };
  const rrule =
    JSON.stringify(d.repeat) === initialRepeat
      ? (base.rrule ?? null)
      : rruleFromDraft(d.repeat);
  if (rrule && !due_at)
    return { error: "Repeating items need a date. Add a start time." };
  const number = (text: string) =>
    text.trim() === "" || !Number.isFinite(Number(text)) ? null : Number(text);
  const target = number(d.measure.target);
  return {
    data: {
      title,
      notes: d.notes,
      kind: d.kind,
      priority: d.priority,
      status: d.status,
      due_at,
      end_at,
      team_id: d.teamId,
      estimate_minutes: minutes,
      list_id: d.listId,
      tag_ids: d.tagIds,
      prerequisite_ids: d.kind === "task" ? d.waitsOn : [],
      ...(d.kind === "task"
        ? {
            target_value: target,
            current_value:
              target === null ? null : (number(d.measure.current) ?? 0),
            value_unit:
              target === null ? "" : d.measure.unit.trim().slice(0, 16),
          }
        : {}),
      assignee_id: d.teamId ? d.assigneeId : null,
      location: d.location.trim(),
      meeting_url: d.meetingUrl.trim(),
      rrule,
      all_day: d.allDay,
      ...(rrule || d.allDay ? { timezone: zone } : {}),
      ...(d.kind === "event" ? { busy: d.busy } : {}),
      color: d.color,
      ...(d.alerts !== null ? { alerts: d.alerts } : {}),
      // Sent only once the saved list is known, so it is never wiped.
      ...(known.links
        ? {
            links: d.links.map((l) => ({
              url: l.url.trim(),
              title: l.title.trim(),
            })),
          }
        : {}),
      ...(d.kind === "event" && known.invitees
        ? {
            attendees: d.invitees.map(({ email, name }) =>
              name ? { email, name } : { email },
            ),
          }
        : {}),
    } as ItemInput,
  };
}
