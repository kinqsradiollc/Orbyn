import { LogOut, Orbit, Settings } from "lucide-react";
import { hasSystemPermission, type User } from "@orbyn/core";
import { NAV_GROUPS, type View } from "../app/views";

type Props = {
  open: boolean;
  view: View;
  user: User | null;
  hasUnread: boolean;
  onNavigate: (view: View) => void;
  onSignOut: () => void;
};

/**
 * The sidebar holds three fixed parts: who you are at the top, the
 * destinations in the middle, and Settings and your account at the bottom.
 * Only the middle scrolls, so the way out is always where you left it — you
 * never have to scroll a sidebar to sign out.
 */
export function Sidebar({
  open,
  view,
  user,
  hasUnread,
  onNavigate,
  onSignOut,
}: Props) {
  const isAdmin = hasSystemPermission(user?.role, "admin:access");
  return (
    <aside className={"sidebar " + (open ? "open" : "")}>
      <div className="sidebar-head">
        <div className="brand">
          <Orbit /> orbyn<span>•</span>
        </div>
        <div className="workspace">
          <span className="avatar">{user?.name[0] || "O"}</span>
          <div>
            <strong>Personal space</strong>
            <small>Room for everything</small>
          </div>
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
                  onClick={() => onNavigate(label)}
                >
                  <Icon size={17} />
                  <span>{label}</span>
                  {label === "Notifications" && hasUnread && <i />}
                </button>
              ))}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-bottom">
        <button
          className="settings-link"
          onClick={() => onNavigate("Settings")}
        >
          <Settings size={17} /> Settings
        </button>
        <div className="profile">
          <span className="avatar">{user?.name[0] || "O"}</span>
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
