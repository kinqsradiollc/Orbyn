import { useEffect, useState } from "react";
import { Orbit, X } from "lucide-react";
import {
  planDayPrompt,
  hasSystemPermission,
  hasTeamPermission,
  type Item,
  type ItemInput,
} from "@orbyn/core";
import { client } from "../lib/api";
import { usePlanner } from "../hooks/usePlanner";
import { useAssistant } from "../hooks/useAssistant";
import { Sidebar } from "../components/Sidebar";
import { PageHeading, Topbar } from "../components/Topbar";
import { ItemEditor } from "../components/ItemEditor";
import { HomePage } from "../features/home/HomePage";
import { AuthPage } from "../features/auth/AuthPage";
import { OverviewView } from "../features/overview/OverviewView";
import { TasksView } from "../features/tasks/TasksView";
import { CalendarView } from "../features/calendar/CalendarView";
import { AssistantView } from "../features/assistant/AssistantView";
import { NotificationsView } from "../features/notifications/NotificationsView";
import { SettingsView } from "../features/settings/SettingsView";
import { TeamsView } from "../features/teams/TeamsView";
import type { TeamActions } from "../features/teams/TeamDetail";
import { AdminView } from "../features/admin/AdminView";
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
  const [month, setMonth] = useState(new Date());
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => {
    if (token && (path === "/login" || path === "/signup"))
      navigatePath("/app", true);
    if (!token && path === "/app") navigatePath("/login", true);
  }, [token, path]);
  useEffect(() => {
    document.title =
      path === "/"
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

  const newItem = (teamId: string | null = null) => {
    setDraftTeamId(teamId);
    setEditing("new");
  };

  /** Viewers can't change team items; say so instead of letting the server reject it. */
  const toggle = (i: Item) => {
    const team = i.team_id ? teams.find((t) => t.id === i.team_id) : null;
    if (team && !hasTeamPermission(team.role, "items:write")) {
      planner.setError(`View only — you're a viewer in ${team.name}.`);
      return;
    }
    void planner.toggleItem(i);
  };

  const teamActions: TeamActions = {
    user,
    busy,
    revision,
    act,
    refresh,
    report,
    onEditItem: setEditing,
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
      else
        await client.updateItem(target.id, {
          ...data,
          version: target.version,
        });
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
      await refresh();
    });
  };

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
                items={items}
                busy={busy}
                onToggle={toggle}
                onEdit={setEditing}
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
                items={items}
                query={query}
                onQueryChange={setQuery}
                busy={busy}
                onToggle={toggle}
                onEdit={setEditing}
              />
            )}
            {view === "Calendar" && (
              <CalendarView
                items={items}
                month={month}
                onMonthChange={setMonth}
                onEdit={setEditing}
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
      {editing && (
        <ItemEditor
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
