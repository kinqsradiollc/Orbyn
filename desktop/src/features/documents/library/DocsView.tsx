import { PageCommandScope, preparePageLeave } from "../../../app/page-commands";
import "./document-workspace.css";
import { DocumentLibraryContext } from "./DocumentWorkspace";
import { useElementWidth } from "../../../hooks/useElementWidth";
import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useId,
  useState,
  type DragEvent,
} from "react";
import { onLive } from "../../../lib/live";
import {
  FileText,
  FolderInput,
  PanelLeftClose,
  PanelLeftOpen,
  MoreHorizontal,
  Check,
  Folder as FolderIcon,
  FolderPlus,
  Plus,
  Star,
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
  Brain,
  Sparkles,
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
import { client } from "../../../lib/api";
import { carries, DOC_MIME, startDrag } from "../../../lib/drag";
import { EmptyState } from "../../../components/EmptyState";
import { useConfirm } from "../../../components/Confirm";
import { useToast } from "../../../components/Toast";
import { Select } from "../../../components/Select";
import { Popover } from "../../../components/Popover";
import { DocEditor } from "../editor/DocEditor";
import { ImportButton, UploadsPanel, useImports } from "./Uploads";
import { MakeCardsDialog } from "../../study/StudyView";
import { PageTemplatesDialog } from "../metadata/PageTemplates";
import { PublishDialog } from "../../public-pages/PublishDialog";
import { announceStars } from "../../../app/prefs";
import {
  TreeFolder,
  TreeMoveMenu,
  TreePages,
  useTreeOpen,
  type TreeMoveTo,
} from "./DocsTree";
import "../editor/docs.css";
import { session } from "../../../lib/session";
import { OutcomeNote, useAction } from "../../../components/Outcome";

const when = (iso: string) => {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
};

/** Library/editor integration shared by pages, notes and agent memory. */
type DocsViewProps = {
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
};

export function DocsView(props: DocsViewProps) {
  return <DocsBody key={`${session.get()}:${props.userId ?? ""}`} {...props} />;
}
function DocsBody({
  report: reportError,
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
}: DocsViewProps) {
  const commandScope = useContext(PageCommandScope);
  const { ref: paneRef, width: paneWidth } = useElementWidth();
  const libraryId = useId();
  const paneElement = useRef<HTMLDivElement | null>(null);
  const setPane = useCallback(
    (element: HTMLDivElement | null) => {
      paneElement.current = element;
      paneRef(element);
    },
    [paneRef],
  );
  const rowId = (id: string) => `${libraryId}-doc-row-${id}`;
  const libraryTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      libraryTimers.current.forEach(clearTimeout);
    },
    [],
  );

  const owner = session.get();
  const alive = useRef(true);
  const libraryRead = useRef(0);
  const archiveRead = useRef(0);
  const trashRead = useRef(0);
  const navigation = useRef(0);
  const currentOwner = useCallback(
    () => alive.current && session.get() === owner,
    [owner],
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const report = (error: unknown) => {
    if (currentOwner()) reportError(error);
  };
  const action = useAction(report);
  const busy = action.pending;
  const [libraryError, setLibraryError] = useState("");
  const [archiveFailed, setArchiveFailed] = useState(false);
  const [trashFailed, setTrashFailed] = useState(false);
  const [tagsStatus, setTagsStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const [tagsRevision, setTagsRevision] = useState(0);
  const [tagQuery, setTagQuery] = useState("");

  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  /** Memory and Agent notes, for their folders in the library's tree. */
  const [memoryDocs, setMemoryDocs] = useState<DocSummary[]>([]);
  const [agentDocs, setAgentDocs] = useState<DocSummary[]>([]);
  const tree = useTreeOpen();
  /** A page whose "Move to…" is open, from its ⋯ in the tree. */
  const [treeMoving, setTreeMoving] = useState<{
    doc: DocSummary;
    anchor: DOMRect;
  } | null>(null);
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
  const [libraryMenu, setLibraryMenu] = useState<DOMRect | null>(null);

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
    let active = true;
    setTagsStatus("loading");
    client.listTags().then(
      (tags) => {
        if (active && currentOwner()) {
          setAllTags(tags);
          setTagsStatus("ready");
        }
      },
      () => {
        if (active && currentOwner()) setTagsStatus("failed");
      },
    );
    return () => {
      active = false;
    };
  }, [tagging, tagsRevision, currentOwner]);
  const [personalProjects, setPersonalProjects] = useState<Project[]>([]);
  const [projectsStatus, setProjectsStatus] = useState<
    "loading" | "ready" | "failed"
  >("loading");
  const [projectsRevision, setProjectsRevision] = useState(0);
  useEffect(() => {
    if (!filing?.doc.in_uploads || filing.doc.team_id || filing.many) {
      setPersonalProjects([]);
      setProjectsStatus("ready");
      return;
    }
    let active = true;
    setProjectsStatus("loading");
    void client.listProjects().then(
      (projects) => {
        if (active && currentOwner()) {
          setPersonalProjects(projects.filter((project) => !project.team_id));
          setProjectsStatus("ready");
        }
      },
      (error) => {
        if (active && currentOwner()) {
          setProjectsStatus("failed");
          report(error);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [filing?.doc.id, filing?.many, projectsRevision]); // eslint-disable-line react-hooks/exhaustive-deps
  const [naming, setNaming] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [failed, setFailed] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const compactLibrary = paneWidth > 0 && paneWidth < 900;
  // The library yields to an open source workspace or a narrow content pane.
  const libraryHidden =
    !navigationOpen &&
    (libraryCollapsed || (!!open && (compactLibrary || sourceOpen)));
  const showLibrary = (show: boolean) => {
    setNavigationOpen(show);
    if (show) setLibraryCollapsed(false);
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
  const mutate = (work: () => Promise<string | void>) =>
    action.run(async () => {
      if (!currentOwner()) return;
      ++libraryRead.current;
      const outcome = await work();
      if (!currentOwner()) return;
      ++libraryRead.current;
      return outcome;
    });
  const afterSave = async (message: string) => {
    const refreshed = await load();
    return refreshed ? message : `${message} Couldn't refresh the library.`;
  };

  const loadArchived = async () => {
    const read = ++archiveRead.current;
    setArchiveFailed(false);
    try {
      const rows = await client.listDocs({
        archived: "only",
        ...(fixedKind ? { kind: fixedKind } : {}),
      });
      if (currentOwner() && read === archiveRead.current) setArchivedDocs(rows);
    } catch (e) {
      if (currentOwner() && read === archiveRead.current) {
        setArchiveFailed(true);
        report(e);
      }
    }
  };
  /** Archive a folder (its pages leave lists and search), or bring it back. */
  const archiveFolder = (folder: Folder, archived: boolean) =>
    void mutate(async () => {
      const saved = await client.archiveFolder(folder.id, archived);
      if (!currentOwner()) return;
      setFolders((all) =>
        all.map((f) =>
          f.id === folder.id ? { ...f, archived_at: saved.archived_at } : f,
        ),
      );
      if (archived) select(null);
      else await loadArchived();
      return afterSave(archived ? "Folder archived." : "Folder restored.");
    });
  /** Bring one archived page back into the library. */
  const unarchive = (doc: DocSummary) =>
    void mutate(async () => {
      if (canWriteDoc && !canWriteDoc(doc.team_id)) return;
      await client.archiveDoc(doc.id, false);
      if (!currentOwner()) return;
      setArchivedDocs((all) => all?.filter((d) => d.id !== doc.id) ?? all);
      return afterSave("Page restored.");
    });
  /** Move, archive or tag the picked pages at once (ORG-03). */
  const bulk = (change: {
    folder_id?: string | null;
    archived?: boolean;
    tag_id?: string;
  }) =>
    mutate(async () => {
      const ids = [...picked];
      if (!ids.length) return;
      const result = await client.bulkDocs({ ids, ...change });
      if (!currentOwner()) return;
      // Confirmed rows leave the selection; rejected rows remain available to inspect.
      setPicked(new Set(result.skipped.map((row) => row.id)));
      setFiling(null);
      setTagging(null);
      const verb =
        change.archived === undefined
          ? change.tag_id
            ? "Tagged"
            : "Moved"
          : change.archived
            ? "Archived"
            : "Restored";
      const message = `${verb} ${result.done.length} pages.${result.skipped.length ? ` ${result.skipped.length} couldn't be changed.` : ""}`;
      if (change.archived && result.done.length)
        toast({
          text: `${result.done.length} pages archived.`,
          action: {
            label: "Undo",
            run: () => {
              if (!currentOwner()) return;
              void mutate(async () => {
                await client.bulkDocs({ ids: result.done, archived: false });
                if (currentOwner()) return afterSave("Pages restored.");
              });
            },
          },
        });
      return afterSave(message);
    });
  const loadTrash = async () => {
    const read = ++trashRead.current;
    setTrashFailed(false);
    try {
      const rows = await client.listTrash();
      if (currentOwner() && read === trashRead.current) setTrash(rows);
    } catch (e) {
      if (currentOwner() && read === trashRead.current) {
        setTrashFailed(true);
        report(e);
      }
    }
  };
  const load = async () => {
    const read = ++libraryRead.current;
    const results = await Promise.allSettled([
      client.listDocs(fixedKind ? { kind: fixedKind } : {}),
      client.listFolders(),
      client.listFavourites(),
      client.fadingDocs(),
      fixedKind
        ? Promise.resolve([] as DocSummary[])
        : client.listDocs({ kind: "memory" }),
      fixedKind
        ? Promise.resolve([] as DocSummary[])
        : client.listDocs({ kind: "agent" }),
    ]);
    if (!currentOwner() || read !== libraryRead.current) return false;
    const [pages, folderRows, favourites, outdated, memory, agents] = results;
    if (pages.status === "fulfilled") {
      setDocs(pages.value);
      setFailed(false);
    } else {
      setFailed(true);
      report(pages.reason);
    }
    if (folderRows.status === "fulfilled") setFolders(folderRows.value);
    if (favourites.status === "fulfilled") setStars(favourites.value);
    if (outdated.status === "fulfilled")
      setFading(new Set(outdated.value.map((d) => d.id)));
    if (memory.status === "fulfilled") setMemoryDocs(memory.value);
    if (agents.status === "fulfilled") setAgentDocs(agents.value);
    const names = [
      "pages",
      "folders",
      "favorites",
      "outdated pages",
      "Memory",
      "agent notes",
    ];
    const failures = results.flatMap((result, index) =>
      result.status === "rejected" ? [names[index]] : [],
    );
    setLibraryError(
      failures.length ? `Couldn't refresh ${failures.join(", ")}.` : "",
    );
    return failures.length === 0;
  };

  const imports = useImports(report, () => void load());
  const importFiles = (files: File[]) => {
    select(null, null, false, null, true);
    void imports.importFiles(files);
  };

  const newFolder = () =>
    void mutate(async () => {
      const name = folderName.trim();
      if (!name) return;
      const folder = await client.createFolder({ name });
      if (!currentOwner()) return;
      setFolders((all) => [...all, folder]);
      setNaming(false);
      setFolderName("");
      setFolderFilter(folder.id);
      setKindFilter(null);
      setFavoritesOnly(false);
      setOpen(null);
      setNavigationOpen(false);
      return "Folder created.";
    });
  const toggleStar = (doc: DocSummary, starred: boolean) =>
    void mutate(async () => {
      await client.setFavourite("doc", doc.id, starred);
      if (!currentOwner()) return;
      setStars((all) =>
        starred
          ? [
              ...all.filter(
                (f) => !(f.kind === "doc" && f.target_id === doc.id),
              ),
              { kind: "doc", target_id: doc.id, created_at: "" },
            ]
          : all.filter((f) => !(f.kind === "doc" && f.target_id === doc.id)),
      );
      announceStars();
      return starred
        ? "Page added to favorites."
        : "Page removed from favorites.";
    });

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
    navigation.current++;
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
    navigation.current++;
    setOpen(initialDoc);
    setTargetBlock(initialBlockId ?? null);
    onInitialDocShown?.();
  }, [initialDoc]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = (kind: DocKind = fixedKind ?? "doc") =>
    void mutate(async () => {
      const destination = ++navigation.current;
      const input = {
        title: "",
        kind,
        folder_id: folderFilter === "none" ? null : folderFilter,
      };
      const doc =
        kind === "doc"
          ? await client.createDocForEditor(input, {
              format: 2,
              nodes: [
                { kind: "block", block: { type: "paragraph", text: "" } },
              ],
            })
          : await client.createDoc({
              ...input,
              content: [{ type: "paragraph", text: "" }],
            });
      if (!currentOwner()) return;
      if (destination === navigation.current) setOpen(doc);
      return afterSave("Page created.");
    });
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
        if (!currentOwner()) return;
        navigation.current++;
        setOpen(null);
        void load();
      }}
      onChanged={(saved) => {
        if (!currentOwner()) return;
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
        if (!currentOwner()) return;
        navigation.current++;
        setOpen((current) => (current?.id === id ? null : current));
        setDocs((current) => current?.filter((d) => d.id !== id) ?? current);
        void load();
      }}
      onUndoDelete={(back) => {
        if (!currentOwner()) return;
        navigation.current++;
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
        libraryTimers.current.forEach(clearTimeout);
        const destination = navigation.current;
        libraryTimers.current = [
          setTimeout(() => {
            if (!currentOwner() || destination !== navigation.current) return;
            const row = paneElement.current?.querySelector<HTMLElement>(
              `[id="${CSS.escape(rowId(here.id))}"]`,
            );
            row?.scrollIntoView({ block: "center", behavior: "auto" });
          }, 60),
          setTimeout(() => {
            if (currentOwner() && destination === navigation.current)
              setFlash(null);
          }, 2000),
        ];
      }}
    />
  ) : null;

  /** Bring a page back from Trash, and say where it went. */
  const restore = (page: TrashedDoc) =>
    void mutate(async () => {
      const restored = await client.restoreDoc(page.id);
      if (!currentOwner()) return;
      setTrash((all) => all?.filter((d) => d.id !== page.id) ?? all);
      toast({
        text: "Page restored.",
        action: {
          label: "Open",
          run: () => {
            if (currentOwner()) {
              navigation.current++;
              setOpen(restored);
            }
          },
        },
      });
      return afterSave("Page restored.");
    });
  /** Permanent deletion holds one operation through confirmation and receipt. */
  const destroy = (page: TrashedDoc) =>
    mutate(async () => {
      if (
        !(await ask({
          title: "Delete page permanently?",
          body: `${page.title || "Untitled"} · Its history and comments are also deleted.`,
          confirmLabel: "Delete permanently",
          destructive: true,
        })) ||
        !currentOwner()
      )
        return;
      await client.deleteDocForever(page.id);
      if (!currentOwner()) return;
      setTrash((all) => all?.filter((d) => d.id !== page.id) ?? all);
      return "Page permanently deleted.";
    });

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
    const destination = ++navigation.current;
    void action.run(async () => {
      if (
        !(await preparePageLeave(commandScope)) ||
        !currentOwner() ||
        destination !== navigation.current
      )
        return;
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
    });
  };
  const openPage = (id: string) => {
    if (busy) return;
    const destination = ++navigation.current;
    void action.run(async () => {
      if (
        !(await preparePageLeave(commandScope)) ||
        !currentOwner() ||
        destination !== navigation.current
      )
        return;
      const doc = await client.getDocForEditor(id);
      if (!currentOwner() || destination !== navigation.current) return;
      setOpen(doc);
      setNavigationOpen(false);
    });
  };
  const fileIn = (doc: DocSummary, folderId: string) =>
    mutate(async () => {
      if (canWriteDoc && !canWriteDoc(doc.team_id)) return;
      const saved = await client.moveDoc(doc.id, {
        parent_id: null,
        folder_id: folderId || null,
      });
      if (!currentOwner()) return;
      setFiling(null);
      setDocs(
        (all) =>
          all?.map((d) =>
            d.id === doc.id
              ? {
                  ...d,
                  folder_id: saved.folder_id,
                  parent_id: saved.parent_id,
                  in_uploads: false,
                  updated_at: saved.updated_at,
                }
              : d,
          ) ?? all,
      );
      return afterSave("Page moved.");
    });
  const fileInProject = (doc: DocSummary, projectId: string) =>
    mutate(async () => {
      if (canWriteDoc && !canWriteDoc(doc.team_id)) return;
      const full = await client.getDocForEditor(doc.id);
      if (!currentOwner()) return;
      await client.updateDocForEditor(doc.id, {
        version: full.version,
        document: full.document ?? { format: 1, blocks: full.content },
        project_id: projectId,
      });
      if (!currentOwner()) return;
      setFiling(null);
      return afterSave("Page moved to project.");
    });

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
      if (!doc || ((doc.folder_id ?? "") === folderId && !doc.parent_id))
        return;
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
  // ---- the library's tree (W5) ----
  const everyPage = [...(docs ?? []), ...memoryDocs, ...agentDocs];
  const unfiled = (docs ?? []).filter(
    (d) => !d.folder_id && d.kind !== "agenda",
  );
  const writable = (doc: DocSummary) =>
    !canWriteDoc || canWriteDoc(doc.team_id);
  /** Move a page in the tree, then read the library again. */
  const moveInTree = (doc: DocSummary, to: TreeMoveTo) =>
    void mutate(async () => {
      if (!writable(doc)) return;
      const saved = await client.moveDoc(doc.id, to);
      if (!currentOwner()) return;
      setTreeMoving(null);
      if (saved.parent_id) tree.show(saved.parent_id);
      return afterSave("Page moved.");
    });
  const renameInTree = (doc: DocSummary, title: string) =>
    mutate(async () => {
      if (!writable(doc)) return;
      const full = await client.getDocForEditor(doc.id);
      if (!currentOwner()) return;
      const saved = await client.updateDocForEditor(doc.id, {
        title,
        document: full.document ?? { format: 1, blocks: full.content },
        version: full.version,
      });
      if (!currentOwner()) return;
      setDocs(
        (all) =>
          all?.map((d) => (d.id === doc.id ? { ...d, title } : d)) ?? all,
      );
      setOpen((current) => (current?.id === saved.id ? saved : current));
      return afterSave("Page renamed.");
    });
  const newInside = (parent: DocSummary) =>
    void mutate(async () => {
      if (!writable(parent)) return;
      const destination = ++navigation.current;
      const kind: "memory" | "agent" | "doc" =
        parent.kind === "memory" || parent.kind === "agent"
          ? parent.kind
          : "doc";
      const input = {
        title: "",
        kind,
        team_id: parent.team_id,
        parent_id: parent.id,
      };
      const doc =
        kind === "doc"
          ? await client.createDocForEditor(input, {
              format: 2,
              nodes: [
                { kind: "block", block: { type: "paragraph", text: "" } },
              ],
            })
          : await client.createDoc({
              ...input,
              content: [{ type: "paragraph", text: "" }],
            });
      if (!currentOwner()) return;
      tree.show(parent.id);
      if (destination === navigation.current) setOpen(doc);
      return afterSave("Page created.");
    });

  const treePages = (pages: DocSummary[]) => (
    <TreePages
      pages={pages}
      all={everyPage}
      openId={open?.id ?? null}
      busy={busy}
      tree={tree}
      canWrite={writable}
      onOpen={openPage}
      onMove={moveInTree}
      onRename={renameInTree}
      onNewInside={newInside}
      onMoveMenu={(doc, anchor) => setTreeMoving({ doc, anchor })}
    />
  );
  /** Memory's or Agent notes' folder: a note dropped there goes to its top. */
  const libraryDrop = (kind: "memory" | "agent") => ({
    className: dropFolder === kind ? "is-drop" : undefined,
    onDragOver: (e: DragEvent) => {
      if (!carries(e, DOC_MIME)) return;
      e.preventDefault();
      if (dropFolder !== kind) setDropFolder(kind);
    },
    onDragLeave: (e: DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setDropFolder((f) => (f === kind ? null : f));
    },
    onDrop: (e: DragEvent) => {
      setDropFolder(null);
      const id = e.dataTransfer.getData(DOC_MIME);
      const doc = everyPage.find((d) => d.id === id);
      if (!doc) return;
      e.preventDefault();
      if (doc.kind !== kind) {
        toast({
          text:
            kind === "memory"
              ? "Only Memory notes go in Memory."
              : "Only Agent notes go in Agent notes.",
          tone: "warn",
        });
        return;
      }
      if (doc.parent_id) moveInTree(doc, { parent_id: null });
    },
  });
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
      ref={setPane}
      className={
        "docs-workspace" +
        (paneWidth > 0 && paneWidth < 900 ? " is-compact" : "") +
        (libraryHidden ? " is-library-hidden" : "") +
        (dropping ? " is-dropping" : "") +
        (editor ? " is-document-open" : "")
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
          <span>PDF, Word or photos</span>
        </div>
      )}
      <button
        className="text-button docs-nav-toggle"
        hidden={!libraryHidden && !compactLibrary}
        aria-expanded={!libraryHidden && (!compactLibrary || navigationOpen)}
        aria-controls={`${libraryId}-navigation`}
        onClick={() => showLibrary(!navigationOpen)}
      >
        <PanelLeftOpen size={18} />{" "}
        {navigationOpen
          ? `Close ${fixedKind === "memory" ? "Memory" : fixedKind === "agent" ? "Agent notes" : "library"}`
          : `Browse ${fixedKind === "memory" ? "Memory" : fixedKind === "agent" ? "Agent notes" : "library"}`}
      </button>
      <nav
        id={`${libraryId}-navigation`}
        aria-label="Document library"
        className={"docs-navigation" + (navigationOpen ? " is-open" : "")}
        onKeyDown={(event) => {
          if (event.key === "Escape" && navigationOpen) {
            event.stopPropagation();
            showLibrary(false);
            event.currentTarget
              .closest(".docs-workspace")
              ?.querySelector<HTMLButtonElement>(".docs-nav-toggle")
              ?.focus();
          }
        }}
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
            type="button"
            className="icon-button docs-library-hide"
            aria-label="Collapse library"
            aria-controls={`${libraryId}-navigation`}
            onClick={() => {
              setLibraryCollapsed(true);
              setNavigationOpen(false);
            }}
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
                disabled={busy}
                onClick={() => {
                  action.setOutcome(null);
                  setNaming(!naming);
                }}
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
                  disabled={busy}
                  value={folderName}
                  maxLength={60}
                  autoFocus
                  onChange={(e) => setFolderName(e.target.value)}
                />
                <div>
                  <button type="submit" disabled={busy || !folderName.trim()}>
                    Create
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setNaming(false)}
                  >
                    Cancel
                  </button>
                </div>
                <OutcomeNote outcome={action.outcome} />
              </form>
            )}
            {folders
              .filter((f) => !f.archived_at)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((folder) => {
                const inside = (docs ?? []).filter(
                  (d) => d.folder_id === folder.id,
                );
                return (
                  <TreeFolder
                    key={folder.id}
                    id={`folder:${folder.id}`}
                    name={folder.name}
                    count={inside.length}
                    tree={tree}
                    drop={folderDrop(folder.id)}
                  >
                    <button
                      aria-current={
                        !open && folderFilter === folder.id ? "page" : undefined
                      }
                      onClick={() => select(folder.id)}
                    >
                      View folder
                    </button>
                    {treePages(inside)}
                  </TreeFolder>
                );
              })}
            <TreeFolder
              id="folder:unfiled"
              name="Unfiled"
              count={unfiled.length}
              tree={tree}
              drop={folderDrop("")}
            >
              <button
                aria-current={
                  !open && folderFilter === "none" ? "page" : undefined
                }
                onClick={() => select("none")}
              >
                View unfiled
              </button>
              {treePages(unfiled)}
            </TreeFolder>
            {memoryDocs.length > 0 && (
              <TreeFolder
                id="folder:memory"
                icon={Brain}
                name="Memory"
                count={memoryDocs.length}
                tree={tree}
                drop={libraryDrop("memory")}
              >
                {treePages(memoryDocs)}
              </TreeFolder>
            )}
            {agentDocs.length > 0 && (
              <TreeFolder
                id="folder:agent"
                icon={Sparkles}
                name="Agent notes"
                count={agentDocs.length}
                tree={tree}
                drop={libraryDrop("agent")}
              >
                {treePages(agentDocs)}
              </TreeFolder>
            )}
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
            {treePages(docs ?? [])}
            {docs?.length === 0 && (
              <p className="muted docs-nav-empty">No notes yet</p>
            )}
          </div>
        )}
      </nav>
      <section className="docs-workspace-content" aria-label="Documents">
        {!naming && !filing && !tagging && (
          <OutcomeNote outcome={action.outcome} />
        )}
        {libraryError && (
          <div className="docs-library-feedback">
            <p role="alert">{libraryError}</p>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void load()}
            >
              Retry library
            </button>
          </div>
        )}
        {editor ? (
          <DocumentLibraryContext.Provider
            value={{
              setSourceOpen,
            }}
          >
            {editor}
          </DocumentLibraryContext.Provider>
        ) : (
          <div className="docs-view">
            <div className="docs-head">
              <h1 className="docs-count docs-library-title">{location}</h1>
              <div className="docs-head-actions">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => create(fixedKind ?? "doc")}
                >
                  <Plus size={15} />{" "}
                  {fixedKind === "memory"
                    ? "New Memory note"
                    : fixedKind === "agent"
                      ? "New Agent note"
                      : "New page"}
                </button>
                {!fixedKind && (
                  <button
                    className="icon-button"
                    disabled={busy}
                    aria-label="Library options"
                    aria-haspopup="dialog"
                    aria-expanded={!!libraryMenu}
                    onClick={(event) =>
                      setLibraryMenu(
                        event.currentTarget.getBoundingClientRect(),
                      )
                    }
                  >
                    <MoreHorizontal size={18} />
                  </button>
                )}
              </div>
            </div>
            {trashOnly && (
              <p className="docs-trash-note">
                Deleted pages are kept for {TRASH_DAYS} days.
              </p>
            )}
            {archivedOnly && (
              <p className="docs-trash-note">
                Restore pages to return them to the library.
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
              archiveFailed ? (
                <div>
                  <p role="alert">Couldn't load archived pages.</p>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void loadArchived()}
                  >
                    Retry
                  </button>
                </div>
              ) : archivedDocs === null ? (
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
                        id={rowId(doc.id)}
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
              trashFailed ? (
                <div>
                  <p role="alert">Couldn't load Trash.</p>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void loadTrash()}
                  >
                    Retry
                  </button>
                </div>
              ) : trash === null ? (
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
                loading={imports.loading}
                loadError={imports.loadError}
                onRetry={() => void imports.refresh()}
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
                      ? "Notes your assistant remembers. You can edit them."
                      : fixedKind === "agent"
                        ? "Briefs and notes from your agents."
                        : "Create a page or import a file."
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
                      disabled={busy}
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
                                disabled={busy}
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
                            id={rowId(doc.id)}
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
                            disabled={busy}
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
      {libraryMenu && (
        <Popover
          label="Library options"
          anchor={libraryMenu}
          onClose={() => {
            if (!busy) setLibraryMenu(null);
          }}
        >
          <div className="popover-actions">
            <button
              disabled={busy}
              onClick={() => {
                setLibraryMenu(null);
                create("note");
              }}
            >
              <Plus size={15} /> New note
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setLibraryMenu(null);
                setTemplating(true);
              }}
            >
              <LayoutTemplate size={15} /> From template
            </button>
            <ImportButton
              busy={busy || imports.busy}
              onFiles={(files) => {
                setLibraryMenu(null);
                importFiles(files);
              }}
            />
            {openFolder && (
              <>
                <button
                  disabled={busy}
                  onClick={() => {
                    setLibraryMenu(null);
                    setPublishingFolder(openFolder);
                  }}
                >
                  <Globe size={15} /> Publish folder
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    setLibraryMenu(null);
                    archiveFolder(openFolder, true);
                  }}
                >
                  <Archive size={15} /> Archive folder
                </button>
              </>
            )}
          </div>
        </Popover>
      )}
      {filing && (
        <Popover
          label="Move to folder"
          anchor={filing.anchor}
          onClose={() => {
            if (!busy) setFiling(null);
          }}
          width={280}
        >
          <div className="docs-move-menu">
            <OutcomeNote outcome={action.outcome} />
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
              disabled={busy}
              value={moveQuery}
              autoFocus
              onChange={(e) => setMoveQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || busy) return;
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
            {filing.doc.in_uploads &&
              !filing.doc.team_id &&
              !filing.many &&
              projectsStatus === "loading" && (
                <p className="muted">Loading projects…</p>
              )}
            {filing.doc.in_uploads &&
              !filing.doc.team_id &&
              !filing.many &&
              projectsStatus === "failed" && (
                <div>
                  <p role="alert">Couldn't load projects.</p>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => setProjectsRevision((n) => n + 1)}
                  >
                    Retry projects
                  </button>
                </div>
              )}
            {projectsStatus === "ready" &&
              !filing.many &&
              personalProjects.length > 0 &&
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
      {treeMoving && (
        <TreeMoveMenu
          doc={treeMoving.doc}
          all={everyPage}
          folders={folders}
          anchor={treeMoving.anchor}
          busy={busy}
          onPick={(to) => moveInTree(treeMoving.doc, to)}
          onClose={() => {
            if (!busy) setTreeMoving(null);
          }}
        />
      )}
      {tagging && (
        <Popover
          label="Tag the picked pages"
          anchor={tagging}
          onClose={() => {
            if (!busy) setTagging(null);
          }}
          width={260}
        >
          <div className="docs-move-menu">
            <OutcomeNote outcome={action.outcome} />
            <strong>Add a tag</strong>
            <p>
              {picked.size} page{picked.size === 1 ? "" : "s"}
            </p>
            <input
              disabled={busy}
              aria-label="Find a tag"
              placeholder="Find a tag"
              value={tagQuery}
              onChange={(e) => setTagQuery(e.target.value)}
            />
            {tagsStatus === "failed" && (
              <div>
                <p role="alert">Couldn't load tags.</p>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => setTagsRevision((n) => n + 1)}
                >
                  Retry
                </button>
              </div>
            )}
            {tagsStatus === "loading" && <p className="muted">Loading tags…</p>}
            {tagsStatus === "ready" && allTags.length === 0 && (
              <p className="muted">
                No tags yet. Add one to a page from its Info first.
              </p>
            )}
            {tagsStatus === "ready" &&
              tagQuery.trim() &&
              !allTags.some((tag) =>
                tag.name
                  .toLocaleLowerCase()
                  .includes(tagQuery.trim().toLocaleLowerCase()),
              ) && <p className="muted">No matching tags.</p>}
            {(tagsStatus === "ready"
              ? allTags.filter((t) =>
                  t.name
                    .toLocaleLowerCase()
                    .includes(tagQuery.trim().toLocaleLowerCase()),
                )
              : []
            ).map((t) => (
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
