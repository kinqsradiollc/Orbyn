import {
  activityOriginLabel,
  atRiskReason,
  dueAfterProject,
  fitTone,
  freshItem,
  fromDateTimeLocal,
  hoursLabel,
  isClosed,
  localDateKey,
  pageAboutTask,
  projectPlace,
  sessionsDeadlineWords,
  STATUSES,
  statusLabels,
  toDateTimeLocal,
  type Item,
  type ItemContext,
  type ItemDetail,
  type ItemProof,
  type ItemSessions,
  type ItemStep,
  type LinkedHereList,
  type Project,
  type Status,
  type TaskAsk,
  type TimeBlock,
  type WorkRecord,
} from "@orbyn/core";
import {
  BadgeCheck,
  CalendarClock,
  CalendarPlus,
  Check,
  Link2,
  ListChecks,
  ListTree,
  MessageCircleQuestion,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Users,
  Wand2,
} from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { navigate } from "../../lib/router";
import { messageOf, useResource } from "../../lib/resource";
import { client } from "../../lib/session";
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  IconButton,
  Input,
  Menu,
  Pill,
  SelectBox,
  TextArea,
  useConfirm,
} from "../../ui/kit";
import {
  deviceTimeZone,
  hostOf,
  minutesLabel,
  progressOf,
  timeAgo,
} from "./format";
import { tasks } from "./host-store";
import { createItem, writeBody } from "./store";

export function Section({
  icon,
  title,
  count,
  action,
  children,
}: {
  icon?: ReactNode;
  title: string;
  count?: string | number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="st-section" aria-label={title}>
      <div className="st-section-head">
        {icon}
        <h3>{title}</h3>
        {count !== undefined && count !== "" && (
          <span className="st-count">{count}</span>
        )}
        <span className="st-gap" />
        {action}
      </div>
      {children}
    </section>
  );
}

function Failed({ text, retry }: { text: string; retry?: () => void }) {
  return <ErrorNotice message={text} onRetry={retry} />;
}

/** Plain text with its web addresses as links. */
export function Linked({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    const start = match.index ?? 0;
    const url = match[0].replace(/[.,;:!?)\]]+$/, "");
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <a key={start} href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>,
    );
    last = start + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

type Run = (work: () => Promise<ItemDetail>) => Promise<boolean>;

const SNAPS = [0, 25, 50, 75, 100];

export function Progress({
  item,
  stepsTotal,
  stepsDone,
  canWrite,
  locked,
  run,
}: {
  item: Item;
  stepsTotal: number;
  stepsDone: number;
  canWrite: boolean;
  locked: boolean;
  run: Run;
}) {
  const saved = progressOf(item);
  const [draft, setDraft] = useState<number | null>(null);
  const value = draft ?? saved;
  useEffect(() => {
    if (draft === null || draft === saved) return;
    const timer = setTimeout(() => {
      void run(() => client.postItemUpdate(item.id, { progress: draft })).then(
        (ok) => ok && setDraft(null),
      );
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  const done = item.status === "done";
  return (
    <Section title="Progress" count={done ? "Complete" : `${value}%`}>
      {(stepsTotal > 0 || !canWrite) && (
        <div
          className="st-bar"
          role="progressbar"
          aria-label={`Progress on ${item.title}`}
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <i style={{ width: `${value}%` }} />
        </div>
      )}
      {stepsTotal > 0 ? (
        <p className="st-hint">
          Follows the checklist: {stepsDone} of {stepsTotal} steps done.
        </p>
      ) : (
        canWrite && (
          <>
            <input
              className="st-range"
              type="range"
              aria-label="Set progress"
              min={0}
              max={100}
              step={5}
              value={value}
              disabled={locked || done}
              aria-valuetext={`${value}%`}
              onChange={(event) => {
                const raw = Number(event.target.value);
                const near = Math.round(raw / 25) * 25;
                setDraft(Math.abs(near - raw) <= 4 ? near : raw);
              }}
            />
            <div className="st-snaps">
              {SNAPS.map((snap) => (
                <button
                  key={snap}
                  type="button"
                  aria-pressed={value === snap}
                  disabled={locked || done}
                  onClick={() => setDraft(snap)}
                >
                  {snap}%
                </button>
              ))}
            </div>
            {done && (
              <p className="st-hint">Reopen the task to change its progress.</p>
            )}
          </>
        )
      )}
    </Section>
  );
}

export function Checklist({
  item,
  steps,
  loaded,
  canWrite,
  locked,
  run,
}: {
  item: Item;
  steps: ItemStep[];
  loaded: boolean;
  canWrite: boolean;
  locked: boolean;
  run: Run;
}) {
  const [text, setText] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const ordered = [...steps].sort((a, b) => a.position - b.position);
  const done = ordered.filter((step) => step.done).length;
  const add = (event: FormEvent) => {
    event.preventDefault();
    const title = text.trim();
    if (!title) return;
    void run(() => client.addStep(item.id, { title })).then(
      (ok) => ok && setText(""),
    );
  };
  const rename = (step: ItemStep, value: string) => {
    const title = value.trim();
    if (!title || title === step.title) return setRenaming(null);
    void run(() => client.updateStep(item.id, step.id, { title })).then(
      (ok) => ok && setRenaming(null),
    );
  };
  return (
    <Section
      icon={<ListChecks aria-hidden="true" />}
      title="Checklist"
      count={ordered.length ? `${done} of ${ordered.length}` : ""}
    >
      {!loaded ? (
        <p className="st-hint">Loading checklist…</p>
      ) : ordered.length ? (
        <ul className="st-steps">
          {ordered.map((step) => (
            <li key={step.id} className={step.done ? "is-done" : undefined}>
              <button
                type="button"
                role="checkbox"
                className="st-check"
                aria-checked={step.done}
                aria-label={step.title}
                disabled={locked}
                onClick={() =>
                  void run(() =>
                    client.updateStep(item.id, step.id, { done: !step.done }),
                  )
                }
              >
                {step.done && <Check aria-hidden="true" />}
              </button>
              {renaming === step.id ? (
                <Input
                  autoFocus
                  aria-label={`Rename step ${step.title}`}
                  maxLength={200}
                  defaultValue={step.title}
                  onBlur={(event) => rename(step, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      rename(step, event.currentTarget.value);
                    }
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      setRenaming(null);
                    }
                  }}
                />
              ) : (
                <span dir="auto">{step.title}</span>
              )}
              {canWrite && renaming !== step.id && (
                <Menu
                  label={`Options for ${step.title}`}
                  trigger={(open, expanded) => (
                    <IconButton
                      label={`Options for ${step.title}`}
                      aria-expanded={expanded}
                      disabled={locked}
                      onClick={open}
                    >
                      <MoreHorizontal />
                    </IconButton>
                  )}
                >
                  {(close) => (
                    <>
                      <button
                        onClick={() => {
                          close();
                          setRenaming(step.id);
                        }}
                      >
                        <Pencil aria-hidden="true" /> Rename step
                      </button>
                      <button
                        className="is-danger"
                        onClick={() => {
                          close();
                          void run(() => client.deleteStep(item.id, step.id));
                        }}
                      >
                        <Trash2 aria-hidden="true" /> Delete step
                      </button>
                    </>
                  )}
                </Menu>
              )}
            </li>
          ))}
        </ul>
      ) : (
        !canWrite && <p className="st-hint">No checklist for this task.</p>
      )}
      {canWrite && (
        <form className="st-add" onSubmit={add}>
          <Input
            aria-label="New step"
            placeholder="Add a step"
            maxLength={200}
            value={text}
            disabled={locked}
            onChange={(event) => setText(event.target.value)}
          />
          <Button type="submit" disabled={locked || !text.trim()}>
            <Plus aria-hidden="true" /> Add
          </Button>
        </form>
      )}
    </Section>
  );
}

export function Subtasks({
  item,
  items,
  canWrite,
  locked,
  onError,
}: {
  item: Item;
  items: Item[];
  canWrite: boolean;
  locked: boolean;
  onError: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const byId = new Map(items.map((i) => [i.id, i]));
  let depth = 0;
  for (
    let up = item.parent_id ? byId.get(item.parent_id) : undefined;
    up && depth < 3;
    depth++
  )
    up = up.parent_id ? byId.get(up.parent_id) : undefined;
  const children = items
    .filter((i) => i.parent_id === item.id)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const canAdd = canWrite && depth < 2 && !isClosed(item.status);
  if (!children.length && !canAdd) return null;
  const add = async (event: FormEvent) => {
    event.preventDefault();
    const title = text.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      await createItem({
        ...freshItem(),
        title,
        kind: "task",
        parent_id: item.id,
        team_id: item.team_id ?? null,
        list_id: item.list_id ?? null,
      });
      setText("");
    } catch (error) {
      onError(messageOf(error, "Couldn't add the subtask."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      icon={<ListTree aria-hidden="true" />}
      title="Subtasks"
      count={
        children.length
          ? `${children.filter((c) => c.status === "done").length} of ${
              children.filter((c) => c.status !== "cancelled").length
            }`
          : ""
      }
    >
      {children.length > 0 && (
        <ul className="st-subtasks">
          {children.map((child) => (
            <li key={child.id}>
              <button type="button" onClick={() => tasks.open(child)}>
                <span dir="auto">{child.title}</span>
                <small>
                  {progressOf(child)}%
                  {child.estimate_minutes
                    ? ` · ${minutesLabel(child.estimate_minutes)}`
                    : ""}
                  {child.remaining_minutes != null && !isClosed(child.status)
                    ? ` · ${minutesLabel(child.remaining_minutes)} left`
                    : ""}
                </small>
              </button>
              <Pill tone={child.status === "done" ? "green" : undefined}>
                {statusLabels[child.status]}
              </Pill>
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <form className="st-add" onSubmit={(event) => void add(event)}>
          <Input
            aria-label="New subtask"
            placeholder="Add a subtask"
            maxLength={200}
            value={text}
            disabled={busy || locked}
            onChange={(event) => setText(event.target.value)}
          />
          <Button type="submit" disabled={busy || locked || !text.trim()}>
            <Plus aria-hidden="true" /> Add
          </Button>
        </form>
      )}
      {canWrite && depth >= 2 && (
        <p className="st-hint">Subtasks go three levels deep at most.</p>
      )}
    </Section>
  );
}

export function Updates({
  item,
  detail,
  canWrite,
  locked,
  run,
}: {
  item: Item;
  detail: ItemDetail | null;
  canWrite: boolean;
  locked: boolean;
  run: Run;
}) {
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<Status | "">("");
  const updates = detail?.updates ?? [];
  const post = (event: FormEvent) => {
    event.preventDefault();
    const text = body.trim();
    if (!text && !status) return;
    void run(() =>
      client.postItemUpdate(item.id, {
        ...(text ? { body: text } : {}),
        ...(status ? { status } : {}),
      }),
    ).then((ok) => {
      if (!ok) return;
      setBody("");
      setStatus("");
    });
  };
  return (
    <Section
      icon={<MessageSquare aria-hidden="true" />}
      title="Updates"
      count={updates.length || ""}
    >
      {canWrite && (
        <form className="st-stack" onSubmit={post}>
          <TextArea
            aria-label="Write an update"
            dir="auto"
            rows={2}
            maxLength={2000}
            placeholder="Write an update"
            value={body}
            disabled={locked}
            onChange={(event) => setBody(event.target.value)}
          />
          <div className="st-add">
            <SelectBox
              aria-label="Change status"
              value={status}
              disabled={locked}
              onChange={(event) => setStatus(event.target.value as Status | "")}
            >
              <option value="">
                Keep status ({statusLabels[item.status]})
              </option>
              {STATUSES.filter((s) => s !== item.status).map((s) => (
                <option key={s} value={s}>
                  Move to {statusLabels[s]}
                </option>
              ))}
            </SelectBox>
            <Button
              type="submit"
              disabled={locked || (!body.trim() && !status)}
            >
              Post update
            </Button>
          </div>
        </form>
      )}
      {updates.length > 0 ? (
        <ol className="st-timeline">
          {updates.map((update) => (
            <li key={update.id}>
              <span className="st-avatar" aria-hidden="true">
                {update.author_name.trim()[0]?.toUpperCase() ?? "?"}
              </span>
              <div>
                <p className="st-timeline-head">
                  <strong dir="auto">{update.author_name}</strong>
                  <time
                    dateTime={update.created_at}
                    title={new Date(update.created_at).toLocaleString()}
                  >
                    {timeAgo(update.created_at)}
                  </time>
                  {update.via_agent && (
                    <span>
                      {activityOriginLabel({ via_agent: update.via_agent })}
                    </span>
                  )}
                </p>
                {update.body && <p dir="auto">{update.body}</p>}
                {(update.status || update.progress !== null) && (
                  <p className="st-hint">
                    {update.status && `Status: ${statusLabels[update.status]}`}
                    {update.status && update.progress !== null && " · "}
                    {update.progress !== null &&
                      `Progress: ${update.progress}%`}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        detail && <p className="st-hint">No updates yet</p>
      )}
    </Section>
  );
}

const rowDay = (iso: string) =>
  new Date(iso).toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function nextQuarter() {
  const d = new Date();
  d.setMinutes(Math.ceil((d.getMinutes() + 1) / 15) * 15, 0, 0);
  return d;
}

function sessionsSummary(s: ItemSessions, item: Item) {
  const { by } = sessionsDeadlineWords(s);
  const parts = [
    `Planned ${minutesLabel(s.planned_minutes)}${by ? ` ${by}` : ""}`,
  ];
  if (item.estimate_minutes != null && item.remaining_minutes != null) {
    const spent = item.spent_minutes ?? 0;
    parts.push(
      `${minutesLabel(item.remaining_minutes)} still needed (${minutesLabel(
        item.estimate_minutes,
      )} estimated${spent ? `, ${minutesLabel(spent)} logged` : ""})`,
    );
  }
  return parts.join(" · ");
}

function sessionsEmpty(s: ItemSessions, item: Item) {
  const facts: string[] = [];
  const words = sessionsDeadlineWords(s);
  if (words.due) facts.push(words.due);
  if (words.sooner)
    facts.push(words.due ? words.sooner : `No deadline · ${words.sooner}`);
  else if (!words.due && s.project_deadline)
    facts.push(`No deadline · project ends ${rowDay(s.project_deadline)}`);
  const work = item.remaining_minutes ?? item.estimate_minutes;
  if (item.estimate_minutes && work && work > 0)
    facts.push(
      `${facts.length ? "about" : "About"} ${minutesLabel(work)} of work`,
    );
  return `No sessions yet.${facts.length ? ` ${facts.join(" · ")}.` : ""}`;
}

/** Time set aside for a task. Reading it never makes a plan. */
export function Sessions({
  item,
  canWrite,
  reloadKey,
  onChanged,
}: {
  item: Item;
  canWrite: boolean;
  reloadKey: string;
  onChanged: () => void;
}) {
  const sessions = useResource(
    () => client.itemSessions(item.id),
    [item.id, reloadKey],
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const data = sessions.data;
  const change = async (work: () => Promise<unknown>) => {
    if (pending) return false;
    setPending(true);
    setError("");
    try {
      await work();
      await sessions.reload();
      onChanged();
      return true;
    } catch (e) {
      setError(messageOf(e, "Couldn't change the session."));
      return false;
    } finally {
      setPending(false);
    }
  };
  const open = !isClosed(item.status);
  const canPlan =
    !!data && !pending && canWrite && open && data.assigned_to_me !== false;
  const rows = data?.sessions ?? [];
  const findLabel = data?.deadline_at
    ? "Find time before the deadline"
    : "Find time";
  const find = () =>
    navigate(`/app/calendar?plan=${encodeURIComponent(item.id)}`);
  const fit = data?.fit ?? null;
  const chip =
    fit && fit.status !== "no_deadline" ? (
      <Pill tone={fitTone(fit.status) === "warn" ? "amber" : "green"}>
        {fit.label}
      </Pill>
    ) : null;
  const risk =
    fit?.status === "at_risk" && fit.free_minutes !== null
      ? atRiskReason(fit.short_minutes, fit.free_minutes)
      : null;
  const row = (block: TimeBlock) => {
    const past = Date.parse(block.end_at) <= Date.now();
    const label = `${rowDay(block.start_at)} · ${clock(block.start_at)} – ${clock(block.end_at)}`;
    return (
      <li key={block.id} className={past ? "is-past" : undefined}>
        <span>
          {label}
          {block.part ? ` · Session ${block.part}` : ""}
          {block.after_deadline && <strong> · After the deadline</strong>}
          {data?.assigned_to_me === false && !past && (
            <strong> · Not yours any more</strong>
          )}
        </span>
        {!past && (
          <span className="st-row-actions">
            <button
              type="button"
              className="st-link"
              onClick={() =>
                navigate(
                  `/app/calendar?date=${localDateKey(new Date(block.start_at), deviceTimeZone())}`,
                )
              }
            >
              Show on calendar
            </button>
            <button
              type="button"
              className="st-link"
              disabled={pending}
              aria-label={`Remove the session on ${label}`}
              onClick={() => void change(() => client.deleteBlock(block.id))}
            >
              Remove
            </button>
          </span>
        )}
      </li>
    );
  };
  return (
    <Section
      icon={<CalendarClock aria-hidden="true" />}
      title="Sessions"
      action={
        canPlan && (
          <span className="st-row-actions">
            {rows.length > 0 && (
              <Button variant="ghost" onClick={find}>
                <Wand2 aria-hidden="true" /> {findLabel}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => {
                setError("");
                setAdding(true);
              }}
            >
              <CalendarPlus aria-hidden="true" /> Add session
            </Button>
          </span>
        )
      }
    >
      {error && !adding && <Failed text={error} />}
      {data?.project_deadline &&
        dueAfterProject(data.deadline_at, data.project_deadline) && (
          <p className="st-hint" role="status">
            Due after the project ({rowDay(data.project_deadline)}){" "}
            {canWrite && open && !item.rrule && (
              <button
                type="button"
                className="st-link"
                disabled={pending}
                onClick={() =>
                  void change(() =>
                    client.updateItem(item.id, {
                      ...writeBody(item),
                      due_at: data.project_deadline,
                      end_at: null,
                      all_day: false,
                    }),
                  )
                }
              >
                Use {rowDay(data.project_deadline)}
              </button>
            )}
          </p>
        )}
      {sessions.error && !data ? (
        <Failed text={sessions.error} retry={() => void sessions.reload()} />
      ) : !data ? (
        <p className="st-hint" role="status">
          Loading sessions…
        </p>
      ) : rows.length ? (
        <>
          <p className="st-hint st-fit">
            {sessionsSummary(data, item)} {chip}
            {!!data.late_minutes && data.fit?.status !== "late_session" && (
              <Pill tone="amber">
                {minutesLabel(data.late_minutes)} after the deadline
              </Pill>
            )}
          </p>
          {risk && <p className="st-hint">{risk}</p>}
          <ul className="st-sessions">{rows.map(row)}</ul>
        </>
      ) : (
        <>
          <p className="st-hint st-fit">
            {sessionsEmpty(data, item)} {chip}
          </p>
          {risk && <p className="st-hint">{risk}</p>}
          {canPlan && (
            <div>
              <Button onClick={find}>
                <Wand2 aria-hidden="true" /> {findLabel}
              </Button>
            </div>
          )}
        </>
      )}
      {adding && (
        <AddSession
          subject={item.title}
          minutes={Math.min(item.estimate_minutes ?? 30, 1440)}
          busy={pending}
          error={error}
          onClose={() => !pending && setAdding(false)}
          onSave={(start, end) =>
            void change(() =>
              client.createBlock({
                item_id: item.id,
                start_at: start.toISOString(),
                end_at: end.toISOString(),
              }),
            ).then((ok) => ok && setAdding(false))
          }
        />
      )}
    </Section>
  );
}

function AddSession({
  subject,
  minutes,
  busy,
  error,
  onClose,
  onSave,
}: {
  subject: string;
  minutes: number;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (start: Date, end: Date) => void;
}) {
  const [when, setWhen] = useState(() =>
    toDateTimeLocal(nextQuarter().toISOString()),
  );
  const [length, setLength] = useState(String(minutes));
  const duration = Number(length);
  const valid = !!when && duration >= 5 && duration <= 1440;
  return (
    <Dialog
      title="Add a session"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!valid}
            onClick={() => {
              const iso = fromDateTimeLocal(when);
              if (!iso) return;
              const from = new Date(iso);
              onSave(from, new Date(from.getTime() + duration * 60_000));
            }}
          >
            Add session
          </Button>
        </>
      }
    >
      <p className="muted" dir="auto">
        {subject}
      </p>
      {error && <Failed text={error} />}
      <Field label="Starts">
        <Input
          type="datetime-local"
          required
          autoFocus
          value={when}
          onChange={(event) => setWhen(event.target.value)}
        />
      </Field>
      <Field label="Length (minutes)">
        <Input
          type="number"
          min={5}
          max={1440}
          step={5}
          value={length}
          onChange={(event) => setLength(event.target.value)}
        />
      </Field>
    </Dialog>
  );
}

const askDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" })
    : "no set date";

/** An ask on a team task, answered in place. */
export function AskCard({
  itemId,
  onChanged,
}: {
  itemId: string;
  onChanged: () => void;
}) {
  const asks = useResource(() => client.listAsks(), [itemId]);
  const [mode, setMode] = useState<"idle" | "counter" | "decline">("idle");
  const [day, setDay] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (asks.error && !asks.data)
    return <Failed text={asks.error} retry={() => void asks.reload()} />;
  const lists = asks.data;
  const ask: TaskAsk | undefined = lists
    ? [...lists.to_me, ...lists.from_me, ...lists.recent].find(
        (row) => row.item_id === itemId,
      )
    : undefined;
  if (!lists || !ask) return null;
  const turn = lists.to_me.some((a) => a.id === ask.id)
    ? "mine"
    : lists.from_me.some((a) => a.id === ask.id)
      ? "theirs"
      : "settled";
  const countered = ask.status === "countered";
  const asked = turn === "mine" && !countered;
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
      setMode("idle");
      setMessage("");
      await asks.reload();
      onChanged();
    } catch (e) {
      setError(messageOf(e, "Couldn't answer this ask."));
    } finally {
      setBusy(false);
    }
  };
  const text =
    ask.status === "accepted"
      ? `${ask.asked_of_name} took this on, by ${askDate(ask.due_at)}.`
      : ask.status === "declined"
        ? `${ask.asked_of_name} couldn't take this on${ask.reply ? `: “${ask.reply}”` : "."}`
        : ask.status === "withdrawn"
          ? "This ask was withdrawn."
          : asked
            ? `${ask.asked_by_name} asked you to do this by ${askDate(ask.due_at)}.`
            : turn === "mine"
              ? `${ask.asked_of_name} suggests ${askDate(ask.counter_due_at)} instead of ${askDate(ask.due_at)}.`
              : countered
                ? `You suggested ${askDate(ask.counter_due_at)}. Waiting for ${ask.asked_by_name}.`
                : `Waiting for ${ask.asked_of_name} to answer.`;
  const quote =
    ask.status !== "declined" &&
    (countered ? ask.reply : ask.message || ask.reply);
  return (
    <div className="st-ask">
      <p>
        <MessageCircleQuestion aria-hidden="true" />
        <span dir="auto">
          {text}
          {quote && <small>“{quote}”</small>}
        </span>
      </p>
      {turn === "mine" && (
        <div className="st-row-actions">
          {asked ? (
            <>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    client.replyToAsk(ask.id, { action: "accept" }),
                  )
                }
              >
                Take it on
              </Button>
              <Button disabled={busy} onClick={() => setMode("counter")}>
                Suggest another date
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setMode("decline")}
              >
                Can't do it
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() =>
                  void act(() => client.settleAsk(ask.id, "agree"))
                }
              >
                Agree to {askDate(ask.counter_due_at)}
              </Button>
              <Button
                disabled={busy}
                onClick={() => void act(() => client.settleAsk(ask.id, "keep"))}
              >
                Keep {askDate(ask.due_at)}
              </Button>
            </>
          )}
        </div>
      )}
      {turn === "theirs" && !countered && (
        <div>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void act(() => client.settleAsk(ask.id, "withdraw"))}
          >
            Withdraw request
          </Button>
        </div>
      )}
      {error && mode === "idle" && <Failed text={error} />}
      {mode !== "idle" && (
        <Dialog
          title={mode === "counter" ? "Suggest a date" : "Decline request"}
          onClose={() => !busy && setMode("idle")}
          actions={
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setMode("idle")}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                busy={busy}
                disabled={mode === "counter" ? !day : !message.trim()}
                onClick={() =>
                  void act(() =>
                    mode === "counter"
                      ? client.replyToAsk(ask.id, {
                          action: "counter",
                          due_at: new Date(`${day}T17:00:00`).toISOString(),
                          message: message.trim(),
                        })
                      : client.replyToAsk(ask.id, {
                          action: "decline",
                          message: message.trim(),
                        }),
                  )
                }
              >
                {mode === "counter" ? "Send suggestion" : "Send"}
              </Button>
            </>
          }
        >
          {error && <Failed text={error} />}
          {mode === "counter" && (
            <Field label="Suggested date">
              <Input
                type="date"
                value={day}
                onChange={(event) => setDay(event.target.value)}
              />
            </Field>
          )}
          <Field
            label={
              mode === "counter"
                ? "Reason (optional)"
                : "Reason, shared with the requester"
            }
          >
            <Input
              maxLength={500}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          </Field>
        </Dialog>
      )}
    </div>
  );
}

/** The link or note that shows a task moved. */
export function Proof({
  itemId,
  canWrite,
}: {
  itemId: string;
  canWrite: boolean;
}) {
  const proofs = useResource(() => client.listProofs(itemId), [itemId]);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rows: ItemProof[] = proofs.data ?? [];
  if (proofs.data && !rows.length && !canWrite) return null;
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
      await proofs.reload();
      return true;
    } catch (e) {
      setError(messageOf(e, "Couldn't save the proof."));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const add = () =>
    act(() =>
      client.addProof(itemId, { url: url.trim() || null, note: note.trim() }),
    ).then((ok) => {
      if (!ok) return;
      setUrl("");
      setNote("");
      setAdding(false);
    });
  return (
    <Section
      icon={<BadgeCheck aria-hidden="true" />}
      title="Proof"
      action={
        canWrite && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setAdding(true)}
          >
            <Plus aria-hidden="true" /> Add proof
          </Button>
        )
      }
    >
      {proofs.error && !proofs.data && (
        <Failed text={proofs.error} retry={() => void proofs.reload()} />
      )}
      {error && !adding && <Failed text={error} />}
      {proofs.data && !rows.length && <p className="st-hint">No proof yet</p>}
      {rows.length > 0 && (
        <ul className="st-proofs">
          {rows.map((proof) => (
            <li key={proof.id}>
              {proof.url ? (
                <Link2 aria-hidden="true" />
              ) : (
                <BadgeCheck aria-hidden="true" />
              )}
              <span dir="auto">
                {proof.url ? (
                  <a href={proof.url} target="_blank" rel="noopener noreferrer">
                    {proof.note || hostOf(proof.url)}
                  </a>
                ) : (
                  proof.note
                )}
                <small>
                  {proof.user_name}
                  {proof.url && proof.note ? ` · ${hostOf(proof.url)}` : ""}
                </small>
              </span>
              {canWrite && (
                <IconButton
                  label="Remove this proof"
                  disabled={busy}
                  onClick={() =>
                    void act(() => client.deleteProof(itemId, proof.id))
                  }
                >
                  <Trash2 />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <Dialog
          title="Add proof"
          onClose={() => !busy && setAdding(false)}
          actions={
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setAdding(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                busy={busy}
                disabled={!url.trim() && !note.trim()}
                onClick={() => void add()}
              >
                Add proof
              </Button>
            </>
          }
        >
          {error && <Failed text={error} />}
          <Field label="Link (optional)">
            <Input
              type="url"
              autoFocus
              placeholder="https://"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </Field>
          <Field label="What this shows">
            <Input
              maxLength={1000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        </Dialog>
      )}
    </Section>
  );
}

/** A meeting's cost in people's time, and what came out of it. */
export function MeetingOutcome({
  item,
  canWrite,
}: {
  item: Item;
  canWrite: boolean;
}) {
  const records = useResource<WorkRecord[]>(
    () =>
      client.listWorkRecords({
        kind: "meeting_outcome",
        source_item_id: item.id,
        limit: 20,
      }),
    [item.id],
  );
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const minutes =
    item.due_at && item.end_at
      ? Math.min(
          1440,
          Math.round(
            (Date.parse(item.end_at) - Date.parse(item.due_at)) / 60_000,
          ),
        )
      : 0;
  const people = Math.min(100, Math.max(1, (item.attendees?.length ?? 0) + 1));
  if (!minutes || item.all_day) return null;
  const ended = Date.parse(item.end_at!) <= Date.now();
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await client.createWorkRecord({
        kind: "meeting_outcome",
        title: item.title.slice(0, 200),
        details: text.trim(),
        team_id: item.team_id ?? null,
        project_id: item.project_id ?? null,
        source_item_id: item.id,
        meeting_minutes: minutes,
        participant_count: people,
      });
      setText("");
      await records.reload();
    } catch (e) {
      setError(messageOf(e, "Couldn't save the outcome."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      icon={<Users aria-hidden="true" />}
      title="Meeting"
      count={`${hoursLabel(minutes * people)} of people's time`}
    >
      <p className="st-hint">
        {hoursLabel(minutes)} × {people} {people === 1 ? "person" : "people"}
      </p>
      {records.data?.map((record) => (
        <p key={record.id} dir="auto">
          <strong>Outcome:</strong> {record.details || record.outcome}
        </p>
      ))}
      {canWrite && ended && records.data?.length === 0 && (
        <form className="st-add" onSubmit={(event) => void save(event)}>
          <Input
            aria-label="Meeting outcome"
            maxLength={4000}
            placeholder="Decision or next step"
            value={text}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
          />
          <Button type="submit" disabled={busy || !text.trim()}>
            Save outcome
          </Button>
        </form>
      )}
      {records.error && !records.data && (
        <Failed text={records.error} retry={() => void records.reload()} />
      )}
      {error && <Failed text={error} />}
    </Section>
  );
}

/** Where a task sits: its project and stage, and the pages about it. */
export function Connections({
  item,
  version,
  canWrite,
  locked,
  onSaved,
}: {
  item: Item;
  version: number;
  canWrite: boolean;
  locked: boolean;
  onSaved: () => void;
}) {
  const data = useResource(async () => {
    const [context, catalog] = await Promise.all([
      client.itemContext(item.id),
      canWrite ? client.listProjects() : Promise.resolve([] as Project[]),
    ]);
    return { context, catalog } as { context: ItemContext; catalog: Project[] };
  }, [item.id, item.team_id, item.version, canWrite]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState<{
    project_id: string | null;
    stage_id?: string | null;
  } | null>(null);
  const context = data.data?.context;
  const projects = (data.data?.catalog ?? []).filter(
    (project) => (project.team_id ?? null) === (item.team_id ?? null),
  );
  const move = async (input: {
    project_id: string | null;
    stage_id?: string | null;
  }) => {
    setBusy(true);
    setError("");
    try {
      await client.setItemProject(item.id, { ...input, version });
      setRetry(null);
      onSaved();
    } catch (e) {
      if ((e as { status?: number }).status === 409) {
        setRetry(input);
        onSaved();
      } else setError(messageOf(e, "Couldn't move the task."));
    } finally {
      setBusy(false);
    }
  };
  const page = async (id: string, block?: string | null) =>
    navigate(`/app/doc/${id}${block ? `#${encodeURIComponent(block)}` : ""}`);
  const newPage = async () => {
    setBusy(true);
    try {
      const doc = await client.createDoc(pageAboutTask(item));
      tasks.close();
      navigate(`/app/doc/${doc.id}`);
    } catch (e) {
      setError(messageOf(e, "Couldn't create the page."));
    } finally {
      setBusy(false);
    }
  };
  const disabled = locked || busy || !data.data;
  return (
    <details className="st-more">
      <summary>Project and pages</summary>
      <div className="st-more-body">
        {data.error && !data.data && (
          <Failed
            text="Couldn't load project and pages."
            retry={() => void data.reload()}
          />
        )}
        {!data.data && !data.error && <p className="st-hint">Loading…</p>}
        {context?.project && (
          <button
            type="button"
            className="st-link"
            onClick={() => {
              tasks.close();
              navigate(`/app/project/${context.project!.id}`);
            }}
          >
            {projectPlace(context.project)}
          </button>
        )}
        {canWrite && projects.length > 0 && (
          <div className="st-add">
            <SelectBox
              aria-label="File task in project"
              disabled={disabled}
              value={item.project_id ?? ""}
              onChange={(event) =>
                void move({ project_id: event.target.value || null })
              }
            >
              <option value="">No project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </SelectBox>
            {!!context?.project && (
              <SelectBox
                aria-label="Project stage"
                disabled={disabled}
                value={item.stage_id ?? ""}
                onChange={(event) =>
                  void move({
                    project_id: context.project!.id,
                    stage_id: event.target.value || null,
                  })
                }
              >
                <option value="">No stage</option>
                {projects
                  .find((project) => project.id === context.project?.id)
                  ?.stages.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
              </SelectBox>
            )}
          </div>
        )}
        {retry && (
          <div className="st-ask" role="status">
            <p>
              <span>
                This task changed. Check where it sits, then retry your move.
              </span>
            </p>
            <div className="st-row-actions">
              <Button disabled={disabled} onClick={() => void move(retry)}>
                Retry move
              </Button>
              <Button variant="ghost" onClick={() => setRetry(null)}>
                Dismiss
              </Button>
            </div>
          </div>
        )}
        {error && <Failed text={error} />}
        {context?.came_from && (
          <p className="st-hint">
            Came from{" "}
            <button
              type="button"
              className="st-link"
              onClick={() =>
                void page(
                  context.came_from!.doc_id,
                  context.came_from!.block_id,
                )
              }
            >
              {context.came_from.title}
            </button>
            {context.came_from.quote && (
              <small> “{context.came_from.quote}”</small>
            )}
          </p>
        )}
        {!!context?.pages.length && (
          <div className="st-stack">
            <p className="st-hint">Pages about this task</p>
            {context.pages.map((doc) => (
              <button
                key={doc.id}
                type="button"
                className="st-link"
                onClick={() => void page(doc.id, doc.block_id)}
              >
                {doc.title}
              </button>
            ))}
          </div>
        )}
        {canWrite && (
          <div>
            <Button
              variant="ghost"
              disabled={disabled}
              onClick={() => void newPage()}
            >
              <Plus aria-hidden="true" /> New page about this task
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}

/** The pages and tasks that link to this one. */
export function LinkedHere({ item }: { item: Item }) {
  const kind = item.kind === "event" ? "event" : "task";
  const links = useResource<LinkedHereList>(
    () => client.linksHere(kind, item.id),
    [kind, item.id],
  );
  if (links.error && !links.data)
    return (
      <Failed
        text="Links couldn't be loaded."
        retry={() => void links.reload()}
      />
    );
  if (!links.data?.count) return null;
  return (
    <details className="st-more">
      <summary>Linked here · {links.data.count}</summary>
      <div className="st-more-body">
        {links.data.items.map((entry) => (
          <button
            key={`${entry.kind}:${entry.id}`}
            type="button"
            className="st-link"
            dir="auto"
            onClick={() => {
              if (entry.kind === "task") tasks.open(entry.id);
              else
                navigate(
                  `/app/doc/${entry.id}${entry.block_id ? `#${encodeURIComponent(entry.block_id)}` : ""}`,
                );
            }}
          >
            {entry.title}
          </button>
        ))}
      </div>
    </details>
  );
}

export function useCancelTask(onCancel: () => void, title: string) {
  const confirm = useConfirm();
  return async () => {
    if (
      await confirm({
        title: `Cancel “${title}”?`,
        body: "It closes without being done.",
        action: "Cancel task",
        danger: true,
      })
    )
      onCancel();
  };
}
