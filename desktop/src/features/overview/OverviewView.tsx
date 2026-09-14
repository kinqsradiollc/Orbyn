import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CircleCheck,
  CircleDot,
  Loader,
  OctagonAlert,
  Plus,
  Sparkles,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { dateLabel, groupItems, sameDay, type Item } from "@orbyn/core";
import { EmptyState } from "../../components/EmptyState";
import { ItemRow } from "../../components/ItemRow";
import { ProgressBar } from "../../components/ProgressBar";
import { StatusPill } from "../../components/StatusPill";
import type { View } from "../../app/views";
import { stagger } from "../../lib/motion";
import { isOverdue, progressOf } from "../../lib/tasks";

type Props = {
  items: Item[];
  busy: boolean;
  canWrite: (item: Item) => boolean;
  onToggle: (item: Item) => void;
  onOpen: (item: Item) => void;
  onNewItem: () => void;
  onNavigate: (view: View) => void;
  onPlanDay: () => void;
};

/** Sunday 00:00 of the current week (weeks start on Sunday, like the calendar). */
const startOfWeek = (now: Date) =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());

/** When an item last changed: its edit time or its newest update. */
const touchedAt = (i: Item) =>
  Math.max(
    i.updated_at ? Date.parse(i.updated_at) : 0,
    i.last_update_at ? Date.parse(i.last_update_at) : 0,
  );

export function OverviewView({
  items,
  busy,
  canWrite,
  onToggle,
  onOpen,
  onNewItem,
  onNavigate,
  onPlanDay,
}: Props) {
  const now = new Date();
  const { pending, today, upcoming, done } = groupItems(items, now);
  const inProgress = pending.filter(
    (i) => i.status === "in_progress" && !isOverdue(i, now),
  );
  const attention = pending
    .filter((i) => i.status === "blocked" || isOverdue(i, now))
    .sort(
      (a, b) =>
        Number(b.status === "blocked") - Number(a.status === "blocked") ||
        (a.due_at ? Date.parse(a.due_at) : Infinity) -
          (b.due_at ? Date.parse(b.due_at) : Infinity),
    );
  const comingUp = upcoming.filter((i) => !sameDay(new Date(i.due_at!), now));
  const weekStart = startOfWeek(now).getTime();
  const doneThisWeek = done.filter((i) => touchedAt(i) >= weekStart).length;
  const blocked = pending.filter((i) => i.status === "blocked").length;
  const openTasks = pending.filter((i) => i.kind === "task");
  const average = openTasks.length
    ? openTasks.reduce((sum, i) => sum + progressOf(i), 0) / openTasks.length
    : 0;
  const completePct = items.length ? (done.length / items.length) * 100 : 0;

  const rows = (list: Item[]) =>
    list.map((i, n) => (
      <ItemRow
        key={i.id}
        item={i}
        index={n}
        busy={busy}
        readOnly={!canWrite(i)}
        onToggle={onToggle}
        onOpen={onOpen}
      />
    ));

  if (!items.length)
    return (
      <section className="card">
        <EmptyState
          icon={Sun}
          title="Give your ideas a home."
          body="Add a task or event to start building your plan. Progress, checklists and updates all live on each task."
        >
          <button className="primary" onClick={onNewItem}>
            <Plus size={15} /> Make your first plan
          </button>
        </EmptyState>
      </section>
    );

  return (
    <>
      <section className="stats stats-4" aria-label="At a glance">
        <Stat icon={CircleDot} label="Open" value={pending.length}>
          still on your list
        </Stat>
        <Stat icon={Loader} label="In progress" value={inProgress.length}>
          moving along
        </Stat>
        <Stat
          icon={OctagonAlert}
          label="Blocked"
          value={blocked}
          tone={blocked ? "blocked" : undefined}
        >
          waiting on something
        </Stat>
        <Stat icon={CircleCheck} label="Done this week" value={doneThisWeek}>
          finished since Sunday
        </Stat>
      </section>
      <div className="overview-grid">
        <div>
          {attention.length > 0 && (
            <OverviewSection
              icon={AlertTriangle}
              title="Needs attention"
              count={attention.length}
              className="attention-card"
              hint="Blocked or past due. Open one to post an update or unblock it."
            >
              {rows(attention)}
            </OverviewSection>
          )}
          <OverviewSection
            icon={Loader}
            title="In progress"
            count={inProgress.length}
            action={
              <button
                className="text-button"
                onClick={() => onNavigate("My tasks")}
              >
                All tasks <ArrowRight size={14} />
              </button>
            }
          >
            {inProgress.length ? (
              rows(inProgress)
            ) : (
              <p className="section-empty">
                Nothing underway. Open a task and set it to In progress when you
                start.
              </p>
            )}
          </OverviewSection>
          <OverviewSection icon={Sun} title="Due today" count={today.length}>
            {today.length ? (
              rows(today)
            ) : (
              <EmptyState
                icon={Sun}
                title="A little breathing room."
                body="Nothing due today. Add something worth making time for."
              >
                <button className="text-button" onClick={onNewItem}>
                  Plan something <Plus size={14} />
                </button>
              </EmptyState>
            )}
          </OverviewSection>
        </div>
        <div>
          <section className="assistant-card">
            <span className="sparkle-box">
              <Sparkles size={23} />
            </span>
            <span className="eyebrow">A MIND BESIDE YOURS</span>
            <h2>
              Find your next
              <br />
              clear step.
            </h2>
            <p>Let’s turn a busy mind into a plan that feels possible.</p>
            <button onClick={onPlanDay}>
              Help me plan my day <ArrowUpRight size={17} />
            </button>
            <div className="abstract-orbit">
              <i />
              <i />
              <span>✦</span>
            </div>
          </section>
          <OverviewSection
            icon={CalendarDays}
            title="Coming up"
            count={comingUp.length}
            action={
              <button
                className="text-button"
                onClick={() => onNavigate("Calendar")}
              >
                Calendar <ArrowRight size={14} />
              </button>
            }
          >
            {comingUp.slice(0, 5).map((i, n) => (
              <button
                className="upcoming fade-up stagger"
                style={stagger(n)}
                key={i.id}
                onClick={() => onOpen(i)}
              >
                <span className="date-tile" aria-hidden="true">
                  <small>
                    {new Date(i.due_at!).toLocaleDateString([], {
                      month: "short",
                    })}
                  </small>
                  {new Date(i.due_at!).getDate()}
                </span>
                <span className="upcoming-main">
                  <strong>{i.title}</strong>
                  <small>
                    {dateLabel(i.due_at)} ·{" "}
                    {i.kind === "event" ? "Event" : "Task"}
                  </small>
                  {i.kind === "task" && (
                    <ProgressBar
                      value={progressOf(i)}
                      status={i.status}
                      label={`Progress on ${i.title}`}
                    />
                  )}
                </span>
                <StatusPill status={i.status} />
              </button>
            ))}
            {!comingUp.length && (
              <p className="section-empty">
                No upcoming plans yet. Your next idea can start here.
              </p>
            )}
          </OverviewSection>
          <section className="card progress-card">
            <h2>Your momentum</h2>
            <div className="progress-line">
              <strong>{Math.round(completePct)}%</strong>
              <span>of your plans complete</span>
            </div>
            <div className="progress-track">
              <div style={{ transform: `scaleX(${completePct / 100})` }} />
            </div>
            <p>
              {openTasks.length
                ? `Open tasks are ${Math.round(average)}% done on average.`
                : "Progress happens one small step at a time."}
            </p>
          </section>
        </div>
      </div>
    </>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
  children,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone?: "blocked";
  children: ReactNode;
}) {
  return (
    <div className={tone ? "stat-" + tone : undefined}>
      <span>
        <Icon size={17} aria-hidden="true" /> {label}
      </span>
      <strong>
        {value}
        <small>{children}</small>
      </strong>
    </div>
  );
}

function OverviewSection({
  icon: Icon,
  title,
  count,
  hint,
  action,
  className = "",
  children,
}: {
  icon: LucideIcon;
  title: string;
  count: number;
  hint?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const id = "overview-" + title.toLowerCase().replace(/\W+/g, "-");
  return (
    <section
      className={"card overview-section " + className}
      aria-labelledby={id}
    >
      <div className="section-heading">
        <div>
          <h2 id={id}>
            <Icon size={17} aria-hidden="true" className="heading-icon" />
            {title} <span>{count}</span>
          </h2>
          {hint && <p className="section-hint">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
