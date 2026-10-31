import {
  hasSystemPermission,
  type SavedView,
  type StarredItem,
} from "@orbyn/core";
import {
  Bell,
  LogOut,
  Menu as MenuIcon,
  Moon,
  MoreHorizontal,
  Orbit,
  Search,
  Settings,
  Star,
  Sun,
  Table2,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { client } from "../lib/session";
import { navigate, usePath } from "../lib/router";
import { useTheme } from "../lib/theme";
import { IconButton, Menu } from "../ui/kit";
import { TaskHost, tasks } from "../screens/shared-task";
import { useAccount } from "./account";
import { Banners } from "./Banners";
import { CommandBar } from "./CommandBar";
import { MORE, PRIMARY, owns, ownsAny, type NavItem } from "./nav";
import "./shell.css";

function NavLink({
  item,
  path,
  onGo,
}: {
  item: NavItem;
  path: string;
  onGo: () => void;
}) {
  const Icon = item.icon;
  return (
    <a
      href={item.path}
      className={`nav-link${owns(item, path) ? " is-active" : ""}`}
      aria-current={owns(item, path) ? "page" : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        navigate(item.path);
        onGo();
      }}
    >
      <Icon aria-hidden="true" />
      {item.label}
    </a>
  );
}

/** What the sidebar and bell show, refreshed as the person moves around. */
function useShellData(path: string) {
  const [starred, setStarred] = useState<StarredItem[]>([]);
  const [pinned, setPinned] = useState<SavedView[]>([]);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let live = true;
    void client.listStarred().then(
      (all) => live && setStarred(all),
      () => undefined,
    );
    void client.listViews().then(
      (all) => live && setPinned(all.filter((view) => view.pinned)),
      () => undefined,
    );
    void client.listNotifications().then(
      (all) => live && setUnread(all.filter((n) => !n.read).length),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [path]);
  return { starred, pinned, unread };
}

const openStarred = (item: StarredItem) => {
  if (item.kind === "task") tasks.open(item.id);
  else if (item.kind === "project") navigate(`/app/project/${item.id}`);
  else if (item.kind === "view") navigate(`/app/view/${item.id}`);
  else
    navigate(`/app/doc/${item.id}${item.block_id ? `#${item.block_id}` : ""}`);
};

export function Shell({ children }: { children: ReactNode }) {
  const path = usePath();
  const { user, signOut } = useAccount();
  const [theme, toggleTheme] = useTheme();
  const [navOpen, setNavOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const { starred, pinned, unread } = useShellData(path);
  const closeSearch = useCallback(() => setSearching(false), []);
  const isAdmin = hasSystemPermission(user?.role, "admin:access");
  const more = MORE.filter((item) => !item.adminOnly || isAdmin);
  const [moreOpen, setMoreOpen] = useState(() =>
    more.some((item) => ownsAny(item, path)),
  );
  const close = () => setNavOpen(false);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearching(true);
        return;
      }
      const target = event.target as HTMLElement;
      const typing =
        target.isContentEditable ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if (
        event.key.toLowerCase() === "n" &&
        !typing &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        tasks.create({});
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {navOpen && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={close}
        />
      )}
      <aside className={`sidebar${navOpen ? " is-open" : ""}`} id="navigation">
        <a
          className="brand"
          href="/app"
          aria-label="Orbyn, Today"
          onClick={(event) => {
            event.preventDefault();
            navigate("/app");
            close();
          }}
        >
          <Orbit aria-hidden="true" />
          orbyn
        </a>
        <nav aria-label="Main">
          {PRIMARY.map((item) => (
            <div key={item.path}>
              <NavLink item={item} path={path} onGo={close} />
              {item.children && ownsAny(item, path) && (
                <div className="nav-children">
                  {item.children.map((child) => (
                    <NavLink
                      key={child.path}
                      item={child}
                      path={path}
                      onGo={close}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
          {starred.length > 0 && (
            <div className="nav-group" aria-label="Starred">
              <span className="nav-label">Starred</span>
              {starred.slice(0, 8).map((item) => (
                <button
                  key={`${item.kind}:${item.id}:${item.block_id}`}
                  className={`nav-link${item.closed ? " is-closed" : ""}`}
                  onClick={() => {
                    openStarred(item);
                    close();
                  }}
                >
                  <Star aria-hidden="true" />
                  <span className="row-title" dir="auto">
                    {item.title || "Untitled"}
                  </span>
                </button>
              ))}
            </div>
          )}
          {pinned.length > 0 && (
            <div className="nav-group" aria-label="Pinned views">
              <span className="nav-label">Pinned views</span>
              {pinned.map((view) => (
                <NavLink
                  key={view.id}
                  item={{
                    label: view.name,
                    path: `/app/view/${view.id}`,
                    icon: Table2,
                  }}
                  path={path}
                  onGo={close}
                />
              ))}
            </div>
          )}
          <button
            className="nav-link"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((open) => !open)}
          >
            <MoreHorizontal aria-hidden="true" />
            More
          </button>
          {moreOpen &&
            more.map((item) => (
              <NavLink key={item.path} item={item} path={path} onGo={close} />
            ))}
        </nav>
        <div className="sidebar-foot">
          <Menu
            label="Account"
            trigger={(open, expanded) => (
              <button
                className="account"
                aria-expanded={expanded}
                onClick={open}
              >
                <span className="avatar" aria-hidden="true">
                  {(user?.name || user?.email || "?").slice(0, 1).toUpperCase()}
                </span>
                <span className="row-title">{user?.name || user?.email}</span>
              </button>
            )}
          >
            {(done) => (
              <>
                <button
                  onClick={() => {
                    done();
                    navigate("/app/settings");
                    close();
                  }}
                >
                  <Settings aria-hidden="true" /> Settings
                </button>
                <button onClick={signOut}>
                  <LogOut aria-hidden="true" /> Sign out
                </button>
              </>
            )}
          </Menu>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <IconButton
            className="menu-button"
            label="Open navigation"
            aria-expanded={navOpen}
            aria-controls="navigation"
            onClick={() => setNavOpen(true)}
          >
            <MenuIcon />
          </IconButton>
          <button className="search-trigger" onClick={() => setSearching(true)}>
            <Search aria-hidden="true" />
            <span>Search</span>
            <kbd>⌘K</kbd>
          </button>
          <span className="topbar-gap" />
          <IconButton
            label={theme === "dark" ? "Use light theme" : "Use dark theme"}
            onClick={toggleTheme}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </IconButton>
          <span className="bell">
            <IconButton
              label={
                unread ? `Notifications, ${unread} unread` : "Notifications"
              }
              onClick={() => navigate("/app/notifications")}
            >
              <Bell />
            </IconButton>
            {unread > 0 && <i aria-hidden="true" />}
          </span>
        </header>
        <Banners isAdmin={isAdmin} />
        <main id="main" tabIndex={-1}>
          {children}
        </main>
      </div>
      {searching && (
        <CommandBar
          isAdmin={isAdmin}
          onToggleTheme={toggleTheme}
          onClose={closeSearch}
        />
      )}
      <TaskHost />
    </div>
  );
}
