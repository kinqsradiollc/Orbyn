import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  FileText,
  Hash,
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
  refKey,
  splitHeadingQuery,
  type HeadingOption,
  type RelatedPage,
  type UnlinkedMention,
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
import { LinkCardPopover } from "./LinkCard";
import { CONCEPT_ICON } from "../../app/concept-icons";
import { canOpenTabs, openInNewTab } from "../../app/tabs";

/**
 * Links between things (LNK-01, LNK-02, LNK-05) on the web: the pill a
 * picker link reads as, the picker [[ opens, and "Linked here".
 */

/** Asks the app to open something (App.tsx listens). */
export const OPEN_LINK_EVENT = "orbyn:open-link";

/** Asks the app to open something in the side peek (App.tsx listens). */
export const PEEK_EVENT = "orbyn:peek";

/**
 * Open a page, task, event or project in the side peek (NAV-05), beside
 * whatever is open: ⌘-click (Ctrl-click) a link, or ⌘Enter in ⌘K.
 */
export function peekObject(ref: ObjectRef) {
  if (ref.kind === "person" || ref.kind === "date") return;
  window.dispatchEvent(
    new CustomEvent<ObjectRef>(PEEK_EVENT, {
      detail: { kind: ref.kind === "event" ? "task" : ref.kind, id: ref.id },
    }),
  );
}

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

const MOD_CLICK =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? "⌘-click"
    : "Ctrl-click";

const ICONS: Record<LinkKind, LucideIcon> = {
  doc: CONCEPT_ICON.page,
  task: CONCEPT_ICON.task,
  event: CONCEPT_ICON.event,
  project: CONCEPT_ICON.project,
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

/**
 * One key for a thing, whether it was linked as a task or an event; a link
 * to one line of a page has a key of its own (it shows that line's words).
 */
export const pillKey = refKey;

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
  /** A task was changed from the page (a live list's tick): the planner reads afresh. */
  onItemsChanged?: () => void;
  /** Where a hover card's failures go. */
  report?: (e: unknown) => void;
};

const PillContext = createContext<Pills>({ pills: new Map() });

/** Gives the pills inside it their live titles and actions. */
export const LinkPillProvider = PillContext.Provider;

/** The page's pill actions, for blocks inside it that change tasks. */
export const usePageActions = () => useContext(PillContext);

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

/** How long the pointer rests on a link before its card opens. */
const HOVER_MS = 450;

/**
 * A link made with the picker, as it reads on the page: the thing's icon
 * and live title; a task with its tick and deadline; a link to one line of
 * a page with that line's words. A page in the Trash reads "Deleted page",
 * muted, with Restore when you may; something gone or not yours to see
 * says only that it isn't there. Resting the pointer on it opens its hover
 * card (LNK-07).
 */
export function LinkPillView({
  href,
  label,
  start,
  hint,
}: {
  href: string;
  label: string;
  start: number;
  hint?: string;
}) {
  const ref = parseObjectHref(href);
  const { pills, onToggle, onRestore, onItemsChanged, report } =
    useContext(PillContext);
  const [card, setCard] = useState<DOMRect | null>(null);
  const timer = useRef<number | null>(null);
  const inside = useRef(false);
  const el = useRef<HTMLSpanElement>(null);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
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
  const Icon = ref.block ? Hash : ICONS[ref.kind];
  const openable = ref.kind !== "person" && ref.kind !== "date";
  // A page merged into another opens the page it went into.
  const target: ObjectRef = pill?.moved_to
    ? { kind: "doc", id: pill.moved_to }
    : ref;
  const open = () => openObject(target, ref.block);
  // With tabs, ⌘-click (or a middle click) opens a page or project in a
  // new tab; tasks still open beside.
  const inTab =
    canOpenTabs() && (target.kind === "doc" || target.kind === "project");
  const modOpen = () => {
    if (inTab)
      openInNewTab({ kind: target.kind as "doc" | "project", id: target.id });
    else peekObject(target);
  };
  const hoverable =
    ref.kind === "doc" ||
    ref.kind === "task" ||
    ref.kind === "event" ||
    ref.kind === "project";
  const later = (fn: () => void, ms: number) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, ms);
  };
  return (
    <span
      ref={el}
      className={
        "link-pill" +
        (done ? " is-done" : "") +
        (openable ? " is-openable" : "")
      }
      data-src={start}
      role={openable ? "link" : undefined}
      tabIndex={openable ? 0 : undefined}
      aria-label={openable ? `Open ${noun} ${title}` : undefined}
      title={
        hint !== undefined && pill?.state === "ok"
          ? hint
          : openable
            ? `Open. ${MOD_CLICK} opens it ${inTab ? "in a new tab" : "beside this page"}.`
            : undefined
      }
      onClick={(e) => {
        stop(e);
        if (!openable) return;
        if (e.metaKey || e.ctrlKey) modOpen();
        else open();
      }}
      onAuxClick={(e) => {
        if (e.button !== 1 || !inTab) return;
        e.preventDefault();
        stop(e);
        modOpen();
      }}
      onKeyDown={(e) => {
        if (openable && e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          if (e.metaKey || e.ctrlKey) modOpen();
          else open();
        }
      }}
      onMouseEnter={() => {
        if (!hoverable) return;
        later(() => {
          if (el.current) setCard(el.current.getBoundingClientRect());
        }, HOVER_MS);
      }}
      onMouseLeave={() =>
        later(() => {
          if (!inside.current) setCard(null);
        }, 250)
      }
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
      <span className="link-pill-title">
        {title}
        {ref.block && pill && (
          <span className="link-pill-line">
            {" › "}
            {pill.block_title ?? "line gone"}
          </span>
        )}
      </span>
      {isTask && pill?.due_at && !done && (
        <small className="link-pill-due">{shortDue(pill.due_at)}</small>
      )}
      {card && (
        <span onClick={stop}>
          <LinkCardPopover
            target={{ ...target, ...(ref.block ? { block: ref.block } : {}) }}
            anchor={card}
            onOpen={open}
            onOpenDoc={(id) => openObject({ kind: "doc", id })}
            onChanged={() => onItemsChanged?.()}
            onClose={() => setCard(null)}
            onHover={(on) => {
              inside.current = on;
              if (!on) later(() => setCard(null), 250);
              else if (timer.current) window.clearTimeout(timer.current);
            }}
            report={report ?? (() => {})}
          />
        </span>
      )}
    </span>
  );
}

// ----------------------------------------------------------------- picker ---

type Row =
  | { type: "option"; option: LinkOption }
  | { type: "create"; kind: "doc" | "task"; title: string }
  /** `[[Page#`: one of the page's headings or lines (LNK-04). */
  | { type: "heading"; doc: LinkOption; heading: HeadingOption };

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
  /** `[[Page#words`: the page it names, and its headings. */
  const wantsLine = splitHeadingQuery(query);
  const [lines, setLines] = useState<{
    doc: LinkOption;
    headings: HeadingOption[];
  } | null>(null);
  useEffect(() => {
    let live = true;
    const t = window.setTimeout(() => {
      if (wantsLine)
        client
          .pickLinks(wantsLine.page, 5)
          .then(async (hits) => {
            const doc = hits.find((h) => h.kind === "doc");
            if (!doc) return live && setLines(null);
            const headings = await client.pageHeadings(
              doc.id,
              wantsLine.heading.trim(),
            );
            if (live) setLines({ doc, headings });
          })
          .catch(report);
      else
        client.pickLinks(q, 12).then((hits) => live && setFound(hits), report);
    }, 120);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const rows = useMemo<Row[]>(() => {
    if (wantsLine)
      return lines
        ? [
            { type: "option", option: lines.doc },
            ...lines.headings.map((heading): Row => ({
              type: "heading",
              doc: lines.doc,
              heading,
            })),
          ]
        : [];
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found, q, lines]);
  const [highlight, setHighlight] = useState(0);
  useEffect(() => setHighlight(0), [q]);

  const take = useCallback(
    (row: Row | undefined) => {
      if (!row) return;
      if (row.type === "create") onCreate(row.kind, row.title);
      else if (row.type === "heading") {
        const { doc, heading } = row;
        // A line with no name yet is named first, so the link can find it.
        const named = heading.block_id
          ? Promise.resolve(heading.block_id)
          : client
              .anchorLine(doc.id, heading.index, heading.text)
              .then((r) => r.block_id);
        void named.then(
          (block) => onPick({ kind: "doc", id: doc.id, block }, doc.title),
          (e) => {
            // Not ours to name (a page we may only read): link the page.
            onPick({ kind: "doc", id: doc.id }, doc.title);
            if ((e as { statusCode?: number }).statusCode !== 403) report(e);
          },
        );
      } else onPick(row.option, row.option.title);
    },
    [onCreate, onPick, report],
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
            {wantsLine
              ? "No page is called that, or it has no headings."
              : q
                ? "Nothing is called that."
                : "Type to find a page, task, project, person or date. Add # after a page for one of its headings."}
          </p>
        )}
        <div className="link-picker-rows" role="listbox" aria-label="Link to">
          {rows.map((row, i) => {
            const kind =
              row.type === "option"
                ? row.option.kind
                : row.type === "heading"
                  ? "heading"
                  : "create";
            const heading =
              kind !== lastKind
                ? kind === "create"
                  ? null
                  : kind === "heading"
                    ? "Headings and lines"
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
                  {row.type === "heading" ? (
                    <>
                      <Hash size={15} aria-hidden="true" />
                      <span
                        className="doc-menu-text"
                        style={{
                          paddingLeft: row.heading.level
                            ? (row.heading.level - 1) * 12
                            : 0,
                        }}
                      >
                        <strong>{row.heading.text}</strong>
                        {!row.heading.level && <small>A line</small>}
                      </span>
                    </>
                  ) : row.type === "create" ? (
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
 * never listed or counted. Under it, for a page or a project, the pages that
 * say its name without linking to it ("Mentioned without a link"), each
 * with a Link button, and for a page, the pages that read like it
 * ("Related", LNK-06). Hidden when there is none of these.
 */
export function LinkedHere({
  kind,
  id,
  refresh = 0,
  onCount,
  report,
  compact = false,
  onLinkRelated,
}: {
  kind: "doc" | "task" | "event" | "project";
  id: string;
  /** Changed to ask again (after a save). */
  refresh?: number;
  onCount?: (n: number) => void;
  report: (e: unknown) => void;
  /** Narrow panels: no heading rule, tighter rows. */
  compact?: boolean;
  /** Link a related page from this one; left out where that can't be. */
  onLinkRelated?: (page: RelatedPage) => void;
}) {
  const [list, setList] = useState<LinkedHereList | null>(null);
  const [mentions, setMentions] = useState<UnlinkedMention[]>([]);
  const [related, setRelated] = useState<RelatedPage[]>([]);
  const [showMentions, setShowMentions] = useState(false);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    client.linksHere(kind, id).then((l) => {
      if (!live) return;
      setList(l);
      onCount?.(l.count);
    }, report);
    if (kind === "doc" || kind === "project")
      client.unlinkedMentions(kind, id).then(
        (m) => live && setMentions(m),
        () => setMentions([]),
      );
    if (kind === "doc")
      client.relatedPages(id).then(
        (r) => live && setRelated(r),
        () => setRelated([]),
      );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id, refresh, round]);
  const link = (m: UnlinkedMention) => {
    if (!m.block_id || (kind !== "doc" && kind !== "project")) return;
    void client
      .linkMention({
        doc_id: m.doc_id,
        block_id: m.block_id,
        matched: m.matched,
        target: { kind, id },
      })
      .then(() => setRound((n) => n + 1), report);
  };
  if (!list) return null;
  if (!list.count && !mentions.length && !related.length) return null;
  return (
    <section
      className={"linked-here" + (compact ? " is-compact" : "")}
      aria-label="Linked here"
    >
      {list.count > 0 && (
        <>
          <h3 className="linked-here-title">Linked here · {list.count}</h3>
          <ul>
            {list.items.map((e) => (
              <li key={`${e.kind}:${e.id}`}>
                <LinkedRow entry={e} />
              </li>
            ))}
          </ul>
        </>
      )}
      {mentions.length > 0 && (
        <div className="linked-here-more">
          <button
            type="button"
            className="linked-here-toggle"
            aria-expanded={showMentions}
            onClick={() => setShowMentions((v) => !v)}
          >
            {showMentions ? (
              <ChevronDown size={14} aria-hidden="true" />
            ) : (
              <ChevronRight size={14} aria-hidden="true" />
            )}
            Mentioned without a link ({mentions.length})
          </button>
          {showMentions && (
            <ul>
              {mentions.map((m) => (
                <li key={m.doc_id} className="linked-here-mention">
                  <button
                    type="button"
                    className="linked-here-row"
                    onClick={() =>
                      openObject({ kind: "doc", id: m.doc_id }, m.block_id)
                    }
                  >
                    <FileText size={15} aria-hidden="true" />
                    <span className="linked-here-text">
                      <span className="linked-here-head">
                        <strong>{m.title}</strong>
                        {m.hint && <small>{m.hint}</small>}
                      </span>
                      <span className="linked-here-context">
                        {m.context.before}
                        <b>{m.context.linked}</b>
                        {m.context.after}
                      </span>
                    </span>
                  </button>
                  {m.can_link && (
                    <button
                      type="button"
                      className="link-card-action"
                      onClick={() => link(m)}
                    >
                      <Link2 size={13} aria-hidden="true" /> Link
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {related.length > 0 && (
        <div className="linked-here-more">
          <h3 className="linked-here-title">Related</h3>
          <ul>
            {related.map((r) => (
              <li key={r.doc_id} className="linked-here-mention">
                <button
                  type="button"
                  className="linked-here-row"
                  onClick={() => openObject({ kind: "doc", id: r.doc_id })}
                >
                  <FileText size={15} aria-hidden="true" />
                  <span className="linked-here-text">
                    <span className="linked-here-head">
                      <strong>{r.title}</strong>
                      <small>
                        {[r.hint, r.reason].filter(Boolean).join(" · ")}
                      </small>
                    </span>
                  </span>
                </button>
                {onLinkRelated && (
                  <button
                    type="button"
                    className="link-card-action"
                    onClick={() => {
                      onLinkRelated(r);
                      setRelated((all) =>
                        all.filter((x) => x.doc_id !== r.doc_id),
                      );
                    }}
                  >
                    <Link2 size={13} aria-hidden="true" /> Link
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
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
