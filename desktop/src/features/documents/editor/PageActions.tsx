import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../../hooks/useModalFocus";
import { FileText, LayoutTemplate, X } from "lucide-react";
import {
  blankDate,
  fillTemplate,
  newBlockId,
  type Doc,
  type DocBlock,
  type LinkOption,
  type PageTemplate,
} from "@orbyn/core";
import { Popover } from "../../../components/Popover";
import { client } from "../../../lib/api";
import { errorText } from "../../../lib/errors";
import { deviceTimeZone } from "../../planner/planning";

/**
 * Two page actions from D4b: "Merge into…" (ORG-05), which picks the page
 * this one goes into, and "Template" in the / menu, which puts a template's
 * lines where the line is.
 */

/**
 * "Merge into…": find the page this one's lines should go to (in the same
 * space), then merge. The page goes to Trash, links to it are pointed at
 * the other, and its remarks and task lines go with its lines.
 */
export function MergeDialog(props: Parameters<typeof MergeDialogBody>[0]) {
  return <MergeDialogBody key={props.doc.id} {...props} />;
}

function MergeDialogBody({
  doc,
  version,
  onClose,
  onMerged,
}: {
  doc: Pick<Doc, "id" | "title" | "team_id">;
  /** The version the page is at, as its editor last saved it. */
  version: () => Promise<number>;
  onClose: () => void;
  onMerged: (into: Doc, relinked: number) => void;
}) {
  const mutation = useRef(false);
  const [searching, setSearching] = useState(true);
  const [searchFailed, setSearchFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<LinkOption[]>([]);
  const [picked, setPicked] = useState<LinkOption | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const focus = useModalFocus(onClose, busy);
  useEffect(() => {
    const dialog = focus.ref.current as HTMLDialogElement;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  useEffect(() => {
    let live = true;
    setFound([]);
    setSearching(true);
    setSearchFailed(false);
    const t = window.setTimeout(() => {
      client.pickLinks(q, 20).then(
        (hits) => {
          if (live) {
            setFound(hits.filter((h) => h.kind === "doc" && h.id !== doc.id));
            setSearching(false);
          }
        },
        () => {
          if (live) {
            setSearchFailed(true);
            setSearching(false);
          }
        },
      );
    }, 150);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [q, doc.id, retry]);

  const merge = async () => {
    if (!picked || searching || searchFailed || mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      const done = await client.mergeDoc(doc.id, picked.id, await version());
      onMerged(done.doc, done.relinked);
    } catch (e) {
      setError(errorText(e));
      mutation.current = false;
      setBusy(false);
    }
  };

  return createPortal(
    <dialog
      ref={(node) => {
        focus.ref.current = node;
      }}
      data-modal-owner={focus.id}
      className="modal merge-dialog"
      aria-labelledby="merge-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!mutation.current) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !mutation.current)
          onClose();
      }}
    >
      <div className="section-heading">
        <h2 id="merge-title">Merge into…</h2>
        <button
          className="icon-button"
          disabled={busy}
          aria-label="Close"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <p className="muted">
        “{doc.title || "Untitled"}” joins the target with comments and tasks.
        Links redirect; this page moves to Trash and can be restored.
      </p>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <input
        autoFocus
        disabled={busy}
        value={q}
        placeholder="Find a page"
        aria-label="Find the page to merge into"
        onChange={(e) => {
          setQ(e.target.value);
          setPicked(null);
        }}
      />
      <ul className="merge-list" role="listbox" aria-label="Pages">
        {found.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              role="option"
              disabled={busy}
              aria-selected={picked?.id === f.id}
              className={
                "doc-menu-item" + (picked?.id === f.id ? " is-active" : "")
              }
              onClick={() => setPicked(f)}
            >
              <FileText size={15} aria-hidden="true" />
              <span className="doc-menu-text">
                <strong>{f.title}</strong>
                {f.hint && <small>{f.hint}</small>}
              </span>
            </button>
          </li>
        ))}
        {searching && (
          <li className="muted merge-empty" role="status">
            Searching…
          </li>
        )}
        {searchFailed && (
          <li role="alert">
            Couldn't load pages.{" "}
            <button
              className="text-button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry
            </button>
          </li>
        )}
        {!searching && !searchFailed && !found.length && (
          <li className="muted merge-empty">
            {q ? "No matching pages." : "No pages available."}
          </li>
        )}
      </ul>
      <div className="confirm-actions">
        <button
          type="button"
          className="ghost"
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled={!picked || busy || searching || searchFailed}
          onClick={() => void merge()}
        >
          {busy ? "Merging…" : "Merge pages"}
        </button>
      </div>
    </dialog>,
    document.body,
  );
}

/**
 * "Template" in the / menu: the templates you can use, and a click puts a
 * template's lines (blanks filled in) where the line is.
 */
export function TemplateInsert({
  anchor,
  doc,
  onPick,
  onClose,
  report,
}: {
  anchor: DOMRect;
  doc: Pick<Doc, "title" | "project_name">;
  onPick: (lines: DocBlock[]) => void;
  onClose: () => void;
  report: (e: unknown) => void;
}) {
  const [templates, setTemplates] = useState<PageTemplate[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const reportRef = useRef(report);
  reportRef.current = report;
  useEffect(() => {
    let live = true;
    setFailed(false);
    setTemplates(null);
    void client.listPageTemplates().then(
      (next) => {
        if (live) setTemplates(next);
      },
      (reason) => {
        if (live) {
          setFailed(true);
          reportRef.current(reason);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [retry]);
  const values = useMemo(
    () => ({
      date: blankDate(new Date(), deviceTimeZone()),
      title: doc.title,
      project: doc.project_name ?? "",
    }),
    [doc.title, doc.project_name],
  );
  return (
    <Popover
      anchor={anchor}
      label="Insert a template"
      onClose={onClose}
      width={360}
    >
      <div className="doc-menu">
        <span className="doc-menu-label">Insert a template</span>
        {!failed && templates === null && (
          <p className="doc-menu-note" role="status">
            Loading…
          </p>
        )}
        {failed && (
          <div role="alert">
            <p>Couldn't load templates.</p>
            <button
              className="text-button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry
            </button>
          </div>
        )}
        {templates?.length === 0 && (
          <p className="doc-menu-note">No templates yet.</p>
        )}
        <div className="doc-menu-kinds" role="listbox" aria-label="Templates">
          {templates?.map((t) => (
            <button
              key={t.id}
              type="button"
              role="option"
              aria-selected={false}
              className="doc-menu-item"
              onClick={() => {
                const { content } = fillTemplate(t, values, doc.title);
                // Fresh names, so nothing here points at the template's lines.
                onPick(
                  content.map((b) => ({ ...b, id: newBlockId() }) as DocBlock),
                );
                onClose();
              }}
            >
              <LayoutTemplate size={15} aria-hidden="true" />
              <span className="doc-menu-text">
                <strong>{t.name}</strong>
                {t.description && <small>{t.description}</small>}
              </span>
            </button>
          ))}
        </div>
      </div>
    </Popover>
  );
}
