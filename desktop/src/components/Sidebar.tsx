import { SidebarResizer } from "./SidebarResizer";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Popover } from "./Popover";
import { ActivityDialog } from "../features/activity/ActivityDialog";
import {
  ChartNoAxesColumn,
  Hash,
  LogOut,
  Orbit,
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
  width?: number;
  onResize?: (width: number) => void;
  /** Shown as a narrow rail of icons, to give the page more room. */
  railed: boolean;
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
  width = 224,
  onResize,
  railed,
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
  const [activityOpen, setActivityOpen] = useState(false);
  const [hint, setHint] = useState<{
    label: string;
    x: number;
    y: number;
  } | null>(null);
  const showHint = (target: EventTarget | null) => {
    const button =
      target instanceof Element
        ? target.closest<HTMLButtonElement>("button[aria-label]")
        : null;
    if (!railed || !button) {
      setHint(null);
      return;
    }
    const rect = button.getBoundingClientRect();
    setHint({
      label: button.getAttribute("aria-label")!,
      x: rect.right + 10,
      y: rect.top + rect.height / 2,
    });
  };
  const [accountAnchor, setAccountAnchor] = useState<DOMRect | null>(null);
  return (
    <aside
      data-shared-chrome=""
      id="workspace-navigation"
      aria-label="Workspace navigation"
      onMouseOver={(event) => showHint(event.target)}
      onMouseLeave={() => setHint(null)}
      onFocus={(event) => showHint(event.target)}
      onBlur={() => setHint(null)}
      onPointerDown={() => setHint(null)}
      onScrollCapture={() => setHint(null)}
      className={"sidebar " + (open ? "open" : "")}
    >
      {onResize && <SidebarResizer width={width} onChange={onResize} />}
      <div className="sidebar-head">
        <div className="brand" aria-label="orbyn">
          <Orbit />
          <span className="brand-name">
            orbyn
            <span className="brand-dot" aria-hidden="true">
              •
            </span>
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
          type="button"
          className="sidebar-account-trigger"
          data-settings-focus-return
          aria-label={`Account: ${user?.name || "Orbyn"}`}
          aria-haspopup="dialog"
          aria-expanded={!!accountAnchor}
          onClick={(event) =>
            setAccountAnchor(event.currentTarget.getBoundingClientRect())
          }
        >
          <span className="avatar" aria-hidden="true">
            {user?.name[0] || "O"}
          </span>
          <span className="sidebar-account-name">
            {user?.name || "Loading…"}
          </span>
        </button>
        {accountAnchor && (
          <Popover
            anchor={accountAnchor}
            label="Account"
            onClose={() => setAccountAnchor(null)}
            width={280}
          >
            <div className="sidebar-account-menu" data-shared-chrome="">
              <div className="sidebar-account-identity">
                <strong>{user?.name || "Orbyn account"}</strong>
                <small>
                  {isAdmin ? "Workspace admin" : "Personal account"}
                </small>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAccountAnchor(null);
                  setActivityOpen(true);
                }}
              >
                <ChartNoAxesColumn size={17} aria-hidden="true" /> Activity
              </button>
              <button
                type="button"
                onClick={() => {
                  setAccountAnchor(null);
                  onNavigate("Settings");
                }}
              >
                <Settings size={17} aria-hidden="true" /> Settings
              </button>
              <button
                type="button"
                onClick={() => {
                  setAccountAnchor(null);
                  onSignOut();
                }}
              >
                <LogOut size={17} aria-hidden="true" /> Sign out
              </button>
            </div>
          </Popover>
        )}
      </div>
      {activityOpen && (
        <ActivityDialog onClose={() => setActivityOpen(false)} />
      )}
      {railed &&
        hint &&
        createPortal(
          <div
            className="navigation-hint"
            role="tooltip"
            style={{ left: hint.x, top: hint.y }}
          >
            {hint.label}
          </div>,
          document.body,
        )}
    </aside>
  );
}
