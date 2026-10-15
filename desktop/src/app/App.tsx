import { ViewDraftStore } from "@orbyn/api-client";
import { chatgptStore } from "../lib/chatgpt";
import "./workspace.css";
import {
  type CSSProperties,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { savedSidebarWidth } from "../components/SidebarResizer";
import { Orbit, Settings, X, type LucideIcon } from "lucide-react";
import {
  dayZone,
  deadlineOf,
  itemBody,
  type ColumnChange,
  hasSystemPermission,
  hasTeamPermission,
  planDayPrompt,
  type Item,
  type ItemInput,
  type Notice,
  type Plan,
  type Status,
} from "@orbyn/core";
import { client } from "../lib/api";
import { session } from "../lib/session";
import { useConfirm } from "../components/Confirm";
import { setPageMeta } from "../lib/seo";
import { usePlanner } from "../hooks/usePlanner";
import { usePresence } from "../hooks/usePresence";
import { FocusElsewhere } from "../features/focus/FocusElsewhere";
import { WelcomeBack } from "../features/followthrough/WelcomeBack";
import { AsksPanel } from "../features/followthrough/AsksPanel";
import { useAssistant } from "../hooks/useAssistant";
import { useNewVersion } from "../hooks/useNewVersion";
import { usePlanningData } from "../hooks/usePlanningData";
import { PlanningContext } from "./planning";
import { OPEN_LINK_EVENT } from "../features/docs/DocLinks";
import {
  activeTab,
  tabsReducer,
  TAB_LIMIT,
  hasUnseenRelease,
  HttpError,
  placeOf,
  type ObjectRef,
  type StarredItem,
  type TabAction,
  type TabPlace,
} from "@orbyn/core";
import {
  deepLinkKey,
  deepLinkOf,
  deepLinkPath,
  focusDocBlock,
  deepLinkOfUrl,
  rememberDeepLink,
  takeDeepLink,
  type DeepLink,
} from "./deep-link";
import "./deep-link.css";
import { commandById, commandForKey, type CommandDef } from "./commands";
import {
  lastPage,
  PrefsContext,
  startScreen,
  useAccountPrefs,
  useStarred,
} from "./prefs";
import { isPageWindow } from "../lib/windows";
import { PageWindow } from "../features/docs/PageWindow";
import { usePlannedData } from "../hooks/usePlannedData";
import { PlanningProviders } from "./PlanningProviders";
import { Sidebar } from "../components/Sidebar";
import {
  AnnouncementBanner,
  MaintenanceBanner,
  UpdateBanner,
} from "../components/SystemBanners";
import { PageHeading, Topbar } from "../components/Topbar";
import { HomeSections, HomeTop } from "../features/overview/Home";
import { ItemEditor } from "../components/ItemEditor";
import { CommandBar } from "../components/CommandBar";
import { Celebration } from "../components/Celebration";
import { ShortcutSheet } from "../components/ShortcutSheet";
import { celebrate } from "../lib/celebrate";
import { isTyping } from "../lib/keys";
import { appliedText } from "../components/PlanCard";
import { deviceTimeZone, errorText, nextUp } from "../lib/planning";
import { HomePage } from "../features/home/HomePage";
import { LegalPage } from "../features/legal/LegalPage";
import { StudyView } from "../features/study/StudyView";
import { ConsentGate } from "../features/legal/ConsentGate";
import { StatusPage } from "../features/status/StatusPage";
import { DeveloperPage } from "../features/developers/DeveloperPage";
import { SecurityPage } from "../features/legal/SecurityPage";
import { ChangelogPage } from "../features/whatsnew/ChangelogPage";
import {
  markReleaseSeen,
  seenRelease,
  WhatsNew,
} from "../features/whatsnew/WhatsNew";
import { FirstRun } from "../features/firstrun/FirstRun";
import { SidePeek } from "../features/peek/SidePeek";
import {
  RecentChanges,
  RecentChangesDialog,
} from "../features/changes/RecentChanges";
import { PEEK_EVENT } from "../features/docs/DocLinks";
import {
  PageCommandScope,
  preparePageLeave,
  openPageCommands,
  watchOpenPage,
} from "./page-commands";
import {
  OPEN_TAB_EVENT,
  PAGE_VIEWS,
  setTabsShown,
  useTabState,
  useTabsEnabled,
  useWideEnoughForTabs,
  type TabRequest,
} from "./tabs";
import { TabStrip } from "../components/TabStrip";
import { AuthPage } from "../features/auth/AuthPage";
import {
  ForgotPasswordPage,
  ResetPasswordPage,
  VerifyEmailPage,
  VerifyGate,
} from "../features/auth/AccountFlows";
import { OverviewView } from "../features/overview/OverviewView";
import { TasksView } from "../features/tasks/TasksView";
import { ListsView } from "../features/lists/ListsView";
import type {
  AssistantSource,
  Doc,
  LegalSummary,
  SavedView,
} from "@orbyn/core";
import { DocsView } from "../features/docs/DocsView";
import { AgendaView } from "../features/docs/AgendaView";
import { ProjectsView } from "../features/projects/ProjectsView";
import { ViewsView } from "../features/views/ViewsView";
import {
  CalendarView,
  type CalendarMode,
  type PlanRequest,
} from "../features/calendar/CalendarView";
import { AssistantView } from "../features/assistant/AssistantView";
import { NotificationsView } from "../features/notifications/NotificationsView";
import { SettingsView } from "../features/settings/SettingsView";
import {
  SettingsModal,
  settingsExitAllowed,
} from "../features/settings/SettingsModal";
import { TeamsView } from "../features/teams/TeamsView";
import type { TeamActions } from "../features/teams/TeamDetail";
import { AdminView } from "../features/admin/AdminView";
import { TaskDetail } from "../features/task/TaskDetail";
import { FocusMode } from "../features/focus/FocusMode";
import {
  BookingView,
  type BookingFocus,
} from "../features/booking/BookingView";
import { PublicBooking } from "../features/booking/PublicBooking";
import { RsvpPage } from "../features/rsvp/RsvpPage";
import {
  OAuthConsentPage,
  takeOAuthReturn,
} from "../features/auth/OAuthConsent";
import type { AuthMode } from "../hooks/usePlanner";
import { PublicInvitePage } from "../features/booking/PublicInvite";
import { PublicProfilePage } from "../features/booking/PublicProfile";
import type { EditOptions, OccurrenceRef } from "../components/ScopeDialog";
import { NAV, navName, type View } from "./views";
import { ReviewView } from "../features/review/ReviewView";
import { OvernightView } from "../features/assistant/OvernightView";
import { BackgroundView } from "../features/assistant/BackgroundView";
import { onOpenReview } from "../lib/review";
import { onLive } from "../lib/live";
import "../styles/planning.css";

type ChromeAction =
  | { kind: "navigate"; view: View }
  | { kind: "search" }
  | { kind: "saved-view"; id: string }
  | { kind: "starred"; item: StarredItem };
type ChromeLocation = { view: View; savedView: string | null };
type ChromeOwner = {
  run: (action: ChromeAction) => void;
};

export function App() {
  const planner = usePlanner();
  const [chromeLocations, setChromeLocations] = useState<
    Record<string, ChromeLocation>
  >({});
  const reportChromeLocation = useCallback(
    (scope: string, location: ChromeLocation) => {
      setChromeLocations((previous) => {
        const current = previous[scope];
        return current?.view === location.view &&
          current.savedView === location.savedView
          ? previous
          : { ...previous, [scope]: location };
      });
    },
    [],
  );
  const chromeOwners = useRef(new Map<string, ChromeOwner>());
  const registerChrome = useCallback((scope: string, owner: ChromeOwner) => {
    chromeOwners.current.set(scope, owner);
    return () => {
      if (chromeOwners.current.get(scope) === owner)
        chromeOwners.current.delete(scope);
    };
  }, []);
  const dispatchChrome = (action: ChromeAction) => {
    const scope = focusedRef.current;
    if (paneVisible(scope)) chromeOwners.current.get(scope)?.run(action);
  };
  const [paired, setPaired] = useState<TabPlace | null>(null);
  const [focused, setFocused] = useState("main");
  const focusedRef = useRef("main");
  const primaryPane = useRef<HTMLDivElement>(null);
  const secondaryPane = useRef<HTMLDivElement>(null);
  const [singlePane, setSinglePane] = useState(
    () => window.matchMedia("(max-width: 1279px)").matches,
  );
  const paneState = useRef({ paired, singlePane, token: planner.token });
  paneState.current = { paired, singlePane, token: planner.token };
  const lastPaneFocus = useRef(new Map<string, HTMLElement>());
  const focusFrame = useRef<number | null>(null);
  const restoreRequested = useRef<string | null>(null);
  const paneVisible = (scope: string) =>
    scope === "main"
      ? !paneState.current.paired ||
        !paneState.current.singlePane ||
        focusedRef.current === "main"
      : !!paneState.current.paired &&
        (!paneState.current.singlePane || focusedRef.current === "secondary");
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1279px)");
    const update = () => setSinglePane(media.matches);
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    };
  }, []);
  const focusPane = (scope: string) => {
    focusedRef.current = scope;
    setFocused(scope);
  };
  const restorePaneFocus = (scope: string) => {
    restoreRequested.current = scope;
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    const account = planner.token;
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = null;
      if (
        account !== paneState.current.token ||
        focusedRef.current !== scope ||
        !paneVisible(scope)
      )
        return;
      const root =
        scope === "main" ? primaryPane.current : secondaryPane.current;
      if (!root) return;
      restoreRequested.current = null;
      const remembered = lastPaneFocus.current.get(scope);
      if (
        root &&
        remembered?.isConnected &&
        root.contains(remembered) &&
        remembered.getClientRects().length &&
        !remembered.closest("[hidden], [inert]") &&
        !remembered.matches(":disabled")
      )
        remembered.focus({ preventScroll: true });
      else root?.focus({ preventScroll: true });
    });
  };
  const capturePaneFocus = (scope: string, target: EventTarget) => {
    if (target instanceof Element && target.closest("[data-shared-chrome]"))
      return;
    if (!paneVisible(scope)) return;
    focusPane(scope);
    const root = scope === "main" ? primaryPane.current : secondaryPane.current;
    if (
      target instanceof HTMLElement &&
      target !== root &&
      root?.contains(target)
    )
      lastPaneFocus.current.set(scope, target);
  };
  useEffect(() => {
    if (restoreRequested.current === focused) restorePaneFocus(focused);
    // Retry restoration after the requested pane is committed or becomes visible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, paired, singlePane]);
  usePresence(planner.token, () => void planner.refresh({ silent: true }));
  useEffect(() => {
    setPaired(null);
    setChromeLocations({});
    lastPaneFocus.current.clear();
    restoreRequested.current = null;
    focusPane("main");
  }, [planner.token]);
  return (
    <div
      className={"workspace-duo" + (paired ? " is-paired" : "")}
      data-focused={focused}
    >
      {paired && (
        <nav className="workspace-pane-switch" aria-label="Working panes">
          <button
            aria-pressed={focused === "main"}
            onClick={() => {
              focusPane("main");
              restorePaneFocus("main");
            }}
          >
            First pane
          </button>
          <button
            aria-pressed={focused === "secondary"}
            onClick={() => {
              focusPane("secondary");
              restorePaneFocus("secondary");
            }}
          >
            Second pane
          </button>
        </nav>
      )}
      <div
        ref={primaryPane}
        tabIndex={-1}
        role={paired ? "region" : undefined}
        aria-label={paired ? "First working pane" : undefined}
        className="workspace-duo-primary"
        inert={!!paired && singlePane && focused !== "main"}
        onPointerDownCapture={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest("[data-shared-chrome]")
          )
            return;
          if (paneVisible("main")) focusPane("main");
        }}
        onFocusCapture={(event) => capturePaneFocus("main", event.target)}
      >
        <PageCommandScope.Provider value="main">
          <WorkspaceController
            planner={planner}
            registerChrome={registerChrome}
            reportChromeLocation={reportChromeLocation}
            chromeLocation={chromeLocations[focused]}
            dispatchChrome={dispatchChrome}
            ownsEvents={() =>
              paneVisible("main") && focusedRef.current === "main"
            }
            onSplit={
              paired
                ? undefined
                : (place) => {
                    setPaired(place);
                    focusPane("secondary");
                    restorePaneFocus("secondary");
                  }
            }
          />
        </PageCommandScope.Provider>
      </div>
      {paired && (
        <div
          ref={secondaryPane}
          tabIndex={-1}
          role="region"
          aria-label="Second working pane"
          className="workspace-duo-secondary"
          inert={singlePane && focused !== "secondary"}
          onPointerDownCapture={() => {
            if (paneVisible("secondary")) focusPane("secondary");
          }}
          onFocusCapture={(event) =>
            capturePaneFocus("secondary", event.target)
          }
        >
          <PageCommandScope.Provider value="secondary">
            <WorkspaceController
              planner={planner}
              registerChrome={registerChrome}
              reportChromeLocation={reportChromeLocation}
              initialPlace={paired}
              ownsEvents={() =>
                paneVisible("secondary") && focusedRef.current === "secondary"
              }
              onClosePane={() => {
                setPaired(null);
                focusPane("main");
                restorePaneFocus("main");
              }}
            />
          </PageCommandScope.Provider>
        </div>
      )}
    </div>
  );
}

function WorkspaceController({
  planner,
  initialPlace,
  ownsEvents,
  onSplit,
  onClosePane,
  registerChrome,
  reportChromeLocation,
  chromeLocation,
  dispatchChrome,
}: {
  registerChrome: (scope: string, owner: ChromeOwner) => () => void;
  reportChromeLocation: (scope: string, location: ChromeLocation) => void;
  chromeLocation?: ChromeLocation;
  dispatchChrome?: (action: ChromeAction) => void;
  planner: ReturnType<typeof usePlanner>;
  initialPlace?: TabPlace;
  ownsEvents: () => boolean;
  onSplit?: (place: TabPlace) => void;
  onClosePane?: () => void;
}) {
  const ownsEventsRef = useRef(ownsEvents);
  ownsEventsRef.current = ownsEvents;
  const secondary = !!initialPlace;
  const commandScope = useContext(PageCommandScope);
  const tabPrefix =
    commandScope === "main" ? "workspace" : `workspace-${commandScope}`;
  const panelId =
    commandScope === "main" ? "tab-panel" : `tab-panel-${commandScope}`;
  const { ask } = useConfirm();
  const nativeDesktop = location.protocol === "file:";
  const [path, setPath] = useState(secondary ? "/app" : location.pathname);
  const navigatePath = (next: string, replace = false) => {
    if (!nativeDesktop && !secondary)
      window.history[replace ? "replaceState" : "pushState"]({}, "", next);
    setPath(next);
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    if (secondary) return;
    const pop = () => setPath(location.pathname);
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const assistant = useAssistant(planner);
  const newVersion = useNewVersion();
  const {
    token,
    user,
    items,
    notices,
    teams,
    revision,
    busy,
    error,
    loading,
    act,
    refresh,
    report,
    adoptSession,
    refreshUser,
  } = planner;
  const planning = usePlanningData(token, revision, report);
  /**
   * The zone your days are read in (the account's planner zone, as the
   * server has it): the header's date and the agenda's Today. Undefined
   * until the settings load.
   */
  const accountZone = planning.prefs
    ? dayZone(planning.prefs.timezone, false, deviceTimeZone())
    : undefined;
  const planned = usePlannedData(token, revision);
  /** Choices that follow the account, and what's starred (D5). */
  const accountPrefs = useAccountPrefs(token, report);
  const starred = useStarred(token);
  /** A window showing one page alone (NAV-06), and which page. */
  const [pageWindowId] = useState<string | null>(() => {
    if (secondary || !isPageWindow()) return null;
    const open = new URLSearchParams(location.search).get("open");
    const link = open
      ? deepLinkOfUrl(open)
      : deepLinkOf(location.pathname, location.hash, location.search);
    return link?.kind === "doc" ? link.id : null;
  });
  /** Files opened with Orbyn on the desktop (CAP-11), for Docs to import. */
  const [openedFiles, setOpenedFiles] = useState<{
    files: File[];
    seq: number;
  } | null>(null);
  /** The current Terms version, to know whether to ask for agreement. */
  const [legal, setLegal] = useState<LegalSummary | null>(null);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    const check = () =>
      client
        .legal()
        .then((l) => alive && setLegal(l))
        .catch(() => {
          // Keep the last known version; the next check tries again.
        });
    void check();
    // A version published mid-session is asked for within the quarter hour.
    const timer = setInterval(() => void check(), 15 * 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [token]);
  const [view, setViewState] = useState<View>(() => {
    if (initialPlace) return initialPlace.view as View;
    try {
      return location.pathname === "/app" &&
        localStorage.getItem("orbyn-assistant-view-open") === "true"
        ? "AI assistant"
        : "Overview";
    } catch {
      return "Overview";
    }
  });
  // A late navigation read must not replace a newer tab, screen or account.
  const navigationRead = useRef(0);
  const itemRead = useRef(0);
  const sessionToken = useRef(token);
  sessionToken.current = token;
  const viewDraftReport = useRef(report);
  viewDraftReport.current = report;
  const viewDraftStore = useMemo(
    () =>
      new ViewDraftStore(
        async (id, definition) =>
          (await client.updateView(id, { definition })).definition,
        () => !!token && sessionToken.current === token,
        (error) => viewDraftReport.current(error),
      ),
    [token],
  );
  useEffect(() => {
    viewDraftStore.start();
    return () => viewDraftStore.stop();
  }, [viewDraftStore]);
  const setView = useCallback((next: View) => {
    navigationRead.current += 1;
    itemRead.current += 1;
    setViewState(next);
  }, []);
  useEffect(() => {
    navigationRead.current += 1;
    itemRead.current += 1;
    return () => {
      navigationRead.current += 1;
      itemRead.current += 1;
    };
  }, [token]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => {
    if (!settingsExitAllowed()) return false;
    setSettingsOpen(false);
    return true;
  }, []);
  useEffect(() => {
    if (!token) setSettingsOpen(false);
  }, [token]);
  // Compact layouts have no workspace tabs to restore their current screen.
  useEffect(() => {
    if (secondary) return;
    try {
      if (view === "AI assistant")
        localStorage.setItem("orbyn-assistant-view-open", "true");
      else localStorage.removeItem("orbyn-assistant-view-open");
    } catch {
      /* Storage can be disabled; the current session still works. */
    }
  }, [view]);
  /** The screen showing, for listeners that outlive a render. */
  const viewRef = useRef(view);
  viewRef.current = view;
  // Tabs (W4): on unless turned off on this device, and shown only in a
  // window wide enough for them. Narrower, one screen shows, as before.
  const tabsOn = useTabsEnabled();
  const wideEnough = useWideEnoughForTabs();
  // A window with one page alone (NAV-06) has no tabs.
  const tabsLive = tabsOn && wideEnough && !pageWindowId;
  const tabsLiveRef = useRef(tabsLive);
  tabsLiveRef.current = tabsLive;
  const tabs = useTabState({
    storageKey: commandScope === "main" ? "orbyn-tabs" : null,
    initialPlace,
  });
  useEffect(() => {
    if (!secondary) setTabsShown(tabsLive);
  }, [tabsLive, secondary]);
  /**
   * The thing a tab is opening (a page, project, view or chat): until it
   * shows, what the screens say they show is someone else's.
   */
  const pendingPlace = useRef<(TabPlace & { since: number }) | null>(null);
  /** Counts places shown from tabs, so each starts its screen afresh. */
  const [shownSeq, setShownSeq] = useState(0);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  /** The occurrence being edited, when the editor opened from a repeating entry. */
  const [editOccurrence, setEditOccurrence] = useState<OccurrenceRef | null>(
    null,
  );
  useEffect(() => {
    if (!editing) setEditOccurrence(null);
  }, [editing]);
  /** Team prefilled in the editor when a new item starts from a team page. */
  const [draftTeamId, setDraftTeamId] = useState<string | null>(null);
  /** Other prefilled fields for a new item (a meeting time, a list). */
  const [draft, setDraft] = useState<Partial<ItemInput> | null>(null);
  /** The task open in the detail panel (as last seen, in case it isn't in `items`). */
  const [openTask, setOpenTask] = useState<Item | null>(null);
  /** The time of a repeating event the task panel was opened on. */
  const [openOccurrence, setOpenOccurrence] = useState<{
    itemId: string;
    occurrence: string;
  } | null>(null);
  useEffect(() => {
    if (!openTask) setOpenOccurrence(null);
  }, [openTask]);
  /** The task in focus mode. */
  const [focusTask, setFocusTask] = useState<Item | null>(null);
  /** A meeting note opened from its event, handed to the Docs view. */
  const [noteDoc, setNoteDoc] = useState<Doc | null>(null);
  const [noteBlockId, setNoteBlockId] = useState<string | null>(null);
  const [projectToOpen, setProjectToOpen] = useState<string | null>(null);
  /** A proposal to open in Review (a link, a notice, an agent's activity). */
  const [reviewToOpen, setReviewToOpen] = useState<string | null>(null);
  const [reviewPending, setReviewPending] = useState(0);
  /** A saved view to open (from the sidebar or a link), and the one open. */
  const [overnightId, setOvernightId] = useState<string | undefined>();
  const [viewToOpen, setViewToOpen] = useState<string | null>(null);
  /** Bumped by Home's goals and routines to open the assistant's Upcoming. */
  const [upcomingAsked, setUpcomingAsked] = useState(0);
  const [shownView, setShownView] = useState<string | null>(null);
  /** Saved views pinned to the sidebar. */
  const [pinnedViews, setPinnedViews] = useState<SavedView[]>([]);
  /** Saved views' names, for their tabs. */
  const [viewNames, setViewNames] = useState<Record<string, string>>({});
  const pinnedRead = useRef(0);
  const loadPinnedViews = useCallback(() => {
    const request = ++pinnedRead.current;
    const account = sessionToken.current;
    if (!account) return;
    void client.listViews().then(
      (views) => {
        if (request !== pinnedRead.current || account !== sessionToken.current)
          return;
        setPinnedViews(views.filter((v) => v.pinned));
        setViewNames(Object.fromEntries(views.map((v) => [v.id, v.name])));
      },
      () => {
        // The sidebar goes without pins until the next try.
      },
    );
  }, []);
  useEffect(() => {
    if (token) loadPinnedViews();
    else {
      setPinnedViews([]);
      setViewNames({});
    }
    return () => {
      pinnedRead.current += 1;
    };
  }, [token, loadPinnedViews]);
  const openSavedView = (id: string) => {
    setViewToOpen(id);
    setView("Views");
  };
  const [projectSectionToOpen, setProjectSectionToOpen] = useState<
    "decisions" | "history" | null
  >(null);
  const [projectSourceId, setProjectSourceId] = useState<string | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandFocusRequest, setCommandFocusRequest] = useState(0);
  const [commandQueryRequest, setCommandQueryRequest] = useState(0);
  /** Words ⌘K opens with (a quick-add or search link). */
  const [commandQuery, setCommandQuery] = useState("");
  /** The words came from an add link: making them leads, to confirm. */
  const [commandAdd, setCommandAdd] = useState(false);
  const openCommand = (words?: string, add = false) => {
    if (words !== undefined || !commandOpen) {
      setCommandQuery(words ?? "");
      setCommandAdd(add);
      if (words !== undefined) setCommandQueryRequest((request) => request + 1);
    }
    setCommandOpen(true);
    setCommandFocusRequest((request) => request + 1);
  };
  /** Bumped to open "New page from template" or a new project from ⌘K. */
  const [templatesAsked, setTemplatesAsked] = useState(0);
  const [projectAsked, setProjectAsked] = useState(0);
  /** A template to open for review, from a "ready to start" notice. */
  const [templateToOpen, setTemplateToOpen] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /** "What's new" (DSN-03) and Recent changes (SHR-02), over the app. */
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  /** The side peek (NAV-05): what is open beside, and whether it stays. */
  const [peek, setPeek] = useState<{
    target: ObjectRef;
    pinned: boolean;
  } | null>(null);
  /** A setting ⌘K asked for (NAV-10), counted so asking again works. */
  const [settingAsked, setSettingAsked] = useState<{
    id: string;
    seq: number;
  } | null>(null);
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("month");
  const tabCalendar = useRef(
    new Map<string, { date: Date; mode: CalendarMode }>(),
  );
  useEffect(() => {
    tabCalendar.current.clear();
  }, [token]);
  const [planRequest, setPlanRequest] = useState<PlanRequest | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(savedSidebarWidth);
  // A narrow icon rail instead of the full sidebar, remembered per browser.
  const [railed, setRailed] = useState(() => {
    try {
      return localStorage.getItem("orbyn-sidebar") !== "full";
    } catch {
      return false;
    }
  });
  const toggleRail = () =>
    setRailed((was) => {
      try {
        localStorage.setItem("orbyn-sidebar", was ? "full" : "rail");
      } catch {
        // Private windows can refuse storage; the choice lasts this visit.
      }
      return !was;
    });
  /** The booking to open in the bookings inbox (from a notification). */
  const [bookingFocus, setBookingFocus] = useState<BookingFocus | null>(null);
  // Public pages from emailed links: booking pages and invitations.
  const isPublicBooking =
    !nativeDesktop &&
    ["/book/", "/rsvp/", "/invite/", "/u/"].some((p) => path.startsWith(p));

  // Connecting an app (/oauth/authorize): signing in happens in place, so
  // every parameter the app sent stays in the address.
  const isOAuth = !nativeDesktop && path === "/oauth/authorize";
  const [oauthMode, setOauthMode] = useState<AuthMode>("login");
  useEffect(() => {
    if (!token || isOAuth) return;
    // Signed in somewhere else (a reset link) while an app was waiting.
    const back = takeOAuthReturn();
    if (back) window.location.assign(back);
  }, [token]);
  useEffect(() => {
    if (token && (path === "/login" || path === "/signup"))
      navigatePath("/app", true);
    if (!token && path === "/app") navigatePath("/login", true);
  }, [token, path]);
  // A link to one thing (/app/task/<id>, /app/doc/<id>#<line>,
  // /app/project/<id>, /app/today) opens it over the app. Signed out, it
  // waits through every sign-in step (two-step and passkeys included), kept
  // for this tab and in the sign-in page's ?next=, and opens after.
  const linked = secondary
    ? null
    : deepLinkOf(
        path,
        nativeDesktop ? "" : location.hash,
        nativeDesktop ? "" : location.search,
      );
  // Read now: the sign-in redirect below replaces the address before effects.
  const signInSearch = nativeDesktop || secondary ? "" : location.search;
  const openDeepLink = async (link: DeepLink) => {
    // Document loads settle the current page immediately before adoption.
    // Other replacing links need the same departure contract as the sidebar.
    if (
      !["task", "doc", "add", "search", "agents", "chatgpt"].includes(link.kind)
    ) {
      const account = sessionToken.current;
      const request = ++navigationRead.current;
      if (
        !(await preparePageLeave(commandScope)) ||
        account !== sessionToken.current ||
        request !== navigationRead.current
      )
        return;
    }
    if (link.kind === "task") openItemById(link.id);
    else if (link.kind === "doc") openPage(link.id, link.block, true);
    else if (link.kind === "project") {
      setProjectToOpen(link.id);
      setView("Projects");
    } else if (link.kind === "add" || link.kind === "search")
      // Words to add open Quick add filled in, to confirm: never added
      // silently, whoever sent the link.
      openCommand(
        link.kind === "add" ? link.text : link.q,
        link.kind === "add",
      );
    else if (link.kind === "review") {
      // The Review inbox, at one change when the link names it.
      setReviewToOpen(link.id);
      setView("Review");
    } else if (link.kind === "view") openSavedView(link.id);
    // Settings → Connected agents: what agents did, to undo (H7).
    else if (link.kind === "agents") openSetting("agents");
    else if (link.kind === "chatgpt") {
      if (link.requestId)
        void chatgptStore
          .command({ action: "connect-request", requestId: link.requestId })
          .catch(report);
      else openSetting("chatgpt-models");
    } else if (link.kind === "assistant") setView("AI assistant");
    else if (link.kind === "overnight") {
      setOvernightId(link.id);
      setView("Overnight");
    } else setView("Overview");
  };
  // How many proposals wait, for the sidebar: read when signed in and again
  // whenever the inbox changes (an agent proposed, or another device decided).
  useEffect(() => {
    setReviewPending(0);
    if (!token) return;
    let alive = true;
    let request = 0;
    const count = () => {
      const read = ++request;
      return client.reviewCount().then(
        (r) => {
          if (alive && read === request) setReviewPending(r.pending);
        },
        () => {},
      );
    };
    void count();
    const stop = onLive(
      (news) =>
        news.kind === "changed" && news.area === "review" && void count(),
    );
    const stopOpen = onOpenReview((id) => {
      if (!ownsEventsRef.current()) return;
      setReviewToOpen(id);
      setView("Review");
    });
    return () => {
      alive = false;
      stop();
      stopOpen();
    };
  }, [token]);
  // The desktop app hands over orbyn:// links it was opened with. Signed
  // out, a link waits for sign-in, like a web link does.
  const openLinkRef = useRef<(url: string) => void>(() => {});
  openLinkRef.current = (url) => {
    const link = deepLinkOfUrl(url);
    if (!link) return;
    if (token) openDeepLink(link);
    else rememberDeepLink(link);
  };
  useEffect(
    () =>
      window.orbynDesktop?.onOpenLink((url) => {
        if (ownsEventsRef.current()) openLinkRef.current(url);
      }),
    [],
  );
  // Link pills and "Linked here" ask for things to open the same way.
  useEffect(() => {
    const open = (e: Event) => {
      if (!ownsEventsRef.current()) return;
      const url = (e as CustomEvent<unknown>).detail;
      if (typeof url === "string") openLinkRef.current(url);
    };
    window.addEventListener(OPEN_LINK_EVENT, open);
    return () => window.removeEventListener(OPEN_LINK_EVENT, open);
  }, []);
  // ⌘-click on a link, ⌘Enter in ⌘K: open it beside (NAV-05).
  useEffect(() => {
    const onPeek = (e: Event) => {
      if (!sessionToken.current || !ownsEventsRef.current()) return;
      const target = (e as CustomEvent<ObjectRef>).detail;
      itemRead.current += 1;
      navigationRead.current += 1;
      setOpenTask(null);
      setMobileNav(false);
      setPeek((was) => ({ target, pinned: was?.pinned ?? false }));
    };
    window.addEventListener(PEEK_EVENT, onPeek);
    return () => window.removeEventListener(PEEK_EVENT, onPeek);
  }, []);
  // After a release, "What's new" opens once by itself (DSN-03). A browser
  // that has never seen one (a new account, a first visit) is not shown it.
  useEffect(() => {
    if (secondary || !token || !user || user.first_run_done === false) return;
    const seen = seenRelease();
    if (!seen) markReleaseSeen();
    else if (hasUnseenRelease(seen)) setWhatsNewOpen(true);
  }, [token, user?.id, user?.first_run_done]);
  // Moving to another screen closes the peek, unless it is pinned.
  useEffect(() => {
    setPeek((p) => (p?.pinned ? p : null));
  }, [view]);
  // What opens at start on this device (NAV-12), unless a link says otherwise.
  const started = useRef(false);
  const ownedSession = useRef(token);
  useEffect(() => {
    const previous = ownedSession.current;
    ownedSession.current = token;
    if (!previous || previous === token) return;
    // Private screen intents and editors cannot survive a session change.
    started.current = false;
    pendingPlace.current = null;
    setEditing(null);
    setDraft(null);
    setDraftTeamId(null);
    setOpenTask(null);
    setOpenOccurrence(null);
    setFocusTask(null);
    setNoteDoc(null);
    setNoteBlockId(null);
    setOpenedFiles(null);
    setProjectToOpen(null);
    setProjectSectionToOpen(null);
    setProjectSourceId(null);
    setViewToOpen(null);
    setShownView(null);
    setReviewToOpen(null);
    setTemplateToOpen(null);
    setOvernightId(undefined);
    setCommandOpen(false);
    setCommandQuery("");
    setCommandAdd(false);
    setSettingsOpen(false);
    setSettingAsked(null);
    setPeek(null);
    setMobileNav(false);
    setShortcutsOpen(false);
    setWhatsNewOpen(false);
    setChangesOpen(false);
    setPlanRequest(null);
    setBookingFocus(null);
    setQuery("");
  }, [token]);
  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    if (initialPlace) {
      showPlace(initialPlace);
      return;
    }
    if (linked || pageWindowId) return;
    // Tabs kept on this device open where they were instead.
    if (tabsLive) {
      const saved = tabs.ref.current;
      const here = placeOf(activeTab(saved));
      if (saved.tabs.length > 1 || here.view !== "Overview" || here.id) {
        showPlace(here);
        return;
      }
    }
    const start = startScreen();
    if (start === "agenda") setView("Agenda");
    else if (start === "tasks") setView("My tasks");
    else if (start === "last-page") {
      const id = lastPage();
      if (id) openPage(id, null, false, true);
    }
  }, [token]);
  // Files opened with Orbyn on the desktop (CAP-11): Word and PDF go to
  // Uploads; Markdown is read by the page importer, which says first what
  // it would make.
  useEffect(() => {
    let alive = true;
    const current = () => alive && token === sessionToken.current;
    const stop = window.orbynDesktop?.onOpenFile?.((opened) => {
      if (!ownsEventsRef.current()) return;
      if (!token) {
        planner.setError("Sign in to open this file.");
        return;
      }
      const destination = navigationRead.current;
      void (async () => {
        try {
          if (opened.type === "text/markdown") {
            const input = {
              format: "markdown" as const,
              file_name: opened.name,
              data: opened.data,
            };
            const dry = await client.importPages({ ...input, dry_run: true });
            if (!current()) return;
            if (dry.errors.length || !dry.pages) {
              planner.setError(
                dry.errors.length
                  ? `Couldn't import “${opened.name}”. ${dry.errors.join(" ")}`
                  : `“${opened.name}” has no pages to import.`,
              );
              return;
            }
            const accepted = await ask({
              title: `Import ${dry.pages === 1 ? "page" : `${dry.pages} pages`}?`,
              body: `“${opened.name}” will be added to your pages.`,
              confirmLabel: "Import",
            });
            if (!accepted || !current()) return;
            const done = await client.importPages({ ...input, dry_run: false });
            if (!current()) return;
            if (done.errors.length) {
              planner.setError(
                `Import needs attention. ${done.errors.join(" ")}`,
              );
              return;
            }
            if (destination === navigationRead.current) setView("Docs");
            return;
          }
          const bytes = Uint8Array.from(atob(opened.data), (c) =>
            c.charCodeAt(0),
          );
          const file = new File([bytes], opened.name, { type: opened.type });
          if (!current()) return;
          setOpenedFiles((was) => ({
            files: [file],
            seq: (was?.seq ?? 0) + 1,
          }));
          setView("Docs");
        } catch (error) {
          if (current()) report(error);
        }
      })();
    });
    return () => {
      alive = false;
      stop?.();
    };
  }, [token, ask]);

  useEffect(() => {
    if (!linked || pageWindowId) return;
    if (!token) {
      rememberDeepLink(linked);
      navigatePath("/login", true);
      if (!nativeDesktop)
        window.history.replaceState(
          {},
          "",
          `/login?next=${encodeURIComponent(deepLinkPath(linked))}`,
        );
      return;
    }
    navigatePath("/app", true);
    openDeepLink(linked);
  }, [token, deepLinkKey(linked)]);
  useEffect(() => {
    const waiting = token ? takeDeepLink(signInSearch) : null;
    if (waiting) openDeepLink(waiting);
  }, [token]);
  useEffect(() => {
    // The primary pane owns the browser page metadata.
    if (secondary || isPublicBooking) return;
    // The same words index.html ships, so the page says one thing whether or
    // not a crawler runs the script.
    const app = "One planner for tasks, calendar, projects and notes.";
    setPageMeta(
      path === "/"
        ? {
            title: "Orbyn — Planner for tasks, calendar, projects and notes",
            description: `${app} Orbyn plans your day around them, with an AI assistant that asks first. Web, desktop, iOS and Android.`,
            index: true,
          }
        : path === "/security"
          ? {
              title: "Security and data · Orbyn",
              description:
                "How Orbyn keeps your account and your plans safe, and how you can take your data with you.",
              index: true,
            }
          : path === "/terms" || path === "/privacy"
            ? {
                title:
                  (path === "/terms" ? "Terms of Service" : "Privacy Policy") +
                  " · Orbyn",
                description:
                  path === "/terms"
                    ? "The terms for using Orbyn."
                    : "What Orbyn collects, why, how long it's kept, and your rights.",
                index: true,
              }
            : isOAuth
              ? {
                  title: "Connect an app · Orbyn",
                  description: app,
                  index: false,
                }
              : path === "/status"
                ? {
                    title: "Service status · Orbyn",
                    description: "Whether every part of Orbyn is up right now.",
                    index: false,
                  }
                : path === "/changelog"
                  ? {
                      title: "What's new · Orbyn",
                      description:
                        "Everything that changed in Orbyn: New, Better and No longer broken.",
                      index: true,
                    }
                  : path === "/developers/mcp"
                    ? {
                        title: "Orbyn for AI agents (MCP) · Orbyn",
                        description:
                          "Connect Claude, ChatGPT, Claude Code, Codex or Cursor to Orbyn over MCP: the address, signing in, limits, errors and every tool.",
                        index: true,
                      }
                    : token
                      ? {
                          title:
                            (view === "Overview" ? "Home" : view) + " · Orbyn",
                          description: app,
                          index: false,
                        }
                      : path === "/login"
                        ? {
                            title: "Sign in · Orbyn",
                            description: app,
                            index: false,
                          }
                        : {
                            title: "Create your space · Orbyn",
                            description: app,
                            index: false,
                          },
    );
  }, [path, token, view, isPublicBooking]);

  const isAdmin = hasSystemPermission(user?.role, "admin:access");

  // Leave the admin console if the user loses admin access (e.g. self-demotion).
  useEffect(() => {
    if (view === "Admin" && user && !isAdmin) setView("Overview");
  }, [view, user, isAdmin]);

  // Signing out closes the task panel, focus mode and the command bar.
  useEffect(() => {
    if (token) return;
    setOpenTask(null);
    setFocusTask(null);
    setCommandOpen(false);
  }, [token]);

  // ⌘K / Ctrl+K opens the command bar anywhere in the app. "?" shows the
  // shortcuts and N starts a new item, unless you're typing or a dialog,
  // panel or menu is open.
  const inShell = !(
    isOAuth ||
    path === "/status" ||
    path === "/developers/mcp" ||
    path === "/terms" ||
    path === "/privacy" ||
    path === "/security" ||
    path === "/changelog" ||
    path === "/forgot-password" ||
    path === "/reset-password" ||
    path === "/verify-email" ||
    (!nativeDesktop && path === "/")
  );
  useEffect(() => {
    if (!token || isPublicBooking || !inShell) return;
    // The keys come from the one command list (commands.ts), with the
    // person's own changes (NAV-09): what a key does is looked up there,
    // then run here, whichever command it is.
    const onKey = (e: KeyboardEvent) => {
      if (!ownsEventsRef.current()) return;
      if (
        e.defaultPrevented ||
        document.querySelector(
          'dialog[open], [aria-modal="true"], .popover, .select-list.is-floating',
        )
      )
        return;
      const command = commandForKey(e, accountPrefs.prefs.shortcuts);
      if (!command) return;
      const keys =
        accountPrefs.prefs.shortcuts[command.id] ?? command.keys ?? [];
      // ⌘ and Ctrl shortcuts work while typing; single keys don't, and
      // wait while a dialog or popover is open.
      const withMod = keys.includes("mod");
      if (
        !withMod &&
        (e.defaultPrevented ||
          isTyping(e) ||
          document.querySelector('[aria-modal="true"], .popover'))
      )
        return;
      if (!runCommandRef.current(command)) return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [token, isPublicBooking, inShell, accountPrefs.prefs.shortcuts]);

  /**
   * Run any command from the list, as ⌘K would: a screen, the open page's
   * own commands, a setting, or one of the app's actions. False when there
   * is nothing to run it on (a page command with no page open).
   */
  const leaveFor = async (adopt: () => void) => {
    const account = sessionToken.current;
    const request = ++navigationRead.current;
    try {
      if (
        !(await preparePageLeave(commandScope)) ||
        account !== sessionToken.current ||
        request !== navigationRead.current ||
        !chromeMounted.current
      )
        return;
      adopt();
    } catch (error) {
      if (account === sessionToken.current && chromeMounted.current)
        report(error);
    }
  };
  const runCommandRef = useRef<(c: CommandDef) => boolean>(() => false);
  runCommandRef.current = (c: CommandDef) => {
    if (c.view) {
      if (c.needs === "admin" && !isAdmin) return false;
      chromeRun.current({ kind: "navigate", view: c.view });
      return true;
    }
    if (c.needs === "page") {
      const run = openPageCommands(commandScope)?.run[c.id];
      if (!run) return false;
      run();
      return true;
    }
    if (c.setting) {
      navigate("Settings");
      setSettingAsked((was) => ({ id: c.setting!, seq: (was?.seq ?? 0) + 1 }));
      return true;
    }
    const actions: Record<string, () => void> = {
      "app.search": () => {
        if (settingsOpen && !closeSettings()) return;
        openCommand();
      },
      "app.sidebar": () => toggleRail(),
      "app.shortcuts": () => setShortcutsOpen(true),
      "app.changes": () => setChangesOpen(true),
      "app.whats-new": () => setWhatsNewOpen(true),
      "app.security": () => void leaveFor(() => navigatePath("/security")),
      "new.task": () => newItem(),
      "new.event": () => newItem(null, { kind: "event" }),
      "new.page": () => void newPage(),
      "new.from-template": () =>
        void leaveFor(() => {
          navigate("Docs");
          setTemplatesAsked(Date.now());
        }),
      "new.project": () =>
        void leaveFor(() => {
          navigate("Projects");
          setProjectAsked(Date.now());
        }),
      "new.import": () => {
        navigate("Settings");
        setSettingAsked((was) => ({ id: "import", seq: (was?.seq ?? 0) + 1 }));
      },
      "plan.day": () => void leaveFor(planMyDay),
      "plan.focus": () => {
        const next = nextUp(items, undefined, 1)[0];
        if (next) startFocus(next);
      },
      "plan.today": () =>
        void leaveFor(() => {
          navigate("Calendar");
          setCalendarDate(new Date());
          setCalendarMode("day");
        }),
    };
    const action = actions[c.id];
    if (!action) return false;
    action();
    return true;
  };

  /** Open something from the Starred group or ⌘K's starred rows (NAV-07). */
  const openStarred = (s: StarredItem) => {
    if (s.kind === "doc") openPage(s.id);
    else if (s.kind === "heading") openPage(s.id, s.block_id);
    else if (s.kind === "task") openItemById(s.id);
    else if (s.kind === "project") {
      void leaveFor(() => {
        setProjectToOpen(s.id);
        navigate("Projects");
      });
    } else if (s.kind === "view") void leaveFor(() => openSavedView(s.id));
  };

  const newItem = (
    teamId: string | null = null,
    prefill: Partial<ItemInput> | null = null,
  ) => {
    setDraftTeamId(teamId ?? prefill?.team_id ?? null);
    setDraft(prefill);
    setEditing("new");
  };

  /** A new page (titled when ⌘K's Shift+Enter named it), opened. */
  const creatingPage = useRef(false);
  const newPage = async (title = "") => {
    if (creatingPage.current) return;
    creatingPage.current = true;
    const account = token;
    const request = ++navigationRead.current;
    const current = () =>
      account === sessionToken.current && request === navigationRead.current;
    try {
      if (!(await preparePageLeave(commandScope)) || !current()) return;
      const doc = await client.createDoc({
        title,
        kind: "doc",
        content: [{ type: "paragraph", text: "" }],
      });
      if (!current() || !(await preparePageLeave(commandScope)) || !current())
        return;
      setNoteBlockId(null);
      setNoteDoc(doc);
      navigate("Docs");
    } catch (e) {
      if (current()) report(e);
    } finally {
      creatingPage.current = false;
    }
  };

  const openPage = (
    docId: string,
    blockId?: string | null,
    forEditor = false,
    quiet = false,
  ) => {
    const request = ++navigationRead.current;
    const account = token;
    const current = () =>
      request === navigationRead.current && account === sessionToken.current;
    const load = forEditor
      ? client.getDocForEditor(docId)
      : client.getDoc(docId);
    void load
      .then(async (doc) => {
        if (!current() || !(await preparePageLeave(commandScope)) || !current())
          return;
        setNoteBlockId(blockId ?? null);
        setNoteDoc(doc);
        setView("Docs");
        const adopted = navigationRead.current;
        if (blockId)
          focusDocBlock(
            blockId,
            40,
            () =>
              adopted === navigationRead.current &&
              account === sessionToken.current,
          );
      })
      .catch((error) => {
        if (current() && !quiet) report(error);
      });
  };

  /** Open a fact the assistant read at its task, page, or project section. */
  const openSource = (source: AssistantSource) => {
    if ("doc_id" in source) {
      openPage(source.doc_id, source.block_id);
    } else if (source.kind === "task") {
      openItemById(source.id);
    } else if (source.project_id) {
      const projectId = source.project_id;
      void leaveFor(() => {
        setProjectToOpen(projectId);
        setProjectSectionToOpen(
          source.kind === "decision" ? "decisions" : "history",
        );
        setProjectSourceId(source.id);
        setView("Projects");
      });
    }
  };

  /** Personal pages are always yours; a team's need `items:write`. */
  const canWriteIn = (teamId: string | null) =>
    !teamId ||
    hasTeamPermission(teams.find((t) => t.id === teamId)?.role, "items:write");

  /** Personal items are always yours; team items need `items:write`. */
  const canWrite = (i: Item) => {
    if (!i.team_id) return true;
    const team = teams.find((t) => t.id === i.team_id);
    return hasTeamPermission(team?.role, "items:write");
  };

  /** Viewers can't change team items; say so instead of letting the server reject it. */
  const guard = (i: Item) => {
    if (canWrite(i)) return true;
    const team = teams.find((t) => t.id === i.team_id);
    planner.setError(
      `View only — you're a viewer in ${team?.name ?? i.team_name ?? "this team"}.`,
    );
    return false;
  };

  const toggle = (i: Item) => {
    if (guard(i)) void planner.toggleItem(i);
  };

  const setStatus = (i: Item, status: Status) => {
    if (status !== i.status && guard(i)) void planner.setItemStatus(i, status);
  };

  /**
   * A card dragged to another board column (DATA-03): its list, priority,
   * assignee or tags change, saved against the version it was shown at.
   */
  const saveItemChange = async (
    i: Item,
    change: ColumnChange | Partial<ItemInput>,
  ) => {
    const owner = sessionToken.current;
    // Handing a task to your agent or taking it back (W3), and giving it
    // to someone at the same time.
    if ("agent" in change) {
      const { agent, ...rest } = change;
      const after =
        agent === "hand"
          ? await client.handTaskToAgent(i.id)
          : await client.takeTaskBack(i.id);
      if (sessionToken.current !== owner) return;
      if ("assignee_id" in rest)
        await client.updateItem(i.id, {
          ...itemBody(after),
          assignee_id: rest.assignee_id ?? null,
        });
    } else await client.updateItem(i.id, { ...itemBody(i), ...change });
    if (sessionToken.current === owner) await refresh();
  };
  const changeItem = (i: Item, change: ColumnChange | Partial<ItemInput>) => {
    if (guard(i)) void act(() => saveItemChange(i, change));
  };
  const changeItemResult = (i: Item, change: Partial<ItemInput>) =>
    guard(i)
      ? planner.actResult(() => saveItemChange(i, change))
      : Promise.resolve(false);
  const setStatusResult = (i: Item, status: Status) => {
    if (!guard(i)) return Promise.resolve(false);
    return status === i.status
      ? Promise.resolve(true)
      : planner.setItemStatusResult(i, status);
  };
  const toggleResult = (i: Item) =>
    setStatusResult(
      i,
      i.status !== "done"
        ? "done"
        : (i.progress ?? 0) > 0
          ? "in_progress"
          : "todo",
    );

  /**
   * Opens an item in the task panel. Opened on one time of a repeating
   * event (a class), that time is kept, so its meeting note is that class's.
   */
  const openItem = (i: Item, occurrence?: OccurrenceRef) => {
    itemRead.current += 1;
    navigationRead.current += 1;
    setPeek(null);
    setMobileNav(false);
    setOpenTask(i);
    setOpenOccurrence(
      occurrence ? { itemId: i.id, occurrence: occurrence.occurrence } : null,
    );
  };
  const closeTask = useCallback(() => {
    itemRead.current += 1;
    navigationRead.current += 1;
    setOpenTask(null);
  }, []);
  const closeFocus = useCallback(() => setFocusTask(null), []);
  const startFocus = (i: Item) => {
    itemRead.current += 1;
    navigationRead.current += 1;
    setPeek(null);
    setMobileNav(false);
    setOpenTask(null);
    setFocusTask(i);
  };
  // Prefer the freshest copy from the planner list.
  const shownTask = openTask
    ? (items.find((i) => i.id === openTask.id) ?? openTask)
    : null;
  const shownFocus = focusTask
    ? (items.find((i) => i.id === focusTask.id) ?? focusTask)
    : null;

  const teamActions: TeamActions = {
    user,
    busy,
    revision,
    act,
    refresh,
    report,
    onOpenItem: openItem,
    canWrite,
    onNewTeamItem: newItem,
    onToggle: toggle,
  };

  const navigate = (v: View) => {
    if (v === "Settings") {
      navigationRead.current += 1;
      setSettingsOpen(true);
      setMobileNav(false);
      return;
    }
    if (settingsOpen && !closeSettings()) return;
    if (v === "Overnight") setOvernightId(undefined);
    // A failure belongs to the view it happened in.
    if (v !== view) planner.setError("");
    setView(v);
    setMobileNav(false);
    setQuery("");
    setPlanRequest(null);
    setBookingFocus(null);
  };

  const chromeNavigation = useRef(false);
  const chromeMounted = useRef(true);
  const chromeRun = useRef<(action: ChromeAction) => void>(() => {});
  chromeRun.current = (action) => {
    if (action.kind === "search") {
      openCommand();
      return;
    }
    if (chromeNavigation.current) return;
    chromeNavigation.current = true;
    const account = sessionToken.current;
    const navigation = navigationRead.current;
    void (async () => {
      try {
        // Settings and task details overlay the current work; other destinations
        // must let the pane's editors save or reject leaving their draft.
        const overlays =
          (action.kind === "navigate" && action.view === "Settings") ||
          (action.kind === "starred" && action.item.kind === "task");
        if (!overlays && !(await preparePageLeave(commandScope))) return;
        if (
          account !== sessionToken.current ||
          navigation !== navigationRead.current ||
          !chromeMounted.current ||
          !ownsEventsRef.current()
        )
          return;
        if (action.kind === "navigate") navigate(action.view);
        else if (action.kind === "saved-view") openSavedView(action.id);
        else openStarred(action.item);
      } catch (error) {
        if (account === sessionToken.current) report(error);
      } finally {
        chromeNavigation.current = false;
      }
    })();
  };
  useEffect(() => {
    chromeMounted.current = true;
    const unregister = registerChrome(commandScope, {
      run: (action) => chromeRun.current(action),
    });
    return () => {
      chromeMounted.current = false;
      unregister();
    };
  }, [commandScope, registerChrome]);
  useEffect(() => {
    reportChromeLocation(commandScope, { view, savedView: shownView });
  }, [commandScope, view, shownView, reportChromeLocation]);
  const chrome = (action: ChromeAction) => {
    if (dispatchChrome) dispatchChrome(action);
    else chromeRun.current(action);
  };

  // ── Tabs (W4) ─────────────────────────────────────────────────────────
  // Each tab is a screen and the thing open there. The app shows one place
  // at a time as before; the active tab follows wherever it goes, and
  // choosing a tab (or going back in one) shows that tab's place.

  /** A screen says what it shows now: the active tab follows. */
  const reportPlace = (place: TabPlace) => {
    if (!tabsLiveRef.current) return;
    const waiting = pendingPlace.current;
    if (waiting) {
      const same = waiting.view === place.view && waiting.id === place.id;
      // Something else, while a tab's own thing is still on its way.
      if (!same && Date.now() - waiting.since < 8000) return;
      pendingPlace.current = null;
    }
    tabs.act({ type: "go", place });
    if (place.id && place.title)
      tabs.act({
        type: "retitle",
        view: place.view,
        id: place.id,
        title: place.title,
      });
  };

  const tabPlaceRead = useRef(0);
  useEffect(() => {
    tabPlaceRead.current += 1;
    return () => {
      tabPlaceRead.current += 1;
    };
  }, [token]);

  /** Show a tab's place: its screen, afresh, with its thing open. */
  const showPlace = (place: TabPlace) => {
    const request = ++tabPlaceRead.current;
    const next = place.view as View;
    if (next === "Settings") {
      setSettingsOpen(true);
      setMobileNav(false);
      return;
    }
    if (next !== view) planner.setError("");
    setMobileNav(false);
    setQuery("");
    setPlanRequest(null);
    setBookingFocus(null);
    setNoteDoc(null);
    setNoteBlockId(null);
    setProjectToOpen(null);
    setProjectSectionToOpen(null);
    setProjectSourceId(null);
    setTemplateToOpen(null);
    setViewToOpen(null);
    setShownSeq((n) => n + 1);
    setView(next);
    const navigation = navigationRead.current;
    const id = place.id;
    pendingPlace.current = id ? { ...place, since: Date.now() } : null;
    const missed = () => {
      // Gone or out of reach: the screen shows without it, quietly.
      if (request === tabPlaceRead.current && pendingPlace.current?.id === id)
        pendingPlace.current = null;
    };
    if (!id) {
      // A tab on the assistant with no chat yet is a new chat.
      if (next === "AI assistant" && assistant.activeChatId) assistant.reset();
      return;
    }
    if (PAGE_VIEWS.includes(next))
      void client.getDoc(id).then((doc) => {
        const current = placeOf(activeTab(tabs.ref.current));
        if (
          request !== tabPlaceRead.current ||
          navigation !== navigationRead.current ||
          !tabsLiveRef.current ||
          current.view !== next ||
          current.id !== id
        )
          return;
        setNoteBlockId(null);
        setNoteDoc(doc);
      }, missed);
    else if (next === "Projects") setProjectToOpen(id);
    else if (next === "Views") setViewToOpen(id);
    else if (next === "AI assistant") {
      if (assistant.activeChatId === id) pendingPlace.current = null;
      else void assistant.openChat(id).catch(missed);
    } else pendingPlace.current = null;
  };

  /** Change the tabs as the person asked, and show what came to the front. */
  const tabActNow = (action: TabAction) => {
    if (!tabsLive) return false;
    if (action.type === "open" && tabs.ref.current.tabs.length >= TAB_LIMIT) {
      planner.setError(
        `Close a tab before opening another. Maximum ${TAB_LIMIT} tabs.`,
      );
      return false;
    }
    if (settingsOpen && !closeSettings()) return false;
    if (action.type === "select") {
      const selected = tabs.ref.current.tabs.find(
        (tab) => tab.key === action.key,
      );
      if (selected && placeOf(selected).view === "Settings") {
        navigate("Settings");
        return false;
      }
    }
    const before = activeTab(tabs.ref.current);
    const was = placeOf(before);
    tabCalendar.current.set(before.key, {
      date: calendarDate,
      mode: calendarMode,
    });
    const state = tabs.act(action);
    const after = activeTab(state);
    if (after.key !== before.key) {
      const saved = tabCalendar.current.get(after.key);
      setCalendarDate(saved?.date ?? new Date());
      setCalendarMode(saved?.mode ?? "month");
    }
    // Recently closed tabs retain their calendar state for Reopen closed tab.
    const retained = new Set(
      [...state.tabs, ...state.closed].map((tab) => tab.key),
    );
    for (const key of tabCalendar.current.keys())
      if (!retained.has(key)) tabCalendar.current.delete(key);
    if (after.key !== before.key || placeOf(after) !== was)
      showPlace(placeOf(after));
    return true;
  };
  const tabNavigation = useRef(0);
  const tabAct = async (action: TabAction) => {
    const request = ++tabNavigation.current;
    const before = tabs.ref.current;
    const currentTab = activeTab(before);
    const currentPlace = placeOf(currentTab);
    const projected = tabsReducer(before, action);
    const nextTab = activeTab(projected);
    const nextPlace = placeOf(nextTab);
    const leavesPage =
      nextTab.key !== currentTab.key ||
      nextPlace.view !== currentPlace.view ||
      nextPlace.id !== currentPlace.id;
    if (leavesPage) {
      const account = sessionToken.current;
      const navigation = navigationRead.current;
      const allowed = await preparePageLeave(commandScope);
      if (
        request !== tabNavigation.current ||
        account !== sessionToken.current ||
        navigation !== navigationRead.current ||
        !chromeMounted.current
      )
        return false;
      if (!allowed) return false;
    }
    return tabActNow(action);
  };
  const tabActRef = useRef(tabAct);
  tabActRef.current = tabAct;

  const closingPane = useRef(false);
  const paneClosureState = useRef({
    busy,
    assistant,
    editing,
    settingsOpen,
    viewDraftStore,
  });
  paneClosureState.current = {
    busy,
    assistant,
    editing,
    settingsOpen,
    viewDraftStore,
  };
  const paneClosureBlocked = () => {
    const latest = paneClosureState.current;
    return (
      latest.busy ||
      latest.assistant.thinking ||
      !!latest.editing ||
      latest.settingsOpen ||
      latest.assistant.runProgress?.state === "waiting" ||
      latest.assistant.runProgress?.state === "running" ||
      !!latest.viewDraftStore.creation ||
      latest.viewDraftStore.drafts.size > 0
    );
  };
  const closePane = async () => {
    if (!onClosePane || closingPane.current) return;
    if (paneClosureBlocked()) {
      planner.setError("Finish the open edit before closing this pane.");
      return;
    }
    closingPane.current = true;
    const account = sessionToken.current;
    try {
      if (
        !(await preparePageLeave(commandScope)) ||
        account !== sessionToken.current ||
        paneClosureBlocked()
      )
        return;
      const draft = paneClosureState.current.assistant.message;
      if (
        draft.trim() &&
        !(await ask({
          title: "Discard this unsent message?",
          confirmLabel: "Discard",
          destructive: true,
        }))
      )
        return;
      if (
        account === sessionToken.current &&
        !paneClosureBlocked() &&
        draft === paneClosureState.current.assistant.message
      )
        onClosePane();
    } finally {
      closingPane.current = false;
    }
  };

  /** A thing's current name (a page's title, a project's name). */
  const titleFor = (place: TabPlace): Promise<string> => {
    const id = place.id;
    if (!id) return Promise.resolve("");
    if (PAGE_VIEWS.includes(place.view as View))
      return client.getDoc(id).then((d) => d.title || "Untitled");
    if (place.view === "Projects")
      return client.getProject(id).then((p) => p.name);
    if (place.view === "Views")
      return client.listViews().then((list) => {
        const found = list.find((v) => v.id === id);
        if (!found) throw new HttpError(404, "That view is gone.");
        return found.name;
      });
    if (place.view === "AI assistant") return client.aiChat(id).then(() => "");
    return Promise.resolve("");
  };

  // Moving to another screen is a step in the active tab. Turning tabs on
  // (or widening the window) starts the tab where the app already is.
  const lastView = useRef(view);
  const lastLive = useRef(tabsLive);
  useEffect(() => {
    const moved = lastView.current !== view;
    const turnedOn = tabsLive && !lastLive.current;
    lastView.current = view;
    lastLive.current = tabsLive;
    if (!tabsLive || !(moved || turnedOn)) return;
    const here = placeOf(activeTab(tabs.ref.current));
    if (here.view === view) return;
    pendingPlace.current = null;
    tabs.act({ type: "go", place: { view, id: null, title: "" } });
  }, [view, tabsLive, tabs]);

  // The page open in Docs (or Memory, or Agent notes), and its title.
  const pageTab = useRef<string | null>(null);
  /** The app's frame; gone while a gate (terms, sign-in) stands in for it. */
  const shellEl = useRef<HTMLDivElement | null>(null);
  useEffect(
    () =>
      watchOpenPage((page) => {
        const here = viewRef.current;
        if (!tabsLiveRef.current || !PAGE_VIEWS.includes(here)) return;
        const key = tabs.ref.current.active;
        if (page) {
          pageTab.current = key;
          reportPlace({ view: here, id: page.docId, title: page.title });
        } else if (
          pageTab.current === key &&
          !pendingPlace.current &&
          shellEl.current
        )
          // Back to the library, in the same tab.
          reportPlace({ view: here, id: null, title: "" });
      }, commandScope),
    [commandScope], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // The chat open in the assistant.
  useEffect(() => {
    if (!tabsLive || view !== "AI assistant") return;
    const chat = assistant.activeChatId;
    const waiting = pendingPlace.current;
    if (waiting?.view === "AI assistant" && waiting.id === chat)
      pendingPlace.current = null;
    const here = placeOf(activeTab(tabs.ref.current));
    if (here.view !== "AI assistant" || here.id === chat) return;
    if (pendingPlace.current) {
      if (Date.now() - pendingPlace.current.since < 8000) return;
      pendingPlace.current = null;
    }
    tabs.act({
      type: "replace",
      place: { view: "AI assistant", id: chat, title: "" },
    });
  }, [tabsLive, view, assistant.activeChatId, tabs]);

  // Saved views' names reach their tabs once the list has them.
  useEffect(() => {
    for (const [id, title] of Object.entries(viewNames))
      tabs.act({ type: "retitle", view: "Views", id, title });
  }, [viewNames]); // eslint-disable-line react-hooks/exhaustive-deps

  // Kept tabs whose thing is gone (deleted, or no longer shared) close,
  // without a word, once signed in.
  useEffect(() => {
    if (!token || !tabsLive) return;
    let alive = true;
    const gone = (e: unknown) =>
      e instanceof HttpError && [403, 404, 410].includes(e.statusCode);
    void Promise.all(
      tabs.ref.current.tabs.map(async (tab) => {
        const place = placeOf(tab);
        if (!place.id) return null;
        try {
          const title = await titleFor(place);
          if (alive && title)
            tabs.act({
              type: "retitle",
              view: place.view,
              id: place.id,
              title,
            });
          return null;
        } catch (e) {
          return gone(e) ? { key: tab.key, place } : null;
        }
      }),
    ).then((results) => {
      if (!alive) return;
      const drop = results.flatMap((result) => {
        if (!result) return [];
        const current = tabs.ref.current.tabs.find(
          (tab) => tab.key === result.key,
        );
        if (!current) return [];
        const place = placeOf(current);
        return place.view === result.place.view && place.id === result.place.id
          ? [result.key]
          : [];
      });
      if (drop.length) tabActRef.current({ type: "drop", keys: drop });
    });
    return () => {
      alive = false;
    };
  }, [token, tabsLive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Asked for a new tab: ⌘-click, a middle click, or "Open in new tab".
  const openTabRef = useRef<(request: TabRequest) => void>(() => {});
  openTabRef.current = (request) => {
    if (!tabsLive) return;
    const place: TabPlace =
      request.kind === "screen"
        ? { view: request.view, id: null, title: "" }
        : {
            view:
              request.kind === "doc"
                ? "Docs"
                : request.kind === "project"
                  ? "Projects"
                  : "Views",
            id: request.id,
            title:
              request.title ??
              (request.kind === "view" ? (viewNames[request.id] ?? "") : ""),
          };
    tabAct({ type: "open", place, background: true });
    const account = token;
    if (place.id && !place.title)
      void titleFor(place).then(
        (title) =>
          title &&
          account === sessionToken.current &&
          tabs.act({ type: "retitle", view: place.view, id: place.id!, title }),
        () => {
          // Its name shows once the tab is opened.
        },
      );
  };
  useEffect(() => {
    const onOpen = (e: Event) => {
      if (ownsEventsRef.current())
        openTabRef.current((e as CustomEvent<TabRequest>).detail);
    };
    window.addEventListener(OPEN_TAB_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_TAB_EVENT, onOpen);
  }, []);

  // The browser's back and forward move through the active tab: each step
  // in a tab is a step in the browser's history (the address stays /app).
  const historyAt = useRef<number>(
    typeof window.history.state?.orbynTab === "number"
      ? window.history.state.orbynTab
      : 0,
  );
  const movesSeen = useRef(tabs.state.moves);
  useEffect(() => {
    if (tabs.state.moves === movesSeen.current) return;
    movesSeen.current = tabs.state.moves;
    if (
      secondary ||
      !tabsLive ||
      nativeDesktop ||
      !location.pathname.startsWith("/app")
    )
      return;
    historyAt.current += 1;
    window.history.pushState({ orbynTab: historyAt.current }, "");
  }, [tabs.state.moves, tabsLive, nativeDesktop]);
  useEffect(() => {
    if (secondary || !tabsLive || nativeDesktop) return;
    const pop = async (e: PopStateEvent) => {
      if (!location.pathname.startsWith("/app")) return;
      const state = e.state as { orbynTab?: unknown } | null;
      const at = typeof state?.orbynTab === "number" ? state.orbynTab : 0;
      const steps = at - historyAt.current;
      historyAt.current = at;
      for (let i = 0; i < Math.abs(steps); i++) {
        const moved = await tabActRef.current({
          type: steps < 0 ? "back" : "forward",
        });
        if (!moved) {
          // Return the browser to the accepted position when a draft blocks it.
          const remaining = Math.sign(steps) * (Math.abs(steps) - i);
          historyAt.current -= remaining;
          window.history.go(-remaining);
          break;
        }
      }
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [tabsLive, nativeDesktop]);

  // ⌘W (Ctrl+W) closes the tab, ⌘⇧T brings the last one back, and
  // Ctrl+Tab / Ctrl+Shift+Tab go round them.
  useEffect(() => {
    if (!token || !tabsLive || isPublicBooking || !inShell) return;
    const mac = /Mac|iPhone|iPad/.test(navigator.userAgent);
    const onKey = (e: KeyboardEvent) => {
      if (!ownsEventsRef.current()) return;
      if (
        e.defaultPrevented ||
        e.altKey ||
        document.querySelector(
          'dialog[open], [aria-modal="true"], .popover, .select-list.is-floating',
        )
      )
        return;
      const mod = mac ? e.metaKey : e.ctrlKey;
      const key = e.key.toLowerCase();
      const now = tabs.ref.current;
      let action: TabAction | null = null;
      if (e.ctrlKey && key === "tab" && now.tabs.length > 1)
        action = { type: "cycle", step: e.shiftKey ? -1 : 1 };
      else if (mod && !e.shiftKey && key === "w" && now.tabs.length > 1)
        action = { type: "close", key: now.active };
      else if (mod && e.shiftKey && key === "t" && now.closed.length)
        action = { type: "reopen" };
      if (!action) return;
      e.preventDefault();
      tabActRef.current(action);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [token, tabsLive, isPublicBooking, inShell]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A tab's name: the thing's own, else its screen's. */
  const tabTitle = (place: TabPlace) =>
    place.view === "AI assistant"
      ? assistant.agentName
      : place.title || navName(place.view as View, assistant.agentName);
  const tabIcon = (place: TabPlace): LucideIcon =>
    place.view === "Settings"
      ? Settings
      : (NAV.find((n) => n.label === place.view)?.icon ?? Orbit);

  /** Settings, at one setting ("agents": Connected agents). */
  const openSetting = (id: string) => {
    navigate("Settings");
    setSettingAsked((was) => ({ id, seq: (was?.seq ?? 0) + 1 }));
  };

  /** The bookings inbox, with one booking open. */
  const openBooking = (id: string) => {
    navigate("Booking");
    setBookingFocus({ id, key: Date.now() });
  };

  /** Shows a plan in the calendar's planner (from the assistant). */
  const openPlan = (plan: Plan) => {
    navigate("Calendar");
    setPlanRequest({ key: Date.now(), plan });
  };
  /** "Plan my day": today in the calendar with a plan preview. */
  const planMyDay = () => {
    navigate("Calendar");
    setCalendarDate(new Date());
    setCalendarMode("day");
    setPlanRequest({ key: Date.now(), days: 1 });
  };
  const applyPlan = async (plan: Plan, moves?: string[]) => {
    const result = await client.applyPlan(plan.id, moves ? { moves } : {});
    await refresh();
    return appliedText(result, plan);
  };
  /**
   * "Roll forward" on a notice: a plan for unfinished blocks (all of them,
   * or those named: "Plan again" on Today), in the calendar.
   */
  const rollForward = async (blockIds?: string[]) => {
    try {
      openPlan(await client.rollForward(blockIds));
    } catch (e) {
      report(e);
    }
  };
  /**
   * "Plan it" on a notice: a preview that includes the task, looking ahead
   * as far as its deadline (days counted in the planner's zone). On a Today
   * row (`only`) the preview plans that task alone, as "Find time before
   * the deadline" does.
   */
  const planTask = (itemId: string, only = false) => {
    const item = items.find((i) => i.id === itemId);
    navigate("Calendar");
    setPlanRequest({
      key: Date.now(),
      until: item ? deadlineOf(item) : undefined,
      ...(only ? { only: [itemId] } : { include: [itemId] }),
    });
  };
  const planIt = (n: Notice) => {
    if (n.item_id) planTask(n.item_id);
  };
  /**
   * "Find time before the deadline" on a task: the calendar's planner,
   * previewing only this task over the days up to its deadline.
   */
  const findTimeFor = (item: Item) => {
    closeTask();
    navigate("Calendar");
    setPlanRequest({
      key: Date.now(),
      until: deadlineOf(item),
      only: [item.id],
    });
  };
  /** "Show on calendar" on a session: its week, with the task panel closed. */
  const showOnCalendar = (at: string) => {
    closeTask();
    navigate("Calendar");
    setCalendarDate(new Date(at));
    if (calendarMode === "month" || calendarMode === "agenda")
      setCalendarMode("week");
  };
  /** Opens an item by id (from a notice), fetching it if the list doesn't have it. */
  const openItemById = (id: string) => {
    const request = ++itemRead.current;
    navigationRead.current += 1;
    const account = token;
    const current = () =>
      request === itemRead.current && account === sessionToken.current;
    setOpenOccurrence(null);
    setPeek(null);
    setMobileNav(false);
    const found = items.find((i) => i.id === id);
    if (found) setOpenTask(found);
    else {
      setOpenTask(null);
      void client.getItem(id).then(
        (item) => {
          if (current()) setOpenTask(item);
        },
        (error) => {
          if (current()) report(error);
        },
      );
    }
  };
  /** Shows a day in the calendar (from an event search result). */
  const jumpToDate = (day: Date) => {
    navigate("Calendar");
    setCalendarDate(day);
    setCalendarMode("day");
  };
  const reschedule = async (n: Notice) => {
    if (!n.ref) return;
    try {
      await client.rescheduleBlock(n.ref);
      await refresh();
    } catch (e) {
      report(e);
    }
  };

  const saveItem = (data: ItemInput, options: EditOptions = {}) => {
    if (!editing) return;
    const target = editing;
    const account = sessionToken.current;
    const current = () =>
      sessionToken.current === account && session.get() === account;
    return act(async () => {
      if (!current()) return;
      if (target === "new") await client.createItem(data);
      else {
        const saved = await client.updateItem(
          target.id,
          { ...data, status: target.status, version: target.version },
          options,
        );
        if (!current()) return;
        // Keep the form mounted and advance its revision if the separate status write fails.
        setEditing(saved);
        if (data.status !== target.status) {
          try {
            await client.postItemUpdate(target.id, { status: data.status });
          } catch (e) {
            if (current())
              throw new Error(
                `Item saved. Status update failed: ${errorText(e)}`,
              );
            return;
          }
          if (!current()) return;
          if (data.status === "done") celebrate();
        }
      }
      if (!current()) return;
      setEditing(null);
      try {
        await refresh();
      } catch {
        if (current())
          report(
            new Error("Item saved. Refresh your planner to update the list."),
          );
      }
    });
  };

  const deleteItem = (options: EditOptions = {}) => {
    if (!editing || editing === "new") return;
    const target = editing,
      account = sessionToken.current;
    const current = () =>
      sessionToken.current === account && session.get() === account;
    return act(async () => {
      if (!current()) return;
      await client.deleteItem(target.id, target.version, options);
      if (!current()) return;
      setEditing(null);
      if (openTask?.id === target.id) setOpenTask(null);
      try {
        await refresh();
      } catch {
        if (current())
          report(
            new Error("Item deleted. Refresh your planner to update the list."),
          );
      }
    });
  };

  // What's new, every release: public, signed in or not (DSN-03).
  if (path === "/changelog")
    return (
      <ChangelogPage
        signedIn={!!token}
        onNavigate={navigatePath}
        onHome={nativeDesktop ? undefined : () => navigatePath("/")}
      />
    );

  // Security and data: public, signed in or not.
  if (path === "/security")
    return (
      <SecurityPage
        signedIn={!!token}
        onNavigate={navigatePath}
        onHome={nativeDesktop ? undefined : () => navigatePath("/")}
      />
    );

  // Public status page, signed in or not. The native app routes in memory.
  if (path === "/status")
    return (
      <StatusPage
        signedIn={!!token}
        onNavigate={navigatePath}
        onHome={nativeDesktop ? undefined : () => navigatePath("/")}
      />
    );

  // The developer page: public, signed in or not.
  if (path === "/developers/mcp")
    return (
      <DeveloperPage
        signedIn={!!token}
        onNavigate={navigatePath}
        onHome={nativeDesktop ? undefined : () => navigatePath("/")}
      />
    );

  // Terms and Privacy: public, signed in or not.
  if (path === "/terms" || path === "/privacy")
    return (
      <LegalPage
        doc={path === "/terms" ? "terms" : "privacy"}
        signedIn={!!token}
        onNavigate={navigatePath}
        onHome={nativeDesktop ? undefined : () => navigatePath("/")}
      />
    );

  // Public booking pages: no sign-in, no app shell.
  if (isPublicBooking)
    return path.startsWith("/rsvp/") ? (
      <RsvpPage path={path} onHome={() => navigatePath("/")} />
    ) : path.startsWith("/invite/") ? (
      <PublicInvitePage path={path} onHome={() => navigatePath("/")} />
    ) : path.startsWith("/u/") ? (
      <PublicProfilePage path={path} onHome={() => navigatePath("/")} />
    ) : (
      <PublicBooking path={path} onHome={() => navigatePath("/")} />
    );

  if (!nativeDesktop && path === "/")
    return <HomePage signedIn={!!token} onNavigate={navigatePath} />;

  // Account-flow pages reached from an email link or the sign-in page. They
  // work signed in or not; the token comes from the link's query string.
  if (path === "/forgot-password")
    return (
      <ForgotPasswordPage
        onNavigate={navigatePath}
        onHome={nativeDesktop ? undefined : () => navigatePath("/")}
      />
    );
  if (path === "/reset-password")
    return (
      <ResetPasswordPage
        token={new URLSearchParams(location.search).get("token") ?? ""}
        onAuthed={(result) => {
          adoptSession(result);
          navigatePath("/app", true);
        }}
        onNavigate={navigatePath}
        onHome={nativeDesktop ? undefined : () => navigatePath("/")}
      />
    );
  if (path === "/verify-email")
    return (
      <VerifyEmailPage
        token={new URLSearchParams(location.search).get("token") ?? ""}
        signedIn={!!token}
        onVerified={() => void refreshUser()}
        onNavigate={navigatePath}
        onHome={nativeDesktop ? undefined : () => navigatePath("/")}
      />
    );

  // Signed in but the email isn't confirmed yet: hold at the gate.
  if (token && user && !user.email_verified && secondary) return null;
  if (token && user && !user.email_verified)
    return (
      <VerifyGate
        email={user.email}
        onContinue={() => void refreshUser()}
        onLogout={() => void planner.logout()}
      />
    );

  // Signed in but not on the current Terms: ask before the app.
  if (
    secondary &&
    token &&
    user &&
    legal &&
    user.terms_version !== legal.terms_version
  )
    return null;
  if (token && user && legal && user.terms_version !== legal.terms_version)
    return (
      <ConsentGate
        user={user}
        legal={legal}
        onAccepted={() => void refreshUser()}
        onLogout={() => void planner.logout()}
      />
    );

  if (isOAuth)
    return (
      <OAuthConsentPage
        signedIn={!!token}
        user={user}
        onSwitchAccount={() => void planner.logout()}
        signIn={(notice) => (
          <AuthPage
            key={oauthMode}
            notice={notice}
            initialMode={oauthMode}
            onSwitchMode={() =>
              setOauthMode((m) => (m === "login" ? "register" : "login"))
            }
            onNavigate={navigatePath}
            busy={busy}
            error={error}
            onClearError={() => planner.setError("")}
            onSubmit={(mode, values) => void planner.authenticate(mode, values)}
            twoFactorRequired={planner.twoFactorRequired}
            onPasskey={(email) => void planner.passkeyLogin(email || undefined)}
          />
        )}
      />
    );

  if (!token)
    return (
      <AuthPage
        key={path}
        initialMode={path === "/login" ? "login" : "register"}
        onNavigate={navigatePath}
        onHome={nativeDesktop ? undefined : () => navigatePath("/")}
        busy={busy}
        error={error}
        onClearError={() => planner.setError("")}
        onSubmit={(mode, values) => void planner.authenticate(mode, values)}
        twoFactorRequired={planner.twoFactorRequired}
        onPasskey={(email) => void planner.passkeyLogin(email || undefined)}
      />
    );

  const listProps = {
    items,
    busy,
    canWrite,
    onToggle: toggle,
    onOpen: openItem,
  };

  const workspaceTabs = tabsLive ? (
    <TabStrip
      onSplit={onSplit}
      idPrefix={tabPrefix}
      panelId={panelId}
      tabs={tabs.state}
      onAction={tabAct}
      titleOf={tabTitle}
      iconOf={tabIcon}
    />
  ) : null;

  const settingsDialog =
    settingsOpen && user ? (
      <SettingsModal onClose={closeSettings}>
        <SettingsView
          key={token}
          user={user}
          teams={teams}
          busy={busy}
          report={report}
          initialSetting={settingAsked}
          onOpenWhatsNew={() => {
            if (closeSettings()) setWhatsNewOpen(true);
          }}
          onEmailReminders={planner.setEmailReminders}
          onOpenStatus={() => {
            if (closeSettings()) void leaveFor(() => navigatePath("/status"));
          }}
          onOpenSecurity={() => {
            if (closeSettings()) void leaveFor(() => navigatePath("/security"));
          }}
          onAccountDeleted={() => {
            planner.clearSession();
            navigatePath("/", true);
          }}
        />
      </SettingsModal>
    ) : null;

  // One page in a window of its own (NAV-06): no sidebar, no library.
  if (pageWindowId)
    return (
      <PrefsContext.Provider value={accountPrefs}>
        <PlanningProviders planning={planning} planned={planned}>
          <PageWindow
            docId={pageWindowId}
            userId={user?.id}
            canWriteIn={canWriteIn}
            teamNameFor={(id) => teams.find((t) => t.id === id)?.name ?? null}
            onItemsChanged={() => void refresh()}
            report={report}
          />
          {settingsDialog}
        </PlanningProviders>
      </PrefsContext.Provider>
    );

  return (
    <PrefsContext.Provider value={accountPrefs}>
      <PlanningProviders planning={planning} planned={planned}>
        <div
          className={
            "app workspace" +
            (secondary ? " is-secondary-pane" : "") +
            (railed ? " is-railed" : "") +
            (peek ? " has-peek" : "")
          }
          style={
            {
              "--workspace-sidebar-width": `${sidebarWidth}px`,
            } as CSSProperties
          }
        >
          {!secondary && (
            <Sidebar
              open={mobileNav}
              width={sidebarWidth}
              onResize={setSidebarWidth}
              railed={railed}
              view={chromeLocation?.view ?? view}
              user={user}
              hasUnread={notices.some((n) => !n.read)}
              reviewPending={reviewPending}
              onNavigate={(view) => chrome({ kind: "navigate", view })}
              pinnedViews={pinnedViews}
              openView={chromeLocation ? chromeLocation.savedView : shownView}
              onOpenView={(id) => chrome({ kind: "saved-view", id })}
              starred={starred}
              onOpenStarred={(item) => chrome({ kind: "starred", item })}
              onSignOut={() => void planner.logout()}
              agentName={assistant.agentName}
            />
          )}
          <div className="shell" ref={shellEl}>
            {onClosePane && (
              <div className="workspace-pane-toolbar">
                <span>Second pane</span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Close second pane"
                  onClick={() => void closePane()}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            {!secondary && (
              <>
                <AnnouncementBanner />
                <MaintenanceBanner
                  maintenance={planner.maintenance}
                  isAdmin={hasSystemPermission(user?.role, "system:manage")}
                />
                {newVersion.available && (
                  <UpdateBanner onDismiss={newVersion.dismiss} />
                )}
                <FocusElsewhere
                  items={items}
                  hidden={!!shownFocus}
                  onOpen={setFocusTask}
                />
              </>
            )}
            <Topbar
              sharedChrome={!secondary}
              showLocation={!tabsLive}
              tabs={secondary ? undefined : workspaceTabs}
              view={chromeLocation?.view ?? view}
              agentName={assistant.agentName}
              railed={railed}
              navigationOpen={mobileNav}
              onToggleRail={toggleRail}
              onToggleMenu={() => {
                setPeek(null);
                setMobileNav(!mobileNav);
              }}
              onOpenNotifications={() =>
                chrome({ kind: "navigate", view: "Notifications" })
              }
              onOpenCommand={() => chrome({ kind: "search" })}
              timeZone={accountZone}
            />
            {secondary && workspaceTabs}
            <main className="content">
              {error && (
                <div role="alert" className="error">
                  {error}
                  <button
                    className="icon-button"
                    aria-label="Dismiss error"
                    onClick={() => planner.setError("")}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
              <div
                // A tab's place always starts its screen afresh; without
                // tabs the count never moves, so this is the screen alone.
                key={`${shownSeq}:${view}`}
                className="view-enter"
                id={tabsLive ? panelId : undefined}
                role={tabsLive ? "tabpanel" : undefined}
                aria-labelledby={
                  tabsLive ? `${tabPrefix}-tab-${tabs.state.active}` : undefined
                }
                aria-label={
                  tabsLive
                    ? tabTitle(placeOf(activeTab(tabs.state)))
                    : undefined
                }
              >
                {view === "Overview" ? (
                  <HomeTop
                    user={user}
                    timeZone={accountZone}
                    onNewItem={() => newItem()}
                  />
                ) : (
                  !["AI assistant", "Docs", "Memory", "Agent notes"].includes(
                    view,
                  ) && (
                    <PageHeading
                      view={view}
                      user={user}
                      onNewItem={() => newItem()}
                    />
                  )
                )}
                {view === "Overview" && (
                  <WelcomeBack
                    onOpenItem={openItemById}
                    onOpenDoc={(id) => openPage(id)}
                    onOpenAsks={() => navigate("Notifications")}
                  />
                )}
                {view === "Overview" && (
                  <HomeSections
                    canOpenAgentOutput={
                      !busy &&
                      !assistant.thinking &&
                      !assistant.restoringChat &&
                      !["queued", "running", "waiting"].includes(
                        assistant.runProgress?.state ?? "",
                      )
                    }
                    onOpenAgentOutput={(id) => {
                      if (
                        busy ||
                        assistant.thinking ||
                        assistant.restoringChat ||
                        ["queued", "running", "waiting"].includes(
                          assistant.runProgress?.state ?? "",
                        )
                      )
                        return;
                      navigate("AI assistant");
                      void assistant.openChat(id).catch(report);
                    }}
                    report={report}
                    onOpenProject={(id) => {
                      setProjectToOpen(id);
                      setView("Projects");
                    }}
                    onOpenDoc={(id) => openPage(id)}
                    onOpenStudy={() => navigate("Study")}
                    onOpenView={openSavedView}
                    onOpenUpcoming={() => {
                      setUpcomingAsked((n) => n + 1);
                      navigate("AI assistant");
                    }}
                  />
                )}
                {view === "Overview" && (
                  <OverviewView
                    {...listProps}
                    onNewItem={() => newItem()}
                    onNavigate={(next) =>
                      chromeRun.current({ kind: "navigate", view: next })
                    }
                    onOpenProject={(id) => {
                      setProjectToOpen(id);
                      setView("Projects");
                    }}
                    onOpenDoc={(found) => {
                      setNoteDoc(found);
                      setView("Docs");
                    }}
                    onPlanDay={() => {
                      navigate("AI assistant");
                      void assistant.ask(planDayPrompt);
                    }}
                    onFocus={startFocus}
                    onOpenById={openItemById}
                    onPlanIt={(id) => planTask(id, true)}
                    onPlanAgain={(id) => void rollForward([id])}
                    onPlanMyDay={planMyDay}
                    onShowLate={() => navigate("My tasks")}
                  />
                )}
                {/* What changed in your teams, others' changes first (SHR-02). */}
                {view === "Overview" && teams.length > 0 && (
                  <RecentChanges compact limit={12} />
                )}
                {view === "My tasks" && (
                  <TasksView
                    {...listProps}
                    query={query}
                    onQueryChange={setQuery}
                    onSetStatus={setStatus}
                    userId={user?.id}
                    onChanged={refresh}
                    onNewItem={(prefill) => newItem(null, prefill)}
                    onChangeItem={changeItem}
                    agentName={assistant.agentName}
                    onOpenReview={(id) => {
                      setReviewToOpen(id);
                      navigate("Review");
                    }}
                  />
                )}
                {view === "Lists" && (
                  <ListsView
                    {...listProps}
                    teams={teams}
                    report={report}
                    onNewItem={(prefill) => newItem(null, prefill)}
                  />
                )}
                {view === "Agenda" && (
                  <AgendaView
                    report={report}
                    userId={user?.id}
                    timeZone={accountZone}
                    onItemsChanged={() => void refresh()}
                  />
                )}
                {(view === "Docs" || view === "Memory" || view === "Agent") && (
                  <DocsView
                    fixedKind={
                      view === "Memory"
                        ? "memory"
                        : view === "Agent"
                          ? "agent"
                          : undefined
                    }
                    report={report}
                    onOpenProject={(id) => {
                      setProjectToOpen(id);
                      setView("Projects");
                    }}
                    userId={user?.id}
                    canWriteDoc={canWriteIn}
                    teamNameFor={(id) =>
                      teams.find((t) => t.id === id)?.name ?? null
                    }
                    onItemsChanged={() => void refresh()}
                    initialDoc={noteDoc}
                    initialBlockId={noteBlockId}
                    openTemplates={templatesAsked}
                    incomingFiles={openedFiles}
                    onInitialDocShown={() => {
                      setNoteDoc(null);
                      setNoteBlockId(null);
                    }}
                  />
                )}
                {view === "Views" && (
                  <ViewsView
                    key={token}
                    draftStore={viewDraftStore}
                    report={report}
                    teams={teams}
                    userId={user?.id}
                    items={items}
                    revision={revision}
                    openViewId={viewToOpen}
                    onViewOpened={() => setViewToOpen(null)}
                    onSelected={(id) => {
                      setShownView(id);
                      if (id && viewRef.current === "Views")
                        reportPlace({
                          view: "Views",
                          id,
                          title: viewNames[id] ?? "",
                        });
                    }}
                    onOpenItem={openItem}
                    onOpenDoc={(id) => openPage(id)}
                    onOpenProject={(id) => {
                      setProjectToOpen(id);
                      setView("Projects");
                    }}
                    onViewsChanged={loadPinnedViews}
                    onToggle={toggleResult}
                    onSetStatus={setStatusResult}
                    onChangeItem={changeItemResult}
                  />
                )}
                {view === "Study" && (
                  <StudyView
                    report={report}
                    onOpenPage={(doc) => {
                      setNoteDoc(doc);
                      setView("Docs");
                    }}
                    onPlanned={() => void refresh()}
                  />
                )}
                {view === "Projects" && (
                  <ProjectsView
                    initialProjectId={projectToOpen}
                    initialSection={projectSectionToOpen}
                    initialSourceId={projectSourceId}
                    onShown={(project) => {
                      if (viewRef.current === "Projects")
                        reportPlace({
                          view: "Projects",
                          id: project?.id ?? null,
                          title: project?.name ?? "",
                        });
                    }}
                    onInitialProjectShown={() => {
                      setProjectToOpen(null);
                      setProjectSectionToOpen(null);
                      setProjectSourceId(null);
                    }}
                    items={items}
                    userId={user?.id ?? ""}
                    teams={teams}
                    openTemplate={templateToOpen}
                    onTemplateOpened={() => setTemplateToOpen(null)}
                    openProject={projectToOpen}
                    onProjectOpened={() => setProjectToOpen(null)}
                    report={report}
                    onRefresh={() => void refresh()}
                    onOpenItem={openItem}
                    onOpenPlan={(plan) => void leaveFor(() => openPlan(plan))}
                    startNew={projectAsked}
                    onAskProject={(project, question, chatId) => {
                      assistant.setScope({
                        kind: "project",
                        id: project.id,
                        name: project.name,
                      });
                      if (question) assistant.setMessage(question);
                      setView("AI assistant");
                      if (chatId) void assistant.openChat(chatId).catch(report);
                    }}
                    onOpenNote={(docId, blockId) => openPage(docId, blockId)}
                  />
                )}
                {view === "Calendar" && (
                  <CalendarView
                    items={items}
                    teams={teams}
                    canWrite={canWrite}
                    onOpen={openItem}
                    onEditItem={(item, occurrence) => {
                      setEditing(item);
                      setEditOccurrence(occurrence ?? null);
                    }}
                    onFocus={startFocus}
                    date={calendarDate}
                    onDateChange={setCalendarDate}
                    mode={calendarMode}
                    onModeChange={setCalendarMode}
                    ownsShortcuts={() => ownsEventsRef.current()}
                    shortcuts={
                      !editing &&
                      !shownTask &&
                      !shownFocus &&
                      !commandOpen &&
                      !shortcutsOpen
                    }
                    onNewEvent={(prefill) => newItem(null, prefill)}
                    userId={user?.id}
                    revision={revision}
                    report={report}
                    onChanged={refresh}
                    planRequest={planRequest}
                    onOpenFieldTarget={(target, id) => {
                      if (target === "project") {
                        setProjectToOpen(id);
                        setView("Projects");
                      } else openPage(id);
                    }}
                  />
                )}
                {view === "AI assistant" && (
                  <AssistantView
                    items={items}
                    busy={busy}
                    assistant={assistant}
                    onApplyPlan={applyPlan}
                    onOpenPlan={(plan) => void leaveFor(() => openPlan(plan))}
                    onShowOnCalendar={(at) =>
                      void leaveFor(() => showOnCalendar(at))
                    }
                    onOpenSource={openSource}
                    onKeptNote={(docId) => openPage(docId)}
                    openUpcoming={upcomingAsked}
                    navigationOpen={mobileNav || !ownsEvents()}
                    onOpenSidePanel={() => setMobileNav(false)}
                    agentWorkspace={(lane, openChat) =>
                      lane === "background" ? (
                        <BackgroundView onOpenChat={openChat} />
                      ) : (
                        <OvernightView
                          report={report}
                          onOpenChat={openChat}
                          onOpenReview={(id) => {
                            setReviewToOpen(id);
                            navigate("Review");
                          }}
                          onOpen={(kind, id) =>
                            openDeepLink(
                              kind === "doc"
                                ? { kind, id, block: null }
                                : { kind, id },
                            )
                          }
                        />
                      )
                    }
                  />
                )}
                {view === "Teams" && (
                  <TeamsView teams={teams} {...teamActions} />
                )}
                {view === "Booking" && (
                  <BookingView
                    user={user}
                    teams={teams}
                    report={report}
                    focus={bookingFocus}
                  />
                )}
                {view === "Admin" && isAdmin && (
                  <AdminView
                    {...teamActions}
                    onMaintenanceChange={planner.applyMaintenance}
                  />
                )}
                {view === "Notifications" && (
                  <AsksPanel onOpenItem={openItemById} />
                )}
                {view === "Notifications" && (
                  <NotificationsView
                    onOpenOvernight={(id) => {
                      navigate("Overnight");
                      setOvernightId(id);
                    }}
                    onOpenChat={(id) => {
                      navigate("AI assistant");
                      void assistant.openChat(id).catch(report);
                    }}
                    notices={notices}
                    onRead={planner.markRead}
                    onReschedule={reschedule}
                    onRollForward={() => rollForward()}
                    onPlanIt={planIt}
                    onOpenItem={openItemById}
                    onOpenCalendar={() => navigate("Calendar")}
                    onOpenBooking={openBooking}
                    onOpenTemplate={(id) => {
                      setTemplateToOpen(id);
                      navigate("Projects");
                    }}
                    onOpenProject={(id) => {
                      setProjectToOpen(id);
                      navigate("Projects");
                    }}
                    onOpenSetting={openSetting}
                    onOpenDoc={(id) => openPage(id)}
                    onStartSession={async (blockId, itemId) => {
                      try {
                        await client.startSession(blockId, "reminder");
                      } catch {
                        // Over or moved: focus mode still starts on the task.
                      }
                      const task =
                        items.find((i) => i.id === itemId) ??
                        (await client.getItem(itemId).catch(() => null));
                      if (task) startFocus(task);
                    }}
                    onOpenReview={(id) => {
                      setReviewToOpen(id);
                      navigate("Review");
                    }}
                  />
                )}
                {view === "Review" && (
                  <ReviewView
                    report={report}
                    focusId={reviewToOpen}
                    onFocused={() => setReviewToOpen(null)}
                    onCount={setReviewPending}
                  />
                )}
                {view === "Overnight" && (
                  <OvernightView
                    key={overnightId ?? "latest"}
                    nightId={overnightId}
                    report={report}
                    onOpenChat={(id) => {
                      navigate("AI assistant");
                      void assistant.openChat(id).catch(report);
                    }}
                    onOpenReview={(id) => {
                      setReviewToOpen(id);
                      navigate("Review");
                    }}
                    onOpen={(kind, id) =>
                      openDeepLink(
                        kind === "doc"
                          ? { kind, id, block: null }
                          : { kind, id },
                      )
                    }
                  />
                )}
                {view === "Background" && (
                  <BackgroundView
                    onOpenChat={(id) => {
                      navigate("AI assistant");
                      void assistant.openChat(id).catch(report);
                    }}
                  />
                )}
              </div>
              {loading && (
                <small className="sync-status">Syncing your space…</small>
              )}
              {view !== "AI assistant" && (
                <footer>
                  <button
                    type="button"
                    className="footer-link"
                    onClick={() => setWhatsNewOpen(true)}
                  >
                    What's new
                  </button>
                </footer>
              )}
            </main>
          </div>
          {settingsDialog}
          {shownTask && (
            <TaskDetail
              key={shownTask.id}
              item={shownTask}
              teamName={teams.find((t) => t.id === shownTask.team_id)?.name}
              canWrite={canWrite(shownTask)}
              suspended={!!editing}
              onClose={closeTask}
              onEdit={setEditing}
              onFocus={startFocus}
              items={items}
              onOpenItem={(i) => openItem(i)}
              onChanged={refresh}
              onError={report}
              occurrence={
                openOccurrence?.itemId === shownTask.id
                  ? openOccurrence.occurrence
                  : null
              }
              onFindTime={findTimeFor}
              onShowOnCalendar={(at) => void leaveFor(() => showOnCalendar(at))}
              onOpenProject={(id) => {
                closeTask();
                setProjectToOpen(id);
                setView("Projects");
              }}
              onAskTask={(item) => {
                closeTask();
                assistant.setScope({
                  kind: "task",
                  id: item.id,
                  name: item.title,
                });
                setView("AI assistant");
              }}
              onOpenDoc={(doc, blockId) => {
                closeTask();
                setNoteBlockId(blockId ?? null);
                setNoteDoc(doc);
                setView("Docs");
              }}
              onOpenNote={(event, series) => {
                const request = ++navigationRead.current;
                const account = token;
                const current = () =>
                  request === navigationRead.current &&
                  account === sessionToken.current;
                void client
                  // Opened on one class of a repeating event: that class's
                  // note, unless the series' own was asked for.
                  .itemNote(
                    event.id,
                    !series &&
                      event.rrule &&
                      openOccurrence?.itemId === event.id
                      ? openOccurrence.occurrence
                      : null,
                  )
                  .then((note) => {
                    if (!current()) return;
                    closeTask();
                    setNoteDoc(note);
                    setView("Docs");
                  })
                  .catch((error) => {
                    if (current()) report(error);
                  });
              }}
            />
          )}
          {shownFocus && (
            <FocusMode
              key={shownFocus.id}
              item={shownFocus}
              items={items}
              canWrite={canWrite(shownFocus)}
              onClose={closeFocus}
              onSwitch={setFocusTask}
              onChanged={refresh}
              onError={report}
            />
          )}
          {editing && (
            <ItemEditor
              key={`${token}:${editing === "new" ? "new" : editing.id}`}
              editing={editing}
              teams={teams}
              items={items}
              defaultTeamId={draftTeamId}
              draft={editing === "new" ? draft : null}
              busy={busy}
              error={error}
              onClose={() => setEditing(null)}
              onSave={saveItem}
              onDelete={deleteItem}
              onUpdated={(updated) => {
                if (session.get() === token)
                  setEditing((current) =>
                    current && current !== "new" && current.id === updated.id
                      ? updated
                      : current,
                  );
              }}
              occurrence={editing === "new" ? null : editOccurrence}
            />
          )}
          {commandOpen && (
            <CommandBar
              key={token}
              items={items}
              isAdmin={isAdmin}
              view={view}
              focusRequest={commandFocusRequest}
              queryRequest={commandQueryRequest}
              initialQuery={commandQuery}
              initialAdd={commandAdd}
              onClose={() => setCommandOpen(false)}
              onOpenItem={openItem}
              onOpenItemById={openItemById}
              onOpenDoc={(found, blockId) =>
                void leaveFor(() => {
                  setNoteDoc(found);
                  setNoteBlockId(blockId ?? null);
                  setView("Docs");
                })
              }
              onGoToProjects={(id) =>
                void leaveFor(() => {
                  setProjectToOpen(id);
                  setView("Projects");
                })
              }
              onNewItem={() => newItem()}
              onNewEvent={() => newItem(null, { kind: "event" })}
              onNewPage={(title) => void newPage(title)}
              onNewPageFromTemplate={() =>
                void leaveFor(() => {
                  navigate("Docs");
                  setTemplatesAsked(Date.now());
                })
              }
              onNewProject={() =>
                void leaveFor(() => {
                  navigate("Projects");
                  setProjectAsked(Date.now());
                })
              }
              onPlanDay={() => void leaveFor(planMyDay)}
              onStartFocus={() => {
                const next = nextUp(items, undefined, 1)[0];
                if (next) startFocus(next);
                else planner.setError("Nothing is next up to focus on.");
              }}
              onShowToday={() =>
                void leaveFor(() => {
                  navigate("Calendar");
                  setCalendarDate(new Date());
                  setCalendarMode("day");
                })
              }
              onToggleSidebar={toggleRail}
              onOpenSecurity={() =>
                void leaveFor(() => navigatePath("/security"))
              }
              onNavigate={(next) =>
                chromeRun.current({ kind: "navigate", view: next })
              }
              onApplyPlan={applyPlan}
              onOpenPlan={(plan) => void leaveFor(() => openPlan(plan))}
              onShowOnCalendar={(at) => void leaveFor(() => showOnCalendar(at))}
              onOpenSource={openSource}
              onKeptNote={(docId) => openPage(docId)}
              onApplied={refresh}
              onShowShortcuts={() => setShortcutsOpen(true)}
              onOpenWhatsNew={() => setWhatsNewOpen(true)}
              onOpenChanges={() => setChangesOpen(true)}
              onOpenSetting={(id) => {
                navigate("Settings");
                setSettingAsked((was) => ({ id, seq: (was?.seq ?? 0) + 1 }));
              }}
              teams={teams}
              userId={user?.id}
              onJumpToDate={(day) => void leaveFor(() => jumpToDate(day))}
              starred={starred}
              onOpenStarred={openStarred}
              report={report}
            />
          )}
          {shortcutsOpen && (
            <ShortcutSheet onClose={() => setShortcutsOpen(false)} />
          )}
          {peek && (
            <SidePeek
              target={peek.target}
              pinned={peek.pinned}
              onPin={(pinned) => setPeek((p) => (p ? { ...p, pinned } : p))}
              onClose={() => setPeek(null)}
              report={report}
            />
          )}
          {whatsNewOpen && (
            <WhatsNew
              onClose={() => setWhatsNewOpen(false)}
              onOpenChangelog={() => {
                setWhatsNewOpen(false);
                navigatePath("/changelog");
              }}
            />
          )}
          {changesOpen && (
            <RecentChangesDialog onClose={() => setChangesOpen(false)} />
          )}
          {!secondary && user && user.first_run_done === false && (
            <FirstRun
              user={user}
              onDone={(_next, made) => {
                markReleaseSeen();
                void refreshUser();
                void refresh();
                if (made?.brief_id) openPage(made.brief_id);
              }}
            />
          )}
          {!secondary && <Celebration />}
        </div>
      </PlanningProviders>
    </PrefsContext.Provider>
  );
}
