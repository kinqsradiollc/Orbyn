import { useEffect, useRef, useState } from "react";
import {
  Boxes,
  CalendarDays,
  Circle,
  CheckCircle2,
  FileText,
  Maximize2,
  Pin,
  PinOff,
  X,
} from "lucide-react";
import {
  docOutline,
  listLayout,
  type Doc,
  type Item,
  type ObjectRef,
  type Project,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { hasHigherDialog } from "../../lib/dialogLayers";
import { formatDateTime } from "../../lib/format";
import { ItemFacts } from "../tasks/ItemFacts";
import { BlockView } from "../documents/editor/DocBlocks";
import {
  LinkPillProvider,
  openObject,
  useLinkPills,
} from "../documents/editor/DocLinks";
import "./peek.css";

type Loaded =
  | { kind: "doc"; doc: Doc }
  | { kind: "task"; item: Item }
  | { kind: "project"; project: Project };

/** A page as it reads, with its links live, but nothing to edit. */
function PagePeek({ doc, report }: { doc: Doc; report: (e: unknown) => void }) {
  const { pills } = useLinkPills(doc.content, report);
  const layout = listLayout(doc.content);
  const outline = docOutline(doc.content);
  return (
    <LinkPillProvider value={{ pills, report }}>
      {outline.length >= 3 && (
        <p className="peek-meta">
          {outline.length} headings · {doc.content.length} lines
        </p>
      )}
      <div className="doc-body peek-doc">
        {doc.content.map((block, i) => (
          <div key={block.id ?? i} className="doc-block">
            <BlockView
              block={block}
              number={layout[i]?.number}
              depth={layout[i]?.depth}
              pageBlocks={doc.content}
            />
          </div>
        ))}
        {!doc.content.length && (
          <p className="peek-meta">This page is empty.</p>
        )}
      </div>
    </LinkPillProvider>
  );
}

/**
 * The side peek (NAV-05): a page, task or project read beside the one you
 * are in, without leaving it. ⌘-click a link or press ⌘Enter in ⌘K to open
 * one. "Open full" opens it as usual; the pin keeps the peek open while you
 * move around the app. Embedded mode delegates tabs, focus and dismissal to
 * the workspace dock shell.
 */
export function SidePeek({
  target,
  pinned,
  onPin,
  onClose,
  report,
  embedded = false,
  onTitle,
  onOpenFull,
}: {
  embedded?: boolean;
  onTitle?: (title: string) => void;
  onOpenFull?: () => void;
  target: ObjectRef;
  pinned: boolean;
  onPin: (pinned: boolean) => void;
  onClose: () => void;
  report: (e: unknown) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [overlay, setOverlay] = useState(
    () => !window.matchMedia("(min-width: 1360px)").matches,
  );
  const root = useRef<HTMLElement>(null);
  const opener = useRef(document.activeElement as HTMLElement | null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1360px)");
    const update = () => setOverlay(!query.matches);
    query.addEventListener("change", update);
    update();
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    let live = true;
    setLoaded(null);
    setError("");
    const load: Promise<Loaded> =
      target.kind === "doc"
        ? client.getDoc(target.id).then((doc) => ({ kind: "doc", doc }))
        : target.kind === "project"
          ? client
              .getProject(target.id)
              .then((project) => ({ kind: "project", project }))
          : client.getItem(target.id).then((item) => ({ kind: "task", item }));
    load.then(
      (l) => live && setLoaded(l),
      (e) => live && setError(errorText(e)),
    );
    return () => {
      live = false;
    };
  }, [target.kind, target.id, retry]);
  useEffect(() => {
    if (!embedded) close.current?.focus();
  }, [target.id, embedded]);
  useEffect(() => {
    if (embedded || !overlay) return;
    const backgrounds = Array.from(
      document.querySelectorAll<HTMLElement>(".shell, .sidebar"),
    ).filter((node) => !node.contains(root.current));
    const previous = backgrounds.map((node) => ({ node, inert: node.inert }));
    previous.forEach(({ node }) => {
      node.inert = true;
    });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const containFocus = () => {
      if (
        root.current?.isConnected &&
        !root.current.closest("[inert]") &&
        !hasHigherDialog(root.current) &&
        !root.current.contains(document.activeElement)
      )
        close.current?.focus();
    };
    const onFocus = () => containFocus();
    // A higher dialog may disappear while focus falls onto the document body.
    const observer = new MutationObserver(containFocus);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("focusin", onFocus);
    containFocus();
    return () => {
      previous.forEach(({ node, inert }) => {
        node.inert = inert;
      });
      document.body.style.overflow = overflow;
      document.removeEventListener("focusin", onFocus);
      observer.disconnect();
    };
  }, [overlay, embedded]);
  useEffect(() => {
    if (embedded) return;
    return () => {
      const node = opener.current;
      if (node?.isConnected && !node.closest("[inert]")) node.focus();
      else
        document
          .querySelector<HTMLElement>(".command-trigger:not([disabled])")
          ?.focus();
    };
  }, []);
  useEffect(() => {
    if (embedded) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape closes the peek unless a dialog above it is open.
      if (
        e.defaultPrevented ||
        hasHigherDialog(root.current) ||
        root.current?.closest("[inert]")
      )
        return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (overlay && e.key === "Tab") {
        const items = Array.from(
          root.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]',
          ) ?? [],
        );
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, overlay, embedded]);

  const title =
    loaded?.kind === "doc"
      ? loaded.doc.title || "Untitled"
      : loaded?.kind === "task"
        ? loaded.item.title
        : loaded?.kind === "project"
          ? loaded.project.name
          : "";
  useEffect(() => {
    if (title) onTitle?.(title);
  }, [title, onTitle]);
  const Icon =
    target.kind === "doc"
      ? FileText
      : target.kind === "project"
        ? Boxes
        : loaded?.kind === "task" && loaded.item.kind === "event"
          ? CalendarDays
          : Circle;
  const noun =
    target.kind === "doc"
      ? "Page"
      : target.kind === "project"
        ? "Project"
        : loaded?.kind === "task" && loaded.item.kind === "event"
          ? "Event"
          : "Task";

  return (
    <>
      {!embedded && overlay && (
        <button
          className="peek-backdrop"
          tabIndex={-1}
          aria-label="Close the peek"
          onClick={onClose}
        />
      )}
      <aside
        ref={root}
        role={embedded ? "region" : overlay ? "dialog" : "complementary"}
        aria-modal={(!embedded && overlay) || undefined}
        className={embedded ? "side-peek is-embedded" : "side-peek"}
        aria-label={`${noun} beside: ${title}`}
      >
        <header className="peek-head">
          <span className="peek-kind">
            <Icon size={14} aria-hidden="true" /> {noun}
          </span>
          <span className="peek-actions">
            {!embedded && (
              <button
                className="icon-button"
                aria-pressed={pinned}
                title={
                  pinned
                    ? "Unpin: close it when you move on"
                    : "Pin: keep it open as you move around"
                }
                aria-label={pinned ? "Unpin the peek" : "Pin the peek"}
                onClick={() => onPin(!pinned)}
              >
                {pinned ? <PinOff size={16} /> : <Pin size={16} />}
              </button>
            )}
            <button
              className="icon-button"
              title="Open full"
              aria-label="Open full"
              onClick={() => {
                if (onOpenFull) onOpenFull();
                else {
                  openObject(target);
                  if (!pinned) onClose();
                }
              }}
            >
              <Maximize2 size={16} />
            </button>
            {!embedded && (
              <button
                ref={close}
                className="icon-button"
                aria-label="Close the peek"
                onClick={onClose}
              >
                <X size={18} />
              </button>
            )}
          </span>
        </header>
        <div className="peek-body">
          {error ? (
            <>
              <p role="alert" className="peek-meta">
                {error}
              </p>
              <button
                className="secondary"
                onClick={() => setRetry((value) => value + 1)}
              >
                Retry
              </button>
            </>
          ) : !loaded ? (
            <p className="peek-meta" aria-live="polite">
              Opening…
            </p>
          ) : (
            <>
              <h2 className="peek-title">{title}</h2>
              {loaded.kind === "doc" && (
                <PagePeek doc={loaded.doc} report={report} />
              )}
              {loaded.kind === "task" && (
                <div className="peek-task">
                  <p className="peek-status">
                    {loaded.item.status === "done" ? (
                      <CheckCircle2 size={14} aria-hidden="true" />
                    ) : (
                      <Circle size={14} aria-hidden="true" />
                    )}
                    {loaded.item.status === "todo"
                      ? "To do"
                      : loaded.item.status === "in_progress"
                        ? "In progress"
                        : loaded.item.status.charAt(0).toUpperCase() +
                          loaded.item.status.slice(1)}
                    {loaded.item.due_at &&
                      ` · ${loaded.item.kind === "event" ? "Starts" : "Due"} ${formatDateTime(loaded.item.due_at)}`}
                  </p>
                  <ItemFacts item={loaded.item} />
                  {loaded.item.notes ? (
                    <p className="peek-notes">{loaded.item.notes}</p>
                  ) : (
                    <p className="peek-meta">No notes.</p>
                  )}
                </div>
              )}
              {loaded.kind === "project" && (
                <div className="peek-project">
                  {loaded.project.summary && <p>{loaded.project.summary}</p>}
                  <p className="peek-meta">
                    {loaded.project.done_count} of {loaded.project.task_count}{" "}
                    tasks done
                    {loaded.project.deadline &&
                      ` · Latest date ${formatDateTime(loaded.project.deadline)}`}
                  </p>
                  <ul className="peek-stages">
                    {loaded.project.stages.map((s) => (
                      <li key={s.id}>{s.name}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
