import { useEffect, useMemo, useState } from "react";
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
import { Popover } from "../../components/Popover";
import { client } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { deviceTimeZone } from "../../lib/planning";

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
export function MergeDialog({
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
  const [q, setQ] = useState("");
  const [found, setFound] = useState<LinkOption[]>([]);
  const [picked, setPicked] = useState<LinkOption | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    let live = true;
    const t = window.setTimeout(() => {
      client.pickLinks(q, 20).then(
        (hits) =>
          live &&
          setFound(hits.filter((h) => h.kind === "doc" && h.id !== doc.id)),
        () => live && setFound([]),
      );
    }, 150);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [q, doc.id]);

  const merge = async () => {
    if (!picked) return;
    setBusy(true);
    setError("");
    try {
      const done = await client.mergeDoc(doc.id, picked.id, await version());
      onMerged(done.doc, done.relinked);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className="modal merge-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-title"
      >
        <div className="section-heading">
          <h2 id="merge-title">Merge into…</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <p className="muted">
          “{doc.title || "Untitled"}” goes to the end of the page you choose,
          with its comments and task lines. Links to it will open that page, and
          this one moves to Trash, where it can be brought back.
        </p>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <input
          autoFocus
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
          {!found.length && (
            <li className="muted merge-empty">
              {q ? "No page is called that." : "Type to find a page."}
            </li>
          )}
        </ul>
        <div className="confirm-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!picked || busy}
            onClick={() => void merge()}
          >
            {picked ? `Merge into “${picked.title}”` : "Merge"}
          </button>
        </div>
      </section>
    </div>
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
  useEffect(() => {
    client.listPageTemplates().then(setTemplates, (e) => {
      setTemplates([]);
      report(e);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
        {templates === null && <p className="doc-menu-note">Loading…</p>}
        {templates?.length === 0 && (
          <p className="doc-menu-note">
            No templates yet. Save a page as one with Save as template.
          </p>
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
