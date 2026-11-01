import { useCalendarZone } from "./controls/calendar-zone";
import {
  useTabsPreference,
  tabsPreferenceEnabled,
} from "./controls/tabs-preference";
import {
  localDateKey,
  COMMANDS,
  SETTING_COMMANDS,
  effectiveKeys,
  pressMatches,
  hasSystemPermission,
  type StarredItem,
} from "@orbyn/core";
import {
  Bell,
  ChevronDown,
  MoreHorizontal,
  LogOut,
  Menu as MenuIcon,
  Moon,
  Orbit,
  Search,
  Settings,
  Star,
  Sun,
  Table2,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useId,
  useMemo,
  useEffect,
  useState,
  useRef,
  type ReactNode,
  type CSSProperties,
} from "react";
import { useRouteScope } from "../lib/route-scope";
import { getSessionVersion } from "../lib/session";
import {
  noteLegacyInput,
  prepareLegacyExit,
  useNavigate,
  usePath,
} from "../lib/router";
import { useTheme } from "../lib/theme";
import { Button, ErrorNotice, IconButton, Menu, useToast } from "../ui/kit";
import { TaskHost, useTasks, useItems, nextUp } from "../screens/shared-task";
import { useAccount } from "./account";
import { prepareTaskWorkspaceExit } from "../screens/shared-task/host-store";
import { useShellData } from "./shell-feed";
import { Banners } from "./Banners";
import { CommandBar } from "./CommandBar";
import {
  ALL_NAV,
  navKey,
  owns,
  ownsAny,
  sidebarComposition,
  type NavItem,
} from "./nav";
import { ArrangeNavigation, Shortcuts } from "./controls/Preferences";
import { SidebarSize, useSidebarSize } from "./controls/SidebarSize";
import { UpdateBanner } from "./controls/UpdateBanner";
import { Activity } from "./controls/Activity";
import { GlobalOverlays, requestWhatsNew } from "./GlobalOverlays";
import { usePrefs } from "../screens/today/prefs";
import { useCommandMemory } from "./controls/command-memory";
import {
  runCommand,
  availableCommands,
  COMMAND_PATHS,
  type CommandActions,
} from "./controls/commands";
import { useRegisteredRouteCommands } from "./controls/page-commands";
import {
  NotificationsPanel,
  useNotificationPin,
} from "../screens/notifications";
import type { FrameLease, WorkspaceController } from "./workspace/controller";
import "./shell.css";

function NavLink({
  item,
  path,
  onGo,
  onOpenInTab,
}: {
  item: NavItem;
  path: string;
  onGo: () => void;
  onOpenInTab?: (href: string, background: boolean) => void;
}) {
  const navigate = useNavigate();
  const Icon = item.icon;
  return (
    <a
      href={item.path}
      className={`nav-link${owns(item, path) ? " is-active" : ""}`}
      aria-current={owns(item, path) ? "page" : undefined}
      title={item.label}
      aria-label={item.label}
      onAuxClick={(event) => {
        if (event.button === 1 && onOpenInTab) {
          event.preventDefault();
          onOpenInTab(item.path, true);
        }
      }}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey) {
          if (onOpenInTab) {
            event.preventDefault();
            onOpenInTab(item.path, !event.shiftKey);
          }
          return;
        }
        if (event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(item.path);
        onGo();
      }}
    >
      <Icon aria-hidden="true" />
      <span className="shell-nav-text">{item.label}</span>
    </a>
  );
}

/** The main link still navigates; the adjacent disclosure only exposes its children. */
function NavSection({
  item,
  path,
  onGo,
  onOpenInTab,
}: {
  item: NavItem;
  path: string;
  onGo(): void;
  onOpenInTab?: (href: string, background: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(() => ownsAny(item, path));
  const childrenId = useId();
  useEffect(() => {
    if (ownsAny(item, path)) setExpanded(true);
  }, [item, path]);
  const children = item.children ?? [];
  return (
    <div
      className="nav-section"
      data-branch-current={ownsAny(item, path) || undefined}
    >
      <div className="nav-section-head">
        <NavLink
          item={item}
          path={path}
          onGo={() => {
            setExpanded(true);
            onGo();
          }}
          onOpenInTab={onOpenInTab}
        />
        {!!children.length && (
          <button
            type="button"
            className="nav-section-toggle"
            aria-label={`${expanded ? "Hide" : "Show"} ${item.label} destinations`}
            title={`${item.label} destinations`}
            aria-expanded={expanded}
            aria-controls={childrenId}
            onClick={() => setExpanded((open) => !open)}
          >
            <ChevronDown aria-hidden="true" />
          </button>
        )}
      </div>
      {!!children.length && (
        <div
          id={childrenId}
          className="nav-children nav-section-body"
          role="group"
          aria-label={`${item.label} destinations`}
          hidden={!expanded}
        >
          {children.map((child) => (
            <NavLink
              key={child.path}
              item={child}
              path={path}
              onGo={onGo}
              onOpenInTab={onOpenInTab}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MoreNavigation({
  items,
  path,
  onGo,
  onOpenInTab,
}: {
  items: NavItem[];
  path: string;
  onGo(): void;
  onOpenInTab?: (href: string, background: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(() =>
    items.some((item) => ownsAny(item, path)),
  );
  const childrenId = useId();
  useEffect(() => {
    if (items.some((item) => ownsAny(item, path))) setExpanded(true);
  }, [items, path]);
  return (
    <div className="nav-section nav-more">
      <button
        type="button"
        className="nav-link nav-more-toggle"
        title="More destinations"
        aria-label="More destinations"
        aria-expanded={expanded}
        aria-controls={childrenId}
        onClick={() => setExpanded((open) => !open)}
      >
        <MoreHorizontal aria-hidden="true" />
        <span className="shell-nav-text">More</span>
        <ChevronDown className="nav-more-chevron" aria-hidden="true" />
      </button>
      <div
        id={childrenId}
        className="nav-children nav-section-body"
        role="group"
        aria-label="More destinations"
        hidden={!expanded}
      >
        {items.map((item) => (
          <NavLink
            key={item.path}
            item={item}
            path={path}
            onGo={onGo}
            onOpenInTab={onOpenInTab}
          />
        ))}
      </div>
    </div>
  );
}

export function Shell({
  children,
  prepareSignOut,
  prepareReload,
  controller,
  origin,
}: {
  children: ReactNode;
  prepareSignOut?: () => Promise<{ allowed: boolean; current(): boolean }>;
  prepareReload?: () => Promise<{ allowed: boolean; current(): boolean }>;
  controller?: WorkspaceController;
  origin?: FrameLease;
}) {
  const navigate = useNavigate(),
    tasks = useTasks(),
    toast = useToast();
  const scope = useRouteScope(),
    pageCommands = useRegisteredRouteCommands(scope);
  const calendar = useCalendarZone();
  const calendarRef = useRef(calendar);
  calendarRef.current = calendar;
  const tabsEnabled = useTabsPreference();
  const prefs = usePrefs(),
    size = useSidebarSize(),
    items = useItems(),
    notificationPin = useNotificationPin();
  const [arranging, setArranging] = useState(false),
    [shortcuts, setShortcuts] = useState(false),
    [activity, setActivity] = useState(false);
  const [leaving, setLeaving] = useState(false),
    [leaveError, setLeaveError] = useState("");
  const leavingRef = useRef(false);
  const generation = getSessionVersion();
  const noteInput = () => {
    noteLegacyInput();
    scope?.noteInput?.();
    const command = scope?.commandScope;
    if (command && command !== (scope?.originScope ?? scope))
      command.noteInput?.();
  };
  const logout = async () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    setLeaveError("");
    try {
      const permission = await (
        prepareSignOut ??
        (() =>
          prepareLegacyExit({
            current: () => generation === getSessionVersion(),
            prepareGlobal: prepareTaskWorkspaceExit,
          }))
      )();
      if (!permission.allowed) {
        if (generation === getSessionVersion())
          setLeaveError("Resolve open drafts and dialogs before signing out.");
        return;
      }
      if (generation === getSessionVersion() && permission.current()) signOut();
      else if (generation === getSessionVersion())
        setLeaveError(
          "An open view changed while preparing to sign out. Check it and try again.",
        );
    } catch {
      if (generation === getSessionVersion())
        setLeaveError("Couldn't prepare your open views. They remain open.");
    } finally {
      if (generation === getSessionVersion()) {
        leavingRef.current = false;
        setLeaving(false);
      }
    }
  };
  const openStarred = (item: StarredItem) => {
    if (item.kind === "task") tasks.open(item.id);
    else if (item.kind === "project") navigate(`/app/project/${item.id}`);
    else if (item.kind === "view") navigate(`/app/view/${item.id}`);
    else
      navigate(
        `/app/doc/${item.id}${item.block_id ? `#${encodeURIComponent(item.block_id)}` : ""}`,
      );
  };
  const path = usePath();
  const { user, signOut } = useAccount();
  const commandMemory = useCommandMemory(user?.id ?? "");
  const [theme, toggleTheme] = useTheme();
  const [navOpen, setNavOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const {
    starred,
    pinned,
    unread,
    error: feedError,
    reload: reloadFeed,
  } = useShellData();
  const closeSearch = useCallback(() => setSearching(false), []);
  const isAdmin = hasSystemPermission(user?.role, "admin:access");
  const entries = ALL_NAV.filter((item) => !item.adminOnly || isAdmin).map(
    (item) => ({ ...item, key: navKey(item) }),
  );
  const composition = useMemo(
    () => sidebarComposition(prefs.prefs.sidebar, isAdmin),
    [prefs.prefs.sidebar, isAdmin],
  );
  const close = () => setNavOpen(false);
  const inTab =
    controller && origin && tabsEnabled
      ? (href: string, background = true) => {
          const opening = origin;
          if (
            generation !== getSessionVersion() ||
            !controller.owns(opening) ||
            !tabsPreferenceEnabled()
          )
            return;
          if (/^\/app\/(?:settings|agents|chatgpt)(?:[/?#]|$)/.test(href)) {
            navigate(href);
            return;
          }
          void controller
            .open({ origin: opening, href, target: "new-tab", background })
            .then((result) => {
              if (
                generation === getSessionVersion() &&
                result.kind === "refused"
              )
                toast({ text: result.reason, error: true });
            });
        }
      : undefined;
  const actions: Record<string, () => void | Promise<unknown>> = {};
  for (const command of [...COMMANDS, ...SETTING_COMMANDS]) {
    if (
      command.view &&
      COMMAND_PATHS[command.view] &&
      (command.needs !== "admin" || isAdmin)
    )
      actions[command.id] = () => navigate(COMMAND_PATHS[command.view!]);
    if (command.setting)
      actions[command.id] = () =>
        navigate(
          `/app/settings?setting=${encodeURIComponent(command.setting!)}`,
        );
  }
  Object.assign(actions, {
    "new.task": () => tasks.create({}),
    "new.event": () => tasks.create({ prefill: { kind: "event" } }),
    "new.project": () => navigate("/app/projects?new=1"),
    "plan.day": () => navigate("/app/calendar?plan=all"),
    "app.search": () => setSearching(true),
    "app.shortcuts": () => setShortcuts(true),
    "app.sidebar": () => {
      setNavOpen(true);
      const target = document.querySelector<HTMLElement>("#navigation a");
      requestAnimationFrame(() => {
        if (
          generation === getSessionVersion() &&
          target?.isConnected &&
          !document.querySelector("dialog[open]")
        )
          target.focus();
      });
    },
    "app.changes": () => setActivity(true),
    "app.whats-new": requestWhatsNew,
    "app.security": () => navigate("/app/settings/privacy"),
  } satisfies CommandActions);
  if (calendar.zone)
    actions["plan.today"] = () => {
      const zone = calendarRef.current.zone;
      if (!zone)
        throw new Error(
          "Reload calendar preferences before using a date command.",
        );
      return navigate(`/app/calendar?date=${localDateKey(new Date(), zone)}`);
    };
  const next = nextUp(items, undefined, 1)[0];
  if (next) actions["plan.focus"] = () => tasks.focus(next);
  const globalActions = { ...actions };
  for (const [id, action] of Object.entries(pageCommands))
    actions[id] = action.run;
  const commands = availableCommands(actions, isAdmin);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        generation !== getSessionVersion() ||
        document.querySelector("dialog[open]")
      )
        return;
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      const command = commands.find((command) =>
        pressMatches(effectiveKeys(command, prefs.prefs.shortcuts), event),
      );
      if (
        command &&
        actions[command.id] &&
        (!typing || event.metaKey || event.ctrlKey || event.altKey)
      ) {
        event.preventDefault();
        commandMemory.record(command.id);
        runCommand(actions[command.id], (text) => {
          if (generation === getSessionVersion()) toast({ text, error: true });
        });
        return;
      }
      if (
        !controller ||
        !origin ||
        !controller.owns(origin) ||
        typing ||
        !tabsPreferenceEnabled()
      )
        return;
      const mod = event.metaKey || event.ctrlKey;
      const run = (action: Parameters<WorkspaceController["command"]>[1]) => {
        event.preventDefault();
        void controller.command(origin, action).then((result) => {
          if (generation === getSessionVersion() && result.kind === "refused")
            toast({ text: result.reason, error: true });
        });
      };
      if (mod && event.key.toLowerCase() === "t") {
        event.preventDefault();
        if (event.shiftKey) run({ type: "reopen" });
        else inTab?.("/app", false);
      } else if (mod && event.key.toLowerCase() === "w")
        run({ type: "close", key: origin.tabKey });
      else if (event.ctrlKey && event.key === "Tab")
        run({ type: "cycle", step: event.shiftKey ? -1 : 1 });
      else if (event.altKey && event.key === "ArrowLeft") run({ type: "back" });
      else if (event.altKey && event.key === "ArrowRight")
        run({ type: "forward" });
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [
    actions,
    prefs.prefs.shortcuts,
    controller,
    origin,
    generation,
    tabsEnabled,
  ]);

  const starredLinks = starred.length > 0 &&
    !prefs.prefs.sidebar.hidden.includes("Starred") && (
      <div className="nav-group" aria-label="Starred">
        <span className="nav-label">Starred</span>
        {starred.map((item) => (
          <button
            key={`${item.kind}:${item.id}:${item.block_id}`}
            className={`nav-link${item.closed ? " is-closed" : ""}`}
            aria-label={item.title || "Untitled"}
            title={item.title || "Untitled"}
            onClick={() => {
              openStarred(item);
              close();
            }}
          >
            <Star aria-hidden="true" />
            <span className="row-title shell-nav-text" dir="auto">
              {item.title || "Untitled"}
            </span>
          </button>
        ))}
      </div>
    );
  const pinnedLinks = pinned.length > 0 &&
    !prefs.prefs.sidebar.hidden.includes("Pinned views") && (
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
    );
  return (
    <div
      className={`app${size.rail ? " shell-rail" : ""}`}
      onInputCapture={noteInput}
      onClickCapture={noteInput}
      onKeyDownCapture={noteInput}
      style={{ "--shell-sidebar-width": `${size.width}px` } as CSSProperties}
    >
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
          <span className="shell-nav-text">orbyn</span>
        </a>
        <nav aria-label="Main">
          {composition.kind === "default" ? (
            <>
              {composition.primary.map((item) => (
                <NavSection
                  key={item.path}
                  item={item}
                  path={path}
                  onGo={close}
                  onOpenInTab={inTab}
                />
              ))}
              <MoreNavigation
                items={composition.more}
                path={path}
                onGo={close}
                onOpenInTab={inTab}
              />
              {starredLinks}
              {pinnedLinks}
            </>
          ) : (
            composition.slots.map((slot) =>
              slot.kind === "destination" ? (
                <NavLink
                  key={slot.key}
                  item={slot.item}
                  path={path}
                  onGo={close}
                  onOpenInTab={inTab}
                />
              ) : (
                <Fragment key={slot.key}>
                  {slot.kind === "starred" ? starredLinks : pinnedLinks}
                </Fragment>
              ),
            )
          )}
        </nav>
        <div className="sidebar-foot">
          <Button
            aria-label={size.rail ? "Expand navigation" : "Use icon navigation"}
            onClick={() => size.choose(size.rail ? 224 : 72)}
          >
            {size.rail ? "›" : "‹"}
            <span className="shell-nav-text">Icon rail</span>
          </Button>
          <Button
            onClick={() => setArranging(true)}
            title="Arrange navigation"
            aria-label="Arrange navigation"
          >
            ⋮<span className="shell-nav-text">Arrange</span>
          </Button>
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
                <span className="row-title shell-nav-text">
                  {user?.name || user?.email}
                </span>
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
                <button
                  onClick={() => {
                    done();
                    setShortcuts(true);
                  }}
                >
                  Keyboard shortcuts
                </button>
                <button
                  onClick={() => {
                    done();
                    requestWhatsNew();
                  }}
                >
                  What's new
                </button>
                <button
                  disabled={leaving}
                  onClick={() => {
                    done();
                    void logout();
                  }}
                >
                  <LogOut aria-hidden="true" /> Sign out
                </button>
              </>
            )}
          </Menu>
        </div>
      </aside>
      <SidebarSize
        width={size.width}
        restoreWidth={size.preferred}
        onChange={(value) => size.choose(value, false)}
        onCommit={size.choose}
      />
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
        <UpdateBanner
          prepareReload={
            prepareReload ??
            (controller
              ? () => controller.prepareAll("reload")
              : () =>
                  prepareLegacyExit({
                    current: () => generation === getSessionVersion(),
                    prepareGlobal: prepareTaskWorkspaceExit,
                  }))
          }
        />

        {size.error && (
          <p role="status" className="small muted">
            {size.error}
          </p>
        )}
        {commandMemory.error && (
          <p role="status" className="small muted">
            {commandMemory.error}
          </p>
        )}
        {feedError && <ErrorNotice message={feedError} onRetry={reloadFeed} />}
        {calendar.error && (
          <ErrorNotice message={calendar.error} onRetry={calendar.reload} />
        )}
        {leaveError && <ErrorNotice message={leaveError} />}
        <div className="shell-content">
          <main id="main" tabIndex={-1}>
            {children}
          </main>
          {notificationPin.pinned && (
            <aside
              className="shell-notifications"
              aria-label="Pinned notifications"
            >
              <Button onClick={() => notificationPin.set(false)}>
                Unpin notifications
              </Button>
              <NotificationsPanel />
            </aside>
          )}
        </div>
      </div>
      {searching && (
        <CommandBar
          isAdmin={isAdmin}
          onToggleTheme={toggleTheme}
          onClose={closeSearch}
          actions={globalActions}
          memory={commandMemory.memory}
          onPin={commandMemory.pin}
          onRun={commandMemory.record}
          openPath={
            inTab
              ? (href, mode) => inTab(href, mode === "background")
              : undefined
          }
        />
      )}
      {arranging && (
        <ArrangeNavigation
          entries={[
            ...entries,
            { key: "Starred", label: "Starred" },
            { key: "Pinned views", label: "Pinned views" },
          ]}
          onClose={() => setArranging(false)}
        />
      )}
      {shortcuts && (
        <Shortcuts commands={commands} onClose={() => setShortcuts(false)} />
      )}
      {activity && <Activity onClose={() => setActivity(false)} />}
      <GlobalOverlays />
      <TaskHost />
    </div>
  );
}
