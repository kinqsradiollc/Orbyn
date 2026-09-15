import { useCallback, useEffect, useState } from "react";
import { Orbit, X } from "lucide-react";
import {
  hasSystemPermission,
  hasTeamPermission,
  planDayPrompt,
  type Item,
  type ItemInput,
  type Notice,
  type Plan,
  type Status,
} from "@orbyn/core";
import { client } from "../lib/api";
import { usePlanner } from "../hooks/usePlanner";
import { useAssistant } from "../hooks/useAssistant";
import { useNewVersion } from "../hooks/useNewVersion";
import { usePlanningData } from "../hooks/usePlanningData";
import { PlanningContext } from "./planning";
import { Sidebar } from "../components/Sidebar";
import { MaintenanceBanner, UpdateBanner } from "../components/SystemBanners";
import { PageHeading, Topbar } from "../components/Topbar";
import { ItemEditor } from "../components/ItemEditor";
import { CommandBar } from "../components/CommandBar";
import { appliedText } from "../components/PlanCard";
import { HomePage } from "../features/home/HomePage";
import { StatusPage } from "../features/status/StatusPage";
import { AuthPage } from "../features/auth/AuthPage";
import { OverviewView } from "../features/overview/OverviewView";
import { TasksView } from "../features/tasks/TasksView";
import { ListsView } from "../features/lists/ListsView";
import {
  CalendarView,
  type CalendarMode,
  type PlanRequest,
} from "../features/calendar/CalendarView";
import { AssistantView } from "../features/assistant/AssistantView";
import { NotificationsView } from "../features/notifications/NotificationsView";
import { SettingsView } from "../features/settings/SettingsView";
import { TeamsView } from "../features/teams/TeamsView";
import type { TeamActions } from "../features/teams/TeamDetail";
import { AdminView } from "../features/admin/AdminView";
import { TaskDetail } from "../features/task/TaskDetail";
import { FocusMode } from "../features/focus/FocusMode";
import {
  BookingView,
  type BookingFocus,
} from "../features/booking/BookingView";
import { PublicBooking } from "../features/booking/PublicBooking";
import type { View } from "./views";
import "../styles/planning.css";

export function App() {
  const nativeDesktop = location.protocol === "file:";
  const [path, setPath] = useState(location.pathname);
  const navigatePath = (next: string, replace = false) => {
    if (!nativeDesktop)
      window.history[replace ? "replaceState" : "pushState"]({}, "", next);
    setPath(next);
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    const pop = () => setPath(location.pathname);
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const planner = usePlanner();
  const assistant = useAssistant(planner);
  const newVersion = useNewVersion();
  const {
    token,
    user,
    items,
    notices,
    teams,
    revision,
    busy,
    error,
    loading,
    act,
    refresh,
    report,
  } = planner;
  const planning = usePlanningData(token, revision, report);
  const [view, setView] = useState<View>("Overview");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  /** Team prefilled in the editor when a new item starts from a team page. */
  const [draftTeamId, setDraftTeamId] = useState<string | null>(null);
  /** Other prefilled fields for a new item (a meeting time, a list). */
  const [draft, setDraft] = useState<Partial<ItemInput> | null>(null);
  /** The task open in the detail panel (as last seen, in case it isn't in `items`). */
  const [openTask, setOpenTask] = useState<Item | null>(null);
  /** The task in focus mode. */
  const [focusTask, setFocusTask] = useState<Item | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("month");
  const [planRequest, setPlanRequest] = useState<PlanRequest | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  /** The booking to open in the bookings inbox (from a notification). */
  const [bookingFocus, setBookingFocus] = useState<BookingFocus | null>(null);
  const isPublicBooking = !nativeDesktop && path.startsWith("/book/");

  useEffect(() => {
    if (token && (path === "/login" || path === "/signup"))
      navigatePath("/app", true);
    if (!token && path === "/app") navigatePath("/login", true);
  }, [token, path]);
  useEffect(() => {
    // Public booking pages set their own titles.
    if (isPublicBooking) return;
    document.title =
      path === "/status"
        ? "Service status · Orbyn"
        : path === "/"
          ? "Orbyn — Your life, in a better orbit"
          : token
            ? view + " · Orbyn"
            : path === "/login"
              ? "Sign in · Orbyn"
              : "Create your space · Orbyn";
  }, [path, token, view, isPublicBooking]);

  const isAdmin = hasSystemPermission(user?.role, "admin:access");

  // Leave the admin console if the user loses admin access (e.g. self-demotion).
  useEffect(() => {
    if (view === "Admin" && user && !isAdmin) setView("Overview");
  }, [view, user, isAdmin]);

  // Signing out closes the task panel, focus mode and the command bar.
  useEffect(() => {
    if (token) return;
    setOpenTask(null);
    setFocusTask(null);
    setCommandOpen(false);
  }, [token]);

  // ⌘K / Ctrl+K opens the command bar anywhere in the app.
  useEffect(() => {
    if (!token || isPublicBooking) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [token, isPublicBooking]);

  const newItem = (
    teamId: string | null = null,
    prefill: Partial<ItemInput> | null = null,
  ) => {
    setDraftTeamId(teamId ?? prefill?.team_id ?? null);
    setDraft(prefill);
    setEditing("new");
  };

  /** Personal items are always yours; team items need `items:write`. */
  const canWrite = (i: Item) => {
    if (!i.team_id) return true;
    const team = teams.find((t) => t.id === i.team_id);
    return hasTeamPermission(team?.role, "items:write");
  };

  /** Viewers can't change team items; say so instead of letting the server reject it. */
  const guard = (i: Item) => {
    if (canWrite(i)) return true;
    const team = teams.find((t) => t.id === i.team_id);
    planner.setError(
      `View only — you're a viewer in ${team?.name ?? i.team_name ?? "this team"}.`,
    );
    return false;
  };

  const toggle = (i: Item) => {
    if (guard(i)) void planner.toggleItem(i);
  };

  const setStatus = (i: Item, status: Status) => {
    if (status !== i.status && guard(i)) void planner.setItemStatus(i, status);
  };

  const openItem = (i: Item) => setOpenTask(i);
  const closeTask = useCallback(() => setOpenTask(null), []);
  const closeFocus = useCallback(() => setFocusTask(null), []);
  const startFocus = (i: Item) => {
    setOpenTask(null);
    setFocusTask(i);
  };
  // Prefer the freshest copy from the planner list.
  const shownTask = openTask
    ? (items.find((i) => i.id === openTask.id) ?? openTask)
    : null;
  const shownFocus = focusTask
    ? (items.find((i) => i.id === focusTask.id) ?? focusTask)
    : null;

  const teamActions: TeamActions = {
    user,
    busy,
    revision,
    act,
    refresh,
    report,
    onOpenItem: openItem,
    canWrite,
    onNewTeamItem: newItem,
    onToggle: toggle,
  };

  const navigate = (v: View) => {
    setView(v);
    setMobileNav(false);
    setQuery("");
    setPlanRequest(null);
    setBookingFocus(null);
  };

  /** The bookings inbox, with one booking open. */
  const openBooking = (id: string) => {
    navigate("Booking");
    setBookingFocus({ id, key: Date.now() });
  };

  /** Shows a plan in the calendar's planner (from the assistant). */
  const openPlan = (plan: Plan) => {
    navigate("Calendar");
    setPlanRequest({ key: Date.now(), plan });
  };
  /** "Plan my day": today in the calendar with a plan preview. */
  const planMyDay = () => {
    navigate("Calendar");
    setCalendarDate(new Date());
    setCalendarMode("day");
    setPlanRequest({ key: Date.now(), days: 1 });
  };
  const applyPlan = async (plan: Plan) => {
    const result = await client.applyPlan(plan.id);
    await refresh();
    return appliedText(result);
  };
  const reschedule = async (n: Notice) => {
    if (!n.ref) return;
    try {
      await client.rescheduleBlock(n.ref);
      await refresh();
    } catch (e) {
      report(e);
    }
  };

  const saveItem = (data: ItemInput) => {
    if (!editing) return;
    const target = editing;
    void act(async () => {
      if (target === "new") await client.createItem(data);
      else {
        await client.updateItem(target.id, {
          ...data,
          status: target.status,
          version: target.version,
        });
        // Status changes go through the timeline so they're recorded.
        if (data.status !== target.status)
          await client.postItemUpdate(target.id, { status: data.status });
      }
      setEditing(null);
      await refresh();
    });
  };

  const deleteItem = () => {
    if (!editing || editing === "new") return;
    const target = editing;
    void act(async () => {
      await client.deleteItem(target.id, target.version);
      setEditing(null);
      if (openTask?.id === target.id) setOpenTask(null);
      await refresh();
    });
  };

  // Public status page, signed in or not. The native app routes in memory.
  if (path === "/status")
    return (
      <StatusPage
        signedIn={!!token}
        onNavigate={navigatePath}
        onHome={nativeDesktop ? undefined : () => navigatePath("/")}
      />
    );

  // Public booking pages: no sign-in, no app shell.
  if (isPublicBooking)
    return <PublicBooking path={path} onHome={() => navigatePath("/")} />;

  if (!nativeDesktop && path === "/")
    return <HomePage signedIn={!!token} onNavigate={navigatePath} />;

  if (!token)
    return (
      <AuthPage
        key={path}
        initialMode={path === "/login" ? "login" : "register"}
        onNavigate={navigatePath}
        onHome={nativeDesktop ? undefined : () => navigatePath("/")}
        busy={busy}
        error={error}
        onClearError={() => planner.setError("")}
        onSubmit={(mode, values) => void planner.authenticate(mode, values)}
      />
    );

  const listProps = {
    items,
    busy,
    canWrite,
    onToggle: toggle,
    onOpen: openItem,
  };

  return (
    <PlanningContext.Provider value={planning}>
      <div className="app">
        <Sidebar
          open={mobileNav}
          view={view}
          user={user}
          hasUnread={notices.some((n) => !n.read)}
          onNavigate={navigate}
          onSignOut={() => void planner.logout()}
        />
        <div className="shell">
          <MaintenanceBanner
            maintenance={planner.maintenance}
            isAdmin={hasSystemPermission(user?.role, "system:manage")}
          />
          {newVersion.available && (
            <UpdateBanner onDismiss={newVersion.dismiss} />
          )}
          <Topbar
            view={view}
            onToggleMenu={() => setMobileNav(!mobileNav)}
            onOpenNotifications={() => navigate("Notifications")}
            onOpenCommand={() => setCommandOpen(true)}
          />
          <main className="content">
            {error && (
              <div role="alert" className="error">
                {error}
                <button
                  className="icon-button"
                  aria-label="Dismiss error"
                  onClick={() => planner.setError("")}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            <div key={view} className="view-enter">
              <PageHeading
                view={view}
                user={user}
                onNewItem={() => newItem()}
              />
              {view === "Overview" && (
                <OverviewView
                  {...listProps}
                  onNewItem={() => newItem()}
                  onNavigate={navigate}
                  onPlanDay={() => {
                    navigate("AI assistant");
                    void assistant.ask(planDayPrompt);
                  }}
                />
              )}
              {view === "My tasks" && (
                <TasksView
                  {...listProps}
                  query={query}
                  onQueryChange={setQuery}
                  onSetStatus={setStatus}
                  userId={user?.id}
                />
              )}
              {view === "Lists" && (
                <ListsView
                  {...listProps}
                  teams={teams}
                  report={report}
                  onNewItem={(prefill) => newItem(null, prefill)}
                />
              )}
              {view === "Calendar" && (
                <CalendarView
                  items={items}
                  teams={teams}
                  canWrite={canWrite}
                  onOpen={openItem}
                  onEditItem={setEditing}
                  onFocus={startFocus}
                  date={calendarDate}
                  onDateChange={setCalendarDate}
                  mode={calendarMode}
                  onModeChange={setCalendarMode}
                  shortcuts={
                    !editing && !shownTask && !shownFocus && !commandOpen
                  }
                  revision={revision}
                  report={report}
                  onChanged={refresh}
                  planRequest={planRequest}
                />
              )}
              {view === "AI assistant" && (
                <AssistantView
                  items={items}
                  busy={busy}
                  assistant={assistant}
                  onApplyPlan={applyPlan}
                  onOpenPlan={openPlan}
                />
              )}
              {view === "Teams" && <TeamsView teams={teams} {...teamActions} />}
              {view === "Booking" && (
                <BookingView
                  user={user}
                  teams={teams}
                  report={report}
                  focus={bookingFocus}
                />
              )}
              {view === "Admin" && isAdmin && (
                <AdminView
                  {...teamActions}
                  onMaintenanceChange={planner.applyMaintenance}
                />
              )}
              {view === "Notifications" && (
                <NotificationsView
                  notices={notices}
                  onRead={planner.markRead}
                  onReschedule={reschedule}
                  onOpenCalendar={() => navigate("Calendar")}
                  onOpenBooking={openBooking}
                />
              )}
              {view === "Settings" && (
                <SettingsView
                  user={user}
                  teams={teams}
                  busy={busy}
                  report={report}
                  onEmailReminders={planner.setEmailReminders}
                  onOpenStatus={() => navigatePath("/status")}
                />
              )}
            </div>
            {loading && (
              <small className="sync-status">Syncing your space…</small>
            )}
            <footer>
              A little more clarity. A little more you. <Orbit size={14} />
            </footer>
          </main>
        </div>
        {shownTask && (
          <TaskDetail
            key={shownTask.id}
            item={shownTask}
            teamName={teams.find((t) => t.id === shownTask.team_id)?.name}
            canWrite={canWrite(shownTask)}
            suspended={!!editing}
            onClose={closeTask}
            onEdit={setEditing}
            onFocus={startFocus}
            onChanged={refresh}
            onError={report}
          />
        )}
        {shownFocus && (
          <FocusMode
            key={shownFocus.id}
            item={shownFocus}
            items={items}
            canWrite={canWrite(shownFocus)}
            onClose={closeFocus}
            onSwitch={setFocusTask}
            onChanged={refresh}
            onError={report}
          />
        )}
        {editing && (
          <ItemEditor
            key={editing === "new" ? "new" : editing.id + ":" + editing.version}
            editing={editing}
            teams={teams}
            defaultTeamId={draftTeamId}
            draft={editing === "new" ? draft : null}
            busy={busy}
            error={error}
            onClose={() => setEditing(null)}
            onSave={saveItem}
            onDelete={deleteItem}
          />
        )}
        {commandOpen && (
          <CommandBar
            items={items}
            onClose={() => setCommandOpen(false)}
            onOpenItem={openItem}
            onNewItem={() => newItem()}
            onPlanDay={planMyDay}
            onNavigate={navigate}
            onApplyPlan={applyPlan}
            onOpenPlan={openPlan}
            onApplied={refresh}
            report={report}
          />
        )}
      </div>
    </PlanningContext.Provider>
  );
}
