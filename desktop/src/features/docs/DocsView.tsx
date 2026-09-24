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
  PanelLeftClose,
  PanelLeftOpen,
  ChevronRight,
  Hourglass,
  CalendarDays,
  Inbox,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  agendaGroups,
  agendaMonthKey,
  favouriteKey,
  favouriteSet,
  savedAgo,
  trashLeft,
  TRASH_DAYS,
  type TrashedDoc,
  type Doc,
  type DocKind,
  type DocSummary,
  type Favourite,
  type Folder,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { EmptyState } from "../../components/EmptyState";
import { useConfirm } from "../../components/Confirm";
import { useToast } from "../../components/Toast";
import { Select } from "../../components/Select";
import { Popover } from "../../components/Popover";
import { DocEditor } from "./DocEditor";
import { ImportButton, UploadsPanel, useImports } from "./Uploads";
import { MakeCardsDialog } from "../study/StudyView";
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
  /**
   * null = every kind but agendas; "note" = only notes; "doc" = only plain
   * pages; "agenda" = the daily agendas, which have their own section.
   */
  const [kindFilter, setKindFilter] = useState<DocKind | null>(null);
  /** Within agendas: one month ("2026-09"), or null for all of them. */
  const [agendaMonth, setAgendaMonth] = useState<string | null>(null);
  /** Uploads: files being imported, and imported pages not filed yet. */
  const [uploadsOnly, setUploadsOnly] = useState(false);
  /** Trash: deleted pages, kept for `TRASH_DAYS` days. */
  const [trashOnly, setTrashOnly] = useState(false);
  const [trash, setTrash] = useState<TrashedDoc[] | null>(null);
  const { ask } = useConfirm();
  const toast = useToast();
  const [dropping, setDropping] = useState(false);
  const [making, setMaking] = useState<DocSummary | null>(null);
  const [open, setOpen] = useState<Doc | null>(null);
  const [filing, setFiling] = useState<{
    doc: DocSummary;
    anchor: DOMRect;
  } | null>(null);
  const [naming, setNaming] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [failed, setFailed] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  // On wide screens the library can be tucked away for a full-width page.
  const [libraryHidden, setLibraryHidden] = useState(() => {
    try {
      return localStorage.getItem("orbyn-docs-library") === "hidden";
    } catch {
      return false;
    }
  });
  const showLibrary = (show: boolean) => {
    setLibraryHidden(!show);
    try {
      localStorage.setItem("orbyn-docs-library", show ? "shown" : "hidden");
    } catch {
      // Storage can be blocked; the choice lasts this visit.
    }
  };
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  /** Pages nobody has changed or confirmed in months. */
  const [fading, setFading] = useState<Set<string>>(new Set());
  const [fadingOnly, setFadingOnly] = useState(false);
  useEffect(() => {
    client.fadingDocs().then(
      (list) => setFading(new Set(list.map((d) => d.id))),
      () => {},
    );
  }, []);
  const [busy, setBusy] = useState(false);

  const loadTrash = () =>
    client.listTrash().then(setTrash, (e) => {
      setTrash([]);
      report(e);
    });

  const load = () => {
    void client.listFolders().then(setFolders, () => setFolders([]));
    void client.listTrash().then(setTrash, () => {});
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

  const imports = useImports(report, () => void load());
  const importFiles = (files: File[]) => {
    select(null, null, false, null, true);
    void imports.importFiles(files);
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
      onUndoDelete={(back) => {
        // Undo from the toast: the page comes back open, where it was.
        setOpen(back);
        void load();
      }}
    />
  ) : null;

  /** Bring a page back from Trash, and say where it went. */
  const restore = (page: TrashedDoc) => {
    setBusy(true);
    client
      .restoreDoc(page.id)
      .then((back) => {
        setTrash((all) => all?.filter((d) => d.id !== page.id) ?? all);
        void load();
        toast({
          text: `Restored “${back.title || "Untitled"}”`,
          action: { label: "Open", run: () => setOpen(back) },
        });
      })
      .catch(report)
      .finally(() => setBusy(false));
  };

  /** Delete a page in Trash for good, after asking: this one can't be undone. */
  const destroy = async (page: TrashedDoc) => {
    if (
      !(await ask({
        title: `Delete “${page.title || "Untitled"}” for good?`,
        body: "Its history and comments go with it. This can't be undone.",
        confirmLabel: "Delete for good",
        destructive: true,
      }))
    )
      return;
    setBusy(true);
    client
      .deleteDocForever(page.id)
      .then(() =>
        setTrash((all) => all?.filter((d) => d.id !== page.id) ?? all),
      )
      .catch(report)
      .finally(() => setBusy(false));
  };

  const starred = favouriteSet(stars);
  const uploadCount =
    (docs ?? []).filter((d) => d.in_uploads).length +
    imports.jobs.filter((j) =>
      ["waiting", "queued", "reading", "ocr", "failed"].includes(j.status),
    ).length;

  const shown = (docs ?? [])
    .filter((d) => !favoritesOnly || starred.has(favouriteKey("doc", d.id)))
    .filter((d) => !fadingOnly || fading.has(d.id))
    .filter((d) =>
      `${d.title} ${d.preview}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
    )
    // A page a day would flood everything else, so agendas live in their
    // own section (a starred one still shows under Favorites).
    .filter((d) =>
      kindFilter === null
        ? d.kind !== "agenda" || favoritesOnly
        : d.kind === kindFilter,
    )
    .filter(
      (d) =>
        kindFilter !== "agenda" ||
        !agendaMonth ||
        agendaMonthKey(d.created_at) === agendaMonth,
    )
    .filter((d) =>
      folderFilter === null
        ? true
        : folderFilter === "none"
          ? !d.folder_id
          : d.folder_id === folderFilter,
    );
  const agendas = agendaGroups(docs ?? []);
  const ordered = [...shown].sort((a, b) =>
    kindFilter === "agenda"
      ? b.created_at.localeCompare(a.created_at)
      : sort === "title"
        ? (a.title || "Untitled").localeCompare(b.title || "Untitled") ||
          a.id.localeCompare(b.id)
        : b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id),
  );
  // Agendas read as a diary: a heading for each month, then each week.
  const groups =
    kindFilter === "agenda"
      ? agendaGroups(ordered).flatMap((y) =>
          y.months.flatMap((m) =>
            m.weeks.map((w, n) => ({
              key: w.key,
              month: n === 0 ? `${m.label} ${y.year}` : "",
              label: w.label,
              docs: w.docs,
            })),
          ),
        )
      : [{ key: "all", month: "", label: "", docs: ordered }];
  const location = trashOnly
    ? "Trash"
    : uploadsOnly
      ? "Uploads"
      : fadingOnly
        ? "Might be out of date"
        : favoritesOnly
          ? "Favorites"
          : folderFilter === "none"
            ? "Unfiled"
            : folderFilter
              ? folders.find((f) => f.id === folderFilter)?.name || "Folder"
              : kindFilter === "agenda"
                ? agendaMonth
                  ? `Agendas · ${
                      agendas
                        .flatMap((y) =>
                          y.months.map((m) => ({ ...m, year: y.year })),
                        )
                        .find((m) => m.key === agendaMonth)?.label ?? ""
                    } ${agendaMonth.slice(0, 4)}`
                  : "Agendas"
                : kindFilter === "doc"
                  ? "Pages"
                  : kindFilter === "note"
                    ? "Notes"
                    : "All documents";
  const select = (
    folder: string | null,
    kind: DocKind | null = null,
    favorites = false,
    month: string | null = null,
    uploads = false,
    trashed = false,
  ) => {
    setTrashOnly(trashed);
    if (trashed) void loadTrash();
    setUploadsOnly(uploads);
    setFolderFilter(folder);
    setKindFilter(kind);
    setAgendaMonth(month);
    setFavoritesOnly(favorites);
    setFadingOnly(false);
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
                  in_uploads: false,
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
    <div
      className={
        "docs-workspace" +
        (libraryHidden ? " is-library-hidden" : "") +
        (dropping ? " is-dropping" : "")
      }
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!dropping) setDropping(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDropping(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDropping(false);
        importFiles([...e.dataTransfer.files]);
      }}
    >
      {dropping && (
        <div className="docs-drop" aria-hidden="true">
          <strong>Drop to import</strong>
          <span>PDF, Word or a photo of notes becomes a page in Uploads.</span>
        </div>
      )}
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
        <div className="docs-nav-title">
          <h2>Library</h2>
          <button
            className="icon-button docs-library-hide"
            aria-label="Hide library"
            title="Hide library"
            onClick={() => showLibrary(false)}
          >
            <PanelLeftClose size={16} />
          </button>
        </div>
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
              !uploadsOnly &&
              !trashOnly &&
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
        <button
          aria-current={!open && uploadsOnly ? "page" : undefined}
          title="Imported PDFs, Word files and photos not filed yet"
          onClick={() => select(null, null, false, null, true)}
        >
          <Inbox size={16} />
          <span>Uploads</span>
          {uploadCount > 0 && (
            <small className="docs-nav-count">{uploadCount}</small>
          )}
        </button>
        {agendas.length > 0 && (
          <details className="docs-nav-folder">
            <summary>
              <ChevronRight size={14} />
              <CalendarDays size={16} />
              <span>Agendas</span>
            </summary>
            <div className="docs-nav-children">
              <button
                aria-current={
                  !open && kindFilter === "agenda" && !agendaMonth
                    ? "page"
                    : undefined
                }
                onClick={() => select(null, "agenda")}
              >
                All agendas
              </button>
              {agendas.map((y) => (
                <details
                  key={y.year}
                  className="docs-nav-folder docs-nav-year"
                  open={y.year === agendas[0].year}
                >
                  <summary>
                    <ChevronRight size={14} />
                    <span>{y.year}</span>
                  </summary>
                  <div className="docs-nav-children">
                    {y.months.map((m) => (
                      <button
                        key={m.key}
                        aria-current={
                          !open &&
                          kindFilter === "agenda" &&
                          agendaMonth === m.key
                            ? "page"
                            : undefined
                        }
                        onClick={() => select(null, "agenda", false, m.key)}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </details>
        )}
        {fading.size > 0 && (
          <button
            aria-current={!open && fadingOnly ? "page" : undefined}
            title="Pages nobody has changed or confirmed in three months or more"
            onClick={() => {
              select(null);
              setFadingOnly(true);
            }}
          >
            <Hourglass size={16} />
            <span>Might be out of date</span>
            <small className="docs-nav-count">{fading.size}</small>
          </button>
        )}
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
            {(docs ?? [])
              .filter((d) => !d.folder_id && d.kind !== "agenda")
              .map(pageLink)}
          </div>
        </details>
        <button
          className="docs-nav-trash"
          aria-current={!open && trashOnly ? "page" : undefined}
          title={`Deleted pages, kept for ${TRASH_DAYS} days`}
          onClick={() => select(null, null, false, null, false, true)}
        >
          <Trash2 size={16} />
          <span>Trash</span>
          {!!trash?.length && (
            <small className="docs-nav-count">{trash.length}</small>
          )}
        </button>
      </nav>
      <section className="docs-workspace-content" aria-label="Documents">
        {libraryHidden && (
          <button
            className="text-button docs-library-show"
            onClick={() => showLibrary(true)}
          >
            <PanelLeftOpen size={16} /> Show library
          </button>
        )}
        {editor ?? (
          <div className="docs-view">
            <div className="docs-head">
              <h2 className="docs-count">{location}</h2>
              <div className="docs-head-actions">
                <ImportButton onFiles={importFiles} busy={imports.busy} />
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
            {trashOnly && (
              <p className="docs-trash-note">
                Pages you delete wait here for {TRASH_DAYS} days, then they’re
                deleted for good.
              </p>
            )}
            {!uploadsOnly && !trashOnly && (
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
            )}
            {trashOnly ? (
              trash === null ? (
                <p className="muted">Loading…</p>
              ) : trash.length === 0 ? (
                <EmptyState
                  icon={Trash2}
                  title="Trash is empty"
                  body={`Deleted pages wait here for ${TRASH_DAYS} days.`}
                />
              ) : (
                <ul className="docs-list docs-trash">
                  {trash.map((page) => (
                    <li key={page.id}>
                      <div className="doc-row is-trashed">
                        <FileText size={16} aria-hidden="true" />
                        <span className="doc-row-main">
                          <strong>{page.title || "Untitled"}</strong>
                          <small>{page.preview || "Empty document"}</small>
                          <span className="doc-row-location">
                            Deleted {savedAgo(page.deleted_at)}
                            {page.deleted_by ? ` by ${page.deleted_by}` : ""}
                            {page.team_name
                              ? ` · ${page.team_name}`
                              : ""} · {trashLeft(page.purge_at)}
                          </span>
                        </span>
                      </div>
                      {page.can_restore && (
                        <>
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => restore(page)}
                          >
                            <RotateCcw size={14} aria-hidden="true" /> Restore
                          </button>
                          <button
                            className="doc-star"
                            aria-label={`Delete ${page.title || "Untitled"} for good`}
                            title="Delete for good"
                            disabled={busy}
                            onClick={() => void destroy(page)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )
            ) : uploadsOnly ? (
              <UploadsPanel
                jobs={imports.jobs}
                docs={docs ?? []}
                busy={imports.busy}
                onOpen={openPage}
                onMove={(doc, anchor) => setFiling({ doc, anchor })}
                onRemove={(job) => void imports.remove(job)}
                onMakeCards={setMaking}
                onFiles={importFiles}
                caps={imports.caps}
              />
            ) : failed ? (
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
              <>
                {groups.map((group) => (
                  <div key={group.key} className="docs-group">
                    {group.month && (
                      <h3 className="docs-group-month">{group.month}</h3>
                    )}
                    {group.label && (
                      <h4 className="docs-group-title">{group.label}</h4>
                    )}
                    <ul className="docs-list">
                      {group.docs.map((doc) => (
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
                                    : "Page"}
                                {/* An agenda lives in Agendas unless filed. */}
                                {doc.kind === "agenda" && !doc.folder_id
                                  ? ""
                                  : ` · ${
                                      folders.find(
                                        (f) => f.id === doc.folder_id,
                                      )?.name || "Unfiled"
                                    }`}
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
                                  anchor:
                                    e.currentTarget.getBoundingClientRect(),
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
                            aria-pressed={starred.has(
                              favouriteKey("doc", doc.id),
                            )}
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
                  </div>
                ))}
              </>
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
      {making && (
        <MakeCardsDialog
          docId={making.id}
          title={making.title || "Untitled"}
          report={report}
          onClose={() => setMaking(null)}
        />
      )}
    </div>
  );
}
