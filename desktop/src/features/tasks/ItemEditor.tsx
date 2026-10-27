import { Select } from "../../components/Select";
import { useConfirm } from "../../components/Confirm";
import { useEffect, useId, useRef, useState } from "react";
import { Eye, MoreHorizontal, Trash2, X } from "lucide-react";
import {
  freshItem,
  addDays,
  allDayRange,
  deadlineOf,
  fromDateTimeLocal,
  hasTeamPermission,
  localDateKey,
  STATUSES,
  statusLabels,
  toDateTimeLocal,
  type Attendee,
  type EditScope,
  type Item,
  type ItemInput,
  type Kind,
  type Priority,
  type Project,
  type PlannerPrefs,
  type Status,
  type Team,
  type TeamMember,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { usePlanning } from "../../app/planning";
import {
  deviceTimeZone,
  errorText,
  ESTIMATES,
  minutesLabel,
  repeatDraft,
  rruleFromDraft,
} from "../planner/planning";
import { RepeatPicker } from "./RepeatPicker";
import { TagPicker } from "../../components/TagPicker";
import { WaitsOnPicker } from "./WaitsOnPicker";
import { AttentionWarning } from "../followthrough/AttentionWarning";
import "../followthrough/followthrough.css";
import {
  MeasureField,
  measureFrom,
  measureValues,
  type Measure,
} from "../../components/MeasureField";
import { LinksField, type LinkDraft } from "../../components/LinksField";
import {
  AlertsPicker,
  ColorPicker,
  InviteesPicker,
  type Invitee,
} from "../calendar/EventFields";
import {
  ScopeDialog,
  type EditOptions,
  type OccurrenceRef,
} from "./ScopeDialog";
import { DateField } from "../../components/DateField";
import { session } from "../../lib/session";
import { useModalFocus } from "../../hooks/useModalFocus";

/** "Fri 16 Oct". */
const shortDay = (iso: string) =>
  new Date(iso).toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

type Props = {
  editing: Item | "new";
  /** Your teams; the "Share with" picker offers those you can write to. */
  teams: Team[];
  /** Prefilled team for new items created from a team page. */
  defaultTeamId?: string | null;
  /** Prefilled fields for a new item (a meeting time, a list). */
  draft?: Partial<ItemInput> | null;
  /** One occurrence of a repeating item, when opened from the calendar. */
  occurrence?: OccurrenceRef | null;
  busy: boolean;
  error: string;
  /** Everything visible, so a task can be pointed at what it waits on. */
  items?: Item[];
  onClose: () => void;
  /** For a repeating item, `options` says which occurrences it changes. */
  onSave: (data: ItemInput, options?: EditOptions) => void;
  onDelete: (options?: EditOptions) => void;
  /** An immediate assignment receipt advances the parent revision without losing drafts. */
  onUpdated?: (item: Item) => void;
};

const today = () => localDateKey(new Date(), deviceTimeZone());

/**
 * Create/edit modal. Submits the full `ItemInput` (including `team_id`, the
 * planning fields and, for events, all day, busy or free, colour, alerts and
 * invitees); the caller adds the version. Changes to a repeating item first
 * ask which occurrences they cover. Team items you can only view (viewer
 * role) open read-only.
 */
export function ItemEditor(props: Props) {
  return (
    <ItemEditorBody
      key={`${session.get()}:${props.editing === "new" ? "new" : props.editing.id}:${props.occurrence?.occurrence ?? ""}`}
      {...props}
    />
  );
}
function ItemEditorBody({
  editing,
  teams,
  defaultTeamId = null,
  draft,
  occurrence,
  busy,
  error,
  items = [],
  onClose,
  onSave,
  onDelete,
  onUpdated,
}: Props) {
  const { ask } = useConfirm();
  const owner = useRef(session.get()).current;
  const mounted = useRef(true);
  const owns = () => mounted.current && session.get() === owner;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const titleId = useId(),
    progressId = useId();
  const dirty = useRef(false);
  const repeatProblem = useRef<string | null>(null);
  const drafts = useRef({
    links: false,
    invitees: false,
    alerts: false,
    tags: false,
  });
  const agentOperation = useRef(false),
    tagOperation = useRef(false),
    dispatch = useRef(false),
    closing = useRef(false);
  const [tagBusy, setTagBusy] = useState(false),
    [dispatchBusy, setDispatchBusy] = useState(false),
    [confirming, setConfirming] = useState(false);
  const [detailRetry, setDetailRetry] = useState(0),
    [membersRetry, setMembersRetry] = useState(0),
    [projectRetry, setProjectRetry] = useState(0);
  const [memberError, setMemberError] = useState("");
  const [membersLoading, setMembersLoading] = useState(false);
  const [projectError, setProjectError] = useState("");
  const planning = usePlanning();
  const existing = editing === "new" ? null : editing;
  const isNew = !existing;
  const base = useRef<Item | ItemInput>(
    existing ?? { ...freshItem(), team_id: defaultTeamId, ...draft },
  ).current;
  const [teamId, setTeamId] = useState<string | null>(base.team_id ?? null);
  const [kind, setKind] = useState<Kind>(base.kind);
  const [estimate, setEstimate] = useState<number | null>(
    base.estimate_minutes ?? null,
  );
  const [estimateText, setEstimateText] = useState(
    base.estimate_minutes == null ? "" : String(base.estimate_minutes),
  );
  const [customEstimate, setCustomEstimate] = useState(
    !!base.estimate_minutes && !ESTIMATES.includes(base.estimate_minutes),
  );
  const [listId, setListId] = useState<string | null>(base.list_id ?? null);
  const [tagIds, setTagIds] = useState<string[]>(base.tag_ids ?? []);
  const [waitsOn, setWaitsOn] = useState<string[]>(base.prerequisite_ids ?? []);
  const [measure, setMeasure] = useState<Measure>(() => measureFrom(base));
  const [assigneeId, setAssigneeId] = useState<string | null>(
    base.assignee_id ?? null,
  );
  // Handing the task to your own agent (W3) happens at once, not on Save.
  const [withAgent, setWithAgent] = useState(!!existing?.agent_grant_id);
  const [agentWhen, setAgentWhen] = useState<"now" | "tonight">(
    existing?.agent_when ?? "now",
  );
  const [agentName, setAgentName] = useState("Orbyn");
  const [agentNote, setAgentNote] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  useEffect(() => {
    if (!existing || existing.kind !== "task") return;
    let live = true;
    client
      .agentSettings()
      .then((a) => live && owns() && setAgentName(a.name || "Orbyn"))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [existing?.id, existing?.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const AGENT = "~agent";
  const pickAssignee = async (value: string) => {
    if (!owns() || lockedRef.current || agentOperation.current) return;
    if (!existing) {
      setAssigneeId(value || null);
      return;
    }
    if (value === AGENT || value === "~tonight" || withAgent) {
      agentOperation.current = true;
      setAgentBusy(true);
      setAgentNote("");
      try {
        if (value === AGENT || value === "~tonight") {
          const when = value === "~tonight" ? "tonight" : "now";
          const updated = await client.handTaskToAgent(existing.id, when);
          if (!owns()) return;
          onUpdated?.(updated);
          setAgentWhen(when);
          setWithAgent(true);
          setAgentNote(
            when === "tonight"
              ? `Assigned to ${agentName} for tonight. Turn on night shift in Assistant settings.`
              : `Assigned to ${agentName} in the background.`,
          );
          return;
        }
        const updated = await client.takeTaskBack(existing.id);
        if (!owns()) return;
        onUpdated?.(updated);
        setWithAgent(false);
        setAgentNote(`Taken back from ${agentName}.`);
      } catch (e) {
        if (owns()) setAgentNote(errorText(e));
        return;
      } finally {
        agentOperation.current = false;
        if (owns()) setAgentBusy(false);
      }
    }
    if (owns()) setAssigneeId(value || null);
  };
  const [location, setLocation] = useState(base.location ?? "");
  const [meetingUrl, setMeetingUrl] = useState(base.meeting_url ?? "");
  const [repeat, setRepeat] = useState(() =>
    repeatDraft(base.rrule, base.due_at),
  );
  const initialRepeat = useRef(JSON.stringify(repeat)).current;

  // Times: an occurrence keeps its own; whole days are dates in the item's zone.
  const zone = base.timezone ?? deviceTimeZone();
  const startIso = occurrence?.start_at ?? base.due_at;
  const endIso = occurrence ? occurrence.end_at : base.end_at;
  const [allDay, setAllDay] = useState(!!base.all_day);
  const [dueValue, setDueValue] = useState(
    base.all_day ? "" : toDateTimeLocal(startIso),
  );
  const [endValue, setEndValue] = useState(
    base.all_day ? "" : toDateTimeLocal(endIso),
  );
  const [startDay, setStartDay] = useState(
    base.all_day && startIso ? localDateKey(new Date(startIso), zone) : "",
  );
  const [endDay, setEndDay] = useState(
    base.all_day && endIso
      ? localDateKey(new Date(Date.parse(endIso) - 1), zone)
      : "",
  );
  const [project, setProject] = useState<Project | null>(null);
  const projectId = base.project_id ?? null;
  useEffect(() => {
    setProject(null);
    setProjectError("");
    if (!projectId) {
      return;
    }
    let alive = true;
    void client.getProject(projectId).then(
      (value) => alive && owns() && setProject(value),
      (e) => alive && owns() && setProjectError(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, [projectId, projectRetry]);
  const allDayDates =
    allDay && startDay
      ? allDayRange(
          startDay,
          endDay && endDay >= startDay ? endDay : startDay,
          zone,
        )
      : null;
  const candidateDeadline =
    kind === "task"
      ? deadlineOf({
          due_at: allDayDates?.due_at ?? fromDateTimeLocal(dueValue || null),
          end_at: allDayDates?.end_at ?? fromDateTimeLocal(endValue || null),
          all_day: allDay,
          timezone: zone,
        })
      : null;
  const afterProject =
    project?.id === projectId &&
    !!project?.deadline &&
    !!candidateDeadline &&
    Date.parse(candidateDeadline) > Date.parse(project.deadline);

  const [busyTime, setBusyTime] = useState(base.busy ?? true);
  const [color, setColor] = useState<string | null>(base.color ?? null);
  /** Null: a new item nobody changed the alerts of (it gets your defaults). */
  const [alerts, setAlerts] = useState<number[] | null>(
    existing
      ? (existing.alerts ??
          (existing.reminder_minutes != null
            ? [existing.reminder_minutes]
            : []))
      : (draft?.alerts ?? null),
  );
  const [invitees, setInvitees] = useState<Invitee[]>(() =>
    (draft?.attendees ?? []).map((a) => ({ email: a.email, name: a.name })),
  );
  const [inviteesState, setInviteesState] = useState<
    "loading" | "ready" | "failed"
  >(existing ? "loading" : "ready");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const linksEdited = useRef(false),
    inviteesEdited = useRef(false);
  const [defaultPrefs, setDefaultPrefs] = useState<PlannerPrefs | null>(null);
  const [defaultsError, setDefaultsError] = useState("");
  const [defaultsRetry, setDefaultsRetry] = useState(0);
  useEffect(() => {
    if (!isNew || planning.prefs) return;
    let alive = true;
    setDefaultsError("");
    client.getPlannerPrefs().then(
      (value) => {
        if (alive && owns()) setDefaultPrefs(value);
      },
      (error) => {
        if (alive && owns()) setDefaultsError(errorText(error));
      },
    );
    return () => {
      alive = false;
    };
  }, [isNew, planning.prefs, defaultsRetry]);
  const [links, setLinks] = useState<LinkDraft[]>(() =>
    (draft?.links ?? []).map((l) => ({ url: l.url, title: l.title ?? "" })),
  );
  const [linksState, setLinksState] = useState<"loading" | "ready" | "failed">(
    existing ? "loading" : "ready",
  );
  const [formError, setFormError] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  /** A save or delete waiting for "this one / following / all". */
  const [pendingSave, setPendingSave] = useState<ItemInput | null>(null);
  const [askDelete, setAskDelete] = useState(false);

  const currentTeam = base.team_id
    ? teams.find((t) => t.id === base.team_id)
    : undefined;
  const teamName =
    currentTeam?.name ?? (existing as Item | null)?.team_name ?? "this team";
  const readOnly =
    !!base.team_id && !hasTeamPermission(currentTeam?.role, "items:write");
  // Moving an item out of a team (to personal or another team) needs
  // member-management rights in the team it leaves.
  const lockTeam =
    readOnly ||
    (!isNew &&
      !!base.team_id &&
      !hasTeamPermission(currentTeam?.role, "members:manage"));
  const writable = teams.filter((t) =>
    hasTeamPermission(t.role, "items:write"),
  );
  const shareOptions =
    base.team_id && !writable.some((t) => t.id === base.team_id)
      ? [{ id: base.team_id, name: teamName }, ...writable]
      : writable;
  const repeating = !!existing?.rrule;
  const occurrenceStart = occurrence?.occurrence ?? existing?.due_at;
  const withScope = (scope: EditScope): EditOptions => ({
    scope,
    occurrence: occurrenceStart ?? undefined,
  });

  // Team items can be assigned to someone in the team.
  useEffect(() => {
    setMembers([]);
    setMemberError("");
    setMembersLoading(!!teamId);
    if (!teamId) return;
    let alive = true;
    client
      .getTeam(teamId)
      .then(
        (t) => {
          if (alive && owns()) setMembers(t.members);
        },
        (e) => {
          if (alive && owns()) setMemberError(errorText(e));
        },
      )
      .finally(() => {
        if (alive && owns()) setMembersLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [teamId, membersRetry]);

  // A saved item's links, and an event's invitees and answers, come with
  // its details.
  const existingId = existing ? existing.id : null;
  useEffect(() => {
    if (!existingId) return;
    setLinksState("loading");
    setInviteesState("loading");
    let alive = true;
    client.getItem(existingId).then(
      (d) => {
        if (!alive || !owns()) return;
        if (!linksEdited.current)
          setLinks(
            (d.links ?? []).map((l) => ({ url: l.url, title: l.title ?? "" })),
          );
        setLinksState("ready");
        if (!inviteesEdited.current)
          setInvitees(
            ((d.attendees ?? []) as Attendee[]).map((a) => ({
              email: a.email,
              name: a.name || undefined,
              status: a.status,
            })),
          );
        setInviteesState("ready");
      },
      () => {
        if (!alive || !owns()) return;
        setInviteesState(inviteesEdited.current ? "ready" : "failed");
        setLinksState(linksEdited.current ? "ready" : "failed");
      },
    );
    return () => {
      alive = false;
    };
  }, [existingId, detailRetry]);

  // Personal items use personal lists and tags; team items use the team's.
  const inScope = (x: { team_id: string | null }) =>
    teamId ? x.team_id === teamId : x.team_id === null;
  const lists = planning.lists.filter(inScope);
  const tags = planning.tags.filter(inScope);

  /** Your default alerts for a new item of this kind. */
  const defaults = (): number[] => {
    const d = (planning.prefs ?? defaultPrefs)?.default_alerts as
      Record<string, number[] | undefined> | undefined;
    return d?.[allDay ? "all_day" : kind] ?? [30];
  };
  const shownAlerts = alerts ?? defaults();

  const changeTeam = (next: string | null) => {
    setTeamId(next);
    // Lists, tags and the assignee belong to the old place; start fresh.
    setListId(null);
    setTagIds([]);
    setAssigneeId(null);
  };

  const toggleAllDay = (on: boolean) => {
    if (on === allDay) return;
    setAllDay(on);
    if (on) {
      const start = dueValue ? dueValue.slice(0, 10) : today();
      const end = endValue ? endValue.slice(0, 10) : start;
      setStartDay(start);
      setEndDay(end > start ? end : start);
    } else if (!dueValue) setDueValue(`${startDay || today()}T09:00`);
  };

  const createTag = async (name: string) => {
    if (!owns() || lockedRef.current || tagOperation.current) return null;
    tagOperation.current = true;
    setTagBusy(true);
    setFormError("");
    try {
      const tag = await client.createTag({ name, team_id: teamId });
      if (!owns()) return null;
      try {
        await planning.reload();
      } catch {
        if (owns())
          setFormError("Tag created. Refresh the tag list to update it.");
      }
      return tag;
    } catch (e) {
      if (owns()) setFormError(errorText(e));
      return null;
    } finally {
      tagOperation.current = false;
      if (owns()) setTagBusy(false);
    }
  };

  const estimateChoice = customEstimate
    ? "custom"
    : estimate === null
      ? ""
      : String(estimate);

  const snapshot = JSON.stringify([
    teamId,
    kind,
    estimate,
    customEstimate,
    listId,
    tagIds,
    waitsOn,
    measure,
    assigneeId,
    location,
    meetingUrl,
    repeat,
    allDay,
    dueValue,
    endValue,
    startDay,
    endDay,
    busyTime,
    color,
    alerts,
  ]);
  const initial = useRef(snapshot).current;
  const locked =
    readOnly ||
    busy ||
    agentBusy ||
    tagBusy ||
    dispatchBusy ||
    confirming ||
    !!pendingSave ||
    askDelete;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const current = useRef({ busy, readOnly });
  current.current = { busy, readOnly };
  const operationPending = () =>
    current.current.busy ||
    agentOperation.current ||
    tagOperation.current ||
    dispatch.current;
  const requestClose = async () => {
    if (
      !owns() ||
      operationPending() ||
      closing.current ||
      pendingSave ||
      askDelete
    )
      return;
    closing.current = true;
    setConfirming(true);
    try {
      const changed =
        !readOnly &&
        (dirty.current ||
          snapshot !== initial ||
          repeatProblem.current ||
          Object.values(drafts.current).some(Boolean));
      if (
        !changed ||
        (await ask({
          title: "Discard changes?",
          body: "Your edits haven't been saved.",
          confirmLabel: "Discard changes",
          destructive: true,
        }))
      ) {
        if (owns() && !operationPending()) onClose();
      }
    } finally {
      closing.current = false;
      if (owns()) setConfirming(false);
    }
  };
  const focus = useModalFocus(
    () => void requestClose(),
    busy || agentBusy || tagBusy || dispatchBusy,
  );
  const send = async (data: ItemInput, options?: EditOptions) => {
    if (!owns() || operationPending() || current.current.readOnly) return;
    dispatch.current = true;
    setDispatchBusy(true);
    try {
      await onSave(data, options);
    } catch (e) {
      if (owns()) setFormError(errorText(e));
    } finally {
      dispatch.current = false;
      if (owns()) setDispatchBusy(false);
    }
  };
  const deleteItem = async (options?: EditOptions) => {
    if (!owns() || operationPending() || current.current.readOnly) return;
    dispatch.current = true;
    setDispatchBusy(true);
    try {
      await onDelete(options);
    } catch (e) {
      if (owns()) setFormError(errorText(e));
    } finally {
      dispatch.current = false;
      if (owns()) setDispatchBusy(false);
    }
  };
  const deleteChoice = async () => {
    if (!owns() || lockedRef.current || closing.current) return;
    if (repeating) {
      setAskDelete(true);
      return;
    }
    closing.current = true;
    setConfirming(true);
    try {
      if (
        (await ask({
          title: `Delete “${base.title}”?`,
          body: "This removes it from your planner.",
          confirmLabel: "Delete item",
          destructive: true,
        })) &&
        owns()
      )
        await deleteItem();
    } finally {
      closing.current = false;
      if (owns()) setConfirming(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <section
        ref={focus.ref}
        data-modal-focus={focus.id}
        tabIndex={-1}
        className="modal item-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="section-heading">
          <h2 id={titleId}>
            {readOnly ? "View item" : isNew ? "New item" : "Edit item"}
          </h2>
          <button
            className="icon-button"
            aria-label="Close editor"
            disabled={
              busy || agentBusy || tagBusy || dispatchBusy || confirming
            }
            onClick={() => void requestClose()}
          >
            <X size={20} />
          </button>
        </div>
        <form
          onChangeCapture={(event) => {
            const node = event.target;
            if (
              (node instanceof HTMLInputElement ||
                node instanceof HTMLTextAreaElement) &&
              (node.name === "title" || node.name === "notes")
            )
              dirty.current = true;
          }}
          onInvalidCapture={(event) => {
            const details = (event.target as HTMLElement).closest("details");
            if (details) {
              details.open = true;
              setDetailsOpen(true);
            }
          }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!owns() || lockedRef.current || operationPending()) return;
            if (repeatProblem.current) {
              setFormError(repeatProblem.current);
              return;
            }
            const unfinished = Object.entries(drafts.current).find(
              ([, pending]) => pending,
            )?.[0];
            if (unfinished) {
              setFormError(
                `Add or clear the unfinished ${unfinished === "invitees" ? "invitee" : unfinished === "alerts" ? "alert" : unfinished === "tags" ? "tag" : "link"} before saving.`,
              );
              return;
            }
            if (
              customEstimate &&
              (!estimateText.trim() ||
                !Number.isInteger(Number(estimateText)) ||
                Number(estimateText) < 1 ||
                Number(estimateText) > 10080)
            ) {
              setFormError("Use 1–10,080 whole minutes for the estimate.");
              return;
            }
            const d = new FormData(e.currentTarget);
            if (!String(d.get("title") ?? "").trim()) {
              setFormError("Add a title.");
              return;
            }
            let dueAt: string | null;
            let endAt: string | null;
            if (allDay) {
              if (!startDay) {
                setFormError("All-day items need a date.");
                return;
              }
              // Whole days: midnight to the midnight after the last day.
              const last = endDay && endDay >= startDay ? endDay : startDay;
              ({ due_at: dueAt, end_at: endAt } = allDayRange(
                startDay,
                last,
                zone,
              ));
            } else {
              dueAt = fromDateTimeLocal(dueValue || null);
              endAt = fromDateTimeLocal(endValue || null);
            }
            if (kind === "event" && !dueAt) {
              setFormError("Events need a start time.");
              return;
            }
            if (endAt && (!dueAt || Date.parse(endAt) <= Date.parse(dueAt))) {
              setFormError("The end must be after the start.");
              return;
            }
            const rrule =
              JSON.stringify(repeat) === initialRepeat
                ? (base.rrule ?? null)
                : rruleFromDraft(repeat);
            if (rrule && !dueAt) {
              setFormError("Repeating items need a date. Add a start time.");
              return;
            }
            if (
              repeat.freq !== "none" &&
              repeat.ends === "until" &&
              !repeat.until
            ) {
              setFormError("Pick the last date, or choose another ending.");
              return;
            }
            setFormError("");
            const data: ItemInput = {
              title: String(d.get("title")),
              notes: String(d.get("notes")),
              kind,
              priority: d.get("priority") as Priority,
              status: d.get("status") as Status,
              due_at: dueAt,
              end_at: endAt,
              team_id: teamId,
              estimate_minutes: estimate,
              list_id: listId,
              tag_ids: tagIds,
              prerequisite_ids: kind === "task" ? waitsOn : [],
              ...(kind === "task" ? measureValues(measure) : {}),
              assignee_id: teamId ? assigneeId : null,
              location: location.trim(),
              meeting_url: meetingUrl.trim(),
              rrule,
              all_day: allDay,
              ...(rrule || allDay ? { timezone: zone } : {}),
              ...(kind === "event" ? { busy: busyTime } : {}),
              color,
              // Untouched on a new item: the server uses your defaults.
              ...(alerts !== null ? { alerts } : {}),
              // Sent only once the saved list is known, so it's never wiped.
              ...(linksState === "ready"
                ? {
                    links: links.map((l) => ({
                      url: l.url.trim(),
                      title: l.title.trim(),
                    })),
                  }
                : {}),
              ...(kind === "event" && inviteesState === "ready"
                ? {
                    attendees: invitees.map(({ email, name }) =>
                      name ? { email, name } : { email },
                    ),
                  }
                : {}),
            };
            if (repeating) setPendingSave(data);
            else void send(data);
          }}
        >
          {readOnly && (
            <p className="view-only-note">
              <Eye size={14} /> View only in {teamName}.
            </p>
          )}
          <fieldset className="plain-fieldset" disabled={locked}>
            <label>
              Title
              <input
                autoFocus={!readOnly}
                required
                name="title"
                maxLength={200}
                defaultValue={base.title}
                placeholder="Task or event title"
              />
            </label>
            <div className="event-toggles">
              <div className="segmented" role="group" aria-label="Timing">
                <button
                  type="button"
                  aria-pressed={!allDay}
                  className={!allDay ? "active" : ""}
                  onClick={() => toggleAllDay(false)}
                >
                  At a time
                </button>
                <button
                  type="button"
                  aria-pressed={allDay}
                  className={allDay ? "active" : ""}
                  onClick={() => toggleAllDay(true)}
                >
                  All day
                </button>
              </div>
              {kind === "event" && (
                <div className="segmented" role="group" aria-label="Show as">
                  <button
                    type="button"
                    aria-pressed={busyTime}
                    className={busyTime ? "active" : ""}
                    onClick={() => setBusyTime(true)}
                  >
                    Busy
                  </button>
                  <button
                    type="button"
                    aria-pressed={!busyTime}
                    className={!busyTime ? "active" : ""}
                    onClick={() => setBusyTime(false)}
                  >
                    Free
                  </button>
                </div>
              )}
              {kind === "event" && (allDay || !busyTime) && (
                <small className="field-hint">
                  {allDay
                    ? "All-day events never block your time."
                    : "Free time doesn't block your planner, booking pages or teammates."}
                </small>
              )}
            </div>
            <div className="form-grid">
              <label>
                Type
                <Select
                  name="kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as Kind)}
                >
                  <option value="task">Task</option>
                  <option value="event">Event</option>
                </Select>
              </label>
              <label>
                Priority
                <Select
                  name="priority"
                  defaultValue={base.priority}
                  onChange={() => {
                    dirty.current = true;
                  }}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </Select>
              </label>
              <label>
                Status
                <Select
                  name="status"
                  defaultValue={base.status}
                  onChange={() => {
                    dirty.current = true;
                  }}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {statusLabels[s]}
                    </option>
                  ))}
                </Select>
              </label>
              {existing && (
                <label>
                  Progress
                  <input
                    readOnly
                    tabIndex={-1}
                    aria-describedby={progressId}
                    value={`${existing.progress ?? 0}%`}
                  />
                  <small id={progressId} className="field-hint">
                    Track progress from the task panel.
                  </small>
                </label>
              )}
              {allDay && kind === "task" ? (
                // A task is due by the end of its day, so "Due" is its last
                // day; moving it moves a task that runs over days as a whole.
                <label>
                  Due
                  <DateField
                    disabled={locked}
                    type="date"
                    required
                    value={endDay > startDay ? endDay : startDay}
                    onChange={(e) => {
                      const due = e.target.value;
                      const days =
                        startDay && endDay > startDay
                          ? Math.round(
                              (Date.parse(endDay) - Date.parse(startDay)) /
                                86_400_000,
                            )
                          : 0;
                      setStartDay(due ? addDays(due, -days) : "");
                      setEndDay(due);
                    }}
                  />
                </label>
              ) : allDay ? (
                <>
                  <label>
                    Starts
                    <DateField
                      disabled={locked}
                      type="date"
                      required
                      value={startDay}
                      onChange={(e) => {
                        setStartDay(e.target.value);
                        if (endDay && e.target.value > endDay)
                          setEndDay(e.target.value);
                      }}
                    />
                  </label>
                  <label>
                    Last day
                    <DateField
                      disabled={locked}
                      type="date"
                      value={endDay}
                      min={startDay || undefined}
                      onChange={(e) => setEndDay(e.target.value)}
                    />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    {kind === "task" ? "Due" : "Start time"}
                    <DateField
                      disabled={locked}
                      type="datetime-local"
                      value={dueValue}
                      onChange={(e) => setDueValue(e.target.value)}
                    />
                  </label>
                  <label>
                    End time (optional)
                    <DateField
                      disabled={locked}
                      type="datetime-local"
                      value={endValue}
                      onChange={(e) => setEndValue(e.target.value)}
                    />
                    {kind === "task" && endValue && (
                      <small className="field-hint">
                        With an end time, it&apos;s due when it ends.
                      </small>
                    )}
                  </label>
                  {kind === "event" && (
                    <AttentionWarning
                      teamId={teamId}
                      start={fromDateTimeLocal(dueValue || null)}
                      end={fromDateTimeLocal(endValue || null)}
                      itemId={existing?.id}
                    />
                  )}
                </>
              )}
              {afterProject && project?.deadline && (
                <p className="field-hint" role="status">
                  Due after the project ({shortDay(project.deadline)}){" "}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setAllDay(false);
                      setDueValue(toDateTimeLocal(project.deadline));
                      setEndValue("");
                    }}
                  >
                    Use {shortDay(project.deadline)}
                  </button>
                </p>
              )}
              <label>
                Estimate
                <Select
                  value={estimateChoice}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCustomEstimate(v === "custom");
                    if (v === "custom") {
                      const value = estimate ?? 25;
                      setEstimate(value);
                      setEstimateText(String(value));
                    } else {
                      setEstimate(v ? Number(v) : null);
                      setEstimateText(v);
                    }
                  }}
                >
                  <option value="">No estimate</option>
                  {ESTIMATES.map((m) => (
                    <option key={m} value={m}>
                      {minutesLabel(m)}
                    </option>
                  ))}
                  <option value="custom">Custom…</option>
                </Select>
              </label>
              {customEstimate && (
                <label>
                  Minutes
                  <input
                    type="number"
                    min={1}
                    max={10080}
                    required
                    value={estimateText}
                    onChange={(event) => {
                      const text = event.target.value;
                      setEstimateText(text);
                      if (!text || Number.isFinite(Number(text)))
                        setEstimate(text ? Number(text) : null);
                    }}
                  />
                </label>
              )}
              <label>
                List
                <Select
                  searchable
                  value={listId ?? ""}
                  onChange={(e) => setListId(e.target.value || null)}
                >
                  <option value="">No list</option>
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
                {!lists.length && (
                  <small className="field-hint">
                    {teamId
                      ? "This team has no lists yet."
                      : "Make lists from Lists in the menu."}
                  </small>
                )}
              </label>
              {(teamId || (existing && kind === "task")) && (
                <label>
                  Assignee
                  <Select
                    searchable
                    value={
                      withAgent
                        ? agentWhen === "tonight"
                          ? "~tonight"
                          : AGENT
                        : teamId
                          ? (assigneeId ?? "")
                          : ""
                    }
                    disabled={agentBusy || membersLoading || !!memberError}
                    onChange={(e) => void pickAssignee(e.target.value)}
                  >
                    <option value="">{teamId ? "Nobody yet" : "You"}</option>
                    {members.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.name}
                      </option>
                    ))}
                    {assigneeId &&
                      teamId &&
                      !members.some((m) => m.user_id === assigneeId) && (
                        <option value={assigneeId}>
                          {(existing as Item | null)?.assignee_name ??
                            "Current assignee"}
                        </option>
                      )}
                    {existing && kind === "task" && (
                      <>
                        <option value={AGENT}>{agentName} — now</option>
                        <option value="~tonight">{agentName} — tonight</option>
                      </>
                    )}
                  </Select>
                  {membersLoading && (
                    <small className="field-hint">Loading people…</small>
                  )}
                  {!!memberError && (
                    <>
                      <small className="field-hint" role="alert">
                        {memberError}
                      </small>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setMembersRetry((n) => n + 1)}
                      >
                        Retry people
                      </button>
                    </>
                  )}
                  {existing && kind === "task" && (
                    <small className="field-hint">
                      Assistant assignment takes effect immediately.
                    </small>
                  )}
                  {agentNote && (
                    <small className="field-hint" role="status">
                      {agentNote}
                    </small>
                  )}
                </label>
              )}
            </div>
            <div className="form-grid">
              <label>
                Share with
                <Select
                  searchable
                  name="team_id"
                  value={teamId ?? ""}
                  disabled={lockTeam}
                  onChange={(e) => changeTeam(e.target.value || null)}
                >
                  <option value="">Personal</option>
                  {shareOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
                {lockTeam && !readOnly && (
                  <small className="field-hint">
                    Only owners and admins can move items out of {teamName}.
                  </small>
                )}
                {teamId !== (base.team_id ?? null) && (
                  <small className="field-hint">
                    Moving it clears its list, tags and assignee.
                  </small>
                )}
              </label>
            </div>
            <details
              className="item-editor-details"
              open={detailsOpen || !!formError || !!error}
              onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
            >
              <summary>More details</summary>
              {kind === "event" && (
                <>
                  <div className="form-grid">
                    <label>
                      Location
                      <input
                        maxLength={300}
                        value={location}
                        placeholder="Location"
                        onChange={(e) => setLocation(e.target.value)}
                      />
                    </label>
                    <label>
                      Meeting link
                      <input
                        type="url"
                        maxLength={500}
                        value={meetingUrl}
                        placeholder="https://"
                        pattern="https?://\S+"
                        title="Meeting links start with https://"
                        onChange={(e) => setMeetingUrl(e.target.value)}
                      />
                    </label>
                  </div>
                  <InviteesPicker
                    value={invitees}
                    onChange={(value) => {
                      dirty.current = true;
                      inviteesEdited.current = true;
                      setInvitees(value);
                    }}
                    onDraftChange={(pending) => {
                      drafts.current.invitees = pending;
                    }}
                    state={inviteesState}
                  />
                </>
              )}
              <TagPicker
                tags={tags}
                selected={tagIds}
                onChange={setTagIds}
                disabled={locked}
                onDraftChange={(pending) => {
                  drafts.current.tags = pending;
                }}
                onCreate={readOnly ? undefined : createTag}
              />
              {/* Only a task waits on anything; an event happens when it does. */}
              {kind === "task" && (
                <WaitsOnPicker
                  selfId={existing?.id ?? null}
                  items={items}
                  selected={waitsOn}
                  onChange={setWaitsOn}
                  readOnly={readOnly}
                />
              )}
              {kind === "task" && (
                <MeasureField
                  value={measure}
                  onChange={setMeasure}
                  readOnly={readOnly}
                />
              )}
              <ColorPicker value={color} onChange={setColor} />
              <LinksField
                value={links}
                onChange={(value) => {
                  dirty.current = true;
                  linksEdited.current = true;
                  setLinks(value);
                }}
                state={linksState}
                onDraftChange={(pending) => {
                  drafts.current.links = pending;
                }}
              />
              <RepeatPicker
                value={repeat}
                originalRule={
                  JSON.stringify(repeat) === initialRepeat ? base.rrule : null
                }
                onProblem={(problem) => {
                  repeatProblem.current = problem;
                }}
                onChange={setRepeat}
                hasDate={!!(allDay ? startDay : dueValue)}
              />
              <label>
                Notes
                <textarea
                  name="notes"
                  rows={3}
                  maxLength={10000}
                  defaultValue={base.notes}
                  placeholder="Add notes"
                />
              </label>
              {isNew && alerts === null && !(planning.prefs ?? defaultPrefs) ? (
                <div>
                  <p className="field-hint">
                    {defaultsError
                      ? "Couldn't load alerts. Your saved defaults apply."
                      : "Loading default alerts…"}
                  </p>
                  {defaultsError && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setDefaultsRetry((n) => n + 1)}
                    >
                      Retry alerts
                    </button>
                  )}
                </div>
              ) : (
                <AlertsPicker
                  value={shownAlerts}
                  onChange={setAlerts}
                  onDraftChange={(pending) => {
                    drafts.current.alerts = pending;
                  }}
                  hint={alerts === null ? "Your default alerts." : undefined}
                />
              )}
            </details>
          </fieldset>
          {(linksState === "failed" || inviteesState === "failed") && (
            <button
              type="button"
              className="text-button"
              disabled={busy || agentBusy || tagBusy || dispatchBusy}
              onClick={() => setDetailRetry((n) => n + 1)}
            >
              Retry links and invitees
            </button>
          )}
          {!!projectError && (
            <>
              <small className="field-hint" role="alert">
                {projectError}
              </small>
              <button
                type="button"
                className="text-button"
                disabled={busy || agentBusy || tagBusy || dispatchBusy}
                onClick={() => setProjectRetry((n) => n + 1)}
              >
                Retry project details
              </button>
            </>
          )}
          {!!memberError && readOnly && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => setMembersRetry((n) => n + 1)}
            >
              Retry people
            </button>
          )}
          {(formError || error) && (
            <div className="error" role="alert">
              {formError || error}
            </div>
          )}
          <div className="button-row">
            {!isNew && !readOnly && (
              <details
                className="item-editor-options"
                onKeyDown={(event) => {
                  if (event.key === "Escape" && event.currentTarget.open) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.open = false;
                    event.currentTarget.querySelector("summary")?.focus();
                  }
                }}
              >
                <summary aria-label="Item options">
                  <MoreHorizontal size={18} />
                </summary>
                <button
                  type="button"
                  className="danger"
                  disabled={locked}
                  onClick={() => void deleteChoice()}
                >
                  <Trash2 size={16} />
                  Delete item
                </button>
              </details>
            )}
            <button
              type="button"
              className="secondary"
              disabled={
                busy || agentBusy || tagBusy || dispatchBusy || confirming
              }
              onClick={() => void requestClose()}
            >
              {readOnly ? "Close" : "Cancel"}
            </button>
            {!readOnly && (
              <button className="primary" disabled={locked}>
                {busy ? "Saving…" : "Save"}
              </button>
            )}
          </div>
        </form>
      </section>
      {pendingSave && (
        <ScopeDialog
          kind={kind}
          action="save"
          onCancel={() => setPendingSave(null)}
          onChoose={(scope) => {
            const data = pendingSave;
            setPendingSave(null);
            void send(data, withScope(scope));
          }}
        />
      )}
      {askDelete && (
        <ScopeDialog
          kind={kind}
          action="delete"
          onCancel={() => setAskDelete(false)}
          onChoose={(scope) => {
            setAskDelete(false);
            void deleteItem(withScope(scope));
          }}
        />
      )}
    </div>
  );
}
