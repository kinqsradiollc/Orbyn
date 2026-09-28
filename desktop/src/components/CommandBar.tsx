import {
  Fragment,
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
  type DocSource,
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
import { client } from "../lib/api";
import { celebrate } from "../lib/celebrate";
import { peekObject } from "../features/docs/DocLinks";
import { usePlanning } from "../app/planning";
import { NAV, type View } from "../app/views";
import {
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
import { openPageCommands } from "../app/page-commands";
import { usePrefs } from "../app/prefs";
import {
  deviceTimeZone,
  errorText,
  fromDayKey,
  minutesLabel,
} from "../lib/planning";
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
  onOpenSource?: (source: DocSource) => void;
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
  /** Archived pages too (SRCH-03), for this search. */
  const [withArchived, setWithArchived] = useState(false);
  const { lists, tags } = usePlanning();
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [members, setMembers] = useState<QuickAddMember[]>([]);
  const [events, setEvents] = useState<CalendarSearchResult[]>([]);
  const [found, setFound] = useState<FindHit[]>([]);
  const [searched, setSearched] = useState<SearchHit[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [memory, setMemory] = useState<CommandMemory>(loadMemory);
  const [picking, setPicking] = useState<{
    kind: "project" | "tag" | "team" | "date";
    anchor: DOMRect;
  } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => opener?.focus?.();
  }, []);

  // Teammates, for "@name" in quick add.
  useEffect(() => {
    if (!teams.length) return;
    let alive = true;
    Promise.all(teams.map((t) => client.getTeam(t.id))).then(
      (details) => {
        if (!alive) return;
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
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [teams]);

  // Projects by name, for the Project filter.
  useEffect(() => {
    void client.listProjects().then(setProjects, () => setProjects([]));
  }, []);

  const go = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const q = query.trim();
  const filters = useMemo(() => parseSearch(query), [query]);
  const filtering = hasSearchFilters(filters);
  const words = filters.words;

  // The names a filter was typed with, as the lists hold them.
  const named = {
    project: findNamed(projects, filters.project),
    tag: findNamed(tags, filters.tag),
    team: findSearchTeam(teams, filters.team),
  };
  const unknown =
    filters.project && !named.project
      ? `No project called “${filters.project}”.`
      : filters.tag && !named.tag
        ? `No tag called “${filters.tag}”.`
        : filters.team && !named.team
          ? `No team called “${filters.team}”.`
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
            (hits) => alive && setFound(hits),
            () => alive && setFound([]),
          ),
      q ? 120 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q, filtering, withArchived]);

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
  useEffect(() => {
    if (!filtering) {
      setSearched(null);
      return;
    }
    if (unknown) {
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
          (hits) => alive && setSearched(hits),
          (e) => {
            if (!alive) return;
            setSearched([]);
            setNotice(errorText(e));
          },
        );
    }, 180);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [searchKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Events, past and future, once there's something to look for.
  useEffect(() => {
    if (filtering || q.length < 2 || q.length > SEARCH_MAX) {
      setEvents([]);
      return;
    }
    let alive = true;
    const id = setTimeout(() => {
      client.searchCalendar(q).then(
        (r) => alive && setEvents(r.results.slice(0, 5)),
        () => alive && setEvents([]),
      );
    }, 250);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [q, filtering]);

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

  const createQuick = async () => {
    if (q.length > QUICK_MAX) return;
    setBusy(true);
    setNotice("");
    try {
      const created = await client.quickAdd(q, deviceTimeZone());
      await onApplied();
      onClose();
      // A habit has no item to open: the planner finds its time.
      if (created.item) onOpenItem(created.item);
      else onNavigate("Settings");
    } catch (e) {
      if ((e as { status?: number }).status === 401) report(e);
      setNotice(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  /** Open a page, task or project the switcher or search found. */
  const openFound = (type: string, id: string, blockId?: string | null) => {
    onClose();
    if (type === "doc")
      void client
        .getDoc(id)
        .then((full) => onOpenDoc?.(full, blockId))
        .catch(report);
    else if (type === "project") onGoToProjects?.(id);
    else if (type === "task" || type === "event") onOpenItemById(id);
  };

  // ------------------------------------------------------------ commands
  const pageOpen = openPageCommands();
  const runDef = (def: CommandDef) => {
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

  const foundRows = found.map((h): Command => ({
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

  const eventRows = events.map((e, n): Command => ({
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
    quick && quick.input.title
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

  /** Shift+Enter: make what was typed, a task on the task screens. */
  const createTyped = () => {
    if (!words) return;
    if (view === "My tasks" || view === "Lists") void createQuick();
    else {
      onClose();
      onNewPage(words.slice(0, 200));
    }
  };

  const startAsk = async (text: string) => {
    setAsk({ question: text, proposal: null, state: "info", error: "" });
    setBusy(true);
    try {
      const { proposal } = await client.chat(text, deviceTimeZone(), []);
      setAsk({
        question: text,
        proposal,
        state: proposal.actions.length ? "pending" : "info",
        error: "",
      });
    } catch (e) {
      if ((e as { status?: number }).status === 401) report(e);
      setAsk({
        question: text,
        proposal: null,
        state: "info",
        error: errorText(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!ask?.proposal) return;
    setBusy(true);
    try {
      await client.applyProposal(ask.proposal.id);
      setAsk({ ...ask, state: "applied" });
      // Celebrate when the assistant's changes finish a task.
      const finished = ask.proposal.actions.some(
        (a) =>
          a.operation === "update" &&
          a.data?.status === "done" &&
          items.find((i) => i.id === a.item_id)?.status !== "done",
      );
      if (finished) celebrate();
      await onApplied();
    } catch (e) {
      setAsk({ ...ask, error: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  /** Change one filter, keeping the rest and the words. */
  const setFilter = (change: Partial<SearchFilters>) => {
    setQuery(formatSearch({ ...filters, ...change }));
    setActive(0);
    setPicking(null);
    input.current?.focus();
  };

  // Escape closes; Tab stays inside.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (document.querySelector(".popover")) return;
        e.preventDefault();
        onClose();
      }
      if (e.key !== "Tab" || !dialog.current) return;
      const focusable = dialog.current.querySelectorAll<HTMLElement>(
        "input, button:not(:disabled), a[href]",
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pickOptions: { label: string; pick: () => void; on: boolean }[] =
    picking?.kind === "project"
      ? projects
          .filter((p) => p.status !== "archived")
          .map((p) => ({
            label: p.name,
            on: named.project?.id === p.id,
            pick: () =>
              setFilter({
                project: named.project?.id === p.id ? null : p.name,
              }),
          }))
      : picking?.kind === "tag"
        ? tags.map((t) => ({
            label: t.name,
            on: named.tag?.id === t.id,
            pick: () =>
              setFilter({ tag: named.tag?.id === t.id ? null : t.name }),
          }))
        : picking?.kind === "team"
          ? [
              {
                label: "Personal (no team)",
                on: named.team?.id === PERSONAL_SPACE.id,
                pick: () =>
                  setFilter({
                    team:
                      named.team?.id === PERSONAL_SPACE.id
                        ? null
                        : PERSONAL_SPACE.id,
                  }),
              },
              ...teams.map((t) => ({
                label: t.name,
                on: named.team?.id === t.id,
                pick: () =>
                  setFilter({ team: named.team?.id === t.id ? null : t.name }),
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
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        className="command-bar scale-in"
        role="dialog"
        aria-modal="true"
        aria-label="Search, add or ask"
      >
        {ask ? (
          <div className="command-ask">
            <button
              className="text-button"
              onClick={() => {
                setAsk(null);
                setTimeout(() => input.current?.focus(), 0);
              }}
            >
              <ArrowLeft size={14} /> Back to search
            </button>
            <p className="command-question">{ask.question}</p>
            <div aria-live="polite">
              {busy && !ask.proposal ? (
                <p className="muted" role="status">
                  <Sparkles size={14} /> Thinking…
                </p>
              ) : ask.error ? (
                <div className="error" role="alert">
                  {ask.error}
                </div>
              ) : ask.proposal ? (
                <ProposalReview
                  proposal={ask.proposal}
                  items={items}
                  busy={busy}
                  state={ask.state}
                  onApply={() => void apply()}
                  onDismiss={() => setAsk({ ...ask, state: "discarded" })}
                  onApplyPlan={onApplyPlan}
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
                aria-controls="command-list"
                aria-activedescendant={
                  commands[current] ? "cmd-" + commands[current].id : undefined
                }
                aria-autocomplete="list"
                aria-label="Search, add something, or ask the assistant"
                aria-describedby="command-summary"
                placeholder={
                  // The full hint doesn't fit a phone's width.
                  window.matchMedia?.("(max-width: 520px)").matches
                    ? "Search, add or ask…"
                    : "Jump to, search, add “Lunch fri 1pm”, or ask…"
                }
                value={query}
                maxLength={4000}
                disabled={busy}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                  setNotice("");
                }}
                onKeyDown={(e) => {
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
                        key={o.label}
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
                      Nothing to choose yet.
                    </p>
                  )}
                </div>
              </Popover>
            )}
            <p
              id="command-summary"
              className={"command-summary" + (filtering ? "" : " is-keys")}
              role="status"
              aria-live="polite"
            >
              {filtering
                ? unknown || searchSummary(filters)
                : q
                  ? `Enter opens · Shift+Enter makes it · ${MAC ? "⌘" : "Ctrl+"}Enter opens it beside`
                  : "Recent first · type to jump anywhere, or use tag: project: is:"}
            </p>
            {notice && (
              <div className="error" role="alert">
                {notice}
              </div>
            )}
            <ul
              id="command-list"
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
                      id={"cmd-" + c.id}
                      role="option"
                      aria-selected={n === current}
                      className={n === current ? "active" : ""}
                      onMouseEnter={() => setActive(n)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={c.run}
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
                          tabIndex={-1}
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
              {!commands.length && (
                <li role="presentation" className="command-empty">
                  {filtering
                    ? searched === null
                      ? "Looking…"
                      : "Nothing matches these filters."
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
