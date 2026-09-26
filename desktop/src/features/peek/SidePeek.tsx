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
import { formatDateTime } from "../../lib/format";
import { ItemFacts } from "../../components/ItemFacts";
import { BlockView } from "../docs/DocBlocks";
import { LinkPillProvider, openObject, useLinkPills } from "../docs/DocLinks";
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
 * move around the app. Not tabs: one thing at a time, beside.
 */
export function SidePeek({
  target,
  pinned,
  onPin,
  onClose,
  report,
}: {
  target: ObjectRef;
  pinned: boolean;
  onPin: (pinned: boolean) => void;
  onClose: () => void;
  report: (e: unknown) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const close = useRef<HTMLButtonElement>(null);
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
  }, [target.kind, target.id]);
  useEffect(() => {
    close.current?.focus();
  }, [target.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape closes the peek unless a dialog above it is open.
      if (e.key === "Escape" && !document.querySelector('[aria-modal="true"]'))
        onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const title =
    loaded?.kind === "doc"
      ? loaded.doc.title || "Untitled"
      : loaded?.kind === "task"
        ? loaded.item.title
        : loaded?.kind === "project"
          ? loaded.project.name
          : "";
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
    <aside
      className="side-peek fade-in"
      aria-label={`${noun} beside: ${title}`}
    >
      <header className="peek-head">
        <span className="peek-kind">
          <Icon size={14} aria-hidden="true" /> {noun}
        </span>
        <span className="peek-actions">
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
          <button
            className="icon-button"
            title="Open full"
            aria-label="Open full"
            onClick={() => {
              openObject(target);
              if (!pinned) onClose();
            }}
          >
            <Maximize2 size={16} />
          </button>
          <button
            ref={close}
            className="icon-button"
            aria-label="Close the peek"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </span>
      </header>
      <div className="peek-body">
        {error ? (
          <p role="alert" className="peek-meta">
            {error}
          </p>
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
                  {loaded.item.status === "done" ? "Done" : "Not done"}
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
  );
}
