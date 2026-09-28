import {
  Hash,
  LogOut,
  Orbit,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Table2,
  type LucideIcon,
} from "lucide-react";
import {
  arrangeEntries,
  hasSystemPermission,
  type SavedView,
  type StarredItem,
  type User,
} from "@orbyn/core";
import { NAV_GROUPS, navName, type View } from "../app/views";
import { commandById, keysFor } from "../app/commands";
import { usePrefs } from "../app/prefs";
import { CONCEPT_ICON } from "../app/concept-icons";
import { newTabClick, openInNewTab, type TabRequest } from "../app/tabs";

/** A starred thing as a tab of its own; tasks open in their panel. */
const starTab = (s: StarredItem): TabRequest | null =>
  s.kind === "doc" || s.kind === "heading"
    ? { kind: "doc", id: s.id, title: s.title }
    : s.kind === "project" || s.kind === "view"
      ? { kind: s.kind, id: s.id, title: s.title }
      : null;

const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);

/** How many starred things the sidebar lists; ⌘K has the rest. */
const STARRED_SHOWN = 8;

const STAR_ICONS: Record<StarredItem["kind"], LucideIcon> = {
  doc: CONCEPT_ICON.page,
  heading: Hash,
  task: CONCEPT_ICON.task,
  project: CONCEPT_ICON.project,
  view: Table2,
};

type Props = {
  open: boolean;
  /** Shown as a narrow rail of icons, to give the page more room. */
  railed: boolean;
  onToggleRail: () => void;
  view: View;
  user: User | null;
  hasUnread: boolean;
  /** Proposals waiting in Review. */
  reviewPending?: number;
  onNavigate: (view: View) => void;
  /** Saved views pinned to the sidebar, and the one open (if any). */
  pinnedViews?: SavedView[];
  openView?: string | null;
  onOpenView?: (id: string) => void;
  /** The Starred group (NAV-07), and opening one of them. */
  starred?: StarredItem[];
  onOpenStarred?: (item: StarredItem) => void;
  onSignOut: () => void;
  /** The assistant's chosen name, shown on its entry. */
  agentName?: string;
};

/**
 * The sidebar holds three fixed parts: the brand at the top, the
 * destinations in the middle, and Settings and your account at the bottom.
 * Only the middle scrolls, so the way out is always where you left it — you
 * never have to scroll a sidebar to sign out.
 */
export function Sidebar({
  open,
  railed,
  onToggleRail,
  view,
  user,
  hasUnread,
  reviewPending = 0,
  onNavigate,
  pinnedViews = [],
  openView = null,
  onOpenView,
  starred = [],
  onOpenStarred,
  onSignOut,
  agentName,
}: Props) {
  const isAdmin = hasSystemPermission(user?.role, "admin:access");
  const { prefs } = usePrefs();
  /** The sidebar's keys, as the command list (and your changes) have them. */
  const sidebarKeys = keysFor(
    commandById("app.sidebar"),
    MAC,
    prefs.shortcuts,
  ).join(" ");
  return (
    <aside className={"sidebar " + (open ? "open" : "")}>
      <div className="sidebar-head">
        <div className="brand" aria-label="orbyn">
          <Orbit />
          <span className="brand-name">
            orbyn<span>•</span>
          </span>
        </div>
      </div>

      <nav>
        {NAV_GROUPS.map((group) => {
          // Arrange (NAV-08): the order and what's hidden follow the account.
          const items = arrangeEntries(
            group.items.filter((n) => !n.adminOnly || isAdmin),
            (n) => n.label,
            prefs.sidebar,
          );
          if (!items.length) return null;
          return (
            <div className="nav-group" key={group.label}>
              <span className="nav-label">{group.label}</span>
              {items.map(({ label, icon: Icon }) => (
                <button
                  key={label}
                  className={view === label ? "active" : ""}
                  aria-current={view === label ? "page" : undefined}
                  aria-label={railed ? navName(label, agentName) : undefined}
                  title={railed ? navName(label, agentName) : undefined}
                  {...newTabClick(
                    () => onNavigate(label),
                    () => openInNewTab({ kind: "screen", view: label }),
                  )}
                >
                  <Icon size={17} />
                  <span>{navName(label, agentName)}</span>
                  {label === "Notifications" && hasUnread && <i />}
                  {label === "Review" && reviewPending > 0 && (
                    <i aria-label={`${reviewPending} waiting`} />
                  )}
                </button>
              ))}
            </div>
          );
        })}
        {starred.length > 0 &&
          onOpenStarred &&
          !prefs.sidebar.hidden.includes("Starred") && (
            <div className="nav-group" aria-label="Starred">
              <span className="nav-label">STARRED</span>
              {starred.slice(0, STARRED_SHOWN).map((s) => {
                const Icon = STAR_ICONS[s.kind];
                return (
                  <button
                    key={`${s.kind}:${s.id}:${s.block_id}`}
                    className={"nav-view" + (s.closed ? " is-closed" : "")}
                    aria-label={railed ? s.title : undefined}
                    title={s.hint ? `${s.title} · ${s.hint}` : s.title}
                    {...newTabClick(
                      () => onOpenStarred(s),
                      () => {
                        const tab = starTab(s);
                        if (tab) openInNewTab(tab);
                        else onOpenStarred(s);
                      },
                    )}
                  >
                    <Icon size={17} />
                    <span>{s.title}</span>
                  </button>
                );
              })}
            </div>
          )}
        {pinnedViews.length > 0 && onOpenView && (
          <div className="nav-group" aria-label="Pinned views">
            <span className="nav-label">PINNED VIEWS</span>
            {pinnedViews.map((v) => {
              const on = view === "Views" && openView === v.id;
              return (
                <button
                  key={v.id}
                  className={"nav-view" + (on ? " active" : "")}
                  aria-current={on ? "page" : undefined}
                  aria-label={railed ? v.name : undefined}
                  title={railed ? v.name : undefined}
                  {...newTabClick(
                    () => onOpenView(v.id),
                    () =>
                      openInNewTab({ kind: "view", id: v.id, title: v.name }),
                  )}
                >
                  <Table2 size={17} />
                  <span>{v.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </nav>

      <div className="sidebar-bottom">
        <button
          className="settings-link rail-toggle"
          aria-label={railed ? "Expand sidebar" : "Collapse sidebar"}
          title={`${railed ? "Expand" : "Collapse"} sidebar${
            sidebarKeys ? ` (${sidebarKeys})` : ""
          }`}
          aria-expanded={!railed}
          onClick={onToggleRail}
        >
          {railed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}{" "}
          <span>Collapse</span>
        </button>
        <button
          className="settings-link"
          aria-label={railed ? "Settings" : undefined}
          title={railed ? "Settings" : undefined}
          {...newTabClick(
            () => onNavigate("Settings"),
            () => openInNewTab({ kind: "screen", view: "Settings" }),
          )}
        >
          <Settings size={17} /> <span>Settings</span>
        </button>
        <div className="profile">
          <span className="avatar" title={user?.name}>
            {user?.name[0] || "O"}
          </span>
          <div>
            <strong>
              {user?.name || "Loading…"}
              {isAdmin && <span className="role-badge system">Admin</span>}
            </strong>
            <small>{isAdmin ? "Workspace admin" : "Personal account"}</small>
          </div>
          <button
            className="icon-button"
            aria-label="Sign out"
            onClick={onSignOut}
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
