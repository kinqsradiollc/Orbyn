import { useEffect, useState, type DragEvent } from "react";
import { onLive } from "../../lib/live";
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
  LayoutTemplate,
  RotateCcw,
  Trash2,
  Globe,
  Archive,
  ArchiveRestore,
  Tag as TagIcon,
  X,
} from "lucide-react";
import {
  agendaDay,
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
  type Project,
  type Tag,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { carries, DOC_MIME, startDrag } from "../../lib/drag";
import { EmptyState } from "../../components/EmptyState";
import { useConfirm } from "../../components/Confirm";
import { useToast } from "../../components/Toast";
import { Select } from "../../components/Select";
import { Popover } from "../../components/Popover";
import { DocEditor } from "./DocEditor";
import { ImportButton, UploadsPanel, useImports } from "./Uploads";
import { MakeCardsDialog } from "../study/StudyView";
import { PageTemplatesDialog } from "./PageTemplates";
import { PublishDialog } from "../publish/PublishDialog";
import { announceStars } from "../../app/prefs";
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
  initialBlockId,
  onInitialDocShown,
  onOpenProject,
  openTemplates,
  incomingFiles,
  fixedKind,
}: {
  /** Files opened with Orbyn on the desktop (CAP-11), to import. */
  incomingFiles?: { files: File[]; seq: number } | null;
  /** A separate Memory or Agent notes library. */
  fixedKind?: DocKind;
  report: (e: unknown) => void;
  userId?: string;
  /** Whether this reader may change a page, by the team it belongs to. */
  canWriteDoc?: (teamId: string | null) => boolean;
  teamNameFor?: (teamId: string | null) => string | null;
  onItemsChanged?: () => void;
  /** A document to open straight away, e.g. a note opened from its event. */
  initialDoc?: Doc | null;
  initialBlockId?: string | null;
  onInitialDocShown?: () => void;
  onOpenProject?: (id: string) => void;
  /** Changes to open "New page from template" (from ⌘K). */
  openTemplates?: number;
}) {
  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [stars, setStars] = useState<Favourite[]>([]);
  /** null = everything; a folder id = that folder; "none" = unfiled. */
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  /** A folder being put on the web (SHR-05). */
  const [publishingFolder, setPublishingFolder] = useState<Folder | null>(null);
  /**
   * null = every kind but agendas; "note" = only notes; "doc" = only plain
   * pages; "agenda" = the daily agendas, which have their own section.
   */
  const [kindFilter, setKindFilter] = useState<DocKind | null>(
    fixedKind ?? null,
  );
  /** Within agendas: one month ("2026-09"), or null for all of them. */
  const [agendaMonth, setAgendaMonth] = useState<string | null>(null);
  /** Uploads: files being imported, and imported pages not filed yet. */
  const [uploadsOnly, setUploadsOnly] = useState(false);
  /** Trash: deleted pages, kept for `TRASH_DAYS` days. */
  const [trashOnly, setTrashOnly] = useState(false);
  const [trash, setTrash] = useState<TrashedDoc[] | null>(null);
  /** Archived pages and folders (SRCH-03), out of every other list. */
  const [archivedOnly, setArchivedOnly] = useState(false);
  const [archivedDocs, setArchivedDocs] = useState<DocSummary[] | null>(null);
  /** Pages picked to move, tag or archive together (ORG-03). */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [lastPicked, setLastPicked] = useState<string | null>(null);
  /** The page "Show in library" points at, marked for a moment. */
  const [flash, setFlash] = useState<string | null>(null);
  const [moveQuery, setMoveQuery] = useState("");

  const { ask } = useConfirm();
  const toast = useToast();
  const [dropping, setDropping] = useState(false);
  const [making, setMaking] = useState<DocSummary | null>(null);
  const [open, setOpen] = useState<Doc | null>(null);
  const [targetBlock, setTargetBlock] = useState<string | null>(null);
  const [filing, setFiling] = useState<{
    doc: DocSummary;
    anchor: DOMRect;
    /** Several pages at once, from the picked ones. */
    many?: DocSummary[];
  } | null>(null);
  const [tagging, setTagging] = useState<DOMRect | null>(null);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  useEffect(() => {
    if (!tagging) return;
    client.listTags().then(setAllTags, () => setAllTags([]));
  }, [tagging]);
  const [personalProjects, setPersonalProjects] = useState<Project[]>([]);
  useEffect(() => {
    if (!filing?.doc.in_uploads || filing.doc.team_id) {
      setPersonalProjects([]);
      return;
    }
    let active = true;
    void client.listProjects().then(
      (projects) => {
        if (active)
          setPersonalProjects(projects.filter((project) => !project.team_id));
      },
      (error) => {
        if (active) report(error);
      },
    );
    return () => {
      active = false;
    };
  }, [filing?.doc.id]); // eslint-disable-line react-hooks/exhaustive-deps
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
  /** Only pages with this tag, by id; "" for every page. */
  const [tagFilter, setTagFilter] = useState("");
  /** Whether "New page from a template" is open. */
  const [templating, setTemplating] = useState(false);
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

  const loadArchived = () =>
    client
      .listDocs({ archived: "only", ...(fixedKind ? { kind: fixedKind } : {}) })
      .then(setArchivedDocs, (e) => {
        setArchivedDocs([]);
        report(e);
      });
  /** Archive a folder (its pages leave lists and search), or bring it back. */
  const archiveFolder = (folder: Folder, archived: boolean) => {
    setBusy(true);
    client
      .archiveFolder(folder.id, archived)
      .then((saved) => {
        setFolders((all) =>
          all.map((f) =>
            f.id === folder.id ? { ...f, archived_at: saved.archived_at } : f,
          ),
        );
        if (archived) select(null);
        else void loadArchived();
        void load();
        toast({
          text: archived
            ? `Archived ${folder.name} and its pages. Find them under Archived.`
            : `${folder.name} is back`,
        });
      })
      .catch(report)
      .finally(() => setBusy(false));
  };
  /** Bring one archived page back into the library. */
  const unarchive = (doc: DocSummary) => {
    setBusy(true);
    client
      .archiveDoc(doc.id, false)
      .then(() => {
        setArchivedDocs((all) => all?.filter((d) => d.id !== doc.id) ?? all);
        void load();
        toast({ text: `“${doc.title || "Untitled"}” is back in the library` });
      })
      .catch(report)
      .finally(() => setBusy(false));
  };
  /** Move, archive or tag the picked pages at once (ORG-03). */
  const bulk = async (change: {
    folder_id?: string | null;
    archived?: boolean;
    tag_id?: string;
  }) => {
    const ids = [...picked];
    if (!ids.length) return;
    setBusy(true);
    try {
      const done = await client.bulkDocs({ ids, ...change });
      setPicked(new Set());
      setFiling(null);
      setTagging(null);
      await load();
      const n = done.done.length;
      const what =
        change.archived !== undefined
          ? change.archived
            ? "Archived"
            : "Brought back"
          : change.tag_id
            ? "Tagged"
            : "Moved";
      toast({
        text:
          `${what} ${n} page${n === 1 ? "" : "s"}` +
          (done.skipped.length
            ? `. ${done.skipped.length} couldn't be changed by you.`
            : ""),
        tone: done.skipped.length ? "warn" : undefined,
        action:
          change.archived && n
            ? {
                label: "Undo",
                run: () =>
                  void client
                    .bulkDocs({ ids: done.done, archived: false })
                    .then(() => void load(), report),
              }
            : undefined,
      });
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };
  const loadTrash = () =>
    client.listTrash().then(setTrash, (e) => {
      setTrash([]);
      report(e);
    });

  const load = () => {
    void client.listFolders().then(setFolders, () => setFolders([]));
    void client.listTrash().then(setTrash, () => {});
    void client.listFavourites().then(setStars, () => setStars([]));
    return client.listDocs(fixedKind ? { kind: fixedKind } : {}).then(
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
    client.setFavourite("doc", doc.id, starred).then(announceStars, (e) => {
      report(e);
      void client.listFavourites().then(setStars, report);
    });
  };

  useEffect(() => {
    void load();
    // Pages and folders changed elsewhere (another device, a teammate, or
    // a connected agent): read the list again, a moment later so a burst of
    // changes is one read.
    let soon: ReturnType<typeof setTimeout> | undefined;
    const stop = onLive((news) => {
      if (
        news.kind !== "changed" ||
        (news.area && news.area !== "docs" && news.area !== "organize")
      )
        return;
      clearTimeout(soon);
      soon = setTimeout(() => void load(), 400);
    });
    return () => {
      clearTimeout(soon);
      stop();
    };
  }, [fixedKind]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setKindFilter(fixedKind ?? null);
    setFolderFilter(null);
    setFavoritesOnly(false);
    setUploadsOnly(false);
    setTrashOnly(false);
    setArchivedOnly(false);
    setQuery("");
  }, [fixedKind]);

  useEffect(() => {
    if (openTemplates) setTemplating(true);
  }, [openTemplates]);

  // Word and PDF files opened with Orbyn go to Uploads, like a dropped file.
  useEffect(() => {
    if (incomingFiles?.files.length) importFiles(incomingFiles.files);
  }, [incomingFiles?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opening a note from its event hands the document straight to the editor.
  useEffect(() => {
    if (!initialDoc) return;
    setOpen(initialDoc);
    setTargetBlock(initialBlockId ?? null);
    onInitialDocShown?.();
  }, [initialDoc]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = (kind: DocKind = fixedKind ?? "doc") => {
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
      onOpenProject={onOpenProject}
      initialBlockId={targetBlock}
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
      onShowInLibrary={() => {
        const here = open;
        showLibrary(true);
        if (here.archived) select(null, null, false, null, false, false, true);
        else select(here.folder_id ?? "none");
        setNavigationOpen(true);
        setFlash(here.id);
        window.setTimeout(() => {
          document
            .getElementById(`doc-row-${here.id}`)
            ?.scrollIntoView({ block: "center", behavior: "smooth" });
        }, 60);
        window.setTimeout(() => setFlash(null), 2000);
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
        agendaMonthKey(agendaDay(d)) === agendaMonth,
    )
    .filter((d) =>
      folderFilter === null
        ? true
        : folderFilter === "none"
          ? !d.folder_id
          : d.folder_id === folderFilter,
    );
  // The tags on the pages in view, for the tag filter; then the filter.
  const tagsHere = [
    ...new Map(
      shown.flatMap((d) => d.tags ?? []).map((t) => [t.id, t] as const),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const tagged = tagFilter
    ? shown.filter((d) => d.tags?.some((t) => t.id === tagFilter))
    : shown;
  const agendas = agendaGroups(docs ?? []);
  const ordered = [...tagged].sort((a, b) =>
    kindFilter === "agenda"
      ? agendaDay(b).localeCompare(agendaDay(a))
      : sort === "title"
        ? (a.title || "Untitled").localeCompare(b.title || "Untitled") ||
          a.id.localeCompare(b.id)
        : sort === "created"
          ? b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id)
          : b.updated_at.localeCompare(a.updated_at) ||
            a.id.localeCompare(b.id),
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
  const openFolder =
    folderFilter && folderFilter !== "none"
      ? (folders.find((f) => f.id === folderFilter) ?? null)
      : null;
  const location =
    fixedKind === "memory"
      ? "Memory"
      : fixedKind === "agent"
        ? "Agent notes"
        : archivedOnly
          ? "Archived"
          : trashOnly
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
                      ? folders.find((f) => f.id === folderFilter)?.name ||
                        "Folder"
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
    archived = false,
  ) => {
    setTrashOnly(trashed);
    if (trashed) void loadTrash();
    setArchivedOnly(archived);
    if (archived) void loadArchived();
    setPicked(new Set());
    setUploadsOnly(uploads);
    setFolderFilter(folder);
    setKindFilter(fixedKind ?? kind);
    setAgendaMonth(month);
    setFavoritesOnly(favorites);
    setFadingOnly(false);
    setQuery("");
    setTagFilter("");
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
  const fileInProject = async (doc: DocSummary, projectId: string) => {
    setBusy(true);
    try {
      const full = await client.getDoc(doc.id);
      await client.updateDoc(doc.id, {
        version: full.version,
        project_id: projectId,
      });
      setFiling(null);
      await load();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  };
  /**
   * A page dropped on a folder (or Unfiled) is filed there (ORG-06); the
   * folder button on each row does the same without a mouse.
   */
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  const folderDrop = (folderId: string) => ({
    className: dropFolder === folderId ? "is-drop" : undefined,
    onDragOver: (e: DragEvent) => {
      if (!carries(e, DOC_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dropFolder !== folderId) setDropFolder(folderId);
    },
    onDragLeave: (e: DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setDropFolder((f) => (f === folderId ? null : f));
    },
    onDrop: (e: DragEvent) => {
      setDropFolder(null);
      const id = e.dataTransfer.getData(DOC_MIME);
      if (!id) return;
      e.preventDefault();
      const doc = (docs ?? []).find((d) => d.id === id);
      if (!doc || (doc.folder_id ?? "") === folderId) return;
      const folder = folders.find((f) => f.id === folderId);
      if (folder && (folder.team_id ?? null) !== (doc.team_id ?? null)) {
        toast({
          text: folder.team_id
            ? `Only the team's own pages can go in ${folder.name}.`
            : `${folder.name} is your own folder, so a team's page can't go in it.`,
          tone: "warn",
        });
        return;
      }
      if (canWriteDoc && !canWriteDoc(doc.team_id)) return;
      void fileIn(doc, folderId);
    },
  });
  /** A library page picked up: into a folder, or into the open page as a link. */
  const dragPage = (doc: DocSummary) => ({
    draggable: true,
    onDragStart: (e: DragEvent) =>
      startDrag(e, { kind: "doc", id: doc.id, title: doc.title || "Untitled" }),
  });
  /** Pick a page for moving, tagging or archiving; Shift picks a run. */
  const pick = (doc: DocSummary, run: boolean) => {
    setPicked((was) => {
      const next = new Set(was);
      const list = ordered.map((d) => d.id);
      const from = lastPicked ? list.indexOf(lastPicked) : -1;
      const to = list.indexOf(doc.id);
      if (run && from !== -1 && to !== -1) {
        const [a, b] = from < to ? [from, to] : [to, from];
        for (const id of list.slice(a, b + 1)) next.add(id);
      } else if (next.has(doc.id)) next.delete(doc.id);
      else next.add(doc.id);
      return next;
    });
    setLastPicked(doc.id);
  };
  /** Folders a page (or the picked ones) can go to, found by name. */
  const movableFrom = filing?.many ?? (filing ? [filing.doc] : []);
  const movable = [{ id: "", name: "Unfiled", team_id: null }, ...folders]
    .filter((f) => !("archived_at" in f) || !f.archived_at)
    .filter((f) =>
      movableFrom.every(
        (d) => !f.id || (f.team_id ?? null) === (d.team_id ?? null),
      ),
    )
    .filter((f) =>
      f.name.toLocaleLowerCase().includes(moveQuery.trim().toLocaleLowerCase()),
    );
  const pageLink = (doc: DocSummary) => (
    <button
      key={doc.id}
      className="docs-nav-page"
      aria-current={open?.id === doc.id ? "page" : undefined}
      disabled={busy}
      onClick={() => openPage(doc.id)}
      {...dragPage(doc)}
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
        {navigationOpen
          ? `Close ${fixedKind === "memory" ? "Memory" : fixedKind === "agent" ? "Agent notes" : "library"}`
          : `Browse ${fixedKind === "memory" ? "Memory" : fixedKind === "agent" ? "Agent notes" : "library"}`}
      </button>
      <nav
        id="docs-navigation"
        aria-label="Document library"
        className={"docs-navigation" + (navigationOpen ? " is-open" : "")}
      >
        <div className="docs-nav-title">
          <h2>
            {fixedKind === "memory"
              ? "Memory"
              : fixedKind === "agent"
                ? "Agent notes"
                : "Library"}
          </h2>
          <button
            className="icon-button docs-library-hide"
            aria-label="Hide library"
            title="Hide library"
            onClick={() => showLibrary(false)}
          >
            <PanelLeftClose size={16} />
          </button>
        </div>
        {!fixedKind && (
          <>
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
            {folders
              .filter((f) => !f.archived_at)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((folder) => (
                <details key={folder.id} className="docs-nav-folder">
                  <summary {...folderDrop(folder.id)}>
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
              <summary {...folderDrop("")}>
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
              aria-current={!open && archivedOnly ? "page" : undefined}
              title="Pages and folders kept out of the library and search"
              onClick={() =>
                select(null, null, false, null, false, false, true)
              }
            >
              <Archive size={16} />
              <span>Archived</span>
            </button>
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
          </>
        )}
        {fixedKind && (
          <div className="docs-nav-children is-flat">
            {(docs ?? []).map(pageLink)}
            {docs?.length === 0 && (
              <p className="muted docs-nav-empty">No notes yet</p>
            )}
          </div>
        )}
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
                {openFolder && (
                  <button
                    className="text-button"
                    aria-haspopup="dialog"
                    onClick={() => setPublishingFolder(openFolder)}
                    title="Put this folder's pages on the web"
                  >
                    <Globe size={15} /> Publish folder
                  </button>
                )}
                {openFolder && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => archiveFolder(openFolder, true)}
                    title="Keep this folder and its pages out of the library and search"
                  >
                    <Archive size={15} /> Archive folder
                  </button>
                )}
                {fixedKind ? (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => create(fixedKind)}
                  >
                    <Plus size={15} />
                    {fixedKind === "memory"
                      ? "New Memory note"
                      : "New Agent note"}
                  </button>
                ) : (
                  <>
                    <ImportButton onFiles={importFiles} busy={imports.busy} />
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => create("note")}
                    >
                      <Plus size={15} /> New note
                    </button>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => setTemplating(true)}
                    >
                      <LayoutTemplate size={15} /> From template
                    </button>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => create("doc")}
                    >
                      <Plus size={15} /> New page
                    </button>
                  </>
                )}
              </div>
            </div>
            {trashOnly && (
              <p className="docs-trash-note">
                Pages you delete wait here for {TRASH_DAYS} days, then they’re
                deleted for good.
              </p>
            )}
            {archivedOnly && (
              <p className="docs-trash-note">
                Archived pages stay whole and their links still open. They're
                left out of the library and search until you bring them back.
              </p>
            )}
            {!uploadsOnly && !trashOnly && !archivedOnly && (
              <div className="docs-library-tools">
                <input
                  aria-label="Search document titles and previews"
                  placeholder="Search this collection…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {(tagsHere.length > 0 || tagFilter) && (
                  <Select
                    className="docs-tag-filter"
                    aria-label="Show pages with a tag"
                    value={tagFilter}
                    onChange={(e) => setTagFilter(e.target.value)}
                  >
                    <option value="">All tags</option>
                    {tagsHere.map((t) => (
                      <option key={t.id} value={t.id}>
                        #{t.name}
                      </option>
                    ))}
                  </Select>
                )}
                <Select
                  className="docs-sort"
                  aria-label="Sort documents"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="recent">Last edited</option>
                  <option value="created">Newest first</option>
                  <option value="title">Title A–Z</option>
                </Select>
              </div>
            )}
            {archivedOnly ? (
              archivedDocs === null ? (
                <p className="muted">Loading…</p>
              ) : archivedDocs.length === 0 &&
                !folders.some((f) => f.archived_at) ? (
                <EmptyState
                  icon={Archive}
                  title="Nothing archived"
                  body="Pages you archive from a page's ⋯ menu wait here."
                />
              ) : (
                <ul className="docs-list docs-trash">
                  {folders
                    .filter((f) => f.archived_at)
                    .map((folder) => (
                      <li key={folder.id}>
                        <div className="doc-row is-trashed">
                          <FolderIcon size={16} aria-hidden="true" />
                          <span className="doc-row-main">
                            <strong>{folder.name}</strong>
                            <span className="doc-row-location">
                              Folder · {folder.doc_count} page
                              {folder.doc_count === 1 ? "" : "s"}
                            </span>
                          </span>
                        </div>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => archiveFolder(folder, false)}
                        >
                          <ArchiveRestore size={14} aria-hidden="true" /> Bring
                          back
                        </button>
                      </li>
                    ))}
                  {archivedDocs.map((doc) => (
                    <li key={doc.id}>
                      <button
                        className={
                          "doc-row" + (flash === doc.id ? " is-flash" : "")
                        }
                        id={`doc-row-${doc.id}`}
                        disabled={busy}
                        onClick={() => openPage(doc.id)}
                      >
                        <FileText size={16} aria-hidden="true" />
                        <span className="doc-row-main">
                          <strong>{doc.title || "Untitled"}</strong>
                          <small>{doc.preview || "Empty document"}</small>
                          <span className="doc-row-location">
                            {doc.archived_at
                              ? `Archived ${savedAgo(doc.archived_at)}`
                              : `In an archived folder: ${
                                  folders.find((f) => f.id === doc.folder_id)
                                    ?.name ?? "Folder"
                                }`}
                          </span>
                        </span>
                      </button>
                      {doc.archived_at &&
                        (!canWriteDoc || canWriteDoc(doc.team_id)) && (
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => unarchive(doc)}
                          >
                            <ArchiveRestore size={14} aria-hidden="true" />{" "}
                            Bring back
                          </button>
                        )}
                    </li>
                  ))}
                </ul>
              )
            ) : trashOnly ? (
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
                            className="doc-trash-delete"
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
                report={report}
                onChanged={() => {
                  void load();
                  onItemsChanged?.();
                }}
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
                title={
                  query || tagFilter
                    ? `No matching ${fixedKind === "memory" ? "Memory notes" : fixedKind === "agent" ? "Agent notes" : "pages"}`
                    : "Nothing in here yet"
                }
                body={
                  query || tagFilter
                    ? "Try another word or tag."
                    : fixedKind === "memory"
                      ? "What your assistant learns about you is kept here, with where it came from. You can add or change a note any time."
                      : fixedKind === "agent"
                        ? "Briefs and other notes your agent makes are kept here."
                        : "Keep notes, briefs and working out next to your tasks."
                }
              >
                {!(query || tagFilter) && (
                  <div className="empty-actions">
                    <button
                      className="primary"
                      onClick={() => create(fixedKind ?? kindFilter ?? "doc")}
                      disabled={busy}
                    >
                      <Plus size={15} />
                      {fixedKind === "memory"
                        ? "New Memory note"
                        : fixedKind === "agent"
                          ? "New Agent note"
                          : `New ${kindFilter === "note" ? "note" : "page"}`}
                    </button>
                    {!fixedKind && (
                      <ImportButton
                        onFiles={importFiles}
                        busy={imports.busy}
                        className="secondary"
                        label="Import"
                      />
                    )}
                  </div>
                )}
              </EmptyState>
            ) : (
              <>
                {picked.size > 0 && (
                  <div
                    className="docs-bulk-bar"
                    role="toolbar"
                    aria-label="Picked pages"
                  >
                    <strong>{picked.size} picked</strong>
                    <button
                      className="text-button"
                      disabled={busy}
                      aria-haspopup="dialog"
                      onClick={(e) => {
                        const many = (docs ?? []).filter((d) =>
                          picked.has(d.id),
                        );
                        setMoveQuery("");
                        setFiling({
                          doc: many[0],
                          many,
                          anchor: e.currentTarget.getBoundingClientRect(),
                        });
                      }}
                    >
                      <FolderInput size={15} /> Move to…
                    </button>
                    <button
                      className="text-button"
                      disabled={busy}
                      aria-haspopup="dialog"
                      onClick={(e) =>
                        setTagging(e.currentTarget.getBoundingClientRect())
                      }
                    >
                      <TagIcon size={15} /> Tag
                    </button>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => void bulk({ archived: true })}
                    >
                      <Archive size={15} /> Archive
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Clear the picked pages"
                      title="Clear"
                      onClick={() => setPicked(new Set())}
                    >
                      <X size={15} />
                    </button>
                  </div>
                )}
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
                          {(!canWriteDoc || canWriteDoc(doc.team_id)) && (
                            <label
                              className="doc-pick"
                              title="Pick (Shift-click picks a run)"
                            >
                              <input
                                type="checkbox"
                                aria-label={`Pick ${doc.title || "Untitled"}`}
                                checked={picked.has(doc.id)}
                                onChange={() => {}}
                                onClick={(e) => pick(doc, e.shiftKey)}
                              />
                            </label>
                          )}
                          <button
                            className={
                              "doc-row" + (flash === doc.id ? " is-flash" : "")
                            }
                            id={`doc-row-${doc.id}`}
                            disabled={busy}
                            onClick={(e) =>
                              e.shiftKey || picked.size
                                ? pick(doc, e.shiftKey)
                                : openPage(doc.id)
                            }
                            {...dragPage(doc)}
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
                                {!!doc.tags?.length && (
                                  <span className="doc-row-tags">
                                    {doc.tags.map((t) => (
                                      <span
                                        key={t.id}
                                        className="tag-chip"
                                        style={{ "--tag": t.color } as never}
                                      >
                                        <i aria-hidden="true" />
                                        {t.name}
                                      </span>
                                    ))}
                                  </span>
                                )}
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
                              onClick={(e) => {
                                setMoveQuery("");
                                setFiling({
                                  doc,
                                  anchor:
                                    e.currentTarget.getBoundingClientRect(),
                                });
                              }}
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
            <p>
              {filing.many
                ? `${filing.many.length} pages`
                : filing.doc.title || "Untitled"}
            </p>
            <input
              className="docs-move-search"
              aria-label="Find a folder"
              placeholder="Find a folder…"
              value={moveQuery}
              autoFocus
              onChange={(e) => setMoveQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const first = movable[0];
                if (!first) return;
                e.preventDefault();
                if (filing.many) void bulk({ folder_id: first.id || null });
                else void fileIn(filing.doc, first.id);
              }}
            />
            {movable.map((f) => (
              <button
                key={f.id}
                className="doc-menu-item"
                disabled={busy}
                onClick={() =>
                  filing.many
                    ? void bulk({ folder_id: f.id || null })
                    : void fileIn(filing.doc, f.id)
                }
              >
                <FolderIcon size={16} />
                <span>{f.name}</span>
                {!filing.many && (filing.doc.folder_id ?? "") === f.id && (
                  <Check size={16} />
                )}
              </button>
            ))}
            {!movable.length && (
              <p className="muted">No folder is called that.</p>
            )}
            {personalProjects.length > 0 &&
              filing.doc.in_uploads &&
              !filing.doc.team_id && (
                <>
                  <strong>Move to personal project</strong>
                  {personalProjects.map((project) => (
                    <button
                      key={project.id}
                      className="doc-menu-item"
                      disabled={busy}
                      onClick={() => void fileInProject(filing.doc, project.id)}
                    >
                      <FolderIcon size={16} />
                      <span>{project.name}</span>
                    </button>
                  ))}
                </>
              )}
          </div>
        </Popover>
      )}
      {tagging && (
        <Popover
          label="Tag the picked pages"
          anchor={tagging}
          onClose={() => setTagging(null)}
          width={260}
        >
          <div className="docs-move-menu">
            <strong>Add a tag</strong>
            <p>
              {picked.size} page{picked.size === 1 ? "" : "s"}
            </p>
            {allTags.length === 0 && (
              <p className="muted">
                No tags yet. Add one to a page from its Info first.
              </p>
            )}
            {allTags.map((t) => (
              <button
                key={t.id}
                className="doc-menu-item"
                disabled={busy}
                onClick={() => void bulk({ tag_id: t.id })}
              >
                <span
                  className="tag-chip"
                  style={{ "--tag": t.color } as never}
                >
                  <i aria-hidden="true" />
                  {t.name}
                </span>
              </button>
            ))}
          </div>
        </Popover>
      )}
      {templating && (
        <PageTemplatesDialog
          folders={folders}
          folderId={
            folderFilter && folderFilter !== "none" ? folderFilter : null
          }
          onClose={() => setTemplating(false)}
          onCreated={(doc, note, tasks) => {
            setOpen(doc);
            void load();
            toast({ text: note });
            if (tasks) onItemsChanged?.();
          }}
        />
      )}
      {making && (
        <MakeCardsDialog
          docId={making.id}
          title={making.title || "Untitled"}
          report={report}
          onClose={() => setMaking(null)}
        />
      )}
      {publishingFolder && (
        <PublishDialog
          kind="folder"
          id={publishingFolder.id}
          name={publishingFolder.name}
          onClose={() => setPublishingFolder(null)}
        />
      )}
    </div>
  );
}
