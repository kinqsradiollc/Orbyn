import { useEffect, useMemo, useRef, useState } from "react";
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
  X,
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
import { ViewTable } from "./ViewTable";
import { ViewBoard, ViewCalendar, ViewGallery, ViewList } from "./ViewLayouts";
import "./views.css";

type Props = TaskActions & {
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
  const planning = usePlanning();
  const toast = useToast();
  const { ask } = useConfirm();
  const [views, setViews] = useState<SavedView[] | null>(null);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [stars, setStars] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [def, setDef] = useState<ViewDefinition | null>(null);
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
  const reportRef = useRef(report);
  reportRef.current = report;
  // The account's time zone, as the server read the rows' days in it.
  const tz = result?.time_zone ?? planning.prefs?.timezone ?? timeZone();

  const view = views?.find((v) => v.id === selected) ?? null;

  const loadViews = async () => {
    const [list, favourites] = await Promise.all([
      client.listViews(),
      client.listFavourites(),
    ]);
    setViews(list);
    setStars(
      new Set(
        favourites.filter((f) => f.kind === "view").map((f) => f.target_id),
      ),
    );
    return list;
  };

  useEffect(() => {
    loadViews().then(
      (list) =>
        setSelected(
          (s) =>
            s ??
            (openViewId && list.some((v) => v.id === openViewId)
              ? openViewId
              : (list.find((v) => v.pinned)?.id ?? list[0]?.id ?? null)),
        ),
      (e) => reportRef.current(e),
    );
    // Names for the filters: projects, folders and fields.
    void Promise.all([
      client.listProjects(),
      client.listFolders(),
      client.listFields(),
    ]).then(([p, f, fl]) => {
      setProjects(p);
      setFolders(f);
      setFields(fl);
    }, reportRef.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A view asked for from the sidebar or a link.
  useEffect(() => {
    if (!openViewId || !views) return;
    if (views.some((v) => v.id === openViewId)) setSelected(openViewId);
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
    setDef(view ? view.definition : null);
    setFolded(new Set());
    setResult(null);
  }, [view?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rows, read afresh whenever the definition or anything else changes.
  useEffect(() => {
    if (!def) return;
    let live = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      client.runDefinition(def).then(
        (r) => {
          if (!live) return;
          setResult(r);
          setLoading(false);
        },
        (e) => {
          if (!live) return;
          setLoading(false);
          reportRef.current(e);
        },
      );
    }, 180);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [def, revision, stamp]);

  // Changes to a view you may change are kept as you make them.
  useEffect(() => {
    if (!view || !def || !view.can_edit || same(def, view.definition)) return;
    const timer = window.setTimeout(() => {
      client.updateView(view.id, { definition: def }).then((saved) => {
        setViews((vs) => vs?.map((v) => (v.id === saved.id ? saved : v)) ?? vs);
      }, reportRef.current);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [def]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (next: Partial<ViewDefinitionInput>) =>
    setDef((d) =>
      d ? fullDefinition({ ...d, ...next } as ViewDefinitionInput) : d,
    );

  const itemOf = (row: ViewRow) =>
    items.find((i) => i.id === row.id) ?? row.item;

  const open = (row: ViewRow) => {
    if (row.kind === "task") {
      const item = itemOf(row);
      if (item) onOpenItem(item);
    } else if (row.kind === "page") onOpenDoc(row.id);
    else onOpenProject(row.id);
  };

  const edit = (row: ViewRow, e: CellEdit) => {
    applyEdit(
      row,
      e,
      itemOf(row),
      { onToggle, onSetStatus, onChangeItem },
      tz,
    ).then(
      () => setStamp((n) => n + 1),
      (err) => {
        report(err);
        setStamp((n) => n + 1);
      },
    );
  };

  const setStar = (id: string, starred: boolean) => {
    setStars((s) => {
      const next = new Set(s);
      if (starred) next.add(id);
      else next.delete(id);
      return next;
    });
    client.setFavourite("view", id, starred).then(announceStars, (e) => {
      report(e);
      void loadViews();
    });
  };

  const setPin = (v: SavedView, pinned: boolean) => {
    setViews(
      (vs) => vs?.map((x) => (x.id === v.id ? { ...x, pinned } : x)) ?? vs,
    );
    client.pinView(v.id, pinned).then(onViewsChanged, (e) => {
      report(e);
      void loadViews();
    });
  };

  const create = async (
    name: string,
    definition: ViewDefinitionInput,
    teamId: string | null,
  ) => {
    const made = await client.createView({ name, definition, team_id: teamId });
    setViews((vs) => [...(vs ?? []), made]);
    setSelected(made.id);
    setCreating(false);
    onViewsChanged();
  };

  const remove = async (v: SavedView) => {
    setMenu(null);
    const ok = await ask({
      title: `Delete ${v.name}?`,
      body: v.team_id
        ? `It goes for everyone in ${v.team_name ?? "the team"}. Nothing it shows is deleted.`
        : "Nothing it shows is deleted.",
      confirmLabel: "Delete view",
      destructive: true,
    });
    if (!ok) return;
    client.deleteView(v.id).then(async () => {
      const list = await loadViews();
      setSelected(list[0]?.id ?? null);
      onViewsChanged();
      toast({ text: `${v.name} deleted.` });
    }, report);
  };

  const [renaming, setRenaming] = useState<string | null>(null);
  const rename = (v: SavedView, name: string) => {
    setRenaming(null);
    const next = name.trim().slice(0, 80);
    if (!next || next === v.name) return;
    client.updateView(v.id, { name: next }).then((saved) => {
      setViews((vs) => vs?.map((x) => (x.id === saved.id ? saved : x)) ?? vs);
      onViewsChanged();
    }, report);
  };

  const share = (v: SavedView, teamId: string | null) => {
    setMenu(null);
    client.updateView(v.id, { team_id: teamId }).then((saved) => {
      setViews((vs) => vs?.map((x) => (x.id === saved.id ? saved : x)) ?? vs);
      toast({
        text: teamId
          ? `Shared with ${saved.team_name}. Everyone sees only what they can open.`
          : "Only you have this view now.",
      });
    }, report);
  };

  const exportCsv = (v: SavedView) => {
    setMenu(null);
    client.exportViewCsv(v.id).then(({ text, name }) => {
      const url = URL.createObjectURL(
        new Blob([text], { type: "text/csv;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, report);
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

  const groups = useMemo(
    () => (result && def ? groupRows(result.rows, def, names) : []),
    [result, def, names],
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
            source={def.source}
            groups={groups}
            rows={result.rows}
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
          const tasks = result.rows.flatMap((r) => {
            const item = itemOf(r);
            return item ? [item] : [];
          });
          const columns = boardColumns(tasks, by, names);
          const canWrite = (item: Item) =>
            result.rows.find((r) => r.id === item.id)?.can_write ?? false;
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
                onChangeItem(item, moved.change);
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
            rows={result.rows}
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
        return <ViewGallery {...shared} rows={result.rows} />;
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
    <div className="views-screen">
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
        {views && !views.length && (
          <p className="muted views-rail-empty">Save a filter to use again.</p>
        )}
        {mine.length > 0 && (
          <ViewPicker
            label="YOURS"
            views={mine}
            stars={stars}
            selected={selected}
            onSelect={setSelected}
          />
        )}
        {byTeam.map((g) => (
          <ViewPicker
            key={g.team.id}
            label={g.team.name.toUpperCase()}
            views={g.views}
            stars={stars}
            selected={selected}
            onSelect={setSelected}
          />
        ))}
      </aside>

      <section className="card views-main">
        {!view || !def ? (
          <EmptyState
            icon={Table2}
            title={views === null ? "Loading views…" : "No view open"}
            body="Save a filter to use again."
          >
            {views !== null && (
              <button className="primary" onClick={() => setCreating(true)}>
                <Plus size={15} aria-hidden="true" /> New view
              </button>
            )}
          </EmptyState>
        ) : (
          <>
            <div className="section-heading views-heading">
              <div className="views-title">
                {renaming !== null ? (
                  <input
                    autoFocus
                    className="views-rename"
                    aria-label="View name"
                    value={renaming}
                    maxLength={80}
                    onChange={(e) => setRenaming(e.target.value)}
                    onBlur={() => rename(view, renaming)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") rename(view, renaming);
                      if (e.key === "Escape") setRenaming(null);
                    }}
                  />
                ) : (
                  <h2>{view.name}</h2>
                )}
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
                  className={
                    "icon-button" + (stars.has(view.id) ? " is-on" : "")
                  }
                  aria-pressed={stars.has(view.id)}
                  aria-label={stars.has(view.id) ? "Unstar" : "Star"}
                  title={stars.has(view.id) ? "Starred" : "Star"}
                  onClick={() => setStar(view.id, !stars.has(view.id))}
                >
                  <Star
                    size={16}
                    fill={stars.has(view.id) ? "currentColor" : "none"}
                  />
                </button>
                <button
                  className={"icon-button" + (view.pinned ? " is-on" : "")}
                  aria-pressed={view.pinned}
                  aria-label={
                    view.pinned ? "Unpin from sidebar" : "Pin to sidebar"
                  }
                  title={view.pinned ? "Unpin from sidebar" : "Pin to sidebar"}
                  onClick={() => setPin(view, !view.pinned)}
                >
                  <Pin size={16} />
                </button>
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
                  ? `Filter, group and sort · ${Object.keys(def.filters).length}`
                  : "Filter, group and sort"}
              </button>
            </div>

            {filtersOpen && (
              <section
                id="view-filters"
                className="views-options"
                aria-label="Filter, group and sort"
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
                  Only {view.owner_name ?? "whoever made it"} or the team's
                  admins can change this view, so these changes are just for
                  now.
                </span>
                <button
                  className="secondary"
                  onClick={() =>
                    void create(`${view.name} (my copy)`, def, null).catch(
                      report,
                    )
                  }
                >
                  Save as my own view
                </button>
                <button
                  className="text-button"
                  onClick={() => setDef(view.definition)}
                >
                  Put it back
                </button>
              </div>
            )}

            <div className={"views-body" + (loading ? " is-loading" : "")}>
              {renderLayout()}
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
          <div className="popover-actions view-menu">
            {view.can_edit && (
              <button
                onClick={() => {
                  setMenu(null);
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
          </div>
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

      {creating && (
        <NewViewDialog
          teams={teams}
          onClose={() => setCreating(false)}
          onCreate={(name, definition, teamId) =>
            create(name, definition, teamId).catch(report)
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
  teams,
  onClose,
  onCreate,
}: {
  teams: Team[];
  onClose: () => void;
  onCreate: (
    name: string,
    definition: ViewDefinitionInput,
    teamId: string | null,
  ) => Promise<unknown>;
}) {
  const [source, setSource] = useState<ViewSource>("tasks");
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState("");
  const [preset, setPreset] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const presets = VIEW_PRESETS.map((p, n) => ({ ...p, n })).filter(
    (p) => p.definition.source === source,
  );
  const submit = () => {
    const chosen = preset !== null ? VIEW_PRESETS[preset] : null;
    const finalName = name.trim() || chosen?.name || "";
    if (!finalName || busy) return;
    setBusy(true);
    void onCreate(
      finalName,
      chosen?.definition ?? {
        source,
        layout: source === "pages" ? "gallery" : "table",
      },
      teamId || null,
    ).finally(() => setBusy(false));
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
      onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
    >
      <section
        className="modal new-view"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-view-title"
      >
        <div className="section-heading">
          <h2 id="new-view-title">New view</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <form
          className="new-view-body"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
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
                <span>
                  Everything
                  <small>Change the filters once it's made.</small>
                </span>
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
          <div className="new-view-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy || !(name.trim() || preset !== null)}
            >
              Make view
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
