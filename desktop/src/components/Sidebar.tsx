import {
  LogOut,
  Orbit,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from "lucide-react";
import { hasSystemPermission, type User } from "@orbyn/core";
import { NAV_GROUPS, type View } from "../app/views";

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
  onSignOut: () => void;
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
  onSignOut,
}: Props) {
  const isAdmin = hasSystemPermission(user?.role, "admin:access");
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
          const items = group.items.filter((n) => !n.adminOnly || isAdmin);
          if (!items.length) return null;
          return (
            <div className="nav-group" key={group.label}>
              <span className="nav-label">{group.label}</span>
              {items.map(({ label, icon: Icon }) => (
                <button
                  key={label}
                  className={view === label ? "active" : ""}
                  aria-current={view === label ? "page" : undefined}
                  aria-label={railed ? label : undefined}
                  title={railed ? label : undefined}
                  onClick={() => onNavigate(label)}
                >
                  <Icon size={17} />
                  <span>{label}</span>
                  {label === "Notifications" && hasUnread && <i />}
                  {label === "Review" && reviewPending > 0 && (
                    <i aria-label={`${reviewPending} waiting`} />
                  )}
                </button>
              ))}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-bottom">
        <button
          className="settings-link rail-toggle"
          aria-label={railed ? "Expand sidebar" : "Collapse sidebar"}
          title={`${railed ? "Expand" : "Collapse"} sidebar (⌘\\)`}
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
          onClick={() => onNavigate("Settings")}
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
