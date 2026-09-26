import { Bell, Menu, Plus, Search } from "lucide-react";
import type { User } from "@orbyn/core";
import {
  SCREENS,
  VIEWS_WITHOUT_NEW_ITEM,
  viewTitle,
  type View,
} from "../app/views";
import { commandById, keysFor } from "../app/commands";

type TopbarProps = {
  view: View;
  onToggleMenu: () => void;
  onOpenNotifications: () => void;
  /** Opens the command bar (also ⌘K / Ctrl+K). */
  onOpenCommand: () => void;
};

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** ⌘K's keys, as the command list has them. */
export const COMMAND_SHORTCUT = keysFor(commandById("app.search"), isMac).join(
  isMac ? "" : "+",
);

/** Sticky header: mobile menu toggle, breadcrumb, search, today's date, and the bell. */
export function Topbar({
  view,
  onToggleMenu,
  onOpenNotifications,
  onOpenCommand,
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
        <button
          className="command-trigger"
          aria-label="Search or ask"
          aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
          onClick={onOpenCommand}
        >
          <Search size={14} aria-hidden="true" />
          <span>Search or ask</span>
          <kbd>{COMMAND_SHORTCUT}</kbd>
        </button>
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
        <span className="eyebrow">{SCREENS[view].eyebrow}</span>
        <h1>{viewTitle(view, user?.name)}</h1>
        <p>{SCREENS[view].subtitle}</p>
      </div>
      {!VIEWS_WITHOUT_NEW_ITEM.includes(view) && (
        <button className="primary" onClick={onNewItem}>
          <Plus size={17} /> New item
        </button>
      )}
    </div>
  );
}
