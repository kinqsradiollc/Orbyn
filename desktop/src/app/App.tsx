import { useCallback, useEffect, useRef, useState } from "react";
import { Orbit, X } from "lucide-react";
import {
  deadlineOf,
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
import { commandForKey, type KeyedCommand } from "./commands";
import { usePlannedData } from "../hooks/usePlannedData";
import { PlanningProviders } from "./PlanningProviders";
import { Sidebar } from "../components/Sidebar";
import {
  AnnouncementBanner,
  MaintenanceBanner,
  UpdateBanner,
} from "../components/SystemBanners";
import { PageHeading, Topbar } from "../components/Topbar";
import { ItemEditor } from "../components/ItemEditor";
import { CommandBar } from "../components/CommandBar";
import { Celebration } from "../components/Celebration";
import { ShortcutSheet } from "../components/ShortcutSheet";
import { celebrate } from "../lib/celebrate";
import { isTyping } from "../lib/keys";
import { appliedText } from "../components/PlanCard";
import { nextUp } from "../lib/planning";
import { HomePage } from "../features/home/HomePage";
import { LegalPage } from "../features/legal/LegalPage";
import { StudyView } from "../features/study/StudyView";
import { ConsentGate } from "../features/legal/ConsentGate";
import { StatusPage } from "../features/status/StatusPage";
import { SecurityPage } from "../features/legal/SecurityPage";
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
import type { AssistantSource, Doc, LegalSummary } from "@orbyn/core";
import { DocsView } from "../features/docs/DocsView";
import { AgendaView } from "../features/docs/AgendaView";
import { ProjectsView } from "../features/projects/ProjectsView";
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
import type { View } from "./views";
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
  const planned = usePlannedData(token, revision);
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
  const [view, setView] = useState<View>("Overview");
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
    else if (link.kind === "review") setView("Notifications");
    else setView("Overview");
  };
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
  useEffect(() => {
    if (!linked) return;
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
                : token
                  ? { title: view + " · Orbyn", description: app, index: false }
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
    path === "/terms" ||
    path === "/privacy" ||
    path === "/security" ||
    (!nativeDesktop && path === "/")
  );
  useEffect(() => {
    if (!token || isPublicBooking || !inShell) return;
    // The keys come from the one command list (commands.ts): what a key
    // does is looked up there, then run here.
    const run: Record<KeyedCommand, () => void> = {
      "app.search": () => {
        setCommandQuery("");
        setCommandAdd(false);
        setCommandOpen((open) => !open);
      },
      "app.sidebar": () => toggleRail(),
      "app.shortcuts": () => setShortcutsOpen(true),
      "new.task": () => newItem(),
    };
    const onKey = (e: KeyboardEvent) => {
      const command = commandForKey(e);
      const action = command && run[command.id as KeyedCommand];
      if (!command || !action) return;
      // ⌘ and Ctrl shortcuts work while typing; single keys don't, and
      // wait while a dialog or popover is open.
      const withMod = command.keys?.[0] === "mod";
      if (
        !withMod &&
        (e.defaultPrevented ||
          isTyping(e) ||
          document.querySelector('[aria-modal="true"], .popover'))
      )
        return;
      e.preventDefault();
      action();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [token, isPublicBooking, inShell]);

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
    // A failure belongs to the view it happened in.
    if (v !== view) planner.setError("");
    setView(v);
    setMobileNav(false);
    setQuery("");
    setPlanRequest(null);
    setBookingFocus(null);
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

  return (
    <PlanningProviders planning={planning} planned={planned}>
      <div className={"app" + (railed ? " is-railed" : "")}>
        <Sidebar
          open={mobileNav}
          railed={railed}
          onToggleRail={toggleRail}
          view={view}
          user={user}
          hasUnread={notices.some((n) => !n.read)}
          onNavigate={navigate}
          onSignOut={() => void planner.logout()}
        />
        <div className="shell">
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
            onToggleMenu={() => setMobileNav(!mobileNav)}
            onOpenNotifications={() => navigate("Notifications")}
            onOpenCommand={() => openCommand()}
          />
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
            <div key={view} className="view-enter">
              {view !== "AI assistant" && (
                <PageHeading
                  view={view}
                  user={user}
                  onNewItem={() => newItem()}
                />
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
              {view === "My tasks" && (
                <TasksView
                  {...listProps}
                  query={query}
                  onQueryChange={setQuery}
                  onSetStatus={setStatus}
                  userId={user?.id}
                  onChanged={refresh}
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
                  onItemsChanged={() => void refresh()}
                />
              )}
              {view === "Docs" && (
                <DocsView
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
                  onInitialDocShown={() => {
                    setNoteDoc(null);
                    setNoteBlockId(null);
                  }}
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
                />
              )}
              {view === "Teams" && <TeamsView teams={teams} {...teamActions} />}
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
                  onOpenDoc={(id) =>
                    void client.getDoc(id).then((doc) => {
                      setNoteDoc(doc);
                      navigate("Docs");
                    }, report)
                  }
                />
              )}
              {view === "Settings" && (
                <SettingsView
                  user={user}
                  teams={teams}
                  busy={busy}
                  report={report}
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
                A little more clarity. A little more you. <Orbit size={14} />
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
                  !series && event.rrule && openOccurrence?.itemId === event.id
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
            key={editing === "new" ? "new" : editing.id + ":" + editing.version}
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
            teams={teams}
            userId={user?.id}
            onJumpToDate={jumpToDate}
            report={report}
          />
        )}
        {shortcutsOpen && (
          <ShortcutSheet onClose={() => setShortcutsOpen(false)} />
        )}
        <Celebration />
      </div>
    </PlanningProviders>
  );
}
