import {
  deadlineOf,
  hasTeamPermission,
  hoursLabel,
  STATUSES,
  statusLabels,
  toDateTimeLocal,
  type AttentionCheck,
  type Item,
  type Kind,
  type Priority,
  type Project,
  type Status,
  type TeamMember,
} from "@orbyn/core";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { messageOf } from "../../lib/resource";
import { client, getToken } from "../../lib/session";
import { Input, Segmented, SelectBox, TextArea } from "../../ui/kit";
import {
  datesOf,
  inTeam,
  withAllDay,
  withAllDayDue,
  type Draft,
} from "./draft";
import { deviceTimeZone, ESTIMATES, minutesLabel } from "./format";
import {
  AlertsField,
  ColorField,
  InviteesField,
  LinksField,
  MeasureField,
  RepeatField,
  TagsField,
  WaitsOnField,
  type Pending,
} from "./pickers";
import { refreshPlanner, useItems, usePlanning } from "./store";

export function Prop({
  label,
  children,
  wide,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`st-prop${wide ? " st-prop-wide" : ""}`}>
      <span className="st-prop-label">{label}</span>
      <div className="st-prop-value">{children}</div>
    </div>
  );
}

const shortDay = (iso: string) =>
  new Date(iso).toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

const AGENT = "~agent";
const TONIGHT = "~tonight";

type Props = {
  draft: Draft;
  update: (change: (draft: Draft) => Draft) => void;
  /** The saved item; left out while creating one. */
  existing?: Item | null;
  /** The team it started in, which sets who may move it. */
  baseTeam?: string | null;
  timezone?: string;
  projectId?: string | null;
  readOnly?: boolean;
  linksState: "loading" | "ready" | "failed";
  inviteesState: "loading" | "ready" | "failed";
  pending: Pending;
  onUpdated?: (item: Item) => void;
  /** Status is changed from its own control once an item is saved. */
  showStatus?: boolean;
  /** Open "More details" from the start. */
  openMore?: boolean;
};

/**
 * Everything an item can hold. The common fields sit in aligned rows; rarer
 * ones are one disclosure away. Used by the task panel and by new items.
 */
export function ItemFields({
  draft: d,
  update,
  existing,
  baseTeam = null,
  timezone,
  projectId = null,
  readOnly,
  linksState,
  inviteesState,
  pending,
  onUpdated,
  showStatus,
  openMore,
}: Props) {
  const { lists, tags, teams, prefs } = usePlanning();
  const items = useItems();
  const set = (patch: Partial<Draft>) =>
    update((draft) => ({ ...draft, ...patch }));
  const zone = timezone ?? deviceTimeZone();
  const inScope = (x: { team_id: string | null }) =>
    d.teamId ? x.team_id === d.teamId : x.team_id === null;
  const shownLists = lists.filter(inScope);
  const shownTags = tags.filter(inScope);

  const account = useRef(getToken()).current;
  const owns = () => account === getToken();

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [peopleError, setPeopleError] = useState("");
  const [peopleBusy, setPeopleBusy] = useState(false);
  const [peopleTry, setPeopleTry] = useState(0);
  useEffect(() => {
    setMembers([]);
    setPeopleError("");
    setPeopleBusy(!!d.teamId);
    if (!d.teamId) return;
    let alive = true;
    client
      .getTeam(d.teamId)
      .then(
        (team) => alive && owns() && setMembers(team.members),
        (e) =>
          alive &&
          owns() &&
          setPeopleError(messageOf(e, "Couldn't load people.")),
      )
      .finally(() => alive && setPeopleBusy(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.teamId, peopleTry]);

  const [agentName, setAgentName] = useState("Orbyn");
  const [withAgent, setWithAgent] = useState(!!existing?.agent_grant_id);
  const [agentWhen, setAgentWhen] = useState(existing?.agent_when ?? "now");
  const [agentNote, setAgentNote] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const isTask = existing?.kind === "task";
  useEffect(() => {
    if (!isTask) return;
    let alive = true;
    client.agentSettings().then(
      (a) => alive && owns() && setAgentName(a.name || "Orbyn"),
      () => undefined,
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTask]);

  /** Handing to your agent happens at once; choosing a person waits for Save. */
  const pickAssignee = async (value: string) => {
    if (!existing) return set({ assigneeId: value || null });
    const handing = value === AGENT || value === TONIGHT;
    if (handing || withAgent) {
      setAgentBusy(true);
      setAgentNote("");
      try {
        if (handing) {
          const when = value === TONIGHT ? "tonight" : "now";
          onUpdated?.(await client.handTaskToAgent(existing.id, when));
          setAgentWhen(when);
          setWithAgent(true);
          setAgentNote(
            when === "tonight"
              ? `Assigned to ${agentName} for tonight. Turn on night shift in Assistant settings.`
              : `Assigned to ${agentName} in the background.`,
          );
          return;
        }
        onUpdated?.(await client.takeTaskBack(existing.id));
        setWithAgent(false);
        setAgentNote(`Taken back from ${agentName}.`);
      } catch (e) {
        setAgentNote(messageOf(e, "Couldn't change that."));
        return;
      } finally {
        setAgentBusy(false);
      }
    }
    set({ assigneeId: value || null });
  };

  const [project, setProject] = useState<Project | null>(null);
  const [projectError, setProjectError] = useState("");
  const [projectTry, setProjectTry] = useState(0);
  useEffect(() => {
    setProject(null);
    setProjectError("");
    if (!projectId) return;
    let alive = true;
    client.getProject(projectId).then(
      (value) => alive && owns() && setProject(value),
      (e) =>
        alive &&
        owns() &&
        setProjectError(messageOf(e, "Couldn't load the project.")),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, projectTry]);

  const dates = useMemo(() => datesOf(d, zone), [d, zone]);
  const deadline =
    d.kind === "task"
      ? deadlineOf({ ...dates, all_day: d.allDay, timezone: zone })
      : null;
  const afterProject =
    !!project?.deadline &&
    !!deadline &&
    Date.parse(deadline) > Date.parse(project.deadline);

  const createTag = async (name: string) => {
    try {
      const tag = await client.createTag({ name, team_id: d.teamId });
      await refreshPlanner().catch(() => undefined);
      return tag;
    } catch (e) {
      setTagError(messageOf(e, "Couldn't create the tag."));
      return null;
    }
  };
  const [tagError, setTagError] = useState("");

  const currentTeam = teams.find((t) => t.id === baseTeam);
  const lockTeam =
    !!readOnly ||
    (!!existing &&
      !!baseTeam &&
      !hasTeamPermission(currentTeam?.role, "members:manage"));
  const writable = teams.filter((t) =>
    hasTeamPermission(t.role, "items:write"),
  );
  const shareOptions =
    baseTeam && !writable.some((t) => t.id === baseTeam)
      ? [
          {
            id: baseTeam,
            name: currentTeam?.name ?? existing?.team_name ?? "This team",
          },
          ...writable,
        ]
      : writable;

  const estimateChoice = d.customEstimate ? "custom" : d.estimate;
  const defaults = (
    prefs?.default_alerts as Record<string, number[] | undefined> | undefined
  )?.[d.allDay ? "all_day" : d.kind];

  const canSeeAssignee = !!d.teamId || (!!existing && d.kind === "task");

  return (
    <fieldset className="st-fields" disabled={readOnly}>
      {!existing && (
        <Prop label="Type">
          <Segmented<Kind>
            label="Type"
            value={d.kind}
            options={[
              { value: "task", label: "Task" },
              { value: "event", label: "Event" },
            ]}
            onChange={(kind) => set({ kind })}
          />
        </Prop>
      )}
      <Prop label="Timing">
        <div className="st-add">
          <Segmented
            label="Timing"
            value={d.allDay ? "day" : "time"}
            options={[
              { value: "time", label: "At a time" },
              { value: "day", label: "All day" },
            ]}
            onChange={(value) =>
              update((draft) => withAllDay(draft, value === "day"))
            }
          />
          {d.kind === "event" && (
            <Segmented
              label="Show as"
              value={d.busy ? "busy" : "free"}
              options={[
                { value: "busy", label: "Busy" },
                { value: "free", label: "Free" },
              ]}
              onChange={(value) => set({ busy: value === "busy" })}
            />
          )}
        </div>
        {d.kind === "event" && (d.allDay || !d.busy) && (
          <p className="st-hint">
            {d.allDay
              ? "All-day events never block your time."
              : "Free time doesn't block your planner, booking pages or teammates."}
          </p>
        )}
      </Prop>
      {d.allDay && d.kind === "task" ? (
        <Prop label="Due">
          <Input
            type="date"
            aria-label="Due"
            value={d.endDay > d.startDay ? d.endDay : d.startDay}
            onChange={(event) =>
              update((draft) => withAllDayDue(draft, event.target.value))
            }
          />
        </Prop>
      ) : d.allDay ? (
        <>
          <Prop label="Starts">
            <Input
              type="date"
              aria-label="Starts"
              value={d.startDay}
              onChange={(event) => {
                const startDay = event.target.value;
                set({
                  startDay,
                  endDay: d.endDay && startDay > d.endDay ? startDay : d.endDay,
                });
              }}
            />
          </Prop>
          <Prop label="Last day">
            <Input
              type="date"
              aria-label="Last day"
              min={d.startDay || undefined}
              value={d.endDay}
              onChange={(event) => set({ endDay: event.target.value })}
            />
          </Prop>
        </>
      ) : (
        <>
          <Prop label={d.kind === "task" ? "Due" : "Starts"}>
            <Input
              type="datetime-local"
              aria-label={d.kind === "task" ? "Due" : "Starts"}
              value={d.due}
              onChange={(event) => set({ due: event.target.value })}
            />
          </Prop>
          <Prop label="Ends">
            <Input
              type="datetime-local"
              aria-label="Ends"
              value={d.end}
              onChange={(event) => set({ end: event.target.value })}
            />
            {d.kind === "task" && d.end && (
              <p className="st-hint">
                With an end time, it's due when it ends.
              </p>
            )}
          </Prop>
          {d.kind === "event" && (
            <Attention
              teamId={d.teamId}
              start={dates.due_at}
              end={dates.end_at}
              itemId={existing?.id}
            />
          )}
        </>
      )}
      {afterProject && project?.deadline && (
        <p className="st-hint st-prop-note" role="status">
          Due after the project ({shortDay(project.deadline)}){" "}
          <button
            type="button"
            className="st-link"
            onClick={() =>
              set({
                allDay: false,
                due: toDateTimeLocal(project.deadline),
                end: "",
              })
            }
          >
            Use {shortDay(project.deadline)}
          </button>
        </p>
      )}
      {projectError && (
        <p className="st-error st-prop-note" role="alert">
          {projectError}{" "}
          <button
            type="button"
            className="st-link"
            onClick={() => setProjectTry((n) => n + 1)}
          >
            Retry
          </button>
        </p>
      )}
      <Prop label="Priority">
        <Segmented<Priority>
          label="Priority"
          value={d.priority}
          options={[
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
          ]}
          onChange={(priority) => set({ priority })}
        />
      </Prop>
      {showStatus && (
        <Prop label="Status">
          <SelectBox
            aria-label="Status"
            value={d.status}
            onChange={(event) => set({ status: event.target.value as Status })}
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {statusLabels[status]}
              </option>
            ))}
          </SelectBox>
        </Prop>
      )}
      <Prop label="Estimate">
        <div className="st-add">
          <SelectBox
            aria-label="Estimate"
            value={estimateChoice}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "custom")
                set({ customEstimate: true, estimate: d.estimate || "25" });
              else set({ customEstimate: false, estimate: value });
            }}
          >
            <option value="">No estimate</option>
            {ESTIMATES.map((m) => (
              <option key={m} value={m}>
                {minutesLabel(m)}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </SelectBox>
          {d.customEstimate && (
            <Input
              type="number"
              min={1}
              max={10080}
              aria-label="Minutes"
              value={d.estimate}
              onChange={(event) => set({ estimate: event.target.value })}
            />
          )}
        </div>
      </Prop>
      <Prop label="List">
        <SelectBox
          aria-label="List"
          value={d.listId ?? ""}
          onChange={(event) => set({ listId: event.target.value || null })}
        >
          <option value="">No list</option>
          {shownLists.map((list) => (
            <option key={list.id} value={list.id}>
              {list.name}
            </option>
          ))}
        </SelectBox>
        {!shownLists.length && (
          <p className="st-hint">
            {d.teamId
              ? "This team has no lists yet."
              : "Make lists from Lists in the menu."}
          </p>
        )}
      </Prop>
      {canSeeAssignee && (
        <Prop label="Assignee">
          <SelectBox
            aria-label="Assignee"
            disabled={agentBusy || peopleBusy || !!peopleError}
            value={
              withAgent
                ? agentWhen === "tonight"
                  ? TONIGHT
                  : AGENT
                : d.teamId
                  ? (d.assigneeId ?? "")
                  : ""
            }
            onChange={(event) => void pickAssignee(event.target.value)}
          >
            <option value="">{d.teamId ? "Nobody yet" : "You"}</option>
            {members.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.name}
              </option>
            ))}
            {d.assigneeId &&
              d.teamId &&
              !members.some((m) => m.user_id === d.assigneeId) && (
                <option value={d.assigneeId}>
                  {existing?.assignee_name ?? "Current assignee"}
                </option>
              )}
            {existing?.kind === "task" && (
              <>
                <option value={AGENT}>{agentName}, now</option>
                <option value={TONIGHT}>{agentName}, tonight</option>
              </>
            )}
          </SelectBox>
          {peopleBusy && <p className="st-hint">Loading people…</p>}
          {peopleError && (
            <p className="st-error" role="alert">
              {peopleError}{" "}
              <button
                type="button"
                className="st-link"
                onClick={() => setPeopleTry((n) => n + 1)}
              >
                Retry
              </button>
            </p>
          )}
          {existing?.kind === "task" && (
            <p className="st-hint">
              Choosing your assistant takes effect at once.
            </p>
          )}
          {agentNote && (
            <p className="st-hint" role="status">
              {agentNote}
            </p>
          )}
        </Prop>
      )}
      {d.kind === "event" && (
        <>
          <Prop label="Location">
            <Input
              aria-label="Location"
              maxLength={300}
              value={d.location}
              onChange={(event) => set({ location: event.target.value })}
            />
          </Prop>
          <Prop label="Meeting link">
            <Input
              aria-label="Meeting link"
              type="url"
              maxLength={500}
              placeholder="https://"
              value={d.meetingUrl}
              onChange={(event) => set({ meetingUrl: event.target.value })}
            />
          </Prop>
          <Prop label="Invite" wide>
            <InviteesField
              value={d.invitees}
              state={inviteesState}
              pending={pending}
              onChange={(invitees) => set({ invitees })}
            />
          </Prop>
        </>
      )}
      <Prop label="Tags" wide>
        <TagsField
          tags={shownTags}
          selected={d.tagIds}
          pending={pending}
          disabled={readOnly}
          onChange={(tagIds) => set({ tagIds })}
          onCreate={readOnly ? undefined : createTag}
        />
        {tagError && (
          <p className="st-error" role="alert">
            {tagError}
          </p>
        )}
      </Prop>
      <Prop label="Notes" wide>
        <TextArea
          aria-label="Notes"
          dir="auto"
          maxLength={10000}
          rows={3}
          placeholder="Add notes"
          value={d.notes}
          onChange={(event) => set({ notes: event.target.value })}
        />
      </Prop>
      <details className="st-more" open={openMore}>
        <summary>More details</summary>
        <div className="st-more-body">
          {existing && (
            <Prop label="Type">
              <SelectBox
                aria-label="Type"
                value={d.kind}
                onChange={(event) => set({ kind: event.target.value as Kind })}
              >
                <option value="task">Task</option>
                <option value="event">Event</option>
              </SelectBox>
            </Prop>
          )}
          <Prop label="Share with">
            <SelectBox
              aria-label="Share with"
              disabled={lockTeam}
              value={d.teamId ?? ""}
              onChange={(event) =>
                update((draft) => inTeam(draft, event.target.value || null))
              }
            >
              <option value="">Personal</option>
              {shareOptions.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </SelectBox>
            {lockTeam && !readOnly && (
              <p className="st-hint">
                Only owners and admins can move items out of this team.
              </p>
            )}
            {d.teamId !== baseTeam && (
              <p className="st-hint">
                Moving it clears its list, tags and assignee.
              </p>
            )}
          </Prop>
          <Prop label="Repeat" wide>
            <RepeatField
              value={d.repeat}
              disabled={readOnly}
              originalRule={null}
              hasDate={!!(d.allDay ? d.startDay : d.due)}
              onChange={(repeat) => set({ repeat })}
            />
          </Prop>
          <Prop label="Alerts" wide>
            <AlertsField
              value={d.alerts ?? defaults ?? (prefs ? [30] : [])}
              hint={
                d.alerts !== null
                  ? undefined
                  : prefs
                    ? "Your default alerts"
                    : "Your saved default alerts apply"
              }
              disabled={readOnly}
              pending={pending}
              onChange={(alerts) => set({ alerts })}
            />
          </Prop>
          {d.kind === "task" && (
            <>
              <Prop label="Waiting on" wide>
                <WaitsOnField
                  selfId={existing?.id ?? null}
                  items={items}
                  selected={d.waitsOn}
                  disabled={readOnly}
                  onChange={(waitsOn) => set({ waitsOn })}
                />
              </Prop>
              <Prop label="Number to reach" wide>
                <MeasureField
                  value={d.measure}
                  disabled={readOnly}
                  onChange={(measure) => set({ measure })}
                />
              </Prop>
            </>
          )}
          <Prop label="Links" wide>
            <LinksField
              value={d.links}
              state={linksState}
              disabled={readOnly}
              pending={pending}
              onChange={(links) => set({ links })}
            />
          </Prop>
          <Prop label="Colour">
            <ColorField
              value={d.color}
              disabled={readOnly}
              onChange={(color) => set({ color })}
            />
          </Prop>
        </div>
      </details>
    </fieldset>
  );
}

/** Whose week a team meeting would take past the team's meeting budget. */
function Attention({
  teamId,
  start,
  end,
  itemId,
}: {
  teamId: string | null;
  start: string | null;
  end: string | null;
  itemId?: string;
}) {
  const [check, setCheck] = useState<AttentionCheck | null>(null);
  useEffect(() => {
    setCheck(null);
    if (!teamId || !start || !end || Date.parse(end) <= Date.parse(start))
      return;
    let alive = true;
    const timer = setTimeout(() => {
      client
        .checkAttention(teamId, {
          start_at: start,
          end_at: end,
          ...(itemId ? { item_id: itemId } : {}),
        })
        .then(
          (next) => alive && setCheck(next),
          () => undefined,
        );
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [teamId, start, end, itemId]);
  if (!check?.budget_minutes || !check.over.length) return null;
  const names = check.over.map((o) => o.name.split(" ")[0]);
  const who =
    names.length <= 2
      ? names.join(" and ")
      : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
  return (
    <p className="st-warn st-prop-note" role="status">
      This puts {who} over the team's {hoursLabel(check.budget_minutes)} meeting
      budget this week.
    </p>
  );
}
