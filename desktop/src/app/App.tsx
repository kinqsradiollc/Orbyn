import { useState } from "react";
import { Orbit, X } from "lucide-react";
import type { Item, ItemInput } from "@orbyn/core";
import { client } from "../lib/api";
import { usePlanner } from "../hooks/usePlanner";
import { useAssistant } from "../hooks/useAssistant";
import { Sidebar } from "../components/Sidebar";
import { PageHeading, Topbar } from "../components/Topbar";
import { ItemEditor } from "../components/ItemEditor";
import { AuthPage } from "../features/auth/AuthPage";
import { OverviewView } from "../features/overview/OverviewView";
import { TasksView } from "../features/tasks/TasksView";
import { CalendarView } from "../features/calendar/CalendarView";
import { AssistantView } from "../features/assistant/AssistantView";
import { NotificationsView } from "../features/notifications/NotificationsView";
import { SettingsView } from "../features/settings/SettingsView";
import type { View } from "./views";

export function App() {
  const planner = usePlanner();
  const assistant = useAssistant(planner);
  const { token, user, items, notices, busy, error, loading, act, refresh } =
    planner;
  const [view, setView] = useState<View>("Overview");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [month, setMonth] = useState(new Date());
  const [mobileNav, setMobileNav] = useState(false);

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

  if (!token)
    return (
      <AuthPage
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
          <PageHeading
            view={view}
            user={user}
            onNewItem={() => setEditing("new")}
          />
          {view === "Overview" && (
            <OverviewView
              items={items}
              busy={busy}
              onToggle={planner.toggleItem}
              onEdit={setEditing}
              onNewItem={() => setEditing("new")}
              onNavigate={navigate}
              onPlanDay={() => {
                navigate("AI assistant");
                void assistant.ask(
                  "Summarize my upcoming plans and suggest what I should focus on.",
                );
              }}
            />
          )}
          {view === "My tasks" && (
            <TasksView
              items={items}
              query={query}
              onQueryChange={setQuery}
              busy={busy}
              onToggle={planner.toggleItem}
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
