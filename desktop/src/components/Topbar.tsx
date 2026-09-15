import { Bell, Menu, Plus } from "lucide-react";
import { screens, screenTitle, type User } from "@orbyn/core";
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

/** Per-view eyebrow, title, subtitle and the "New item" button at the top of the content area. */
export function PageHeading({ view, user, onNewItem }: PageHeadingProps) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{screens[view].eyebrow}</span>
        <h1>{screenTitle(view, user?.name)}</h1>
        <p>{screens[view].subtitle}</p>
      </div>
      {!VIEWS_WITHOUT_NEW_ITEM.includes(view) && (
        <button className="primary" onClick={onNewItem}>
          <Plus size={17} /> New item
        </button>
      )}
    </div>
  );
}
