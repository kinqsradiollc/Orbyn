import type { ViewDraftStore } from "@orbyn/api-client";
import { useElementWidth } from "../../hooks/useElementWidth";
import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  CalendarDays,
  Columns3,
  Copy,
  Download,
  GalleryVertical,
  LayoutList,
  Link2,
  MoreHorizontal,
  Pin,
  Plus,
  SlidersHorizontal,
  Star,
  Table2,
  Trash2,
} from "lucide-react";
import {
  boardColumns,
  HttpError,
  columnLabel,
  dropChange,
  fieldKeyId,
  fullDefinition,
  groupRows,
  isBoardGroup,
  layoutsFor,
  searchSavedViews,
  VIEW_COLUMNS,
  VIEW_GROUP_LABELS,
  VIEW_GROUPS,
  VIEW_LAYOUT_LABELS,
  VIEW_PRESETS,
  VIEW_SORT_LABELS,
  VIEW_SORTS,
  VIEW_SOURCE_LABELS,
  VIEW_SOURCES,
  viewColumns,
  viewTable,
  type BoardGroupBy,
  type CustomField,
  type Folder,
  type Item,
  type Project,
  type SavedView,
  type Team,
  type ViewDefinition,
  type ViewDefinitionInput,
  type ViewLayout,
  type ViewResult,
  type ViewRow,
  type ViewSource,
} from "@orbyn/core";
import {
  PageCommandScope,
  preparePageLeave,
  usePaneLeaveGuard,
} from "../../app/page-commands";
import { session } from "../../lib/session";
import { client } from "../../lib/api";
import { announceStars } from "../../app/prefs";
import { EmptyState } from "../../components/EmptyState";
import { Popover } from "../../components/Popover";
import { Select } from "../../components/Select";
import { useConfirm } from "../../components/Confirm";
import { useToast } from "../../components/Toast";
import { usePlanning } from "../../app/planning";
import { webOrigin } from "../../lib/links";
import { copyText } from "../../lib/planning";
import { TaskBoard } from "../tasks/TaskBoard";
import { applyEdit, type CellEdit, type TaskActions } from "./edits";
import { ViewFilters } from "./ViewFilters";
import { SettingsEditor } from "../settings/SettingsEditor";
import { ViewTable } from "./ViewTable";
import { ViewBoard, ViewCalendar, ViewGallery, ViewList } from "./ViewLayouts";
import "./views.css";

type Props = TaskActions & {
  draftStore: ViewDraftStore;
  report: (e: unknown) => void;
  teams: Team[];
  userId?: string;
  items: Item[];
  /** Changes when tasks change anywhere, so rows read afresh. */
  revision: number;
  /** A view to open (from the sidebar or a link), then cleared. */
  openViewId: string | null;
  onViewOpened: () => void;
  /** The view open now, so the sidebar can mark it. */
  onSelected?: (id: string | null) => void;
  onOpenItem: (item: Item) => void;
  onOpenDoc: (id: string) => void;
  onOpenProject: (id: string) => void;
  /** Views were added, renamed, pinned or removed (the sidebar lists pins). */
  onViewsChanged: () => void;
};

const LAYOUT_ICONS: Record<ViewLayout, typeof Table2> = {
  list: LayoutList,
  board: Columns3,
  table: Table2,
  calendar: CalendarDays,
  gallery: GalleryVertical,
};

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Saved views (DATA-01): named filters, sorts, groupings and layouts over
 * tasks, pages or projects, kept on the account. Yours and your teams' sit
 * on the left; the open one fills the page as a list, board, table,
 * calendar or (for pages) gallery. Changes to a view you may change are
 * saved as you make them; on a teammate's view they stay yours until you
 * save a copy.
 */
export function ViewsView({
  draftStore,
  report,
  teams,
  userId,
  items,
  revision,
  openViewId,
  onViewOpened,
  onSelected,
  onOpenItem,
  onOpenDoc,
  onOpenProject,
  onViewsChanged,
  onToggle,
  onSetStatus,
  onChangeItem,
}: Props) {
  const { ref: pageRef, width: pageWidth } = useElementWidth();
  const commandScope = useContext(PageCommandScope);
  const accountAtRender = session.get();
  const planning = usePlanning();
  const toast = useToast();
  const { ask } = useConfirm();
  const [views, setViews] = useState<SavedView[] | null>(null);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [stars, setStars] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [def, setDef] = useState<ViewDefinition | null>(null);
  const definitionRef = useRef(def);
  definitionRef.current = def;
  const draftRevision = useSyncExternalStore(
    draftStore.subscribe,
    draftStore.getSnapshot,
  );
  const appliedDraftRevision = useRef(0);
  const [result, setResult] = useState<ViewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const [columnsMenu, setColumnsMenu] = useState<DOMRect | null>(null);
  const [creating, setCreating] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [stamp, setStamp] = useState(0);
  const [libraryError, setLibraryError] = useState(false);
  const [libraryRetry, setLibraryRetry] = useState(0);
  const [rowsError, setRowsError] = useState(false);
  const mounted = useRef(true);
  const currentOwner = () =>
    mounted.current && session.get() === accountAtRender;
  const libraryRead = useRef(0);
  const saveStates = draftStore.states;
  useEffect(() => {
    const after = appliedDraftRevision.current;
    appliedDraftRevision.current = draftRevision;
    setViews(
      (list) =>
        list?.map((entry) => {
          const saved = draftStore.saved.get(entry.id);
          return saved && saved.version > after
            ? { ...entry, definition: saved.definition }
            : entry;
        }) ?? list,
    );
  }, [draftRevision, draftStore]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      libraryRead.current += 1;
    };
  }, []);
  const reportRef = useRef(report);
  reportRef.current = report;
  // The account's time zone, as the server read the rows' days in it.
  const tz = result?.time_zone ?? planning.prefs?.timezone ?? timeZone();

  const view = views?.find((v) => v.id === selected) ?? null;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const editingRows = useRef(new Set<string>());
  const confirmedRows = useRef(new Set<string>());
  const [blockedRows, setBlockedRows] = useState<Set<string>>(new Set());
  const rowRead = useRef(0);
  const publishBlockedRows = () => {
    if (currentOwner())
      setBlockedRows(
        new Set([...editingRows.current, ...confirmedRows.current]),
      );
  };
  usePaneLeaveGuard(async () => editingRows.current.size === 0);
  const resultDefinition = useRef("");

  const loadViews = async () => {
    const request = ++libraryRead.current;
    const started = draftStore.getSnapshot();
    const [list, favourites] = await Promise.all([
      client.listViews(),
      client.listFavourites(),
    ]);
    if (!currentOwner() || request !== libraryRead.current) return list;
    setViews(
      list.map((entry) => {
        const saved = draftStore.saved.get(entry.id);
        return saved && saved.version > started
          ? { ...entry, definition: saved.definition }
          : entry;
      }),
    );
    setStars(
      new Set(
        favourites.filter((f) => f.kind === "view").map((f) => f.target_id),
      ),
    );
    return list;
  };

  useEffect(() => {
    let alive = true;
    setLibraryError(false);
    loadViews().then(
      (list) => {
        if (alive && currentOwner())
          setSelected(
            (s) =>
              s ??
              (openViewId && list.some((v) => v.id === openViewId)
                ? openViewId
                : (list.find((v) => v.pinned)?.id ?? list[0]?.id ?? null)),
          );
      },
      (e) => {
        if (alive && currentOwner()) {
          setLibraryError(true);
          reportRef.current(e);
        }
      },
    );
    // Names for the filters: projects, folders and fields.
    void Promise.allSettled([
      client.listProjects(),
      client.listFolders(),
      client.listFields(),
    ]).then(([p, f, fl]) => {
      if (!alive || !currentOwner()) return;
      if (p.status === "fulfilled") setProjects(p.value);
      if (f.status === "fulfilled") setFolders(f.value);
      if (fl.status === "fulfilled") setFields(fl.value);
      const rejected = [p, f, fl].find((entry) => entry.status === "rejected");
      if (rejected?.status === "rejected") {
        setLibraryError(true);
        reportRef.current(rejected.reason);
      }
    });
    return () => {
      alive = false;
      libraryRead.current += 1;
    };
  }, [libraryRetry]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseView = async (id: string) => {
    if (id === selectedRef.current) return;
    if (
      !(await preparePageLeave(commandScope)) ||
      !mounted.current ||
      session.get() !== accountAtRender
    )
      return;
    setSelected(id);
  };
  // A view asked for from the sidebar or a link.
  useEffect(() => {
    if (!openViewId || !views) return;
    if (views.some((v) => v.id === openViewId)) void chooseView(openViewId);
    else
      report(
        new HttpError(404, "That view isn't shared with you, or was deleted."),
      );
    onViewOpened();
  }, [openViewId, views]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onSelected?.(selected);
    return () => onSelected?.(null);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // The working copy follows the open view.
  useEffect(() => {
    setDef(view ? (draftStore.drafts.get(view.id) ?? view.definition) : null);
    setFolded(new Set());
    setResult(null);
    setRowsError(false);
    setMenu(null);
    setColumnsMenu(null);
    setRenaming(null);
    setFiltersOpen(false);
  }, [view?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rows, read afresh whenever the definition or anything else changes.
  useEffect(() => {
    if (!def) return;
    let live = true;
    const request = ++rowRead.current;
    setLoading(true);
    setRowsError(false);
    const key = `${view?.id}:${JSON.stringify(def)}`;
    if (resultDefinition.current !== key) setResult(null);
    const timer = window.setTimeout(() => {
      const awaitingRefresh = new Set(confirmedRows.current);
      client.runDefinition(def).then(
        (r) => {
          if (!live || !currentOwner() || rowRead.current !== request) return;
          for (const id of awaitingRefresh) confirmedRows.current.delete(id);
          publishBlockedRows();
          resultDefinition.current = key;
          setResult(r);
          setLoading(false);
        },
        (e) => {
          if (!live || !currentOwner() || rowRead.current !== request) return;
          setLoading(false);
          setRowsError(true);
          reportRef.current(e);
        },
      );
    }, 180);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [def, revision, stamp, view?.id]);

  // Queue at the initiating event; the workspace owns the debounce and writes.
  const change = async (next: Partial<ViewDefinitionInput>) => {
    if (
      !(await preparePageLeave(commandScope)) ||
      session.get() !== accountAtRender ||
      !mounted.current
    )
      return;
    const current = definitionRef.current;
    if (!current || !view) return;
    const changed = fullDefinition({
      ...current,
      ...next,
    } as ViewDefinitionInput);
    rowRead.current += 1;
    definitionRef.current = changed;
    draftStore.change(view.id, changed, view.can_edit);
    setDef(changed);
  };

  const itemOf = (row: ViewRow) =>
    items.find((i) => i.id === row.id) ?? row.item;

  const open = async (row: ViewRow) => {
    if (!(await preparePageLeave(commandScope)) || !currentOwner()) return;
    if (row.kind === "task") {
      const item = itemOf(row);
      if (item) onOpenItem(item);
    } else if (row.kind === "page") onOpenDoc(row.id);
    else onOpenProject(row.id);
  };

  const runRowChange = async (
    row: ViewRow,
    operation: () => Promise<boolean>,
  ): Promise<boolean> => {
    if (
      !currentOwner() ||
      !row.can_write ||
      editingRows.current.has(row.id) ||
      confirmedRows.current.has(row.id)
    )
      return false;
    editingRows.current.add(row.id);
    publishBlockedRows();
    try {
      const saved = await operation();
      if (!currentOwner()) return false;
      if (saved) {
        confirmedRows.current.add(row.id);
        rowRead.current += 1;
        setStamp((value) => value + 1);
      }
      return saved;
    } catch (error) {
      if (currentOwner()) report(error);
      return false;
    } finally {
      editingRows.current.delete(row.id);
      publishBlockedRows();
    }
  };
  const edit = (row: ViewRow, change: CellEdit): Promise<boolean> =>
    runRowChange(row, () =>
      applyEdit(
        row,
        change,
        itemOf(row),
        { onToggle, onSetStatus, onChangeItem },
        tz,
      ),
    );

  const managementLock = useRef(false);
  const [managementBusy, setManagementBusy] = useState(false);
  const manage = async (operation: () => Promise<void>) => {
    if (!currentOwner() || managementLock.current) return;
    if (
      !(await preparePageLeave(commandScope)) ||
      !currentOwner() ||
      managementLock.current
    )
      return;
    managementLock.current = true;
    setManagementBusy(true);
    try {
      await operation();
    } catch (error) {
      if (currentOwner()) report(error);
    } finally {
      managementLock.current = false;
      if (currentOwner()) setManagementBusy(false);
    }
  };
  const setStar = (id: string, starred: boolean) =>
    void manage(async () => {
      await client.setFavourite("view", id, starred);
      if (!currentOwner()) return;
      setStars((old) => {
        const next = new Set(old);
        if (starred) next.add(id);
        else next.delete(id);
        return next;
      });
      announceStars();
    });
  const setPin = (view: SavedView, pinned: boolean) =>
    void manage(async () => {
      await client.pinView(view.id, pinned);
      if (!currentOwner()) return;
      setViews(
        (list) =>
          list?.map((entry) =>
            entry.id === view.id ? { ...entry, pinned } : entry,
          ) ?? list,
      );
      onViewsChanged();
    });
  const create = async (
    name: string,
    definition: ViewDefinitionInput,
    teamId: string | null,
  ) => {
    if (!currentOwner() || managementLock.current)
      throw new Error("A view change is already in progress.");
    if (!(await preparePageLeave(commandScope)) || !currentOwner())
      throw new Error("Finish or cancel the current cell edit first.");
    if (managementLock.current)
      throw new Error("A view change is already in progress.");
    managementLock.current = true;
    setManagementBusy(true);
    let made: SavedView;
    try {
      made = await client.createView({ name, definition, team_id: teamId });
    } finally {
      managementLock.current = false;
      if (currentOwner()) setManagementBusy(false);
    }
    if (!currentOwner()) return;
    setViews((vs) => [...(vs ?? []), made]);
    setSelected(made.id);
    draftStore.keepCreation(null);
    setCreating(false);
    onViewsChanged();
  };

  const remove = (v: SavedView) =>
    manage(async () => {
      setMenu(null);
      const ok = await ask({
        title: `Delete ${v.name}?`,
        body: v.team_id
          ? `It goes for everyone in ${v.team_name ?? "the team"}. Nothing it shows is deleted.`
          : "Nothing it shows is deleted.",
        confirmLabel: "Delete view",
        destructive: true,
      });
      if (!ok || !currentOwner()) return;
      try {
        await client.deleteView(v.id);
        draftStore.forget(v.id);
        if (!currentOwner()) return;
        const list = await loadViews();
        if (!currentOwner()) return;
        if (selectedRef.current === v.id) setSelected(list[0]?.id ?? null);
        onViewsChanged();
        toast({ text: `${v.name} deleted.` });
      } catch (error) {
        if (currentOwner()) report(error);
      }
    });

  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameError, setRenameError] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const renamingNow = useRef(false);
  const rename = async (v: SavedView, name: string) => {
    if (renamingNow.current) return;
    const next = name.trim();
    if (!next) return;
    if (next === v.name) {
      setRenaming(null);
      return;
    }
    renamingNow.current = true;
    setRenameBusy(true);
    setRenameError("");
    try {
      const saved = await client.updateView(v.id, { name: next });
      if (mounted.current) {
        setViews(
          (vs) =>
            vs?.map((x) =>
              x.id === saved.id ? { ...x, name: saved.name } : x,
            ) ?? vs,
        );
        setRenaming(null);
        onViewsChanged();
      }
    } catch (e) {
      if (mounted.current)
        setRenameError(
          e instanceof Error ? e.message : "Couldn’t rename view. Try again.",
        );
    } finally {
      renamingNow.current = false;
      if (mounted.current) setRenameBusy(false);
    }
  };

  const share = (view: SavedView, teamId: string | null) => {
    setMenu(null);
    void manage(async () => {
      const saved = await client.updateView(view.id, { team_id: teamId });
      if (!currentOwner()) return;
      setViews(
        (list) =>
          list?.map((entry) =>
            entry.id === saved.id
              ? { ...saved, definition: entry.definition }
              : entry,
          ) ?? list,
      );
      toast({
        text: teamId
          ? `Shared with ${saved.team_name}. Access permissions still apply.`
          : "Only you have this view now.",
      });
    });
  };
  const exportCsv = (view: SavedView) => {
    setMenu(null);
    void manage(async () => {
      const { text, name } = await client.exportViewCsv(view.id);
      if (!currentOwner()) return;
      const url = URL.createObjectURL(
        new Blob([text], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  };

  const copyTable = () => {
    setMenu(null);
    if (!result || !def) return;
    const text = viewTable(
      result.rows,
      viewColumns(def),
      { now: new Date(), timeZone: tz },
      { fields: result.fields, people: result.people },
      "\t",
    );
    navigator.clipboard.writeText(text).then(
      () => toast({ text: "Copied. Paste it into a spreadsheet." }),
      () => toast({ text: "Couldn't copy here.", tone: "warn" }),
    );
  };

  // Names for groups: lists, tags and people you have, projects in the rows.
  const names = useMemo(() => {
    const rowProjects = new Map<string, string>();
    for (const r of result?.rows ?? [])
      if (r.project_id && r.project_name)
        rowProjects.set(r.project_id, r.project_name);
    return {
      lists: planning.lists,
      tags: planning.tags,
      projects: [...rowProjects].map(([id, name]) => ({ id, name })),
      userId,
      fields: result?.fields ?? [],
      people: result?.people ?? [],
    };
  }, [result, planning.lists, planning.tags, userId]);

  const layoutRows = useMemo(
    () =>
      result?.rows.map((row) =>
        blockedRows.has(row.id) ? { ...row, can_write: false } : row,
      ) ?? [],
    [result, blockedRows],
  );
  const groups = useMemo(
    () => (result && def ? groupRows(layoutRows, def, names) : []),
    [result, def, names, layoutRows],
  );

  const toggleFold = (key: string) =>
    setFolded((f) => {
      const next = new Set(f);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const visibleViews = searchSavedViews(views ?? [], libraryQuery);
  const mine = visibleViews.filter((v) => !v.team_id);
  // Shared views by team, named from the views themselves so they show
  // before the team list has loaded.
  const byTeam = [
    ...new Set(visibleViews.flatMap((v) => (v.team_id ? [v.team_id] : []))),
  ].map((id) => {
    const list = visibleViews.filter((v) => v.team_id === id);
    return {
      team: {
        id,
        name:
          teams.find((t) => t.id === id)?.name ?? list[0].team_name ?? "A team",
      },
      views: list,
    };
  });

  const renderLayout = () => {
    if (!def || !result) return null;
    if (!result.rows.length)
      return (
        <EmptyState
          icon={SlidersHorizontal}
          title="Nothing matches"
          body="Loosen a filter, or add something that fits."
        />
      );
    const shared = {
      timeZone: tz,
      fields: result.fields,
      people: result.people,
      onOpen: open,
    };
    switch (def.layout) {
      case "table":
        return (
          <ViewTable
            key={view?.id}
            source={def.source}
            groups={groups}
            rows={layoutRows}
            columns={viewColumns(def)}
            fields={result.fields}
            people={result.people}
            timeZone={tz}
            folded={folded}
            onToggleFold={toggleFold}
            onOpen={open}
            onEdit={edit}
          />
        );
      case "list":
        return (
          <ViewList
            {...shared}
            groups={groups}
            folded={folded}
            onToggleFold={toggleFold}
            onToggle={(row) => edit(row, { column: "done" })}
          />
        );
      case "board": {
        const by: BoardGroupBy | null =
          def.source === "tasks"
            ? isBoardGroup(def.group_by)
              ? def.group_by
              : def.group_by === "none"
                ? "status"
                : null
            : null;
        if (by) {
          const tasks = layoutRows.flatMap((r) => {
            const item = itemOf(r);
            return item ? [item] : [];
          });
          const columns = boardColumns(tasks, by, names);
          const canWrite = (item: Item) =>
            layoutRows.find((r) => r.id === item.id)?.can_write ?? false;
          return (
            <TaskBoard
              columns={columns}
              by={by}
              targets={columns.map((c) => ({ key: c.key, title: c.title }))}
              busy={false}
              canWrite={canWrite}
              onOpen={onOpenItem}
              onMove={(item, from, to) => {
                const moved = dropChange(item, by, from, to, names);
                if (!moved) return;
                if (!moved.ok) {
                  toast({ text: moved.reason, tone: "warn" });
                  return;
                }
                const row = layoutRows.find((entry) => entry.id === item.id);
                if (row)
                  void runRowChange(row, () =>
                    onChangeItem(item, moved.change),
                  );
              }}
              folded={folded}
              onToggleFold={toggleFold}
            />
          );
        }
        return (
          <ViewBoard
            {...shared}
            groups={groups}
            def={def}
            onSetField={(row, field, value) =>
              edit(row, { column: `field:${field}`, field, value })
            }
          />
        );
      }
      case "calendar":
        return (
          <ViewCalendar
            {...shared}
            rows={layoutRows}
            def={def}
            onMoveDay={(row, day) => {
              const field = fieldKeyId(def.date_by ?? "");
              if (field)
                edit(row, { column: `field:${field}`, field, value: day });
              else edit(row, { column: "due", value: day });
            }}
          />
        );
      case "gallery":
        return <ViewGallery {...shared} rows={layoutRows} />;
    }
  };

  const dateFields = (result?.fields ?? fields).filter(
    (f) =>
      f.type === "date" &&
      f.applies_to === (def?.source === "projects" ? "project" : "page"),
  );
  const sourceFields = fields.filter(
    (f) =>
      def &&
      def.source !== "tasks" &&
      f.applies_to === (def.source === "pages" ? "page" : "project"),
  );

  return (
    <div
      ref={pageRef}
      className={
        "views-screen" +
        (pageWidth < 900 ? " is-compact" : "") +
        (pageWidth < 640 ? " is-small" : "")
      }
    >
      <aside className="views-rail card" aria-label="Your views">
        <button className="primary views-new" onClick={() => setCreating(true)}>
          <Plus size={15} aria-hidden="true" /> New view
        </button>
        <input
          type="search"
          className="views-library-search"
          aria-label="Search saved views"
          placeholder="Search views"
          maxLength={120}
          value={libraryQuery}
          onChange={(event) => setLibraryQuery(event.target.value)}
        />
        {views && views.length > 0 && visibleViews.length === 0 && (
          <p className="muted views-rail-empty" role="status">
            No matching views.
          </p>
        )}
        {libraryError && (
          <button
            className="secondary"
            onClick={() => setLibraryRetry((n) => n + 1)}
          >
            Retry view library
          </button>
        )}
        {views && !views.length && (
          <p className="muted views-rail-empty">Save a filter to use again.</p>
        )}
        {mine.length > 0 && (
          <ViewPicker
            label="YOURS"
            views={mine}
            stars={stars}
            selected={selected}
            onSelect={(id) => void chooseView(id)}
          />
        )}
        {byTeam.map((g) => (
          <ViewPicker
            key={g.team.id}
            label={g.team.name.toUpperCase()}
            views={g.views}
            stars={stars}
            selected={selected}
            onSelect={(id) => void chooseView(id)}
          />
        ))}
      </aside>

      <section className="card views-main">
        {!view || !def ? (
          <EmptyState
            icon={Table2}
            title={
              libraryError && views === null
                ? "Couldn’t load views"
                : views === null
                  ? "Loading views…"
                  : "No view open"
            }
          ></EmptyState>
        ) : (
          <>
            {managementBusy && (
              <p className="muted views-save-status" role="status">
                Updating view…
              </p>
            )}
            <div className="section-heading views-heading">
              <div className="views-title">
                <h2>{view.name}</h2>
                <small className="muted">
                  {VIEW_SOURCE_LABELS[view.source]}
                  {view.team_name ? ` · Shared with ${view.team_name}` : ""}
                  {view.team_id && view.user_id !== userId && view.owner_name
                    ? ` · by ${view.owner_name}`
                    : ""}
                </small>
              </div>
              <div className="views-actions">
                <button
                  className="icon-button"
                  aria-label="View options"
                  title="View options"
                  aria-haspopup="menu"
                  onClick={(e) =>
                    setMenu(
                      menu ? null : e.currentTarget.getBoundingClientRect(),
                    )
                  }
                >
                  <MoreHorizontal size={16} />
                </button>
              </div>
            </div>

            <div className="views-toolbar">
              {pageWidth < 640 ? (
                <label className="filter-select">
                  <span>Layout</span>
                  <Select
                    value={def.layout}
                    onChange={(event) =>
                      change({ layout: event.target.value as ViewLayout })
                    }
                  >
                    {layoutsFor(def.source).map((layout) => (
                      <option key={layout} value={layout}>
                        {VIEW_LAYOUT_LABELS[layout]}
                      </option>
                    ))}
                  </Select>
                </label>
              ) : (
                <div className="segmented" role="group" aria-label="Layout">
                  {layoutsFor(def.source).map((l) => {
                    const Icon = LAYOUT_ICONS[l];
                    return (
                      <button
                        key={l}
                        aria-pressed={def.layout === l}
                        className={def.layout === l ? "active" : ""}
                        onClick={() => change({ layout: l })}
                      >
                        <Icon size={14} aria-hidden="true" />{" "}
                        {VIEW_LAYOUT_LABELS[l]}
                      </button>
                    );
                  })}
                </div>
              )}
              {def.layout === "calendar" && def.source !== "tasks" && (
                <label className="filter-select">
                  <span>Dates from</span>
                  <Select
                    value={def.date_by ?? "due"}
                    onChange={(e) =>
                      change({ date_by: e.target.value as never })
                    }
                  >
                    {def.source === "projects" && (
                      <option value="due">Deadline</option>
                    )}
                    {def.source === "pages" && (
                      <option value="due">Choose a date field</option>
                    )}
                    {dateFields.map((f) => (
                      <option key={f.id} value={`field:${f.id}`}>
                        {f.name}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              {def.layout === "table" && (
                <button
                  className="secondary"
                  aria-haspopup="dialog"
                  onClick={(e) =>
                    setColumnsMenu(
                      columnsMenu
                        ? null
                        : e.currentTarget.getBoundingClientRect(),
                    )
                  }
                >
                  <Columns3 size={14} aria-hidden="true" /> Columns
                </button>
              )}
              <button
                type="button"
                className="secondary filters-toggle"
                aria-expanded={filtersOpen}
                aria-controls="view-filters"
                onClick={() => setFiltersOpen(!filtersOpen)}
              >
                <SlidersHorizontal size={14} aria-hidden="true" />
                {Object.keys(def.filters).length
                  ? `Filters and sort · ${Object.keys(def.filters).length}`
                  : "Filters and sort"}
              </button>
            </div>

            {filtersOpen && (
              <section
                id="view-filters"
                className="views-options"
                aria-label="Filters and sort"
              >
                <div className="views-arrangement">
                  <label className="filter-select">
                    <span>Group</span>
                    <Select
                      value={def.group_by}
                      onChange={(e) => change({ group_by: e.target.value })}
                    >
                      {VIEW_GROUPS[def.source].map((g) => (
                        <option key={g} value={g}>
                          {VIEW_GROUP_LABELS[g] ?? g}
                        </option>
                      ))}
                      {sourceFields
                        .filter((f) => f.type !== "text")
                        .map((f) => (
                          <option key={f.id} value={`field:${f.id}`}>
                            {f.name}
                          </option>
                        ))}
                    </Select>
                  </label>
                  <label className="filter-select">
                    <span>Sort</span>
                    <Select
                      value={`${def.sort.by}|${def.sort.dir}`}
                      onChange={(e) => {
                        const [by, dir] = e.target.value.split("|");
                        change({
                          sort: { by: by as never, dir: dir as "asc" | "desc" },
                        });
                      }}
                    >
                      {VIEW_SORTS.filter(
                        (s) =>
                          def.source === "tasks" ||
                          (s !== "priority" && s !== "estimate"),
                      ).flatMap((s) => [
                        <option key={`${s}|asc`} value={`${s}|asc`}>
                          {VIEW_SORT_LABELS[s]}
                        </option>,
                        <option key={`${s}|desc`} value={`${s}|desc`}>
                          {VIEW_SORT_LABELS[s]}, reversed
                        </option>,
                      ])}
                      {sourceFields.map((f) => (
                        <option key={f.id} value={`field:${f.id}|asc`}>
                          {f.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                </div>
                <ViewFilters
                  key={view.id}
                  id="view-filter-fields"
                  def={def}
                  teams={teams}
                  projects={projects}
                  folders={folders}
                  lists={planning.lists}
                  tags={planning.tags}
                  fields={sourceFields}
                  onChange={(filters) => change({ filters })}
                />
              </section>
            )}

            {!view.can_edit && !same(def, view.definition) && (
              <div className="views-unsaved" role="status">
                <span>
                  These changes are temporary. Save a copy to keep them.
                </span>
                <button
                  className="secondary"
                  onClick={() =>
                    void create(`${view.name} (my copy)`, def, null).catch(
                      report,
                    )
                  }
                >
                  Save a copy
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    draftStore.drafts.delete(view.id);
                    setDef(view.definition);
                  }}
                >
                  Reset changes
                </button>
              </div>
            )}

            {view.can_edit && saveStates[view.id] === "failed" && (
              <div className="views-unsaved" role="status">
                <span>Changes weren’t saved.</span>
                <button
                  className="secondary"
                  onClick={() => draftStore.change(view.id, def, true, true)}
                >
                  Retry save
                </button>
              </div>
            )}
            {view.can_edit && saveStates[view.id] === "saving" && (
              <p className="muted views-save-status" role="status">
                Saving view…
              </p>
            )}
            <div
              className={"views-body" + (loading ? " is-loading" : "")}
              aria-busy={loading}
            >
              {(editingRows.current.size > 0 || (loading && !!result)) && (
                <p className="muted views-save-status" role="status">
                  {editingRows.current.size > 0
                    ? "Saving changes…"
                    : "Updating results…"}
                </p>
              )}
              {rowsError && (
                <div>
                  <p role="alert">Couldn't load results.</p>
                  <button
                    className="secondary"
                    onClick={() => setStamp((n) => n + 1)}
                  >
                    Retry results
                  </button>
                </div>
              )}
              {loading && !result && (
                <p className="muted" role="status">
                  Loading results…
                </p>
              )}
              {result && renderLayout()}
              {result?.truncated && (
                <p className="muted views-truncated">
                  Showing the first {result.rows.length}. Narrow the filters to
                  see the rest.
                </p>
              )}
            </div>
          </>
        )}
      </section>

      {menu && view && (
        <Popover
          anchor={menu}
          label="View options"
          onClose={() => setMenu(null)}
        >
          <fieldset
            disabled={managementBusy}
            className="popover-actions view-menu"
          >
            <button
              onClick={() => {
                setMenu(null);
                setStar(view.id, !stars.has(view.id));
              }}
            >
              <Star size={14} aria-hidden="true" />
              {stars.has(view.id) ? "Unstar" : "Star"}
            </button>
            <button
              onClick={() => {
                setMenu(null);
                setPin(view, !view.pinned);
              }}
            >
              <Pin size={14} aria-hidden="true" />
              {view.pinned ? "Unpin from sidebar" : "Pin to sidebar"}
            </button>

            {view.can_edit && (
              <button
                onClick={() => {
                  setMenu(null);
                  setRenameError("");
                  setRenaming(view.name);
                }}
              >
                Rename
              </button>
            )}
            {view.user_id === userId && (
              <label className="view-menu-share">
                <span>Shared with</span>
                <Select
                  value={view.team_id ?? ""}
                  onChange={(e) => share(view, e.target.value || null)}
                >
                  <option value="">Only me</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <button
              onClick={() => {
                setMenu(null);
                void create(
                  `${view.name} (copy)`,
                  def ?? view.definition,
                  null,
                ).catch(report);
              }}
            >
              <Copy size={14} aria-hidden="true" /> Duplicate
            </button>
            <button
              onClick={() => {
                setMenu(null);
                const origin = webOrigin();
                void copyText(
                  origin
                    ? `${origin}/app/view/${view.id}`
                    : `orbyn://view/${view.id}`,
                ).then((ok) =>
                  toast(
                    ok
                      ? {
                          text: "Link copied. It opens for anyone who has this view.",
                        }
                      : { text: "Couldn't copy here.", tone: "warn" },
                  ),
                );
              }}
            >
              <Link2 size={14} aria-hidden="true" /> Copy link
            </button>
            <button onClick={() => exportCsv(view)}>
              <Download size={14} aria-hidden="true" /> Export as CSV
            </button>
            <button onClick={copyTable} disabled={!result?.rows.length}>
              <Copy size={14} aria-hidden="true" /> Copy for a spreadsheet
            </button>
            {view.can_edit && (
              <button className="danger-text" onClick={() => void remove(view)}>
                <Trash2 size={14} aria-hidden="true" /> Delete view
              </button>
            )}
          </fieldset>
        </Popover>
      )}

      {columnsMenu && def && (
        <Popover
          anchor={columnsMenu}
          label="Columns"
          onClose={() => setColumnsMenu(null)}
        >
          <div className="popover-head">
            <small className="eyebrow">COLUMNS</small>
          </div>
          <div className="popover-actions">
            {[
              ...VIEW_COLUMNS[def.source],
              ...sourceFields.map((f) => `field:${f.id}`),
            ].map((c) => {
              const cols = viewColumns(def);
              const on = cols.includes(c);
              return (
                <label key={c} className="popover-check">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={c === "title"}
                    onChange={() =>
                      change({
                        columns: on
                          ? cols.filter((x) => x !== c)
                          : [...cols, c].slice(0, 20),
                      })
                    }
                  />
                  <span>{columnLabel(c, sourceFields)}</span>
                </label>
              );
            })}
          </div>
        </Popover>
      )}

      {renaming !== null && view && (
        <SettingsEditor
          title="Rename view"
          pending={renameBusy}
          onClose={() => {
            if (!renamingNow.current) setRenaming(null);
          }}
        >
          <form
            className="new-view-body"
            onSubmit={(e) => {
              e.preventDefault();
              void rename(view, renaming);
            }}
          >
            {renameError && (
              <p className="error" role="alert">
                {renameError}
              </p>
            )}
            <label>
              Name
              <input
                autoFocus
                value={renaming}
                maxLength={80}
                disabled={renameBusy}
                onChange={(e) => setRenaming(e.target.value)}
              />
            </label>
            <div className="new-view-actions">
              <button
                type="button"
                className="secondary"
                disabled={renameBusy}
                onClick={() => setRenaming(null)}
              >
                Cancel
              </button>
              <button
                className="primary"
                disabled={renameBusy || !renaming.trim()}
              >
                {renameBusy ? "Saving…" : "Save name"}
              </button>
            </div>
          </form>
        </SettingsEditor>
      )}

      {creating && (
        <NewViewDialog
          draftStore={draftStore}
          teams={teams}
          onClose={() => setCreating(false)}
          onCreate={(name, definition, teamId) =>
            create(name, definition, teamId)
          }
        />
      )}
    </div>
  );
}

function ViewPicker({
  label,
  views,
  stars,
  selected,
  onSelect,
}: {
  label: string;
  views: SavedView[];
  stars: Set<string>;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const sorted = [...views].sort(
    (a, b) =>
      Number(stars.has(b.id)) - Number(stars.has(a.id)) ||
      a.name.localeCompare(b.name),
  );
  return (
    <div className="views-rail-group">
      <span className="nav-label">{label}</span>
      {sorted.map((v) => (
        <button
          key={v.id}
          className={"views-rail-item" + (selected === v.id ? " active" : "")}
          aria-current={selected === v.id ? "page" : undefined}
          onClick={() => onSelect(v.id)}
        >
          <span>{v.name}</span>
          {stars.has(v.id) && (
            <Star size={12} fill="currentColor" aria-label="Starred" />
          )}
          {v.pinned && <Pin size={12} aria-label="Pinned" />}
        </button>
      ))}
    </div>
  );
}

/** A new view: what it shows, a name, a place to start and who has it. */
function NewViewDialog({
  draftStore,
  teams,
  onClose,
  onCreate,
}: {
  draftStore: ViewDraftStore;
  teams: Team[];
  onClose: () => void;
  onCreate: (
    name: string,
    definition: ViewDefinitionInput,
    teamId: string | null,
  ) => Promise<unknown>;
}) {
  const accountAtRender = session.get();
  const [source, setSource] = useState<ViewSource>(
    draftStore.creation?.source ?? "tasks",
  );
  const [name, setName] = useState(draftStore.creation?.name ?? "");
  const [teamId, setTeamId] = useState(draftStore.creation?.team_id ?? "");
  const [preset, setPreset] = useState<number | null>(
    draftStore.creation?.preset ?? null,
  );
  useEffect(() => {
    draftStore.keepCreation({ source, name, team_id: teamId || null, preset });
  }, [source, name, teamId, preset, draftStore]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const writing = useRef(false);
  const mounted = useRef(true);
  const currentOwner = () =>
    mounted.current && session.get() === accountAtRender;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const presets = VIEW_PRESETS.map((p, n) => ({ ...p, n })).filter(
    (p) => p.definition.source === source,
  );
  const submit = () => {
    const chosen = preset !== null ? VIEW_PRESETS[preset] : null;
    const finalName = name.trim() || chosen?.name || "";
    if (!finalName || writing.current || !currentOwner()) return;
    writing.current = true;
    setError("");
    setBusy(true);
    void onCreate(
      finalName,
      chosen?.definition ?? {
        source,
        layout: source === "pages" ? "gallery" : "table",
      },
      teamId || null,
    )
      .catch((e) => {
        if (currentOwner())
          setError(
            e instanceof Error ? e.message : "Couldn’t create view. Try again.",
          );
      })
      .finally(() => {
        writing.current = false;
        if (currentOwner()) setBusy(false);
      });
  };
  return (
    <SettingsEditor
      title="New view"
      pending={busy}
      onClose={() => {
        if (!writing.current) onClose();
      }}
    >
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form
        className="new-view-body"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <fieldset disabled={busy} className="new-view-fields">
          <div className="segmented" role="group" aria-label="What it shows">
            {VIEW_SOURCES.map((s) => (
              <button
                type="button"
                key={s}
                aria-pressed={source === s}
                className={source === s ? "active" : ""}
                onClick={() => {
                  setSource(s);
                  setPreset(null);
                }}
              >
                {VIEW_SOURCE_LABELS[s]}
              </button>
            ))}
          </div>
          <label>
            Name
            <input
              autoFocus
              value={name}
              maxLength={80}
              placeholder={
                preset !== null ? VIEW_PRESETS[preset].name : "Exam week"
              }
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {presets.length > 0 && (
            <fieldset className="new-view-presets">
              <legend>Start from</legend>
              <label className="popover-check">
                <input
                  type="radio"
                  name="preset"
                  checked={preset === null}
                  onChange={() => setPreset(null)}
                />
                <span>Everything</span>
              </label>
              {presets.map((p) => (
                <label key={p.n} className="popover-check">
                  <input
                    type="radio"
                    name="preset"
                    checked={preset === p.n}
                    onChange={() => setPreset(p.n)}
                  />
                  <span>
                    {p.name}
                    <small>{p.blurb}</small>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {teams.length > 0 && (
            <label>
              Who has it
              <Select
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
              >
                <option value="">Only me</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    Everyone in {t.name}
                  </option>
                ))}
              </Select>
              <small className="muted">
                A shared view shows each person only what they can open.
              </small>
            </label>
          )}
        </fieldset>
        <div className="new-view-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="primary"
            disabled={busy || !(name.trim() || preset !== null)}
          >
            {busy ? "Creating…" : "Create view"}
          </button>
        </div>
      </form>
    </SettingsEditor>
  );
}
