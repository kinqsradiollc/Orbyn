import type { ReactNode } from "react";
import { useElementWidth } from "../../hooks/useElementWidth";
import { Bell, Menu, Plus, Search } from "lucide-react";
import type { User } from "@orbyn/core";
import {
  SCREENS,
  navName,
  VIEWS_WITHOUT_NEW_ITEM,
  viewTitle,
  type View,
} from "../views";
import { commandById, keysFor } from "../commands";
import { usePrefs } from "../prefs";

type TopbarProps = {
  view: View;
  sharedChrome?: boolean;
  showLocation?: boolean;
  tabs?: ReactNode;
  /** The assistant's chosen name, shown for its view. */
  agentName?: string;
  onToggleMenu: () => void;
  navigationOpen?: boolean;
  onOpenNotifications: () => void;
  /** Opens the command bar (also ⌘K / Ctrl+K). */
  onOpenCommand: () => void;
  /** Your account's zone, for today's date; the device's until it loads. */
  timeZone?: string;
};

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** ⌘K's keys, as the command list has them. */
export const COMMAND_SHORTCUT = keysFor(commandById("app.search"), isMac).join(
  isMac ? "" : "+",
);

/** Shared header: one navigation toggle, location, search, date and notifications. */
export function Topbar({
  view,
  sharedChrome = false,
  showLocation = true,
  tabs,
  agentName,
  onToggleMenu,
  navigationOpen = false,
  onOpenNotifications,
  onOpenCommand,
  timeZone,
}: TopbarProps) {
  const { ref: headerRef, width } = useElementWidth();
  const compact = width > 0 && width < 700;
  const today = new Date();
  const { prefs } = usePrefs();
  // ⌘K's keys, as changed (NAV-09); none shown when taken away.
  const shortcut = keysFor(
    commandById("app.search"),
    isMac,
    prefs.shortcuts,
  ).join(isMac ? "" : "+");
  return (
    <header
      ref={headerRef}
      className={`topbar${tabs ? " has-tabs" : ""}${compact ? " is-compact" : ""}`}
    >
      <button
        className="icon-button mobile-menu"
        data-shared-chrome={sharedChrome ? "" : undefined}
        data-settings-focus-return
        aria-label="Toggle navigation"
        aria-expanded={navigationOpen}
        aria-controls="workspace-navigation"
        onClick={onToggleMenu}
      >
        <Menu size={20} />
      </button>
      <div className="workspace-location">
        {tabs ?? (showLocation && <strong>{navName(view, agentName)}</strong>)}
      </div>
      <div
        className="workspace-header-actions"
        data-shared-chrome={sharedChrome ? "" : undefined}
      >
        <button
          className="command-trigger"
          aria-label="Search or ask"
          aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
          onClick={onOpenCommand}
        >
          <Search size={14} aria-hidden="true" />
          <span>Search or ask</span>
          {shortcut && <kbd>{shortcut}</kbd>}
        </button>
        <span className="today-label">
          {today.toLocaleDateString([], {
            timeZone,
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

/** View identity and its primary creation action. */
export function PageHeading({ view, user, onNewItem }: PageHeadingProps) {
  return (
    <div className="page-heading">
      <div>
        {SCREENS[view].eyebrow && (
          <span className="eyebrow">{SCREENS[view].eyebrow}</span>
        )}
        <h1>{viewTitle(view, user?.name)}</h1>
        {SCREENS[view].subtitle && <p>{SCREENS[view].subtitle}</p>}
      </div>
      {!VIEWS_WITHOUT_NEW_ITEM.includes(view) && (
        <button className="primary" onClick={onNewItem}>
          <Plus size={17} /> New item
        </button>
      )}
    </div>
  );
}
