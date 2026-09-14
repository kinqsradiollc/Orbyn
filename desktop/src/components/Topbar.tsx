import { Bell, Menu, Plus } from "lucide-react";
import type { User } from "@orbyn/core";
import { VIEWS_WITHOUT_NEW_ITEM, type View } from "../app/views";

type TopbarProps = {
  view: View;
  onToggleMenu: () => void;
  onOpenNotifications: () => void;
};

/** Sticky header: mobile menu toggle, breadcrumb, today's date, and the bell. */
export function Topbar({
  view,
  onToggleMenu,
  onOpenNotifications,
}: TopbarProps) {
  const today = new Date();
  return (
    <header className="topbar">
      <button
        className="icon-button mobile-menu"
        aria-label="Toggle navigation"
        onClick={onToggleMenu}
      >
        <Menu size={20} />
      </button>
      <span>
        My workspace <span className="slash">/</span> <strong>{view}</strong>
      </span>
      <div>
        <span className="today-label">
          {today.toLocaleDateString([], {
            weekday: "short",
            month: "short",
            day: "numeric",
          })}
        </span>
        <button
          className="icon-button"
          aria-label="Notifications"
          onClick={onOpenNotifications}
        >
          <Bell size={18} />
        </button>
      </div>
    </header>
  );
}

type PageHeadingProps = {
  view: View;
  user: User | null;
  onNewItem: () => void;
};

const title = (view: View, user: User | null) => {
  switch (view) {
    case "Overview":
      return `Hello, ${user?.name.split(" ")[0] || "there"}.`;
    case "My tasks":
      return "Small steps. Big things.";
    case "AI assistant":
      return "A little help thinking ahead.";
    case "Teams":
      return "Plans are better together.";
    case "Admin":
      return "Workspace admin";
    default:
      return view;
  }
};

const subtitle = (view: View) => {
  switch (view) {
    case "Overview":
      return "Let's make room for a good day.";
    case "My tasks":
      return "Everything on your mind, with a place to land.";
    case "Calendar":
      return "A little perspective on the days ahead.";
    case "AI assistant":
      return "Summarize your plans, untangle your week, or make a fresh start.";
    case "Teams":
      return "Share tasks and events with the people you plan with.";
    case "Admin":
      return "Accounts, teams, and a record of every change.";
    default:
      return "Your space, just the way you like it.";
  }
};

/** Per-view eyebrow, title, subtitle and the "New item" button at the top of the content area. */
export function PageHeading({ view, user, onNewItem }: PageHeadingProps) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">
          {view === "Overview"
            ? "A FRESH PERSPECTIVE"
            : view === "Teams"
              ? "SHARED ORBITS"
              : view === "Admin"
                ? "WORKSPACE CONTROL"
                : "YOUR PERSONAL ORBIT"}
        </span>
        <h1>{title(view, user)}</h1>
        <p>{subtitle(view)}</p>
      </div>
      {!VIEWS_WITHOUT_NEW_ITEM.includes(view) && (
        <button className="primary" onClick={onNewItem}>
          <Plus size={17} /> New item
        </button>
      )}
    </div>
  );
}
