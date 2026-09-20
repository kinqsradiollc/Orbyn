import { useEffect, useState } from "react";
import { FileText, FolderPlus, Plus, Star } from "lucide-react";
import {
  favouriteKey,
  favouriteSet,
  starterDoc,
  type Doc,
  type DocSummary,
  type Favourite,
  type Folder,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { EmptyState } from "../../components/EmptyState";
import { DocEditor } from "./DocEditor";
import "./docs.css";

const when = (iso: string) => {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
};

/** A starter document, so a new note is never a blank wall. */
export function DocsView({
  report,
  onItemsChanged,
  userId,
  initialDoc,
  onInitialDocShown,
}: {
  report: (e: unknown) => void;
  userId?: string;
  onItemsChanged?: () => void;
  /** A document to open straight away, e.g. a note opened from its event. */
  initialDoc?: Doc | null;
  onInitialDocShown?: () => void;
}) {
  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [stars, setStars] = useState<Favourite[]>([]);
  /** null = everything; a folder id = that folder; "none" = unfiled. */
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [open, setOpen] = useState<Doc | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    void client.listFolders().then(setFolders, () => setFolders([]));
    void client.listFavourites().then(setStars, () => setStars([]));
    return client.listDocs().then(setDocs, (e) => {
      setDocs([]);
      report(e);
    });
  };

  const newFolder = () => {
    const name = prompt("Name the new folder")?.trim();
    if (!name) return;
    client
      .createFolder({ name })
      .then((f) => {
        setFolders((all) => [...all, f]);
        setFolderFilter(f.id);
      })
      .catch(report);
  };

  const toggleStar = (doc: DocSummary, starred: boolean) => {
    // Show the change at once; the server call is a formality.
    setStars((all) =>
      starred
        ? [...all, { kind: "doc", target_id: doc.id, created_at: "" }]
        : all.filter((f) => !(f.kind === "doc" && f.target_id === doc.id)),
    );
    client.setFavourite("doc", doc.id, starred).catch(report);
  };

  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Opening a note from its event hands the document straight to the editor.
  useEffect(() => {
    if (!initialDoc) return;
    setOpen(initialDoc);
    onInitialDocShown?.();
  }, [initialDoc]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = () => {
    setBusy(true);
    client
      .createDoc({
        title: "Untitled",
        content: starterDoc(),
        folder_id: folderFilter === "none" ? null : folderFilter,
      })
      .then((doc) => {
        setOpen(doc);
        void load();
      })
      .catch(report)
      .finally(() => setBusy(false));
  };

  if (open)
    return (
      <DocEditor
        doc={open}
        report={report}
        userId={userId}
        onItemsChanged={onItemsChanged}
        onBack={() => {
          setOpen(null);
          void load();
        }}
        onChanged={(saved) => {
          setOpen(saved);
          setDocs(
            (current) =>
              current?.map((d) =>
                d.id === saved.id
                  ? { ...d, title: saved.title, updated_at: saved.updated_at }
                  : d,
              ) ?? current,
          );
        }}
        onDeleted={(id) => {
          setOpen(null);
          setDocs((current) => current?.filter((d) => d.id !== id) ?? current);
          void load();
        }}
      />
    );

  const starred = favouriteSet(stars);
  const shown = (docs ?? []).filter((d) =>
    folderFilter === null
      ? true
      : folderFilter === "none"
        ? !d.folder_id
        : d.folder_id === folderFilter,
  );
  // Starred documents come first, so the ones you keep returning to are on top.
  const ordered = [
    ...shown.filter((d) => starred.has(favouriteKey("doc", d.id))),
    ...shown.filter((d) => !starred.has(favouriteKey("doc", d.id))),
  ];

  return (
    <div className="docs-view">
      <div className="docs-head">
        <span className="muted docs-count">
          {docs === null
            ? ""
            : ordered.length === 1
              ? "1 document"
              : `${ordered.length} documents`}
        </span>
        <button className="primary" onClick={create} disabled={busy}>
          <Plus size={15} /> New document
        </button>
      </div>

      <div className="folder-bar">
        <button
          className={"folder-chip" + (folderFilter === null ? " is-on" : "")}
          onClick={() => setFolderFilter(null)}
        >
          All
        </button>
        {folders.map((f) => (
          <button
            key={f.id}
            className={"folder-chip" + (folderFilter === f.id ? " is-on" : "")}
            onClick={() => setFolderFilter(f.id)}
          >
            {f.name} <span className="folder-n">{f.doc_count}</span>
          </button>
        ))}
        <button
          className={"folder-chip" + (folderFilter === "none" ? " is-on" : "")}
          onClick={() => setFolderFilter("none")}
        >
          Unfiled
        </button>
        <button className="folder-chip is-add" onClick={newFolder}>
          <FolderPlus size={13} /> New folder
        </button>
      </div>

      {docs === null ? (
        <p className="muted">Loading…</p>
      ) : ordered.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={
            folderFilter === null ? "No documents yet" : "Nothing in here yet"
          }
          body="Keep meeting notes, a project brief or a page of working out — all in the same place as your tasks."
        >
          <button className="primary" onClick={create} disabled={busy}>
            <Plus size={15} /> New document
          </button>
        </EmptyState>
      ) : (
        <ul className="docs-list">
          {ordered.map((doc) => (
            <li key={doc.id}>
              <button
                className="doc-row"
                onClick={() =>
                  client.getDoc(doc.id).then(setOpen).catch(report)
                }
              >
                <FileText size={16} aria-hidden="true" />
                <span className="doc-row-main">
                  <strong>{doc.title || "Untitled"}</strong>
                  <small>{doc.preview || "Empty document"}</small>
                </span>
                <span className="doc-row-when">{when(doc.updated_at)}</span>
              </button>
              <button
                className={
                  "doc-star" +
                  (starred.has(favouriteKey("doc", doc.id)) ? " is-on" : "")
                }
                aria-label={
                  starred.has(favouriteKey("doc", doc.id))
                    ? `Unstar ${doc.title || "Untitled"}`
                    : `Star ${doc.title || "Untitled"}`
                }
                aria-pressed={starred.has(favouriteKey("doc", doc.id))}
                onClick={() =>
                  toggleStar(doc, !starred.has(favouriteKey("doc", doc.id)))
                }
              >
                <Star
                  size={14}
                  fill={
                    starred.has(favouriteKey("doc", doc.id))
                      ? "currentColor"
                      : "none"
                  }
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
