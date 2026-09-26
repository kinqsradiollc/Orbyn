import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
} from "react";
import {
  CalendarDays,
  CheckCircle2,
  Circle,
  FileText,
  FolderKanban,
  Link2,
  Plus,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import {
  dateOptions,
  dateTitle,
  docObjectLinks,
  parseObjectHref,
  type DocBlock,
  type LinkedHere as LinkedHereEntry,
  type LinkedHereList,
  type LinkKind,
  type LinkOption,
  type LinkPill,
  type ObjectRef,
} from "@orbyn/core";
import { Popover } from "../../components/Popover";
import { client } from "../../lib/api";

/**
 * Links between things (LNK-01, LNK-02, LNK-05) on the web: the pill a
 * picker link reads as, the picker [[ opens, and "Linked here".
 */

/** Asks the app to open something (App.tsx listens). */
export const OPEN_LINK_EVENT = "orbyn:open-link";

/** Open a page (at a line), task, event or project over the app. */
export function openObject(ref: ObjectRef, block?: string | null) {
  if (ref.kind === "person" || ref.kind === "date") return;
  const kind = ref.kind === "event" ? "task" : ref.kind;
  window.dispatchEvent(
    new CustomEvent(OPEN_LINK_EVENT, {
      detail: `orbyn://${kind}/${ref.id}${block ? `#${block}` : ""}`,
    }),
  );
}

const ICONS: Record<LinkKind, LucideIcon> = {
  doc: FileText,
  task: Circle,
  event: CalendarDays,
  project: FolderKanban,
  person: UserRound,
  date: CalendarDays,
};

const NOUNS: Record<LinkKind, string> = {
  doc: "page",
  task: "task",
  event: "event",
  project: "project",
  person: "person",
  date: "date",
};

/** One key for a thing, whether it was linked as a task or an event. */
export const pillKey = (r: ObjectRef) =>
  `${r.kind === "event" ? "task" : r.kind}:${r.id.toLowerCase()}`;

/** A deadline as a pill says it: "Fri" this week, "2 Oct" after. */
export function shortDue(iso: string, now = new Date()): string {
  const due = new Date(iso);
  const days = Math.round(
    (new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      86_400_000,
  );
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1 && days < 7)
    return due.toLocaleDateString("en-GB", { weekday: "short" });
  return due.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ------------------------------------------------------------------ pills ---

type Pills = {
  pills: Map<string, LinkPill>;
  onToggle?: (id: string, done: boolean) => void;
  onRestore?: (id: string) => void;
};

const PillContext = createContext<Pills>({ pills: new Map() });

/** Gives the pills inside it their live titles and actions. */
export const LinkPillProvider = PillContext.Provider;

/**
 * The pills for a page's links, as they stand now. Asked again when the
 * set of links changes, and when `reload` is called (after a tick or a
 * restore).
 */
export function useLinkPills(blocks: DocBlock[], report: (e: unknown) => void) {
  const refs = useMemo(() => {
    const seen = new Map<string, ObjectRef>();
    for (const l of docObjectLinks(blocks))
      if (l.ref.kind !== "date") seen.set(pillKey(l.ref), l.ref);
    return [...seen.values()];
  }, [blocks]);
  const key = refs.map(pillKey).sort().join(",");
  const [pills, setPills] = useState(() => new Map<string, LinkPill>());
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!refs.length) return;
    let live = true;
    const chunks: ObjectRef[][] = [];
    for (let i = 0; i < refs.length; i += 60)
      chunks.push(refs.slice(i, i + 60));
    Promise.all(chunks.map((c) => client.resolveLinks(c))).then((all) => {
      if (!live) return;
      setPills((was) => {
        const next = new Map(was);
        for (const p of all.flat()) next.set(pillKey(p), p);
        return next;
      });
    }, report);
    return () => {
      live = false;
    };
    // The set of links, not the array's identity, decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, round]);
  const reload = useCallback(() => setRound((n) => n + 1), []);
  return { pills, reload };
}

/**
 * A link made with the picker, as it reads on the page: the thing's icon
 * and live title; a task with its tick and deadline. A page in the Trash
 * reads "Deleted page", muted, with Restore when you may; something gone or
 * not yours to see says only that it isn't there.
 */
export function LinkPillView({
  href,
  label,
  start,
}: {
  href: string;
  label: string;
  start: number;
}) {
  const ref = parseObjectHref(href);
  const { pills, onToggle, onRestore } = useContext(PillContext);
  if (!ref) return null;
  const pill = pills.get(pillKey(ref));
  const noun = NOUNS[ref.kind];
  const stop = (e: MouseEvent) => e.stopPropagation();
  if (pill && pill.state !== "ok") {
    const deleted = pill.state === "deleted";
    return (
      <span
        className="link-pill is-gone"
        data-src={start}
        title={deleted ? `“${pill.title}” is in Trash` : undefined}
        onClick={stop}
      >
        <Link2 size={12} aria-hidden="true" />
        {deleted
          ? `Deleted ${noun}`
          : `${noun[0].toUpperCase()}${noun.slice(1)} not found`}
        {deleted && pill.can_restore && onRestore && (
          <button
            type="button"
            className="link-pill-action"
            onClick={() => onRestore(ref.id)}
          >
            Restore
          </button>
        )}
      </span>
    );
  }
  const title =
    ref.kind === "date" ? dateTitle(ref.id) : (pill?.title ?? label);
  const isTask = ref.kind === "task" || ref.kind === "event";
  const done = !!pill?.done;
  const Icon = ICONS[ref.kind];
  const openable = ref.kind !== "person" && ref.kind !== "date";
  return (
    <span
      className={
        "link-pill" +
        (done ? " is-done" : "") +
        (openable ? " is-openable" : "")
      }
      data-src={start}
      role={openable ? "link" : undefined}
      tabIndex={openable ? 0 : undefined}
      aria-label={openable ? `Open ${noun} ${title}` : undefined}
      onClick={(e) => {
        stop(e);
        if (openable) openObject(ref);
      }}
      onKeyDown={(e) => {
        if (openable && e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          openObject(ref);
        }
      }}
    >
      {ref.kind === "task" && onToggle && pill ? (
        <button
          type="button"
          className="link-pill-tick"
          role="checkbox"
          aria-checked={done}
          aria-label={done ? "Mark not done" : "Mark done"}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(ref.id, !done);
          }}
        >
          {done ? (
            <CheckCircle2 size={13} aria-hidden="true" />
          ) : (
            <Circle size={13} aria-hidden="true" />
          )}
        </button>
      ) : (
        <Icon size={13} aria-hidden="true" />
      )}
      <span className="link-pill-title">{title}</span>
      {isTask && pill?.due_at && !done && (
        <small className="link-pill-due">{shortDue(pill.due_at)}</small>
      )}
    </span>
  );
}

// ----------------------------------------------------------------- picker ---

type Row =
  | { type: "option"; option: LinkOption }
  | { type: "create"; kind: "doc" | "task"; title: string };

const GROUPS: { kind: LinkKind; label: string }[] = [
  { kind: "doc", label: "Pages" },
  { kind: "task", label: "Tasks" },
  { kind: "event", label: "Events" },
  { kind: "project", label: "Projects" },
  { kind: "person", label: "People" },
  { kind: "date", label: "Dates" },
];

/**
 * The link picker, opened by typing [[ (or "Link" in the / menu): pages,
 * tasks, events, projects, people and dates together, grouped, with
 * "Create page" and "Create task" when nothing is called that. The
 * keyboard stays in the line being typed: the arrows move, Enter links.
 */
export function LinkPicker({
  anchor,
  query,
  projectName,
  onPick,
  onCreate,
  onClose,
  report,
}: {
  anchor: DOMRect;
  query: string;
  /** The page's project, where a new task goes. */
  projectName?: string | null;
  onPick: (ref: ObjectRef, title: string) => void;
  onCreate: (kind: "doc" | "task", title: string) => void;
  onClose: () => void;
  report: (e: unknown) => void;
}) {
  const q = query.trim();
  const [found, setFound] = useState<LinkOption[]>([]);
  useEffect(() => {
    let live = true;
    const t = window.setTimeout(() => {
      client.pickLinks(q, 12).then((hits) => live && setFound(hits), report);
    }, 120);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [q]);
  const rows = useMemo<Row[]>(() => {
    const dates: LinkOption[] = dateOptions(q).map((d) => ({
      kind: "date",
      id: d.id,
      title: d.title,
      hint: d.hint,
    }));
    const all = [...found, ...dates];
    const out: Row[] = [];
    for (const g of GROUPS)
      for (const option of all.filter((o) => o.kind === g.kind))
        out.push({ type: "option", option });
    const same = all.some(
      (o) => o.title.trim().toLowerCase() === q.toLowerCase(),
    );
    if (q && !same) {
      out.push({ type: "create", kind: "task", title: q });
      out.push({ type: "create", kind: "doc", title: q });
    }
    return out;
  }, [found, q]);
  const [highlight, setHighlight] = useState(0);
  useEffect(() => setHighlight(0), [q]);

  const take = useCallback(
    (row: Row | undefined) => {
      if (!row) return;
      if (row.type === "create") onCreate(row.kind, row.title);
      else onPick(row.option, row.option.title);
    },
    [onCreate, onPick],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, rows.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
      } else if (e.key === "Enter" && rows.length) {
        e.preventDefault();
        e.stopPropagation();
        // ⇧↵ makes the page (or task) rather than linking what's there.
        const create = e.shiftKey
          ? rows.find((r) => r.type === "create")
          : undefined;
        take(create ?? rows[highlight]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [rows, highlight, take, onClose]);

  let lastKind: string | null = null;
  return (
    <Popover
      anchor={anchor}
      label="Link to"
      onClose={onClose}
      takeFocus={false}
      width={400}
    >
      <div className="doc-menu link-picker">
        {!rows.length && (
          <p className="doc-menu-note">
            {q
              ? "Nothing is called that."
              : "Type to find a page, task, project, person or date."}
          </p>
        )}
        <div className="link-picker-rows" role="listbox" aria-label="Link to">
          {rows.map((row, i) => {
            const kind = row.type === "option" ? row.option.kind : "create";
            const heading =
              kind !== lastKind
                ? kind === "create"
                  ? null
                  : GROUPS.find((g) => g.kind === kind)?.label
                : null;
            lastKind = kind;
            const selected = i === highlight;
            return (
              <div key={i} className="link-picker-group">
                {heading && <span className="doc-menu-label">{heading}</span>}
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={
                    "doc-menu-item link-picker-item" +
                    (selected ? " is-highlight" : "") +
                    (row.type === "create" ? " is-create" : "")
                  }
                  onMouseEnter={() => setHighlight(i)}
                  // Keep the line being typed focused.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => take(row)}
                >
                  {row.type === "create" ? (
                    <>
                      <Plus size={15} aria-hidden="true" />
                      <span className="doc-menu-text">
                        <strong>
                          {row.kind === "doc"
                            ? `Create page “${row.title}”`
                            : projectName
                              ? `Create task “${row.title}” in ${projectName}`
                              : `Create task “${row.title}”`}
                        </strong>
                      </span>
                    </>
                  ) : (
                    <OptionRow option={row.option} />
                  )}
                </button>
              </div>
            );
          })}
        </div>
        <p className="link-picker-hint">
          <kbd>↵</kbd> link · <kbd>⇧↵</kbd> create · <kbd>esc</kbd> close
        </p>
      </div>
    </Popover>
  );
}

function OptionRow({ option }: { option: LinkOption }) {
  const isTask = option.kind === "task";
  const Icon = isTask
    ? option.done
      ? CheckCircle2
      : Circle
    : ICONS[option.kind];
  return (
    <>
      <Icon size={15} aria-hidden="true" />
      <span className="doc-menu-text">
        <strong>{option.title}</strong>
        {option.hint && <small>{option.hint}</small>}
      </span>
      {isTask && option.due_at && !option.done && (
        <small className="link-pill-due">{shortDue(option.due_at)}</small>
      )}
    </>
  );
}

// ------------------------------------------------------------ linked here ---

/**
 * "Linked here": the pages and tasks that link to this page, task, project
 * or event, each with the line around the link. Places you can't open are
 * never listed or counted. Hidden when nothing links here.
 */
export function LinkedHere({
  kind,
  id,
  refresh = 0,
  onCount,
  report,
  compact = false,
}: {
  kind: "doc" | "task" | "event" | "project";
  id: string;
  /** Changed to ask again (after a save). */
  refresh?: number;
  onCount?: (n: number) => void;
  report: (e: unknown) => void;
  /** Narrow panels: no heading rule, tighter rows. */
  compact?: boolean;
}) {
  const [list, setList] = useState<LinkedHereList | null>(null);
  useEffect(() => {
    let live = true;
    client.linksHere(kind, id).then((l) => {
      if (!live) return;
      setList(l);
      onCount?.(l.count);
    }, report);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id, refresh]);
  if (!list || !list.count) return null;
  return (
    <section
      className={"linked-here" + (compact ? " is-compact" : "")}
      aria-label="Linked here"
    >
      <h3 className="linked-here-title">Linked here · {list.count}</h3>
      <ul>
        {list.items.map((e) => (
          <li key={`${e.kind}:${e.id}`}>
            <LinkedRow entry={e} />
          </li>
        ))}
      </ul>
    </section>
  );
}

const SOURCE_NOTES: Partial<Record<LinkedHereEntry["source"], string>> = {
  task_line: "This task came from here",
  meeting: "Meeting note",
  project: "In this project",
  dependency: "Waits for this",
  mention: "Mentioned in a comment",
};

function LinkedRow({ entry }: { entry: LinkedHereEntry }) {
  const Icon = entry.kind === "doc" ? FileText : Circle;
  const { before, linked, after } = entry.context;
  const note = SOURCE_NOTES[entry.source];
  return (
    <button
      type="button"
      className="linked-here-row"
      onClick={() =>
        openObject({ kind: entry.kind, id: entry.id }, entry.block_id)
      }
    >
      <Icon size={15} aria-hidden="true" />
      <span className="linked-here-text">
        <span className="linked-here-head">
          <strong>{entry.title}</strong>
          <small>{[entry.hint, note].filter(Boolean).join(" · ")}</small>
        </span>
        {(before || linked || after) && (
          <span className="linked-here-context">
            {before}
            {linked && <b>{linked}</b>}
            {after}
          </span>
        )}
      </span>
    </button>
  );
}
