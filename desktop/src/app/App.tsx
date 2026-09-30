import { useCallback, useEffect, useRef, useState } from "react";
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
import { deviceTimeZone, nextUp } from "../lib/planning";
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
import { openPageCommands, watchOpenPage } from "./page-commands";
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
import { onOpenReview } from "../lib/review";
import { onLive } from "../lib/live";
import "../styles/planning.css";

export function App() {
  const nativeDesktop = location.protocol === "file:";
  const [path, setPath] = useState(location.pathname);
  const navigatePath = (next: string, replace = false) => {
    if (!nativeDesktop)
      window.history[replace ? "replaceState" : "pushState"]({}, "", next);
    setPath(next);
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    const pop = () => setPath(location.pathname);
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const planner = usePlanner();
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
    if (!isPageWindow()) return null;
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
  usePresence(token, () => void refresh({ silent: true }));
  const [view, setView] = useState<View>(() => {
    try {
      return location.pathname === "/app" &&
        localStorage.getItem("orbyn-assistant-view-open") === "true"
        ? "AI assistant"
        : "Overview";
    } catch {
      return "Overview";
    }
  });
  // Compact layouts have no workspace tabs to restore their current screen.
  useEffect(() => {
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
  const tabs = useTabState();
  useEffect(() => setTabsShown(tabsLive), [tabsLive]);
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
  const loadPinnedViews = useCallback(() => {
    client.listViews().then(
      (views) => {
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
    else setPinnedViews([]);
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
  /** Words ⌘K opens with (a quick-add or search link). */
  const [commandQuery, setCommandQuery] = useState("");
  /** The words came from an add link: making them leads, to confirm. */
  const [commandAdd, setCommandAdd] = useState(false);
  const openCommand = (words = "", add = false) => {
    setCommandQuery(words);
    setCommandAdd(add);
    setCommandOpen(true);
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
  const [planRequest, setPlanRequest] = useState<PlanRequest | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  // A narrow icon rail instead of the full sidebar, remembered per browser.
  const [railed, setRailed] = useState(() => {
    try {
      return localStorage.getItem("orbyn-sidebar") === "rail";
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
  const linked = deepLinkOf(
    path,
    nativeDesktop ? "" : location.hash,
    nativeDesktop ? "" : location.search,
  );
  // Read now: the sign-in redirect below replaces the address before effects.
  const signInSearch = nativeDesktop ? "" : location.search;
  const openDeepLink = (link: DeepLink) => {
    if (link.kind === "task") openItemById(link.id);
    else if (link.kind === "doc")
      void client.getDoc(link.id).then((doc) => {
        setNoteDoc(doc);
        setView("Docs");
        if (link.block) focusDocBlock(link.block);
      }, report);
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
    else if (link.kind === "assistant") setView("AI assistant");
    else if (link.kind === "overnight") {
      setOvernightId(link.id);
      setView("Overnight");
    } else setView("Overview");
  };
  // How many proposals wait, for the sidebar: read when signed in and again
  // whenever the inbox changes (an agent proposed, or another device decided).
  useEffect(() => {
    if (!token) return;
    const count = () =>
      client.reviewCount().then(
        (r) => setReviewPending(r.pending),
        () => {},
      );
    void count();
    const stop = onLive(
      (news) =>
        news.kind === "changed" && news.area === "review" && void count(),
    );
    const stopOpen = onOpenReview((id) => {
      setReviewToOpen(id);
      setView("Review");
    });
    return () => {
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
    () => window.orbynDesktop?.onOpenLink((url) => openLinkRef.current(url)),
    [],
  );
  // Link pills and "Linked here" ask for things to open the same way.
  useEffect(() => {
    const open = (e: Event) => {
      const url = (e as CustomEvent<unknown>).detail;
      if (typeof url === "string") openLinkRef.current(url);
    };
    window.addEventListener(OPEN_LINK_EVENT, open);
    return () => window.removeEventListener(OPEN_LINK_EVENT, open);
  }, []);
  // ⌘-click on a link, ⌘Enter in ⌘K: open it beside (NAV-05).
  useEffect(() => {
    const onPeek = (e: Event) => {
      const target = (e as CustomEvent<ObjectRef>).detail;
      setPeek((was) => ({ target, pinned: was?.pinned ?? false }));
    };
    window.addEventListener(PEEK_EVENT, onPeek);
    return () => window.removeEventListener(PEEK_EVENT, onPeek);
  }, []);
  // After a release, "What's new" opens once by itself (DSN-03). A browser
  // that has never seen one (a new account, a first visit) is not shown it.
  useEffect(() => {
    if (!token || !user || user.first_run_done === false) return;
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
  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
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
      if (id)
        void client.getDoc(id).then(
          (doc) => {
            setNoteDoc(doc);
            setView("Docs");
          },
          () => {
            // A page that's gone or no longer yours: Overview, as usual.
          },
        );
    }
  }, [token]);
  // Files opened with Orbyn on the desktop (CAP-11): Word and PDF go to
  // Uploads; Markdown is read by the page importer, which says first what
  // it would make.
  useEffect(
    () =>
      window.orbynDesktop?.onOpenFile?.((opened) => {
        const bytes = Uint8Array.from(atob(opened.data), (c) =>
          c.charCodeAt(0),
        );
        if (opened.type === "text/markdown") {
          void client
            .importPages({
              format: "markdown",
              file_name: opened.name,
              data: opened.data,
              dry_run: true,
            })
            .then(async (dry) => {
              if (!dry.pages) {
                planner.setError(`“${opened.name}” has nothing to import.`);
                return;
              }
              await client.importPages({
                format: "markdown",
                file_name: opened.name,
                data: opened.data,
                dry_run: false,
              });
              // The library opens with the new page in it.
              setView("Docs");
            }, report);
          return;
        }
        const file = new File([bytes], opened.name, { type: opened.type });
        setOpenedFiles((was) => ({ files: [file], seq: (was?.seq ?? 0) + 1 }));
        setView("Docs");
      }),
    [],
  );
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
    // Public booking pages set their own titles and say noindex themselves.
    if (isPublicBooking) return;
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
    (!nativeDesktop && path === "/")
  );
  useEffect(() => {
    if (!token || isPublicBooking || !inShell) return;
    // The keys come from the one command list (commands.ts), with the
    // person's own changes (NAV-09): what a key does is looked up there,
    // then run here, whichever command it is.
    const onKey = (e: KeyboardEvent) => {
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
  const runCommandRef = useRef<(c: CommandDef) => boolean>(() => false);
  runCommandRef.current = (c: CommandDef) => {
    if (c.view) {
      if (c.needs === "admin" && !isAdmin) return false;
      navigate(c.view);
      return true;
    }
    if (c.needs === "page") {
      const run = openPageCommands()?.run[c.id];
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
        setCommandQuery("");
        setCommandAdd(false);
        setCommandOpen((open) => !open);
      },
      "app.sidebar": () => toggleRail(),
      "app.shortcuts": () => setShortcutsOpen(true),
      "app.changes": () => setChangesOpen(true),
      "app.whats-new": () => setWhatsNewOpen(true),
      "app.security": () => navigatePath("/security"),
      "new.task": () => newItem(),
      "new.event": () => newItem(null, { kind: "event" }),
      "new.page": () => void newPage(),
      "new.from-template": () => {
        navigate("Docs");
        setTemplatesAsked(Date.now());
      },
      "new.project": () => {
        navigate("Projects");
        setProjectAsked(Date.now());
      },
      "new.import": () => {
        navigate("Settings");
        setSettingAsked((was) => ({ id: "import", seq: (was?.seq ?? 0) + 1 }));
      },
      "plan.day": () => planMyDay(),
      "plan.focus": () => {
        const next = nextUp(items, undefined, 1)[0];
        if (next) startFocus(next);
      },
      "plan.today": () => {
        navigate("Calendar");
        setCalendarDate(new Date());
        setCalendarMode("day");
      },
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
      setProjectToOpen(s.id);
      navigate("Projects");
    } else if (s.kind === "view") openSavedView(s.id);
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
  const newPage = async (title = "") => {
    try {
      const doc = await client.createDoc({
        title,
        kind: "doc",
        content: [{ type: "paragraph", text: "" }],
      });
      setNoteBlockId(null);
      setNoteDoc(doc);
      navigate("Docs");
    } catch (e) {
      report(e);
    }
  };

  const openPage = (docId: string, blockId?: string | null) =>
    void client.getDoc(docId).then((doc) => {
      setNoteBlockId(blockId ?? null);
      setNoteDoc(doc);
      setView("Docs");
    }, report);

  /** Open a fact the assistant read at its task, page, or project section. */
  const openSource = (source: AssistantSource) => {
    if ("doc_id" in source) {
      openPage(source.doc_id, source.block_id);
    } else if (source.kind === "task") {
      openItemById(source.id);
    } else if (source.project_id) {
      setProjectToOpen(source.project_id);
      setProjectSectionToOpen(
        source.kind === "decision" ? "decisions" : "history",
      );
      setProjectSourceId(source.id);
      setView("Projects");
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
  const changeItem = (i: Item, change: ColumnChange | Partial<ItemInput>) => {
    if (!guard(i)) return;
    void act(async () => {
      // Handing a task to your agent or taking it back (W3), and giving it
      // to someone at the same time.
      if ("agent" in change) {
        const { agent, ...rest } = change;
        const after =
          agent === "hand"
            ? await client.handTaskToAgent(i.id)
            : await client.takeTaskBack(i.id);
        if ("assignee_id" in rest)
          await client.updateItem(i.id, {
            ...itemBody(after),
            assignee_id: rest.assignee_id ?? null,
          });
      } else await client.updateItem(i.id, { ...itemBody(i), ...change });
      await refresh();
    });
  };

  /**
   * Opens an item in the task panel. Opened on one time of a repeating
   * event (a class), that time is kept, so its meeting note is that class's.
   */
  const openItem = (i: Item, occurrence?: OccurrenceRef) => {
    setOpenTask(i);
    setOpenOccurrence(
      occurrence ? { itemId: i.id, occurrence: occurrence.occurrence } : null,
    );
  };
  const closeTask = useCallback(() => setOpenTask(null), []);
  const closeFocus = useCallback(() => setFocusTask(null), []);
  const startFocus = (i: Item) => {
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
    if (v === "Overnight") setOvernightId(undefined);
    // A failure belongs to the view it happened in.
    if (v !== view) planner.setError("");
    setView(v);
    setMobileNav(false);
    setQuery("");
    setPlanRequest(null);
    setBookingFocus(null);
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

  /** Show a tab's place: its screen, afresh, with its thing open. */
  const showPlace = (place: TabPlace) => {
    const next = place.view as View;
    if (next !== view) planner.setError("");
    setMobileNav(false);
    setQuery("");
    setPlanRequest(null);
    setBookingFocus(null);
    setShownSeq((n) => n + 1);
    setView(next);
    const id = place.id;
    pendingPlace.current = id ? { ...place, since: Date.now() } : null;
    const missed = () => {
      // Gone or out of reach: the screen shows without it, quietly.
      if (pendingPlace.current?.id === id) pendingPlace.current = null;
    };
    if (!id) {
      // A tab on the assistant with no chat yet is a new chat.
      if (next === "AI assistant" && assistant.activeChatId) assistant.reset();
      return;
    }
    if (PAGE_VIEWS.includes(next))
      void client.getDoc(id).then((doc) => {
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
  const tabAct = (action: TabAction) => {
    if (!tabsLive) return;
    const before = activeTab(tabs.ref.current);
    const was = placeOf(before);
    const after = activeTab(tabs.act(action));
    if (after.key !== before.key || placeOf(after) !== was)
      showPlace(placeOf(after));
  };
  const tabActRef = useRef(tabAct);
  tabActRef.current = tabAct;

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
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
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
  const tabsChecked = useRef(false);
  useEffect(() => {
    if (!token || !tabsLive || tabsChecked.current) return;
    tabsChecked.current = true;
    const gone = (e: unknown) =>
      e instanceof HttpError && [403, 404, 410].includes(e.statusCode);
    void Promise.all(
      tabs.ref.current.tabs.map(async (tab) => {
        const place = placeOf(tab);
        if (!place.id) return null;
        try {
          const title = await titleFor(place);
          if (title)
            tabs.act({
              type: "retitle",
              view: place.view,
              id: place.id,
              title,
            });
          return null;
        } catch (e) {
          return gone(e) ? tab.key : null;
        }
      }),
    ).then((keys) => {
      const drop = keys.filter((k): k is string => !!k);
      if (drop.length) tabActRef.current({ type: "drop", keys: drop });
    });
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
    if (place.id && !place.title)
      void titleFor(place).then(
        (title) =>
          title &&
          tabs.act({ type: "retitle", view: place.view, id: place.id!, title }),
        () => {
          // Its name shows once the tab is opened.
        },
      );
  };
  useEffect(() => {
    const onOpen = (e: Event) =>
      openTabRef.current((e as CustomEvent<TabRequest>).detail);
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
    if (!tabsLive || nativeDesktop || !location.pathname.startsWith("/app"))
      return;
    historyAt.current += 1;
    window.history.pushState({ orbynTab: historyAt.current }, "");
  }, [tabs.state.moves, tabsLive, nativeDesktop]);
  useEffect(() => {
    if (!tabsLive || nativeDesktop) return;
    const pop = (e: PopStateEvent) => {
      if (!location.pathname.startsWith("/app")) return;
      const state = e.state as { orbynTab?: unknown } | null;
      const at = typeof state?.orbynTab === "number" ? state.orbynTab : 0;
      const steps = at - historyAt.current;
      historyAt.current = at;
      for (let i = 0; i < Math.abs(steps); i++)
        tabActRef.current({ type: steps < 0 ? "back" : "forward" });
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
      if (e.altKey || document.querySelector('[aria-modal="true"]')) return;
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
    setOpenOccurrence(null);
    const found = items.find((i) => i.id === id);
    if (found) setOpenTask(found);
    else client.getItem(id).then(setOpenTask, report);
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
    void act(async () => {
      if (target === "new") await client.createItem(data);
      else {
        await client.updateItem(
          target.id,
          { ...data, status: target.status, version: target.version },
          options,
        );
        // Status changes go through the timeline so they're recorded.
        if (data.status !== target.status) {
          await client.postItemUpdate(target.id, { status: data.status });
          if (data.status === "done") celebrate();
        }
      }
      setEditing(null);
      await refresh();
    });
  };

  const deleteItem = (options: EditOptions = {}) => {
    if (!editing || editing === "new") return;
    const target = editing;
    void act(async () => {
      await client.deleteItem(target.id, target.version, options);
      setEditing(null);
      if (openTask?.id === target.id) setOpenTask(null);
      await refresh();
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
  if (token && user && !user.email_verified)
    return (
      <VerifyGate
        email={user.email}
        onContinue={() => void refreshUser()}
        onLogout={() => void planner.logout()}
      />
    );

  // Signed in but not on the current Terms: ask before the app.
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
        </PlanningProviders>
      </PrefsContext.Provider>
    );

  return (
    <PrefsContext.Provider value={accountPrefs}>
      <PlanningProviders planning={planning} planned={planned}>
        <div
          className={
            "app" + (railed ? " is-railed" : "") + (peek ? " has-peek" : "")
          }
        >
          <Sidebar
            open={mobileNav}
            railed={railed}
            onToggleRail={toggleRail}
            view={view}
            user={user}
            hasUnread={notices.some((n) => !n.read)}
            reviewPending={reviewPending}
            onNavigate={navigate}
            pinnedViews={pinnedViews}
            openView={shownView}
            onOpenView={openSavedView}
            starred={starred}
            onOpenStarred={openStarred}
            onSignOut={() => void planner.logout()}
            agentName={assistant.agentName}
          />
          <div className="shell" ref={shellEl}>
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
            <Topbar
              view={view}
              agentName={assistant.agentName}
              onToggleMenu={() => setMobileNav(!mobileNav)}
              onOpenNotifications={() => navigate("Notifications")}
              onOpenCommand={() => openCommand()}
              timeZone={accountZone}
            />
            {tabsLive && (
              <TabStrip
                tabs={tabs.state}
                onAction={tabAct}
                titleOf={tabTitle}
                iconOf={tabIcon}
              />
            )}
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
                id={tabsLive ? "tab-panel" : undefined}
                role={tabsLive ? "tabpanel" : undefined}
              >
                {view === "Overview" ? (
                  <HomeTop
                    user={user}
                    timeZone={accountZone}
                    onNewItem={() => newItem()}
                  />
                ) : (
                  view !== "AI assistant" && (
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
                    onOpenDoc={(id) =>
                      void client.getDoc(id).then((doc) => {
                        setNoteDoc(doc);
                        setView("Docs");
                      }, report)
                    }
                    onOpenAsks={() => navigate("Notifications")}
                  />
                )}
                {view === "Overview" && (
                  <HomeSections
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
                    onNavigate={navigate}
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
                    onOpenDoc={(id) =>
                      void client.getDoc(id).then((doc) => {
                        setNoteDoc(doc);
                        setView("Docs");
                      }, report)
                    }
                    onOpenProject={(id) => {
                      setProjectToOpen(id);
                      setView("Projects");
                    }}
                    onViewsChanged={loadPinnedViews}
                    onToggle={toggle}
                    onSetStatus={setStatus}
                    onChangeItem={changeItem}
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
                    onOpenPlan={openPlan}
                    startNew={projectAsked}
                    onAskProject={(project, question) => {
                      assistant.setScope({
                        kind: "project",
                        id: project.id,
                        name: project.name,
                      });
                      if (question) assistant.setMessage(question);
                      setView("AI assistant");
                    }}
                    onOpenNote={(docId, blockId) =>
                      void client.getDoc(docId).then((doc) => {
                        setNoteDoc(doc);
                        setNoteBlockId(blockId ?? null);
                        setView("Docs");
                      }, report)
                    }
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
                      } else
                        void client.getDoc(id).then((doc) => {
                          setNoteDoc(doc);
                          setView("Docs");
                        }, report);
                    }}
                  />
                )}
                {view === "AI assistant" && (
                  <AssistantView
                    items={items}
                    busy={busy}
                    assistant={assistant}
                    onApplyPlan={applyPlan}
                    onOpenPlan={openPlan}
                    onShowOnCalendar={showOnCalendar}
                    onOpenSource={openSource}
                    onKeptNote={(docId) => openPage(docId)}
                    openUpcoming={upcomingAsked}
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
                    onOpenDoc={(id) =>
                      void client.getDoc(id).then((doc) => {
                        setNoteDoc(doc);
                        navigate("Docs");
                      }, report)
                    }
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
                {view === "Settings" && (
                  <SettingsView
                    user={user}
                    teams={teams}
                    busy={busy}
                    report={report}
                    initialSetting={settingAsked}
                    onOpenWhatsNew={() => setWhatsNewOpen(true)}
                    onEmailReminders={planner.setEmailReminders}
                    onOpenStatus={() => navigatePath("/status")}
                    onOpenSecurity={() => navigatePath("/security")}
                    onAccountDeleted={() => {
                      planner.clearSession();
                      navigatePath("/", true);
                    }}
                  />
                )}
              </div>
              {loading && (
                <small className="sync-status">Syncing your space…</small>
              )}
              {view !== "AI assistant" && (
                <footer>
                  A little more clarity. A little more you. <Orbit size={14} />{" "}
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
              onShowOnCalendar={showOnCalendar}
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
                    closeTask();
                    setNoteDoc(note);
                    setView("Docs");
                  })
                  .catch(report);
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
              key={
                editing === "new" ? "new" : editing.id + ":" + editing.version
              }
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
              occurrence={editing === "new" ? null : editOccurrence}
            />
          )}
          {commandOpen && (
            <CommandBar
              items={items}
              isAdmin={isAdmin}
              view={view}
              initialQuery={commandQuery}
              initialAdd={commandAdd}
              onClose={() => setCommandOpen(false)}
              onOpenItem={openItem}
              onOpenItemById={openItemById}
              onOpenDoc={(found, blockId) => {
                setNoteDoc(found);
                setNoteBlockId(blockId ?? null);
                setView("Docs");
              }}
              onGoToProjects={(id) => {
                setProjectToOpen(id);
                setView("Projects");
              }}
              onNewItem={() => newItem()}
              onNewEvent={() => newItem(null, { kind: "event" })}
              onNewPage={(title) => void newPage(title)}
              onNewPageFromTemplate={() => {
                navigate("Docs");
                setTemplatesAsked(Date.now());
              }}
              onNewProject={() => {
                navigate("Projects");
                setProjectAsked(Date.now());
              }}
              onPlanDay={planMyDay}
              onStartFocus={() => {
                const next = nextUp(items, undefined, 1)[0];
                if (next) startFocus(next);
                else planner.setError("Nothing is next up to focus on.");
              }}
              onShowToday={() => {
                navigate("Calendar");
                setCalendarDate(new Date());
                setCalendarMode("day");
              }}
              onToggleSidebar={toggleRail}
              onOpenSecurity={() => navigatePath("/security")}
              onNavigate={navigate}
              onApplyPlan={applyPlan}
              onOpenPlan={openPlan}
              onShowOnCalendar={showOnCalendar}
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
              onJumpToDate={jumpToDate}
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
          {user && user.first_run_done === false && (
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
          <Celebration />
        </div>
      </PlanningProviders>
    </PrefsContext.Provider>
  );
}
