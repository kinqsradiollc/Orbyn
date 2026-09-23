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
import {
  dateLabel,
  overviewItems,
  inProgressEmpty,
  type Doc,
  type Item,
} from "@orbyn/core";
import { EmptyState } from "../../components/EmptyState";
import { WorkspaceStrip } from "./WorkspaceStrip";
import { UpNextCard } from "./UpNextCard";
import { ItemRow } from "../../components/ItemRow";
import { ProgressBar } from "../../components/ProgressBar";
import { StatusPill } from "../../components/StatusPill";
import type { View } from "../../app/views";
import { stagger } from "../../lib/motion";
import { progressOf } from "../../lib/tasks";

type Props = {
  /** Opens a document found on the Overview. */
  onOpenDoc: (doc: Doc) => void;
  items: Item[];
  busy: boolean;
  canWrite: (item: Item) => boolean;
  onToggle: (item: Item) => void;
  onOpen: (item: Item) => void;
  onNewItem: () => void;
  onNavigate: (view: View) => void;
  onPlanDay: () => void;
  /** Starts focus mode on a task. */
  onFocus: (item: Item) => void;
};

export function OverviewView({
  items,
  busy,
  canWrite,
  onToggle,
  onOpen,
  onNewItem,
  onNavigate,
  onPlanDay,
  onOpenDoc,
  onFocus,
}: Props) {
  const now = new Date();
  const {
    pending,
    today,
    upcoming: comingUp,
    done,
    attention,
    inProgress,
    doneThisWeek,
    inProgressCount,
    blockedCount: blocked,
  } = overviewItems(items, now);
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

  // An empty planner still has a workspace: show any projects and documents
  // under the prompt to add a first task, rather than an apparently empty app.
  if (!items.length)
    return (
      <>
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
        <WorkspaceStrip onOpenDoc={onOpenDoc} onNavigate={onNavigate} />
      </>
    );

  return (
    <>
      <section className="stats stats-4" aria-label="At a glance">
        <Stat icon={CircleDot} label="Open" value={pending.length}>
          still on your list
        </Stat>
        <Stat icon={Loader} label="In progress" value={inProgressCount}>
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
                {inProgressEmpty(inProgressCount)}
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
          <UpNextCard items={items} onOpen={onOpen} onFocus={onFocus} />
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
      <WorkspaceStrip
        onOpenDoc={onOpenDoc}
        onNavigate={(view) => onNavigate(view)}
      />
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
