import {
  Fragment,
  useContext,
  useId,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Boxes,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  CircleCheck,
  Copy,
  Crosshair,
  Download,
  FilePlus,
  History,
  Keyboard,
  LayoutTemplate,
  Link2,
  PanelLeft,
  Pin,
  PinOff,
  Plus,
  Repeat,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Wand2,
  Eye,
  Newspaper,
  Upload,
  Activity,
  Presentation,
  AppWindow,
  Archive,
  Folder,
  Star,
  Mic,
  type LucideIcon,
} from "lucide-react";
import {
  dateLabel,
  describeRrule,
  editedSince,
  findNamed,
  findSearchTeam,
  formatSearch,
  hasSearchFilters,
  parseQuickAdd,
  parseSearch,
  searchHitTarget,
  searchSummary,
  PERSONAL_SPACE,
  SEARCH_DATE_CHIPS,
  SEARCH_KIND_CHIPS,
  snippetRuns,
  type CalendarSearchResult,
  type Doc,
  type AssistantSource,
  type FindHit,
  type StarredItem,
  type Item,
  type LinkTarget,
  type Plan,
  type Project,
  type Proposal,
  type QuickAddChip,
  type QuickAddMember,
  type SearchFilters,
  type SearchHit,
  type Team,
} from "@orbyn/core";
import { session } from "../lib/session";
import { client } from "../lib/api";
import { celebrate } from "../lib/celebrate";
import { peekObject } from "../features/docs/DocLinks";
import { usePlanning } from "../app/planning";
import { NAV, type View } from "../app/views";
import {
  commandForKey,
  EMPTY_MEMORY,
  keysFor,
  orderCommands,
  readMemory,
  recordCommand,
  arrangeBarRows,
  linkAddsFirst,
  togglePinned,
  type CommandDef,
  type CommandIcon,
  type CommandMemory,
} from "../app/commands";
import { PageCommandScope, openPageCommands } from "../app/page-commands";
import { openInNewTab, wantsNewTab } from "../app/tabs";
import { usePrefs } from "../app/prefs";
import {
  deviceTimeZone,
  errorText,
  fromDayKey,
  minutesLabel,
} from "../lib/planning";
import { useModalFocus } from "../hooks/useModalFocus";
import { hasHigherDialog } from "../lib/dialogLayers";
import { Popover } from "./Popover";
import { ProposalReview } from "./ProposalReview";
import "./event-fields.css";
import "./command-bar.css";
import { CONCEPT_ICON } from "../app/concept-icons";

type Props = {
  /** What's starred, shown first with nothing typed (NAV-07). */
  starred?: StarredItem[];
  onOpenStarred?: (item: StarredItem) => void;
  items: Item[];
  /** Your teams: quick add finds teammates by name ("@anna"). */
  teams: Team[];
  /** You, so quick add can assign you but never invites you. */
  userId?: string;
  /** Whether the Admin screen is yours to open. */
  isAdmin?: boolean;
  /** The screen behind the bar: Shift+Enter makes a task on the task screens. */
  view?: View;
  /** Words to start with (a quick-add link, orbyn://search). */
  initialQuery?: string;
  /** Refocus an existing search without changing its query/results. */
  focusRequest?: number;
  /** An explicit search/add link supplies a fresh query. */
  queryRequest?: number;
  /**
   * The words came from an add or share link: making them leads, to
   * confirm with Enter. A search link's words only look for things.
   */
  initialAdd?: boolean;
  onClose: () => void;
  onOpenItem: (item: Item) => void;
  /** Opens a task or event by id (from the switcher). */
  onOpenItemById: (id: string) => void;
  onNewItem: () => void;
  onNewEvent: () => void;
  /** Makes a page (with this title) and opens it. */
  onNewPage: (title?: string) => void;
  onNewPageFromTemplate: () => void;
  onNewProject: () => void;
  onPlanDay: () => void;
  onStartFocus: () => void;
  onShowToday: () => void;
  onToggleSidebar: () => void;
  onOpenSecurity: () => void;
  onNavigate: (view: View) => void;
  /** Opens a document found by search. */
  onOpenDoc?: (doc: Doc, blockId?: string | null) => void;
  /** Opens the project found by search. */
  onGoToProjects?: (id: string) => void;
  /** Shows a day in the calendar (from an event search result). */
  onJumpToDate: (date: Date) => void;
  onApplyPlan: (plan: Plan, moves?: string[]) => Promise<string>;
  onOpenPlan: (plan: Plan) => void;
  /** After a plan is applied: the calendar at its first changed session. */
  onShowOnCalendar?: (at: string) => void;
  /** Opens a page the assistant read, at the line it cited. */
  onOpenSource?: (source: AssistantSource) => void;
  /** Opens a note once it has been kept. */
  onKeptNote?: (docId: string) => void;
  /** Refresh the planner after something is created or applied. */
  onApplied: () => Promise<void>;
  /** Opens the keyboard shortcut sheet. */
  onShowShortcuts: () => void;
  /** What's new (DSN-03), Recent changes (SHR-02), a setting (NAV-10). */
  onOpenWhatsNew?: () => void;
  onOpenChanges?: () => void;
  onOpenSetting?: (id: string) => void;
  report: (e: unknown) => void;
};

type Command = {
  id: string;
  label: ReactNode;
  hint?: string;
  icon: LucideIcon;
  /** A heading shown above the first command of a group. */
  group?: string;
  /** Keys that run it from anywhere, shown on the row. */
  keys?: string[];
  /** A command from the list, which can be pinned. */
  pinnable?: boolean;
  /** What ⌘Enter opens beside. */
  target?: LinkTarget;
  run: () => void;
};

type Ask = {
  question: string;
  proposal: Proposal | null;
  state: "pending" | "applied" | "discarded" | "info";
  error: string;
};

/** The longest text event search and quick add take (the assistant takes 4000). */
const duplicateName = (
  list: readonly { name: string }[],
  name: string | null,
) =>
  !!name &&
  list.filter(
    (row) => row.name.trim().toLowerCase() === name.trim().toLowerCase(),
  ).length > 1;
const uniqueNamed = <T extends { id: string; name: string }>(
  list: readonly T[],
  name: string | null,
) => (duplicateName(list, name) ? null : findNamed(list, name));

const SEARCH_MAX = 100;
const QUICK_MAX = 500;
const MEMORY_KEY = "orbyn-commands";
const MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent);

const ICONS: Record<CommandIcon, LucideIcon> = {
  view: ArrowUpRight,
  plus: Plus,
  calendarPlus: CalendarPlus,
  filePlus: FilePlus,
  template: LayoutTemplate,
  boxes: Boxes,
  wand: Wand2,
  focus: Crosshair,
  calendar: CalendarDays,
  keyboard: Keyboard,
  panel: PanelLeft,
  search: Search,
  link: Link2,
  copy: Copy,
  download: Download,
  history: History,
  sparkles: Sparkles,
  shield: ShieldCheck,
  eye: Eye,
  news: Newspaper,
  upload: Upload,
  activity: Activity,
  settings: Settings,
  present: Presentation,
  window: AppWindow,
  archive: Archive,
  folder: Folder,
  star: Star,
  mic: Mic,
};

const TYPE_ICONS: Record<string, LucideIcon> = {
  doc: CONCEPT_ICON.page,
  task: CONCEPT_ICON.task,
  event: CONCEPT_ICON.event,
  project: CONCEPT_ICON.project,
  record: CircleCheck,
};

/** A quick-add chip as a short readable label. */
function chipLabel(c: QuickAddChip) {
  switch (c.kind) {
    case "date":
      return fromDayKey(c.value).toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    case "time":
      return c.value.replace("-", "–");
    case "duration":
      return minutesLabel(Number(c.value));
    case "estimate":
      return `~${minutesLabel(Number(c.value))}`;
    case "all_day":
      return "All day";
    case "priority":
      return `${c.value} priority`;
    case "location":
      return `At ${c.value}`;
    case "repeat":
      return describeRrule(c.value);
    case "habit":
      return `Habit · ${c.value}`;
    default:
      return c.text;
  }
}

/** A snippet as one line of plain words, with the match markers taken out. */
const plainSnippet = (snippet: string | null | undefined) =>
  snippetRuns(snippet ?? "")
    .map((r) => r.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);

const loadMemory = (): CommandMemory => {
  try {
    return readMemory(localStorage.getItem(MEMORY_KEY));
  } catch {
    return EMPTY_MEMORY;
  }
};
const saveMemory = (memory: CommandMemory) => {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // A private window can refuse storage; the order lasts this visit.
  }
};

/** Where a switcher or search result opens, for ⌘Enter. */
const targetOf = (type: string, id: string): LinkTarget | undefined =>
  type === "doc"
    ? { kind: "doc", id }
    : type === "project"
      ? { kind: "project", id }
      : type === "task" || type === "event"
        ? { kind: "task", id }
        : undefined;

/**
 * ⌘K / Ctrl+K: jump to a page, task or project by name (recent ones first),
 * run any command, search with filters, add something from one line
 * ("Lunch with @anna fri 1pm ;Cafe Roma"), or ask the assistant.
 *
 * Enter opens, Shift+Enter makes what was typed (a page, or a task on the
 * task screens), ⌘Enter opens a result in a new tab. Arrow keys move,
 * Escape closes.
 */
export function CommandBar({
  items,
  teams,
  userId,
  isAdmin = false,
  view,
  initialQuery = "",
  focusRequest = 0,
  queryRequest = 0,
  initialAdd = false,
  onClose,
  onOpenItem,
  onOpenItemById,
  onNewItem,
  onNewEvent,
  onNewPage,
  onNewPageFromTemplate,
  onNewProject,
  onPlanDay,
  onStartFocus,
  onShowToday,
  onToggleSidebar,
  onOpenSecurity,
  onNavigate,
  onOpenDoc,
  onGoToProjects,
  onJumpToDate,
  onApplyPlan,
  onOpenPlan,
  onShowOnCalendar,
  onOpenSource,
  onKeptNote,
  onApplied,
  onShowShortcuts,
  onOpenWhatsNew,
  onOpenChanges,
  onOpenSetting,
  starred = [],
  onOpenStarred,
  report,
}: Props) {
  const { prefs } = usePrefs();
  const scope = useContext(PageCommandScope);
  const instance = useId();
  const listId = `${instance}-results`;
  const summaryId = `${instance}-summary`;
  const rowId = (id: string) => `${instance}-${id}`;
  const owner = useRef(session.get()).current;
  const mounted = useRef(true);
  const operation = useRef<object | null>(null);
  const owns = () => mounted.current && session.get() === owner;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [createdQuery, setCreatedQuery] = useState("");
  const [quickReceipt, setQuickReceipt] = useState<Awaited<
    ReturnType<typeof client.quickAdd>
  > | null>(null);
  const quickConfirmed = useRef<Awaited<
    ReturnType<typeof client.quickAdd>
  > | null>(null);
  /** Archived pages too (SRCH-03), for this search. */
  const [withArchived, setWithArchived] = useState(false);
  const { lists, tags } = usePlanning();
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const begin = () => {
    if (!owns() || operation.current) return null;
    const ticket = {};
    operation.current = ticket;
    setBusy(true);
    return ticket;
  };
  const finish = (ticket: object) => {
    if (operation.current !== ticket) return;
    operation.current = null;
    if (owns()) setBusy(false);
  };
  const [members, setMembers] = useState<QuickAddMember[]>([]);
  const [memberFailure, setMemberFailure] = useState(false);
  const [events, setEvents] = useState<CalendarSearchResult[]>([]);
  const [found, setFound] = useState<FindHit[]>([]);
  const [searchedValues, setSearched] = useState<SearchHit[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectStatus, setProjectStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [readAttempt, setReadAttempt] = useState(0);
  const foundReceipt = useRef("");
  const eventReceipt = useRef("");
  const searchReceipt = useRef("");
  const [findFailure, setFindFailure] = useState<string | null>(null);
  const [eventFailure, setEventFailure] = useState<string | null>(null);
  const [searchFailure, setSearchFailure] = useState<string | null>(null);
  const [memory, setMemory] = useState<CommandMemory>(loadMemory);
  const [filterChoices, setFilterChoices] = useState<
    Partial<Record<"project" | "tag" | "team", { id: string; name: string }>>
  >({});
  const [picking, setPicking] = useState<{
    kind: "project" | "tag" | "team" | "date";
    anchor: DOMRect;
  } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const modal = useModalFocus(onClose, busy);
  const querySeed = useRef(queryRequest);

  useEffect(() => {
    if (!busy && !ask && !hasHigherDialog(modal.ref.current))
      input.current?.focus({ preventScroll: true });
  }, [focusRequest]);
  useEffect(() => {
    if (querySeed.current === queryRequest || busy || ask) return;
    querySeed.current = queryRequest;
    setQuery(initialQuery);
    setFilterChoices({});
    setActive(0);
    setNotice("");
  }, [queryRequest, initialQuery, busy, ask]);

  // Teammates, for "@name" in quick add.
  useEffect(() => {
    setMembers([]);
    setMemberFailure(false);
    if (!teams.length) return;
    let alive = true;
    Promise.all(teams.map((t) => client.getTeam(t.id))).then(
      (details) => {
        if (!alive || !owns()) return;
        const byId = new Map<string, QuickAddMember>();
        for (const team of details)
          for (const m of team.members) {
            const known = byId.get(m.user_id);
            if (known) known.team_ids.push(team.id);
            else
              byId.set(m.user_id, {
                user_id: m.user_id,
                name: m.name,
                email: m.email,
                team_ids: [team.id],
              });
          }
        setMembers([...byId.values()]);
      },
      () => {
        if (alive && owns()) setMemberFailure(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [teams, readAttempt]);

  // Projects by name, for the Project filter.
  useEffect(() => {
    let alive = true;
    setProjectStatus("loading");
    setProjects([]);
    void client.listProjects().then(
      (rows) => {
        if (alive && owns()) {
          setProjects(rows);
          setProjectStatus("ready");
        }
      },
      () => {
        if (alive && owns()) {
          setProjects([]);
          setProjectStatus("error");
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [readAttempt]);

  const go = (fn: () => void) => () => {
    if (!owns() || operation.current) return;
    onClose();
    fn();
  };
  const q = query.trim();
  const filters = useMemo(() => parseSearch(query), [query]);
  const filtering = hasSearchFilters(filters);
  const foundKey = JSON.stringify([q, filtering, withArchived]);
  const eventKey = JSON.stringify([q, filtering]);
  const visibleFound = foundReceipt.current === foundKey ? found : [];
  const visibleEvents = eventReceipt.current === eventKey ? events : [];
  const words = filters.words;

  // The names a filter was typed with, as the lists hold them.
  const named = {
    project:
      filterChoices.project?.name === filters.project
        ? (projects.find(
            (project) => project.id === filterChoices.project?.id,
          ) ?? null)
        : uniqueNamed(projects, filters.project),
    tag:
      filterChoices.tag?.name === filters.tag
        ? (tags.find((tag) => tag.id === filterChoices.tag?.id) ?? null)
        : uniqueNamed(tags, filters.tag),
    team:
      filterChoices.team?.name === filters.team
        ? filterChoices.team.id === PERSONAL_SPACE.id
          ? PERSONAL_SPACE
          : (teams.find((team) => team.id === filterChoices.team?.id) ?? null)
        : duplicateName(teams, filters.team)
          ? null
          : findSearchTeam(teams, filters.team),
  };
  const unknown =
    filtering && words.length > 200
      ? "Use up to 200 characters for search."
      : filters.project && !named.project
        ? projectStatus === "loading"
          ? "Loading projects…"
          : projectStatus === "error"
            ? "Project filters unavailable."
            : duplicateName(projects, filters.project)
              ? "Choose a project from the filter."
              : `No project called “${filters.project}”.`
        : filters.tag && !named.tag
          ? duplicateName(tags, filters.tag)
            ? "Choose a tag from the filter."
            : `No tag called “${filters.tag}”.`
          : filters.team && !named.team
            ? duplicateName(teams, filters.team)
              ? "Choose a team from the filter."
              : `No team called “${filters.team}”.`
            : "";

  // The quick switcher: names from the first letter; with nothing typed,
  // what was opened last.
  useEffect(() => {
    if (filtering || q.length > 200) {
      setFound([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(
      () =>
        void client
          .find(q, {
            limit: q ? 8 : 10,
            ...(withArchived ? { include_archived: true } : {}),
          })
          .then(
            (hits) => {
              if (alive && owns()) {
                foundReceipt.current = foundKey;
                setFound(hits);
                setFindFailure(null);
              }
            },
            () => {
              if (alive && owns()) {
                foundReceipt.current = foundKey;
                setFound([]);
                setFindFailure(foundKey);
              }
            },
          ),
      q ? 120 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q, filtering, withArchived, readAttempt]);

  // A search with filters goes to the server's search, filters and all.
  const searchKey = filtering
    ? JSON.stringify([
        words,
        filters.type,
        named.project?.id,
        named.tag?.id,
        named.team?.id,
        filters.date,
        unknown,
        withArchived,
      ])
    : "";
  const searched = searchReceipt.current === searchKey ? searchedValues : null;
  useEffect(() => {
    if (!filtering) {
      setSearched(null);
      return;
    }
    if (unknown) {
      searchReceipt.current = searchKey;
      setSearched([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void client
        .search(words.slice(0, 200), {
          type: filters.type ?? undefined,
          project: named.project?.id,
          tag: named.tag?.id,
          team: named.team?.id,
          updated_after: filters.date ? editedSince(filters.date) : undefined,
          limit: 20,
          ...(withArchived ? { include_archived: true } : {}),
        })
        .then(
          (hits) => {
            if (alive && owns()) {
              searchReceipt.current = searchKey;
              setSearched(hits);
              setSearchFailure(null);
            }
          },
          (e) => {
            if (!alive || !owns()) return;
            searchReceipt.current = searchKey;
            setSearched([]);
            setSearchFailure(searchKey);
          },
        );
    }, 180);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [searchKey, readAttempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Events, past and future, once there's something to look for.
  useEffect(() => {
    if (filtering || q.length < 2 || q.length > SEARCH_MAX) {
      setEvents([]);
      return;
    }
    let alive = true;
    const id = setTimeout(() => {
      client.searchCalendar(q).then(
        (r) => {
          if (alive && owns()) {
            eventReceipt.current = eventKey;
            setEvents(r.results.slice(0, 5));
            setEventFailure(null);
          }
        },
        () => {
          if (alive && owns()) {
            eventReceipt.current = eventKey;
            setEvents([]);
            setEventFailure(eventKey);
          }
        },
      );
    }, 250);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [q, filtering, readAttempt]);

  // What the text would make as an item, parsed here without AI.
  const quick = useMemo(() => {
    if (!q || filtering || q.length > QUICK_MAX) return null;
    try {
      return parseQuickAdd(q, {
        timeZone: deviceTimeZone(),
        lists: lists.map((l) => ({
          id: l.id,
          name: l.name,
          team_id: l.team_id,
        })),
        tags: tags.map((t) => ({ id: t.id, name: t.name, team_id: t.team_id })),
        members,
        selfId: userId,
      });
    } catch {
      return null;
    }
  }, [q, filtering, lists, tags, members, userId]);

  const openQuickReceipt = () => {
    if (!owns() || operation.current || !quickConfirmed.current) return;
    const made = quickConfirmed.current;
    onClose();
    if (made.item) onOpenItem(made.item);
    else onNavigate("Settings");
  };
  const createQuick = async () => {
    if (q.length > QUICK_MAX) {
      setNotice(`Quick add accepts up to ${QUICK_MAX} characters.`);
      return;
    }
    if (quickConfirmed.current && createdQuery === q) {
      openQuickReceipt();
      return;
    }
    const ticket = begin();
    if (!ticket) return;
    setNotice("");
    try {
      const created = await client.quickAdd(q, deviceTimeZone());
      if (!owns()) return;
      quickConfirmed.current = created;
      setCreatedQuery(q);
      setQuickReceipt(created);
      try {
        await onApplied();
      } catch {
        if (owns())
          setNotice("Created. Refresh your planner to update the list.");
        return;
      }
      if (!owns()) return;
      onClose();
      if (created.item) onOpenItem(created.item);
      else onNavigate("Settings");
    } catch (e) {
      if (!owns()) return;
      if ((e as { status?: number }).status === 401) report(e);
      setNotice(errorText(e));
    } finally {
      finish(ticket);
    }
  };

  /** Keep the search owned until a document read confirms its destination. */
  const openFound = async (
    type: string,
    id: string,
    blockId?: string | null,
  ) => {
    const ticket = begin();
    if (!ticket) return;
    setNotice("");
    try {
      const full = type === "doc" ? await client.getDoc(id) : null;
      if (!owns()) return;
      onClose();
      if (full) onOpenDoc?.(full, blockId);
      else if (type === "project") onGoToProjects?.(id);
      else if (type === "task" || type === "event") onOpenItemById(id);
    } catch (e) {
      if (owns()) {
        setNotice(errorText(e));
        if ((e as { status?: number }).status === 401) report(e);
      }
    } finally {
      finish(ticket);
    }
  };

  // ------------------------------------------------------------ commands
  const pageOpen = openPageCommands(scope);
  const runDef = (def: CommandDef) => {
    if (!owns() || operation.current) return;
    const next = recordCommand(memory, def.id);
    setMemory(next);
    saveMemory(next);
    onClose();
    if (def.view) return onNavigate(def.view);
    if (def.needs === "page") return pageOpen?.run[def.id]?.();
    if (def.setting) return onOpenSetting?.(def.setting);
    const actions: Record<string, () => void> = {
      "new.task": onNewItem,
      "new.event": onNewEvent,
      "new.page": () => onNewPage(),
      "new.from-template": onNewPageFromTemplate,
      "new.project": onNewProject,
      "plan.day": onPlanDay,
      "plan.focus": onStartFocus,
      "plan.today": onShowToday,
      "app.shortcuts": onShowShortcuts,
      "app.sidebar": onToggleSidebar,
      "app.security": onOpenSecurity,
      "app.whats-new": () => onOpenWhatsNew?.(),
      "app.changes": () => onOpenChanges?.(),
      "new.import": () => onOpenSetting?.("import"),
    };
    actions[def.id]?.();
  };
  const pin = (id: string) => {
    const next = togglePinned(memory, id);
    setMemory(next);
    saveMemory(next);
  };
  const listed = filtering
    ? []
    : orderCommands(
        words,
        memory,
        (c) =>
          c.id !== "app.search" &&
          (c.needs !== "admin" || isAdmin) &&
          (c.needs !== "page" || !!pageOpen?.run[c.id]),
      );
  // With nothing typed, the pinned and recent commands lead and the rest
  // wait below what was opened last; typed, they follow what was found.
  const commandRows = listed.map((c): Command => ({
    id: "cmd-" + c.id,
    label:
      c.needs === "page" && pageOpen ? (
        <>
          {c.label} <em className="command-page">· {pageOpen.title}</em>
        </>
      ) : (
        c.label
      ),
    icon: c.view
      ? c.view === "Settings"
        ? Settings
        : (NAV.find((n) => n.label === c.view)?.icon ?? ArrowUpRight)
      : ICONS[c.icon],
    group: c.section,
    keys: keysFor(c, MAC, prefs.shortcuts),
    pinnable: true,
    run: () => runDef(c),
  }));
  // With nothing typed, what's starred comes first (NAV-07).
  const starredRows: Command[] =
    q || !onOpenStarred
      ? []
      : starred.slice(0, 6).map((s) => ({
          id: `star-${s.kind}-${s.id}-${s.block_id}`,
          label: s.title,
          hint: s.hint ?? undefined,
          icon:
            s.kind === "heading"
              ? Star
              : s.kind === "view"
                ? Pin
                : (TYPE_ICONS[s.kind] ?? Star),
          group: "Starred",
          run: () => {
            onClose();
            onOpenStarred(s);
          },
        }));
  const leading = q
    ? []
    : [...starredRows, ...commandRows].filter(
        (c) =>
          c.group === "Starred" ||
          c.group === "Pinned" ||
          c.group === "Recent commands",
      );
  const trailing = q
    ? commandRows
    : commandRows.filter(
        (c) => c.group !== "Pinned" && c.group !== "Recent commands",
      );

  const foundRows = visibleFound.map((h): Command => ({
    id: `find-${h.type}-${h.id}`,
    label: h.title,
    hint: h.hint ?? undefined,
    icon: TYPE_ICONS[h.type] ?? Search,
    group: q ? "Jump to" : "Recent",
    target: targetOf(h.type, h.id),
    run: () => openFound(h.type, h.id),
  }));

  // A work record (a decision, a promise) opens its project.
  const searchRows = (searched ?? []).flatMap((h): Command[] => {
    const to = searchHitTarget(h);
    if (!to) return [];
    return [
      {
        id: `search-${h.type}-${h.id}`,
        label: h.title || "Untitled",
        hint:
          plainSnippet(h.snippet) ||
          (h.project_name && h.type !== "project" ? h.project_name : undefined),
        icon: TYPE_ICONS[h.type] ?? Search,
        group: "Results",
        target: targetOf(to.type, to.id),
        run: () => openFound(to.type, to.id, h.block_id),
      },
    ];
  });

  const eventRows = visibleEvents.map((e, n): Command => ({
    id: "event-" + n,
    label: e.title,
    hint:
      dateLabel(e.start_at) + (e.source === "external" ? ` · ${e.name}` : ""),
    icon: CalendarDays,
    group: "Events",
    run: go(() => onJumpToDate(new Date(e.start_at))),
  }));
  const chips = (quick?.chips ?? []).filter((c) => c.kind !== "kind");
  const quickCommand: Command | null =
    quickReceipt && createdQuery === q
      ? {
          id: "created",
          label: `Open created ${quickReceipt.item?.title ?? "habit"}`,
          icon: ArrowUpRight,
          run: openQuickReceipt,
        }
      : quick && quick.input.title
        ? {
            id: "quick",
            label: (
              <>
                {quick.habit
                  ? "Create habit"
                  : quick.input.kind === "event"
                    ? "Create event"
                    : "Create task"}
                : <em>“{quick.input.title}”</em>
                {chips.length > 0 && (
                  <span className="quick-chips">
                    {chips.map((c, n) => (
                      <span key={n} className="quick-chip">
                        {chipLabel(c)}
                      </span>
                    ))}
                  </span>
                )}
              </>
            ),
            icon: quick.habit
              ? Repeat
              : quick.input.kind === "event"
                ? CalendarPlus
                : Plus,
            run: () => void createQuick(),
          }
        : null;
  const askCommand: Command | null =
    q && !filtering
      ? {
          id: "ask",
          label: (
            <>
              Ask the assistant: <em>“{q}”</em>
            </>
          ),
          icon: Sparkles,
          run: () => void startAsk(q),
        }
      : null;
  // Questions go to the assistant first; text quick add understood makes
  // the item first; short words look for things.
  const wordCount = q.split(/\s+/).filter(Boolean).length;
  const question = /\?$/.test(q) || (!chips.length && wordCount >= 4);
  const quickFirst = !!quickCommand && !question && chips.length > 0;
  // A link that brought words to add puts making them first, to confirm;
  // a search link never does.
  const addFirst = linkAddsFirst({ words: initialQuery, add: initialAdd }, q);
  const commands: Command[] = filtering
    ? searchRows
    : arrangeBarRows(
        {
          ask: askCommand,
          quick: quickCommand,
          leading,
          found: foundRows,
          events: eventRows,
          trailing,
        },
        { question, quickFirst, addFirst },
      );
  const current = Math.min(active, Math.max(0, commands.length - 1));
  const activeResultId = commands[current]?.id;
  useEffect(() => {
    if (!activeResultId) return;
    const row = document.getElementById(rowId(activeResultId));
    if (row && modal.ref.current?.contains(row))
      row.scrollIntoView({ block: "nearest" });
  }, [activeResultId]);

  /** Shift+Enter: make what was typed, a task on the task screens. */
  const createTyped = () => {
    if (!owns() || operation.current || !words) return;
    if (view === "My tasks" || view === "Lists") void createQuick();
    else {
      if (words.length > 200) {
        setNotice(
          "Page titles can have up to 200 characters. Shorten the title.",
        );
        return;
      }
      onClose();
      onNewPage(words);
    }
  };

  const startAsk = async (text: string) => {
    const ticket = begin();
    if (!ticket) return;
    setAsk({ question: text, proposal: null, state: "info", error: "" });
    try {
      const { proposal } = await client.chat(text, deviceTimeZone(), []);
      if (owns())
        setAsk({
          question: text,
          proposal,
          state: proposal.actions.length ? "pending" : "info",
          error: "",
        });
    } catch (e) {
      if (!owns()) return;
      if ((e as { status?: number }).status === 401) report(e);
      setAsk({
        question: text,
        proposal: null,
        state: "info",
        error: errorText(e),
      });
    } finally {
      finish(ticket);
    }
  };

  const apply = async () => {
    if (!ask?.proposal || ask.state !== "pending") return;
    const ticket = begin();
    if (!ticket) return;
    let applied = false;
    setAsk({ ...ask, error: "" });
    try {
      await client.applyProposal(ask.proposal.id);
      if (!owns()) return;
      applied = true;
      setAsk({ ...ask, state: "applied", error: "" });
      const finished = ask.proposal.actions.some(
        (a) =>
          a.operation === "update" &&
          a.data?.status === "done" &&
          items.find((i) => i.id === a.item_id)?.status !== "done",
      );
      if (finished) celebrate();
      await onApplied();
    } catch (e) {
      if (owns())
        setAsk({
          ...ask,
          state: applied ? "applied" : ask.state,
          error: applied
            ? "Changes saved. Refresh your planner to update the list."
            : errorText(e),
        });
    } finally {
      finish(ticket);
    }
  };

  /** Change one filter, keeping the rest and the words. */
  const setFilter = (
    change: Partial<SearchFilters>,
    choice?: { kind: "project" | "tag" | "team"; id: string; name: string },
  ) => {
    if (!owns() || operation.current) return;
    setFilterChoices((previous) => {
      const next = { ...previous };
      for (const kind of ["project", "tag", "team"] as const) {
        if (Object.prototype.hasOwnProperty.call(change, kind)) {
          if (choice?.kind === kind && change[kind] !== null)
            next[kind] = { id: choice.id, name: choice.name };
          else delete next[kind];
        }
      }
      return next;
    });
    setQuery(formatSearch({ ...filters, ...change }));
    setActive(0);
    setPicking(null);
    input.current?.focus();
  };

  // The open search owns repeat-search shortcuts; modal focus owns Escape/Tab.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        busy ||
        ask ||
        event.key === "Escape" ||
        event.key === "Tab" ||
        (event.target instanceof HTMLElement &&
          !!event.target.closest("[data-modal-owner]")) ||
        !modal.ref.current ||
        hasHigherDialog(modal.ref.current)
      )
        return;
      if (commandForKey(event, prefs.shortcuts)?.id !== "app.search") return;
      event.preventDefault();
      input.current?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [prefs.shortcuts, busy, ask]);

  const pickOptions: {
    id?: string;
    label: string;
    pick: () => void;
    on: boolean;
  }[] =
    picking?.kind === "project"
      ? projects
          .filter((p) => p.status !== "archived")
          .map((p) => ({
            id: p.id,
            label: `${p.name} · ${p.team_id ? p.team_name || teams.find((t) => t.id === p.team_id)?.name || "Team" : "Personal"}`,
            on: named.project?.id === p.id,
            pick: () =>
              setFilter(
                { project: named.project?.id === p.id ? null : p.name },
                { kind: "project", id: p.id, name: p.name },
              ),
          }))
      : picking?.kind === "tag"
        ? tags.map((t) => ({
            id: t.id,
            label: `${t.name} · ${t.team_id ? teams.find((team) => team.id === t.team_id)?.name || "Team" : "Personal"}`,
            on: named.tag?.id === t.id,
            pick: () =>
              setFilter(
                { tag: named.tag?.id === t.id ? null : t.name },
                { kind: "tag", id: t.id, name: t.name },
              ),
          }))
        : picking?.kind === "team"
          ? [
              {
                label: "Personal (no team)",
                on: named.team?.id === PERSONAL_SPACE.id,
                pick: () =>
                  setFilter(
                    {
                      team:
                        named.team?.id === PERSONAL_SPACE.id
                          ? null
                          : PERSONAL_SPACE.id,
                    },
                    {
                      kind: "team",
                      id: PERSONAL_SPACE.id,
                      name: PERSONAL_SPACE.id,
                    },
                  ),
              },
              ...teams.map((t) => ({
                id: t.id,
                label: t.name,
                on: named.team?.id === t.id,
                pick: () =>
                  setFilter(
                    { team: named.team?.id === t.id ? null : t.name },
                    { kind: "team", id: t.id, name: t.name },
                  ),
              })),
            ]
          : picking?.kind === "date"
            ? SEARCH_DATE_CHIPS.map((d) => ({
                label: d.label,
                on: filters.date === d.date,
                pick: () =>
                  setFilter({
                    date: filters.date === d.date ? null : d.date,
                  }),
              }))
            : [];
  const dropChip = (
    kind: "project" | "tag" | "team" | "date",
    label: string,
    value: string | null,
  ) => (
    <button
      type="button"
      className={value ? "active" : ""}
      disabled={busy}
      aria-haspopup="menu"
      aria-expanded={picking?.kind === kind}
      onClick={(e) =>
        setPicking(
          picking?.kind === kind
            ? null
            : { kind, anchor: e.currentTarget.getBoundingClientRect() },
        )
      }
    >
      {value ?? label} <ChevronDown size={12} aria-hidden="true" />
    </button>
  );

  return (
    <div
      className="command-backdrop"
      onMouseDown={(e) => {
        if (!busy && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={(node) => {
          modal.ref.current = node;
        }}
        tabIndex={-1}
        data-modal-focus={modal.id}
        className="command-bar scale-in"
        role="dialog"
        aria-modal="true"
        aria-label="Search, add or ask"
      >
        {ask ? (
          <div className="command-ask">
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                setAsk(null);
                setTimeout(() => input.current?.focus(), 0);
              }}
            >
              <ArrowLeft size={14} /> Back to search
            </button>
            <p className="command-question">{ask.question}</p>
            <div aria-live="polite">
              {ask.error && (
                <div className="error" role="alert">
                  {ask.error}
                </div>
              )}
              {busy && !ask.proposal ? (
                <p className="muted" role="status">
                  <Sparkles size={14} /> Thinking…
                </p>
              ) : ask.proposal ? (
                <ProposalReview
                  proposal={ask.proposal}
                  items={items}
                  busy={busy}
                  state={ask.state}
                  onApply={() => void apply()}
                  onDismiss={() => setAsk({ ...ask, state: "discarded" })}
                  onApplyPlan={onApplyPlan}
                  onOpenSource={
                    onOpenSource &&
                    ((source) => {
                      if (owns() && !operation.current) {
                        onClose();
                        onOpenSource(source);
                      }
                    })
                  }
                  onKeptNote={
                    onKeptNote &&
                    ((id) => {
                      if (owns()) {
                        onClose();
                        onKeptNote(id);
                      }
                    })
                  }
                  onOpenPlan={(plan) => {
                    onClose();
                    onOpenPlan(plan);
                  }}
                  onShowOnCalendar={
                    onShowOnCalendar &&
                    ((at) => {
                      onClose();
                      onShowOnCalendar(at);
                    })
                  }
                />
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <div className="command-input">
              <Search size={17} aria-hidden="true" />
              <input
                ref={input}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={
                  commands[current] ? rowId(commands[current].id) : undefined
                }
                aria-autocomplete="list"
                aria-label="Search, add something, or ask the assistant"
                aria-describedby={summaryId}
                placeholder="Search, add or ask…"
                value={query}
                maxLength={4000}
                disabled={busy}
                onChange={(e) => {
                  const nextQuery = e.target.value;
                  const nextFilters = parseSearch(nextQuery);
                  setFilterChoices((previous) => {
                    const next = { ...previous };
                    for (const kind of ["project", "tag", "team"] as const)
                      if (next[kind]?.name !== nextFilters[kind])
                        delete next[kind];
                    return next;
                  });
                  setQuery(nextQuery);
                  setActive(0);
                  setNotice("");
                }}
                onKeyDown={(e) => {
                  if (!owns() || operation.current) return;
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((current + 1) % Math.max(1, commands.length));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive(
                      (current - 1 + commands.length) %
                        Math.max(1, commands.length),
                    );
                  } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    const chosen = commands[current];
                    if (e.shiftKey) createTyped();
                    else if ((e.metaKey || e.ctrlKey) && chosen?.target) {
                      // Beside what is open, not a new tab (NAV-05).
                      const t = chosen.target;
                      onClose();
                      peekObject({ kind: t.kind, id: t.id });
                    } else chosen?.run();
                  }
                }}
              />
              <kbd>Esc</kbd>
            </div>
            <div
              className="filter-chips command-filters"
              role="group"
              aria-label="Narrow the search"
            >
              {SEARCH_KIND_CHIPS.map((chip) => (
                <button
                  key={chip.kind}
                  type="button"
                  disabled={busy}
                  className={filters.type === chip.kind ? "active" : ""}
                  aria-pressed={filters.type === chip.kind}
                  onClick={() =>
                    setFilter({
                      type: filters.type === chip.kind ? null : chip.kind,
                    })
                  }
                >
                  {chip.label}
                </button>
              ))}
              {dropChip("project", "Project", named.project?.name ?? null)}
              {dropChip("tag", "Tag", named.tag?.name ?? null)}
              {(teams.length > 0 || !!filters.team) &&
                dropChip("team", "Team", named.team?.name ?? null)}
              {dropChip(
                "date",
                "Date",
                SEARCH_DATE_CHIPS.find((d) => d.date === filters.date)?.label ??
                  null,
              )}
              <button
                type="button"
                className={withArchived ? "active" : ""}
                disabled={busy}
                aria-pressed={withArchived}
                title="Find archived pages too"
                onClick={() => setWithArchived((v) => !v)}
              >
                Include archived
              </button>
            </div>
            {picking && (
              <Popover
                anchor={picking.anchor}
                label={`Choose a ${picking.kind}`}
                onClose={() => setPicking(null)}
                width={240}
              >
                <div className="doc-menu" role="menu">
                  {pickOptions.length ? (
                    pickOptions.map((o) => (
                      <button
                        key={o.id ?? o.label}
                        className={"doc-menu-item" + (o.on ? " is-on" : "")}
                        role="menuitemcheckbox"
                        aria-checked={o.on}
                        onClick={o.pick}
                      >
                        {o.label}
                      </button>
                    ))
                  ) : (
                    <p className="muted command-pick-empty">
                      {picking.kind === "project"
                        ? projectStatus === "loading"
                          ? "Loading projects…"
                          : projectStatus === "error"
                            ? "Project filters unavailable."
                            : "No projects yet."
                        : "Nothing to choose yet."}
                      {picking.kind === "project" &&
                        projectStatus === "error" && (
                          <button
                            type="button"
                            className="secondary"
                            onClick={() =>
                              setReadAttempt((attempt) => attempt + 1)
                            }
                          >
                            Retry
                          </button>
                        )}
                    </p>
                  )}
                </div>
              </Popover>
            )}
            <p
              id={summaryId}
              className={"command-summary" + (filtering ? "" : " is-keys")}
              role="status"
              aria-live="polite"
            >
              {filtering
                ? unknown || searchSummary(filters)
                : q
                  ? "Enter to open"
                  : "Recently opened"}
            </p>
            <details className="command-help">
              <summary>Search tips</summary>
              <p>Use tag:, project: or is:task to narrow results.</p>
              <p>
                Enter opens · Shift+Enter creates · {MAC ? "⌘" : "Ctrl+"}Enter
                opens beside.
              </p>
            </details>
            {quickReceipt && (createdQuery !== q || filtering) && (
              <div className="command-recovery">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={openQuickReceipt}
                >
                  {quickReceipt.item
                    ? `Open “${quickReceipt.item.title}”`
                    : "Open habit settings"}
                </button>
              </div>
            )}
            {busy && (
              <p className="command-summary" role="status">
                Working…
              </p>
            )}
            {((!filtering && findFailure === foundKey) ||
              (filtering && searchFailure === searchKey && !unknown) ||
              (!filtering && eventFailure === eventKey && q.length >= 2)) && (
              <div className="command-recovery" role="alert">
                <span>
                  {filtering
                    ? "Search unavailable."
                    : findFailure === foundKey
                      ? "Search unavailable. Commands still work."
                      : "Event search unavailable."}
                </span>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setReadAttempt((attempt) => attempt + 1)}
                >
                  Retry
                </button>
              </div>
            )}
            {memberFailure && !filtering && q.includes("@") && (
              <div className="command-recovery" role="alert">
                <span>
                  Teammates unavailable. Retry before assigning someone.
                </span>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setReadAttempt((attempt) => attempt + 1)}
                >
                  Retry
                </button>
              </div>
            )}
            {notice && (
              <div className="error" role="alert">
                {notice}
              </div>
            )}
            <ul
              id={listId}
              role="listbox"
              aria-label="Results"
              className="command-list"
            >
              {commands.map((c, n) => {
                const Icon = c.icon;
                const heading =
                  c.group && c.group !== commands[n - 1]?.group
                    ? c.group
                    : null;
                const pinned = memory.pinned.includes(c.id.slice(4));
                return (
                  <Fragment key={c.id}>
                    {heading && (
                      <li role="presentation" className="command-group">
                        {heading}
                      </li>
                    )}
                    <li
                      id={rowId(c.id)}
                      role="option"
                      aria-selected={n === current}
                      className={n === current ? "active" : ""}
                      onMouseEnter={() => {
                        if (!operation.current) setActive(n);
                      }}
                      onMouseDown={(e) => e.preventDefault()}
                      aria-disabled={busy}
                      onClick={(e) => {
                        if (!owns() || operation.current) return;
                        // ⌘-click a page or project: a new tab (W4).
                        const t = c.target;
                        if (t && t.kind !== "task" && wantsNewTab(e)) {
                          onClose();
                          openInNewTab({ kind: t.kind, id: t.id });
                        } else c.run();
                      }}
                      onAuxClick={(e) => {
                        if (!owns() || operation.current) return;
                        const t = c.target;
                        if (!t || t.kind === "task" || !wantsNewTab(e)) return;
                        e.preventDefault();
                        onClose();
                        openInNewTab({ kind: t.kind, id: t.id });
                      }}
                    >
                      <Icon size={15} aria-hidden="true" />
                      <span className="command-label">{c.label}</span>
                      {c.hint && <small>{c.hint}</small>}
                      {c.keys?.map((k) => (
                        <kbd key={k}>{k}</kbd>
                      ))}
                      {c.pinnable && (
                        <button
                          type="button"
                          className={
                            "icon-button command-pin" + (pinned ? " is-on" : "")
                          }
                          tabIndex={0}
                          disabled={busy}
                          aria-label={pinned ? "Unpin" : "Pin to the top"}
                          title={pinned ? "Unpin" : "Pin to the top"}
                          onClick={(e) => {
                            e.stopPropagation();
                            pin(c.id.slice(4));
                          }}
                        >
                          {pinned ? <PinOff size={13} /> : <Pin size={13} />}
                        </button>
                      )}
                    </li>
                  </Fragment>
                );
              })}
              {!commands.length &&
                !unknown &&
                !(filtering && searchFailure === searchKey) && (
                  <li role="presentation" className="command-empty">
                    {filtering
                      ? searched === null
                        ? "Looking…"
                        : searchFailure === searchKey
                          ? "Search unavailable."
                          : unknown || "Nothing matches these filters."
                      : "Nothing matches. Type a question to ask the assistant."}
                  </li>
                )}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
