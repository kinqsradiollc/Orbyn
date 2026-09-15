import { useEffect, useState } from "react";
import { Eye, Trash2, X } from "lucide-react";
import {
  freshItem,
  fromDateTimeLocal,
  hasTeamPermission,
  statusLabels,
  statusOrder,
  toDateTimeLocal,
  type Item,
  type ItemInput,
  type Kind,
  type Priority,
  type Status,
  type Team,
  type TeamMember,
} from "@orbyn/core";
import { client } from "../lib/api";
import { usePlanning } from "../app/planning";
import {
  deviceTimeZone,
  errorText,
  ESTIMATES,
  minutesLabel,
  repeatDraft,
  rruleFromDraft,
} from "../lib/planning";
import { RepeatPicker } from "./RepeatPicker";
import { TagPicker } from "./TagPicker";

type Props = {
  editing: Item | "new";
  /** Your teams; the "Share with" picker offers those you can write to. */
  teams: Team[];
  /** Prefilled team for new items created from a team page. */
  defaultTeamId?: string | null;
  /** Prefilled fields for a new item (a meeting time, a list). */
  draft?: Partial<ItemInput> | null;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (data: ItemInput) => void;
  onDelete: () => void;
};

/**
 * Create/edit modal. Submits the full `ItemInput` (including `team_id` and
 * the planning fields); the caller adds the version. Team items you can only
 * view (viewer role) open read-only.
 */
export function ItemEditor({
  editing,
  teams,
  defaultTeamId = null,
  draft,
  busy,
  error,
  onClose,
  onSave,
  onDelete,
}: Props) {
  const planning = usePlanning();
  const existing = editing === "new" ? null : editing;
  const isNew = !existing;
  const base: Item | ItemInput = existing ?? {
    ...freshItem(),
    team_id: defaultTeamId,
    ...draft,
  };
  const [teamId, setTeamId] = useState<string | null>(base.team_id ?? null);
  const [kind, setKind] = useState<Kind>(base.kind);
  const [estimate, setEstimate] = useState<number | null>(
    base.estimate_minutes ?? null,
  );
  const [customEstimate, setCustomEstimate] = useState(
    !!base.estimate_minutes && !ESTIMATES.includes(base.estimate_minutes),
  );
  const [listId, setListId] = useState<string | null>(base.list_id ?? null);
  const [tagIds, setTagIds] = useState<string[]>(base.tag_ids ?? []);
  const [assigneeId, setAssigneeId] = useState<string | null>(
    base.assignee_id ?? null,
  );
  const [location, setLocation] = useState(base.location ?? "");
  const [meetingUrl, setMeetingUrl] = useState(base.meeting_url ?? "");
  const [repeat, setRepeat] = useState(() =>
    repeatDraft(base.rrule, base.due_at),
  );
  const [dueValue, setDueValue] = useState(toDateTimeLocal(base.due_at));
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [formError, setFormError] = useState("");

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

  // Team items can be assigned to someone in the team.
  useEffect(() => {
    setMembers([]);
    if (!teamId) return;
    let alive = true;
    client.getTeam(teamId).then(
      (t) => alive && setMembers(t.members),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [teamId]);

  // Personal items use personal lists and tags; team items use the team's.
  const inScope = (x: { team_id: string | null }) =>
    teamId ? x.team_id === teamId : x.team_id === null;
  const lists = planning.lists.filter(inScope);
  const tags = planning.tags.filter(inScope);

  const changeTeam = (next: string | null) => {
    setTeamId(next);
    // Lists, tags and the assignee belong to the old place; start fresh.
    setListId(null);
    setTagIds([]);
    setAssigneeId(null);
  };

  const createTag = async (name: string) => {
    setFormError("");
    try {
      const tag = await client.createTag({ name, team_id: teamId });
      await planning.reload();
      return tag;
    } catch (e) {
      setFormError(errorText(e));
      return null;
    }
  };

  const estimateChoice = customEstimate
    ? "custom"
    : estimate === null
      ? ""
      : String(estimate);

  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-title"
      >
        <div className="section-heading">
          <h2 id="edit-title">
            {readOnly
              ? "View plan"
              : isNew
                ? "Make a little plan"
                : "Edit your plan"}
          </h2>
          <button
            className="icon-button"
            aria-label="Close editor"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (readOnly) return;
            const d = new FormData(e.currentTarget);
            const dueAt = fromDateTimeLocal(d.get("due_at") as string | null);
            const rrule = rruleFromDraft(repeat);
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
            onSave({
              title: String(d.get("title")),
              notes: String(d.get("notes")),
              kind,
              priority: d.get("priority") as Priority,
              status: d.get("status") as Status,
              due_at: dueAt,
              end_at: fromDateTimeLocal(d.get("end_at") as string | null),
              reminder_minutes: Number(d.get("reminder_minutes")),
              team_id: teamId,
              estimate_minutes: estimate,
              list_id: listId,
              tag_ids: tagIds,
              assignee_id: teamId ? assigneeId : null,
              location: location.trim(),
              meeting_url: meetingUrl.trim(),
              rrule,
              ...(rrule ? { timezone: deviceTimeZone() } : {}),
            });
          }}
        >
          {readOnly && (
            <p className="view-only-note">
              <Eye size={14} /> View only — you&apos;re a viewer in {teamName}.
            </p>
          )}
          <fieldset className="plain-fieldset" disabled={readOnly}>
            <label>
              What’s the plan?
              <input
                autoFocus={!readOnly}
                required
                name="title"
                maxLength={200}
                defaultValue={base.title}
                placeholder="Something worth making time for"
              />
            </label>
            <div className="form-grid">
              <label>
                Type
                <select
                  name="kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as Kind)}
                >
                  <option value="task">Task</option>
                  <option value="event">Event</option>
                </select>
              </label>
              <label>
                Priority
                <select name="priority" defaultValue={base.priority}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label>
                Status
                <select name="status" defaultValue={base.status}>
                  {statusOrder.map((s) => (
                    <option key={s} value={s}>
                      {statusLabels[s]}
                    </option>
                  ))}
                </select>
              </label>
              {existing && (
                <label>
                  Progress
                  <input
                    readOnly
                    tabIndex={-1}
                    aria-describedby="progress-hint"
                    value={`${existing.progress ?? 0}%`}
                  />
                  <small id="progress-hint" className="field-hint">
                    Track progress from the task panel.
                  </small>
                </label>
              )}
              <label>
                Due / start time
                <input
                  name="due_at"
                  type="datetime-local"
                  value={dueValue}
                  onChange={(e) => setDueValue(e.target.value)}
                />
              </label>
              <label>
                End time (optional)
                <input
                  name="end_at"
                  type="datetime-local"
                  defaultValue={toDateTimeLocal(base.end_at)}
                />
              </label>
              <label>
                Estimate
                <select
                  value={estimateChoice}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCustomEstimate(v === "custom");
                    if (v === "custom") setEstimate(estimate ?? 25);
                    else setEstimate(v ? Number(v) : null);
                  }}
                >
                  <option value="">No estimate</option>
                  {ESTIMATES.map((m) => (
                    <option key={m} value={m}>
                      {minutesLabel(m)}
                    </option>
                  ))}
                  <option value="custom">Custom…</option>
                </select>
              </label>
              {customEstimate && (
                <label>
                  Minutes
                  <input
                    type="number"
                    min={1}
                    max={10080}
                    required
                    value={estimate ?? ""}
                    onChange={(e) =>
                      setEstimate(
                        e.target.value ? Number(e.target.value) : null,
                      )
                    }
                  />
                </label>
              )}
              <label>
                List
                <select
                  value={listId ?? ""}
                  onChange={(e) => setListId(e.target.value || null)}
                >
                  <option value="">No list</option>
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
                {!lists.length && (
                  <small className="field-hint">
                    {teamId
                      ? "This team has no lists yet."
                      : "Make lists from Lists in the menu."}
                  </small>
                )}
              </label>
              {teamId && (
                <label>
                  Assignee
                  <select
                    value={assigneeId ?? ""}
                    onChange={(e) => setAssigneeId(e.target.value || null)}
                  >
                    <option value="">Nobody yet</option>
                    {members.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.name}
                      </option>
                    ))}
                    {assigneeId &&
                      !members.some((m) => m.user_id === assigneeId) && (
                        <option value={assigneeId}>
                          {(existing as Item | null)?.assignee_name ??
                            "Current assignee"}
                        </option>
                      )}
                  </select>
                </label>
              )}
            </div>
            {kind === "event" && (
              <div className="form-grid">
                <label>
                  Location
                  <input
                    maxLength={300}
                    value={location}
                    placeholder="Office, a café, an address…"
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
            )}
            <TagPicker
              tags={tags}
              selected={tagIds}
              onChange={setTagIds}
              onCreate={readOnly ? undefined : createTag}
            />
            <RepeatPicker
              value={repeat}
              onChange={setRepeat}
              hasDate={!!dueValue}
            />
            <label>
              Notes
              <textarea
                name="notes"
                rows={3}
                maxLength={10000}
                defaultValue={base.notes}
                placeholder="A few details, a big idea…"
              />
            </label>
            <div className="form-grid">
              <label>
                Remind me before (minutes)
                <input
                  name="reminder_minutes"
                  type="number"
                  min={0}
                  max={10080}
                  defaultValue={base.reminder_minutes}
                />
              </label>
              <label>
                Share with
                <select
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
                </select>
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
          </fieldset>
          {(formError || error) && (
            <div className="error" role="alert">
              {formError || error}
            </div>
          )}
          <div className="button-row">
            {!isNew && !readOnly && (
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Delete this item?")) onDelete();
                }}
              >
                <Trash2 size={16} /> Delete
              </button>
            )}
            <button type="button" className="secondary" onClick={onClose}>
              {readOnly ? "Close" : "Cancel"}
            </button>
            {!readOnly && (
              <button className="primary" disabled={busy}>
                {busy ? "Saving…" : "Save item"}
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
