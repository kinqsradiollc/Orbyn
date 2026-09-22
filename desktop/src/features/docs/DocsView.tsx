import { useEffect, useState } from "react";
import {
  FileText,
  FolderInput,
  Check,
  Folder as FolderIcon,
  FolderPlus,
  Plus,
  Star,
  PanelLeft,
  ChevronRight,
} from "lucide-react";
import {
  favouriteKey,
  favouriteSet,
  type Doc,
  type DocKind,
  type DocSummary,
  type Favourite,
  type Folder,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { EmptyState } from "../../components/EmptyState";
import { Select } from "../../components/Select";
import { Popover } from "../../components/Popover";
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
  canWriteDoc,
  teamNameFor,
  initialDoc,
  onInitialDocShown,
}: {
  report: (e: unknown) => void;
  userId?: string;
  /** Whether this reader may change a page, by the team it belongs to. */
  canWriteDoc?: (teamId: string | null) => boolean;
  teamNameFor?: (teamId: string | null) => string | null;
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
  /** null = every kind; "note" = only notes; "doc" = only plain pages. */
  const [kindFilter, setKindFilter] = useState<DocKind | null>(null);
  const [open, setOpen] = useState<Doc | null>(null);
  const [filing, setFiling] = useState<{
    doc: DocSummary;
    anchor: DOMRect;
  } | null>(null);
  const [naming, setNaming] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [failed, setFailed] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => {
    void client.listFolders().then(setFolders, () => setFolders([]));
    void client.listFavourites().then(setStars, () => setStars([]));
    return client.listDocs().then(
      (rows) => {
        setDocs(rows);
        setFailed(false);
      },
      (e) => {
        setFailed(true);
        report(e);
      },
    );
  };

  const newFolder = () => {
    const name = folderName.trim();
    if (!name) return;
    setBusy(true);
    client
      .createFolder({ name })
      .then((f) => {
        setFolders((all) => [...all, f]);
        setNaming(false);
        setFolderName("");
        setFolderFilter(f.id);
        setKindFilter(null);
        setFavoritesOnly(false);
        setOpen(null);
        setNavigationOpen(false);
      })
      .catch(report)
      .finally(() => setBusy(false));
  };

  const toggleStar = (doc: DocSummary, starred: boolean) => {
    // Show the change at once; the server call is a formality.
    setStars((all) =>
      starred
        ? [...all, { kind: "doc", target_id: doc.id, created_at: "" }]
        : all.filter((f) => !(f.kind === "doc" && f.target_id === doc.id)),
    );
    client.setFavourite("doc", doc.id, starred).catch((e) => {
      report(e);
      void client.listFavourites().then(setStars, report);
    });
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

  const create = (kind: DocKind = "doc") => {
    setBusy(true);
    client
      .createDoc({
        title: "",
        kind,
        content: [{ type: "paragraph", text: "" }],
        folder_id: folderFilter === "none" ? null : folderFilter,
      })
      .then((doc) => {
        setOpen(doc);
        void load();
      })
      .catch(report)
      .finally(() => setBusy(false));
  };

  const editor = open ? (
    <DocEditor
      key={open.id}
      doc={open}
      report={report}
      userId={userId}
      canWrite={canWriteDoc ? canWriteDoc(open.team_id) : true}
      teamName={
        open.team_name ?? (teamNameFor ? teamNameFor(open.team_id) : null)
      }
      onItemsChanged={onItemsChanged}
      onBack={() => {
        setOpen(null);
        void load();
      }}
      onChanged={(saved) => {
        setOpen((current) => (current?.id === saved.id ? saved : current));
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
  ) : null;

  const starred = favouriteSet(stars);

  const shown = (docs ?? [])
    .filter((d) => !favoritesOnly || starred.has(favouriteKey("doc", d.id)))
    .filter((d) =>
      `${d.title} ${d.preview}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
    )
    .filter((d) => kindFilter === null || d.kind === kindFilter)
    .filter((d) =>
      folderFilter === null
        ? true
        : folderFilter === "none"
          ? !d.folder_id
          : d.folder_id === folderFilter,
    );
  const ordered = [...shown].sort((a, b) =>
    sort === "title"
      ? (a.title || "Untitled").localeCompare(b.title || "Untitled") ||
        a.id.localeCompare(b.id)
      : b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id),
  );
  const location = favoritesOnly
    ? "Favorites"
    : folderFilter === "none"
      ? "Unfiled"
      : folderFilter
        ? folders.find((f) => f.id === folderFilter)?.name || "Folder"
        : kindFilter === "doc"
          ? "Pages"
          : kindFilter === "note"
            ? "Notes"
            : "All documents";
  const select = (
    folder: string | null,
    kind: DocKind | null = null,
    favorites = false,
  ) => {
    setFolderFilter(folder);
    setKindFilter(kind);
    setFavoritesOnly(favorites);
    setQuery("");
    setOpen(null);
    setNavigationOpen(false);
  };
  const openPage = (id: string) => {
    setBusy(true);
    client
      .getDoc(id)
      .then((doc) => {
        setOpen(doc);
        setNavigationOpen(false);
      })
      .catch(report)
      .finally(() => setBusy(false));
  };
  const fileIn = async (doc: DocSummary, folderId: string) => {
    setBusy(true);
    try {
      const full = await client.getDoc(doc.id);
      const saved = await client.updateDoc(doc.id, {
        version: full.version,
        folder_id: folderId || null,
      });
      setFiling(null);
      setDocs(
        (all) =>
          all?.map((d) =>
            d.id === doc.id
              ? {
                  ...d,
                  folder_id: saved.folder_id,
                  updated_at: saved.updated_at,
                }
              : d,
          ) ?? all,
      );
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };
  const pageLink = (doc: DocSummary) => (
    <button
      key={doc.id}
      className="docs-nav-page"
      aria-current={open?.id === doc.id ? "page" : undefined}
      disabled={busy}
      onClick={() => openPage(doc.id)}
    >
      <FileText size={14} />
      <span>{doc.title || "Untitled"}</span>
    </button>
  );

  return (
    <div className="docs-workspace">
      <button
        className="text-button docs-nav-toggle"
        aria-expanded={navigationOpen}
        aria-controls="docs-navigation"
        onClick={() => setNavigationOpen(!navigationOpen)}
      >
        <PanelLeft size={18} />{" "}
        {navigationOpen ? "Close library" : "Browse library"}
      </button>
      <nav
        id="docs-navigation"
        aria-label="Document library"
        className={"docs-navigation" + (navigationOpen ? " is-open" : "")}
      >
        <h2>Library</h2>
        {(
          [
            [null, "All documents"],
            ["doc", "Pages"],
            ["note", "Notes"],
          ] as const
        ).map(([kind, label]) => (
          <button
            key={label}
            aria-current={
              !open &&
              !favoritesOnly &&
              folderFilter === null &&
              kindFilter === kind
                ? "page"
                : undefined
            }
            onClick={() => select(null, kind)}
          >
            <FileText size={16} />
            <span>{label}</span>
          </button>
        ))}
        <button
          aria-current={!open && favoritesOnly ? "page" : undefined}
          onClick={() => select(null, null, true)}
        >
          <Star size={16} />
          <span>Favorites</span>
        </button>
        <div className="docs-nav-children">
          {(docs ?? [])
            .filter((d) => starred.has(favouriteKey("doc", d.id)))
            .map(pageLink)}
        </div>
        <div className="docs-nav-heading">
          <span>Folders</span>
          <button
            aria-label="New folder"
            aria-expanded={naming}
            onClick={() => setNaming(!naming)}
          >
            <FolderPlus size={16} />
          </button>
        </div>
        {naming && (
          <form
            className="docs-folder-form"
            onSubmit={(e) => {
              e.preventDefault();
              newFolder();
            }}
          >
            <input
              aria-label="Folder name"
              placeholder="Folder name"
              value={folderName}
              maxLength={60}
              autoFocus
              onChange={(e) => setFolderName(e.target.value)}
            />
            <div>
              <button type="submit" disabled={busy || !folderName.trim()}>
                Create
              </button>
              <button type="button" onClick={() => setNaming(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
        {[...folders]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((folder) => (
            <details key={folder.id} className="docs-nav-folder">
              <summary>
                <ChevronRight size={14} />
                <FolderIcon size={16} />
                <span>{folder.name}</span>
              </summary>
              <div className="docs-nav-children">
                <button
                  aria-current={
                    !open && folderFilter === folder.id ? "page" : undefined
                  }
                  onClick={() => select(folder.id)}
                >
                  View folder{" "}
                  <span className="folder-n">
                    {
                      (docs ?? []).filter((d) => d.folder_id === folder.id)
                        .length
                    }
                  </span>
                </button>
                {(docs ?? [])
                  .filter((d) => d.folder_id === folder.id)
                  .sort((a, b) => a.title.localeCompare(b.title))
                  .map(pageLink)}
              </div>
            </details>
          ))}
        <details className="docs-nav-folder">
          <summary>
            <ChevronRight size={14} />
            <FolderIcon size={16} />
            <span>Unfiled</span>
          </summary>
          <div className="docs-nav-children">
            <button
              aria-current={
                !open && folderFilter === "none" ? "page" : undefined
              }
              onClick={() => select("none")}
            >
              View unfiled
            </button>
            {(docs ?? []).filter((d) => !d.folder_id).map(pageLink)}
          </div>
        </details>
      </nav>
      <section className="docs-workspace-content" aria-label="Documents">
        {editor ?? (
          <div className="docs-view">
            <div className="docs-head">
              <h2 className="docs-count">{location}</h2>
              <div className="docs-head-actions">
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => create("note")}
                >
                  <Plus size={15} /> New note
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => create("doc")}
                >
                  <Plus size={15} /> New page
                </button>
              </div>
            </div>
            <div className="docs-library-tools">
              <input
                aria-label="Search document titles and previews"
                placeholder="Search this collection…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <Select
                className="docs-sort"
                aria-label="Sort documents"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="recent">Last edited</option>
                <option value="title">Title A–Z</option>
              </Select>
            </div>
            {failed ? (
              <div>
                <p className="muted">Could not load your documents.</p>
                <button className="text-button" onClick={() => void load()}>
                  Try again
                </button>
              </div>
            ) : docs === null ? (
              <p className="muted">Loading…</p>
            ) : ordered.length === 0 ? (
              <EmptyState
                icon={FileText}
                title={query ? "No matching documents" : "Nothing in here yet"}
                body="Keep meeting notes, a project brief or a page of working out — all in the same place as your tasks."
              >
                <button
                  className="primary"
                  onClick={() => create(kindFilter ?? "doc")}
                  disabled={busy}
                >
                  <Plus size={15} /> New{" "}
                  {kindFilter === "note" ? "note" : "document"}
                </button>
              </EmptyState>
            ) : (
              <ul className="docs-list">
                {ordered.map((doc) => (
                  <li key={doc.id}>
                    <button
                      className="doc-row"
                      disabled={busy}
                      onClick={() => openPage(doc.id)}
                    >
                      <FileText size={16} aria-hidden="true" />
                      <span className="doc-row-main">
                        <strong>{doc.title || "Untitled"}</strong>
                        <small>{doc.preview || "Empty document"}</small>
                        <span className="doc-row-location">
                          {doc.kind === "note"
                            ? "Note"
                            : doc.kind === "agenda"
                              ? "Agenda"
                              : "Page"}{" "}
                          ·{" "}
                          {folders.find((f) => f.id === doc.folder_id)?.name ||
                            "Unfiled"}
                        </span>
                      </span>
                      <span className="doc-row-when">
                        {when(doc.updated_at)}
                      </span>
                    </button>
                    {(!canWriteDoc || canWriteDoc(doc.team_id)) && (
                      <button
                        className="doc-star"
                        aria-label={`Move ${doc.title || "Untitled"} to folder`}
                        title="Move to folder"
                        disabled={busy}
                        aria-haspopup="dialog"
                        aria-expanded={filing?.doc.id === doc.id}
                        onClick={(e) =>
                          setFiling({
                            doc,
                            anchor: e.currentTarget.getBoundingClientRect(),
                          })
                        }
                      >
                        <FolderInput size={17} />
                      </button>
                    )}
                    <button
                      className={
                        "doc-star" +
                        (starred.has(favouriteKey("doc", doc.id))
                          ? " is-on"
                          : "")
                      }
                      aria-label={
                        starred.has(favouriteKey("doc", doc.id))
                          ? `Unstar ${doc.title || "Untitled"}`
                          : `Star ${doc.title || "Untitled"}`
                      }
                      aria-pressed={starred.has(favouriteKey("doc", doc.id))}
                      onClick={() =>
                        toggleStar(
                          doc,
                          !starred.has(favouriteKey("doc", doc.id)),
                        )
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
        )}
      </section>
      {filing && (
        <Popover
          label="Move to folder"
          anchor={filing.anchor}
          onClose={() => setFiling(null)}
          width={280}
        >
          <div className="docs-move-menu">
            <strong>Move to folder</strong>
            <p>{filing.doc.title || "Untitled"}</p>
            {[{ id: "", name: "Unfiled" }, ...folders].map((f) => (
              <button
                key={f.id}
                className="doc-menu-item"
                disabled={busy}
                onClick={() => void fileIn(filing.doc, f.id)}
              >
                <FolderIcon size={16} />
                <span>{f.name}</span>
                {(filing.doc.folder_id ?? "") === f.id && <Check size={16} />}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}
