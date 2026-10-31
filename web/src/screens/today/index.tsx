import {
  friendlyDate,
  greetingFor,
  homePanels,
  overviewItems,
  pickQuote,
  planDayPrompt,
  todayIsCurrent,
  workspacePresets,
} from "@orbyn/core";
import { Plus, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAccount } from "../../app/account";
import type { ScreenProps } from "../../app/routes";
import { useResource } from "../../lib/resource";
import { navigate, usePath, useSearch, useTitle } from "../../lib/router";
import { client } from "../../lib/session";
import { Button, Empty, ErrorNotice, IconButton, Loading } from "../../ui/kit";
import { NotificationsPanel, useNotificationPin } from "../notifications";
import {
  progressOf,
  refreshPlanner,
  tasks,
  useItems,
  usePlanning,
} from "../shared-task";
import { Changes } from "./Changes";
import { Companions } from "./Companions";
import { Customize } from "./Customize";
import { FirstRun } from "./FirstRun";
import { Hubs } from "./Hubs";
import { Goals, Reflection, Routines } from "./Panels";
import { Plan } from "./Plan";
import { homeOf, reloadPrefs, usePrefs } from "./prefs";
import { SinceAway, WelcomeBack } from "./Review";
import { SearchDialog } from "./SearchDialog";
import { ComingUp, Ideas, TaskSection, UpNext } from "./Sections";
import { Week } from "./Week";
import { markReleaseSeen, useWhatsNewOnce, WhatsNew } from "./WhatsNew";
import "./today.css";

function Heading({ onCustomize }: { onCustomize: () => void }) {
  const { user } = useAccount();
  const { prefs } = usePrefs();
  const zone = usePlanning().prefs?.timezone;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(timer);
  }, []);
  const { on, doc_id } = homeOf(prefs).quote;
  const quote = useResource(
    async () =>
      on && doc_id ? pickQuote((await client.getDoc(doc_id)).content) : null,
    [on, doc_id],
  );
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "numeric",
      hour12: false,
    }).format(now),
  );
  const first = user?.name?.split(" ")[0];
  return (
    <header className="today-top">
      <div>
        <p className="today-when">
          <strong>
            {now.toLocaleTimeString([], {
              timeZone: zone,
              hour: "numeric",
              minute: "2-digit",
            })}
          </strong>
          <span>{friendlyDate(now, zone)}</span>
        </p>
        <h1 dir="auto">
          {greetingFor(hour % 24)}
          {first ? `, ${first}` : ""}.
        </h1>
        {quote.data && (
          <p className="today-quote" dir="auto">
            “{quote.data}”
          </p>
        )}
      </div>
      <div className="today-top-actions">
        <IconButton label="Customize Today" onClick={onCustomize}>
          <SlidersHorizontal />
        </IconButton>
        <Button variant="primary" onClick={() => tasks.create()}>
          <Plus aria-hidden="true" /> New item
        </Button>
      </div>
    </header>
  );
}

function Shortcuts() {
  const { prefs } = usePrefs();
  const presets = workspacePresets(prefs.views.workspace);
  const engineer = presets.includes("engineer");
  const student = presets.includes("student");
  if (!engineer && !student) return null;
  return (
    <nav className="today-links is-bar" aria-label="Your workspaces">
      <span>Your workspaces</span>
      <button onClick={() => navigate("/app/projects")}>
        {engineer && student
          ? "Projects & courses"
          : engineer
            ? "Project work"
            : "Course projects"}
      </button>
      {engineer && (
        <button onClick={() => navigate("/app/docs")}>
          Specifications &amp; decisions
        </button>
      )}
      {student && (
        <button onClick={() => navigate("/app/study")}>Review material</button>
      )}
    </nav>
  );
}

const Stat = ({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: string;
}) => (
  <div className={tone ? `is-${tone}` : undefined}>
    <dd>{value}</dd>
    <dt>{label}</dt>
  </div>
);

function HomeSections({ teamsAny }: { teamsAny: boolean }) {
  const userId = useAccount().user?.id;
  const prefs = usePrefs();
  const layout = homeOf(prefs.prefs);
  const data = useResource(async () => {
    const [projects, docs, study, views, summary] = await Promise.all([
      client.listProjects(),
      client.listDocs(),
      client.study().catch(() => null),
      client.listViews(),
      client.getHome(),
    ]);
    return { sources: { projects, docs, study, views }, summary };
  }, [userId]);
  const panels = homePanels(layout);
  const rows = useMemo(() => {
    const out: (typeof panels)[] = [];
    for (const panel of panels) {
      const last = out[out.length - 1];
      if (panel !== "hubs" && last && last[0] !== "hubs") last.push(panel);
      else out.push([panel]);
    }
    return out;
  }, [panels]);
  const loaded = data.data;
  return (
    <>
      {prefs.phase === "error" && (
        <ErrorNotice message={prefs.error} onRetry={() => void reloadPrefs()} />
      )}
      {data.error && !loaded && (
        <ErrorNotice message={data.error} onRetry={() => void data.reload()} />
      )}
      {(prefs.phase === "loading" || (data.loading && !loaded)) && (
        <Loading label="Loading hubs and panels" />
      )}
      {prefs.phase === "ready" &&
        loaded &&
        rows.map((row) =>
          row[0] === "hubs" ? (
            <Hubs key="hubs" layout={layout} sources={loaded.sources} />
          ) : (
            <div key={row.join("-")} className="today-panels">
              {row.map((panel) =>
                panel === "goals" ? (
                  <Goals key={panel} data={loaded.summary} />
                ) : panel === "routines" ? (
                  <Routines key={panel} data={loaded.summary} />
                ) : (
                  <Reflection
                    key={panel}
                    data={loaded.summary}
                    onAdded={(reflection, id) =>
                      data.set((d) =>
                        d
                          ? {
                              ...d,
                              summary: {
                                ...d.summary,
                                reflection,
                                agenda_doc_id: id,
                              },
                            }
                          : d,
                      )
                    }
                  />
                ),
              )}
            </div>
          ),
        )}
      <Companions />
      {teamsAny && <Changes />}
    </>
  );
}

export default function TodayScreen(_: ScreenProps) {
  useTitle("Today");
  const path = usePath();
  const search = useSearch();
  const { user, refresh } = useAccount();
  const items = useItems();
  const planning = usePlanning();
  const pin = useNotificationPin();
  const stamp = items.reduce((sum, item) => sum + item.version, items.length);
  const today = useResource(() => client.today(), [stamp, user?.id]);
  const [customizing, setCustomizing] = useState(false);
  const firstRun = user?.first_run_done === false;
  const [newsOpen, setNewsOpen] = useWhatsNewOnce(!!user && !firstRun);
  const now = new Date();
  const current =
    today.data && todayIsCurrent(today.data, now) ? today.data : null;
  const sets = useMemo(() => overviewItems(items, now), [items]); // eslint-disable-line react-hooks/exhaustive-deps
  const known = !!today.data || !!today.error;
  const dailyIds = useMemo(
    () =>
      new Set(
        current
          ? current.rows.map((r) => r.item_id)
          : known
            ? sets.today.map((i) => i.id)
            : [],
      ),
    [current, known, sets],
  );
  const decisions = sets.attention.filter((i) => !dailyIds.has(i.id));
  const decisionIds = new Set(decisions.map((i) => i.id));
  const continuing = sets.inProgress.filter(
    (i) => !dailyIds.has(i.id) && !decisionIds.has(i.id),
  );
  const continuingIds = new Set(continuing.map((i) => i.id));
  const upcoming = sets.upcoming.filter(
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
  const openTasks = sets.pending.filter((i) => i.kind === "task");
  const average = openTasks.length
    ? openTasks.reduce((sum, i) => sum + progressOf(i), 0) / openTasks.length
    : 0;
  const complete = items.length ? (sets.done.length / items.length) * 100 : 0;
  const reload = () => {
    void today.reload();
    void refreshPlanner(true).catch(() => undefined);
  };
  const allTasks = (
    <Button variant="ghost" onClick={() => navigate("/app/tasks")}>
      All tasks
    </Button>
  );
  const plan = (
    <Plan
      today={today.data}
      loading={today.loading}
      error={today.error}
      items={items}
      onRetry={() => void today.reload()}
      onChanged={reload}
    />
  );
  const none = !items.length;
  const searching = path === "/app/search";
  return (
    <div className="today">
      <Heading onCustomize={() => setCustomizing(true)} />
      {!none && (
        <dl className="today-stats" aria-label="At a glance">
          <Stat label="Open" value={sets.pending.length} />
          <Stat label="In progress" value={sets.inProgressCount} />
          <Stat
            label="Blocked"
            value={sets.blockedCount}
            tone={sets.blockedCount ? "warn" : undefined}
          />
          <Stat label="Done this week" value={sets.doneThisWeek} />
        </dl>
      )}
      <Shortcuts />
      <WelcomeBack />
      {planning.phase === "error" && none && (
        <ErrorNotice
          message={planning.error}
          onRetry={() => void planning.retry().catch(() => undefined)}
        />
      )}
      {planning.phase === "loading" && none && (
        <Loading label="Loading your tasks" />
      )}
      {planning.phase === "ready" && none ? (
        <>
          <SinceAway />
          {plan}
          <Empty title="No tasks yet">
            <span>Add a task or event.</span>
            <Button variant="primary" onClick={() => tasks.create()}>
              <Plus aria-hidden="true" /> Add task
            </Button>
          </Empty>
          <Ideas />
        </>
      ) : (
        !none && (
          <div className="today-grid">
            <div className="today-main">
              <UpNext items={items} excludeIds={shownIds} />
              <TaskSection
                id="today-decide"
                title="Needs a decision"
                hint="Blocked or overdue, outside your plan"
                items={decisions}
                tone="warn"
                action={allTasks}
              />
              {plan}
              <TaskSection
                id="today-continue"
                title="Continue work"
                items={continuing}
                action={allTasks}
              />
            </div>
            <aside className="today-aside" aria-label="Looking ahead">
              {pin.pinned && <NotificationsPanel />}
              <SinceAway />
              <Ideas />
              <ComingUp items={upcoming} />
              <Week stamp={stamp} />
              <section
                className="today-section"
                aria-labelledby="today-progress"
              >
                <header className="today-section-head">
                  <h2 id="today-progress">Progress</h2>
                  <span className="today-head-note">
                    {Math.round(complete)}% of items completed
                  </span>
                </header>
                <span
                  className="today-meter"
                  role="img"
                  aria-label={`${Math.round(complete)}% of items completed`}
                >
                  <i style={{ width: `${complete}%` }} />
                </span>
                <p className="muted small">
                  {openTasks.length
                    ? `Open tasks average ${Math.round(average)}% reported progress.`
                    : "No open tasks."}
                </p>
              </section>
              <section className="today-section" aria-labelledby="today-assist">
                <header className="today-section-head">
                  <h2 id="today-assist">Plan today</h2>
                  <Button
                    onClick={() =>
                      navigate(
                        `/app/assistant?ask=${encodeURIComponent(planDayPrompt)}`,
                      )
                    }
                  >
                    Make a plan
                  </Button>
                </header>
              </section>
            </aside>
          </div>
        )
      )}
      <HomeSections teamsAny={planning.teams.length > 0} />
      <footer className="today-foot">
        <button onClick={() => setNewsOpen(true)}>What's new</button>
      </footer>
      {customizing && <Customize onClose={() => setCustomizing(false)} />}
      {newsOpen && <WhatsNew onClose={() => setNewsOpen(false)} />}
      {searching && (
        <SearchDialog
          key={search}
          query={new URLSearchParams(search).get("q") ?? ""}
        />
      )}
      {firstRun && user && (
        <FirstRun
          user={user}
          onDone={(made) => {
            markReleaseSeen();
            void reloadPrefs();
            void refresh();
            reload();
            if (made?.brief_id) navigate(`/app/doc/${made.brief_id}`);
          }}
        />
      )}
    </div>
  );
}
