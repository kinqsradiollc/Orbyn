import { useCallback, useEffect, useState } from "react";
import { Orbit, X } from "lucide-react";
import {
  planDayPrompt,
  hasSystemPermission,
  hasTeamPermission,
  type Item,
  type ItemInput,
  type Status,
} from "@orbyn/core";
import { client } from "../lib/api";
import { usePlanner } from "../hooks/usePlanner";
import { useAssistant } from "../hooks/useAssistant";
import { Sidebar } from "../components/Sidebar";
import { PageHeading, Topbar } from "../components/Topbar";
import { ItemEditor } from "../components/ItemEditor";
import { HomePage } from "../features/home/HomePage";
import { StatusPage } from "../features/status/StatusPage";
import { AuthPage } from "../features/auth/AuthPage";
import { OverviewView } from "../features/overview/OverviewView";
import { TasksView } from "../features/tasks/TasksView";
import {
  CalendarView,
  type CalendarMode,
} from "../features/calendar/CalendarView";
import { AssistantView } from "../features/assistant/AssistantView";
import { NotificationsView } from "../features/notifications/NotificationsView";
import { SettingsView } from "../features/settings/SettingsView";
import { TeamsView } from "../features/teams/TeamsView";
import type { TeamActions } from "../features/teams/TeamDetail";
import { AdminView } from "../features/admin/AdminView";
import { TaskDetail } from "../features/task/TaskDetail";
import type { View } from "./views";

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
  const [view, setView] = useState<View>("Overview");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  /** Team prefilled in the editor when a new item starts from a team page. */
  const [draftTeamId, setDraftTeamId] = useState<string | null>(null);
  /** The task open in the detail panel (as last seen, in case it isn't in `items`). */
  const [openTask, setOpenTask] = useState<Item | null>(null);
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("month");
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => {
    if (token && (path === "/login" || path === "/signup"))
      navigatePath("/app", true);
    if (!token && path === "/app") navigatePath("/login", true);
  }, [token, path]);
  useEffect(() => {
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
  }, [path, token, view]);

  const isAdmin = hasSystemPermission(user?.role, "admin:access");

  // Leave the admin console if the user loses admin access (e.g. self-demotion).
  useEffect(() => {
    if (view === "Admin" && user && !isAdmin) setView("Overview");
  }, [view, user, isAdmin]);

  // Signing out closes the task panel.
  useEffect(() => {
    if (!token) setOpenTask(null);
  }, [token]);

  const newItem = (teamId: string | null = null) => {
    setDraftTeamId(teamId);
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
  // Prefer the freshest copy from the planner list.
  const shownTask = openTask
    ? (items.find((i) => i.id === openTask.id) ?? openTask)
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
        <Topbar
          view={view}
          onToggleMenu={() => setMobileNav(!mobileNav)}
          onOpenNotifications={() => navigate("Notifications")}
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
            <PageHeading view={view} user={user} onNewItem={() => newItem()} />
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
              />
            )}
            {view === "Calendar" && (
              <CalendarView
                {...listProps}
                date={calendarDate}
                onDateChange={setCalendarDate}
                mode={calendarMode}
                onModeChange={setCalendarMode}
                shortcuts={!editing && !shownTask}
              />
            )}
            {view === "AI assistant" && (
              <AssistantView items={items} busy={busy} assistant={assistant} />
            )}
            {view === "Teams" && <TeamsView teams={teams} {...teamActions} />}
            {view === "Admin" && isAdmin && <AdminView {...teamActions} />}
            {view === "Notifications" && (
              <NotificationsView notices={notices} onRead={planner.markRead} />
            )}
            {view === "Settings" && (
              <SettingsView
                user={user}
                busy={busy}
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
          busy={busy}
          error={error}
          onClose={() => setEditing(null)}
          onSave={saveItem}
          onDelete={deleteItem}
        />
      )}
    </div>
  );
}
