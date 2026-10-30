import "./overview.css";
import { useElementWidth } from "../../hooks/useElementWidth";
import { useId, type ReactNode } from "react";
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
  workspacePresets,
  overviewItems,
  todayIsCurrent,
  type Doc,
  type Item,
} from "@orbyn/core";
import { EmptyState } from "../../components/EmptyState";
import { UpNextCard } from "./UpNextCard";
import { TodayCard } from "./TodayCard";
import { MorningReview } from "./MorningReview";
import { AssistantIdeasCard } from "./AssistantIdeasCard";
import { usePlanned } from "../../app/planned";
import { usePrefs } from "../../app/prefs";
import { ItemRow } from "../tasks/ItemRow";
import { ProgressBar } from "../../components/ProgressBar";
import { StatusPill } from "../../components/StatusPill";
import type { View } from "../../app/views";
import { progressOf } from "../tasks/tasks";

type Props = {
  /** Opens a document found on the Overview. */
  onOpenDoc: (doc: Doc) => void;
  onOpenPage?: (id: string) => void;
  onOpenProject: (id: string) => void;
  onOpenAgentOutput?: (id: string) => void;
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
  /** Opens a task or event by id (from the Today card). */
  onOpenById: (id: string) => void;
  /** Plans time for a task, looking ahead as far as its deadline. */
  onPlanIt: (itemId: string) => void;
  /** A plan for an unfinished session's work. */
  onPlanAgain: (blockId: string) => void;
  /** "Plan my day": today in the calendar with a plan preview. */
  onPlanMyDay: () => void;
  /** Every late task, in My tasks. */
  onShowLate: () => void;
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
  onOpenPage,
  onOpenProject,
  onFocus,
  onOpenById,
  onPlanIt,
  onPlanAgain,
  onPlanMyDay,
  onShowLate,
  onOpenAgentOutput,
}: Props) {
  const { ref: gridRef, width: gridWidth } = useElementWidth();
  const now = new Date();
  const planned = usePlanned();
  const presets = workspacePresets(usePrefs().viewChoice("workspace"));
  const engineer = presets.includes("engineer");
  const student = presets.includes("student");
  const workspaceShortcuts = (engineer || student) && (
    <section className="overview-shortcuts" aria-label="Your workspaces">
      <h2>Your workspaces</h2>
      <div>
        <button className="text-button" onClick={() => onNavigate("Projects")}>
          {engineer && student
            ? "Projects & courses"
            : engineer
              ? "Project work"
              : "Course projects"}{" "}
          <ArrowRight size={14} />
        </button>
        {engineer && (
          <button className="text-button" onClick={() => onNavigate("Docs")}>
            Specifications & decisions <ArrowRight size={14} />
          </button>
        )}
        {student && (
          <button className="text-button" onClick={() => onNavigate("Study")}>
            Review material <ArrowRight size={14} />
          </button>
        )}
      </div>
    </section>
  );
  const hasDaily = !!planned.today && todayIsCurrent(planned.today, now);
  /** Focus on a task by id: the listed copy, else the task opens instead. */
  const focusById = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (item) onFocus(item);
    else onOpenById(id);
  };
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
  // A task has one primary place in the daily workspace. Session history is
  // retained inside Today; the other projections only add work not shown there.
  const dailyIds = new Set(
    hasDaily
      ? planned.today!.rows.map((r) => r.item_id)
      : planned.ready
        ? today.map((i) => i.id)
        : [],
  );
  const decisions = attention.filter((i) => !dailyIds.has(i.id));
  const decisionIds = new Set(decisions.map((i) => i.id));
  const continuing = inProgress.filter(
    (i) => !dailyIds.has(i.id) && !decisionIds.has(i.id),
  );
  const continuingIds = new Set(continuing.map((i) => i.id));
  const upcoming = comingUp.filter(
    (i) =>
      !dailyIds.has(i.id) && !decisionIds.has(i.id) && !continuingIds.has(i.id),
  );
  const shownIds = new Set(
    [
      ...dailyIds,
      ...decisionIds,
      ...continuingIds,
      ...upcoming.slice(0, 5).map((i) => i.id),
    ].filter((id): id is string => !!id),
  );
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

  const morningReview = (
    <MorningReview
      onOpenPage={onOpenPage}
      onOpenReview={() => onNavigate("Review")}
      onOpenActivity={(lane) =>
        onNavigate(lane === "background" ? "Background" : "Overnight")
      }
      onOpenChat={onOpenAgentOutput}
    />
  );

  // Start with a single task action when the planner is empty.
  if (!items.length)
    return (
      <>
        {workspaceShortcuts}
        {morningReview}
        <section className="card">
          <EmptyState
            icon={Sun}
            title="No tasks yet"
            body="Add a task or event."
          >
            <button className="primary" onClick={onNewItem}>
              <Plus size={15} /> Add task
            </button>
          </EmptyState>
        </section>
        <AssistantIdeasCard onReview={() => onNavigate("Review")} />
      </>
    );

  return (
    <>
      <section
        className={
          "stats stats-4 overview-summary" +
          (gridWidth < 600 ? " is-compact" : "")
        }
        aria-label="At a glance"
      >
        <Stat icon={CircleDot} label="Open" value={pending.length} />
        <Stat icon={Loader} label="In progress" value={inProgressCount} />
        <Stat
          icon={OctagonAlert}
          label="Blocked"
          value={blocked}
          tone={blocked ? "blocked" : undefined}
        />
        <Stat icon={CircleCheck} label="Done this week" value={doneThisWeek} />
      </section>
      {workspaceShortcuts}
      {morningReview}
      <AssistantIdeasCard onReview={() => onNavigate("Review")} />
      <div
        ref={gridRef}
        className={
          "overview-grid overview-workspace" +
          (gridWidth < 820 ? " is-compact" : "")
        }
      >
        <div className="overview-main">
          {/* Older servers have no Today list: what's due today, as before. */}
          {!planned.ready || hasDaily ? (
            <TodayCard
              today={planned.today}
              items={items}
              onOpen={onOpenById}
              onFocus={focusById}
              onPlanIt={onPlanIt}
              onPlanAgain={onPlanAgain}
              onOpenCalendar={() => onNavigate("Calendar")}
              onPlanDay={onPlanMyDay}
              onShowLate={onShowLate}
              onCheckedIn={() => void planned.reload()}
            />
          ) : (
            <OverviewSection
              icon={Sun}
              title="Due today"
              count={today.length}
              className="ov-due-today"
            >
              {today.length ? (
                rows(today)
              ) : (
                <EmptyState
                  icon={Sun}
                  title="Nothing due today"
                  body="Add a task or event."
                >
                  <button className="text-button" onClick={onNewItem}>
                    Plan something <Plus size={14} />
                  </button>
                </EmptyState>
              )}
            </OverviewSection>
          )}
          {decisions.length > 0 && (
            <OverviewSection
              icon={AlertTriangle}
              title="Needs a decision"
              count={decisions.length}
              className="attention-card"
              hint="Blocked or overdue work outside your daily plan."
              action={
                <button
                  className="text-button"
                  onClick={() => onNavigate("My tasks")}
                >
                  All tasks <ArrowRight size={14} />
                </button>
              }
            >
              {rows(decisions)}
            </OverviewSection>
          )}
          {continuing.length > 0 && (
            <OverviewSection
              icon={Loader}
              title="Continue work"
              className="ov-in-progress"
              count={continuing.length}
              action={
                <button
                  className="text-button"
                  onClick={() => onNavigate("My tasks")}
                >
                  All tasks <ArrowRight size={14} />
                </button>
              }
            >
              {rows(continuing)}
            </OverviewSection>
          )}
        </div>
        <aside className="overview-aside" aria-label="Looking ahead">
          <UpNextCard
            items={items}
            excludeIds={shownIds}
            onOpen={onOpen}
            onFocus={onFocus}
          />
          <OverviewSection
            icon={CalendarDays}
            title="Coming up"
            className="ov-coming-up"
            count={upcoming.length}
            action={
              <button
                className="text-button"
                onClick={() => onNavigate("Calendar")}
              >
                Calendar <ArrowRight size={14} />
              </button>
            }
          >
            {upcoming.slice(0, 5).map((i) => (
              <button className="upcoming" key={i.id} onClick={() => onOpen(i)}>
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
                  {i.kind === "task" &&
                    ((progressOf(i) > 0 && progressOf(i) < 100) ||
                      !!i.steps_total) && (
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
            {!upcoming.length && (
              <p className="section-empty">No upcoming tasks or events.</p>
            )}
          </OverviewSection>
          <section className="assistant-card">
            <h2>
              <Sparkles size={16} aria-hidden="true" /> Plan today
            </h2>
            <button onClick={onPlanDay}>
              Make a plan <ArrowUpRight size={17} />
            </button>
          </section>
          <section className="card progress-card">
            <h2>Progress</h2>
            <div className="progress-line">
              <strong>{Math.round(completePct)}%</strong>
              <span>of items completed</span>
            </div>
            <div className="progress-track">
              <div style={{ transform: `scaleX(${completePct / 100})` }} />
            </div>
            <p>
              {openTasks.length
                ? `Open tasks average ${Math.round(average)}% reported progress.`
                : "No open tasks."}
            </p>
          </section>
        </aside>
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
  children?: ReactNode;
}) {
  return (
    <div className={tone ? "stat-" + tone : undefined}>
      <span>
        <Icon size={17} aria-hidden="true" /> {label}
      </span>
      <strong>
        {value}
        {children && <small>{children}</small>}
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
  const id = useId();
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
