import { ArrowUpRight, LogOut, Orbit, Settings, Sparkles } from "lucide-react";
import { hasSystemPermission, type User } from "@orbyn/core";
import { NAV, type View } from "../app/views";

type Props = {
  open: boolean;
  view: View;
  user: User | null;
  hasUnread: boolean;
  onNavigate: (view: View) => void;
  onSignOut: () => void;
};

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
      <span className="nav-label">YOUR WORKSPACE</span>
      <nav>
        {NAV.filter((n) => !n.adminOnly || isAdmin).map(
          ({ label, icon: Icon }) => (
            <button
              key={label}
              className={view === label ? "active" : ""}
              onClick={() => onNavigate(label)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {label === "Notifications" && hasUnread && <i />}
            </button>
          ),
        )}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-note">
          <Sparkles size={18} />
          <strong>A little help, a clearer day.</strong>
          <p>Let Orbyn connect the dots in your plans.</p>
          <button onClick={() => onNavigate("AI assistant")}>
            Meet your assistant <ArrowUpRight size={14} />
          </button>
        </div>
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
