import {
  VIEW_COLUMNS,
  VIEW_GROUP_LABELS,
  VIEW_GROUPS,
  VIEW_LAYOUT_LABELS,
  VIEW_PRESETS,
  VIEW_SORT_LABELS,
  VIEW_SORTS,
  VIEW_SOURCE_LABELS,
  VIEW_SOURCES,
  boardColumns,
  columnLabel,
  dropChange,
  fieldKeyId,
  fullDefinition,
  groupRows,
  isBoardGroup,
  layoutsFor,
  searchSavedViews,
  viewColumns,
  viewTable,
  type BoardGroupBy,
  type CustomField,
  type Folder,
  type Item,
  type ItemInput,
  type Project,
  type SavedView,
  type Status,
  type ViewDefinition,
  type ViewDefinitionInput,
  type ViewFilters,
  type ViewLayout,
  type ViewResult,
  type ViewRow,
  type ViewSource,
} from "@orbyn/core";
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
  Users,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useAccount } from "../../app/account";
import type { ScreenProps } from "../../app/routes";
import { messageOf, useResource } from "../../lib/resource";
import { navigate, useTitle } from "../../lib/router";
import { client } from "../../lib/session";
import {
  Button,
  Dialog,
  Empty,
  ErrorNotice,
  Field,
  IconButton,
  Input,
  Loading,
  Menu,
  Segmented,
  SelectBox,
  useConfirm,
  useToast,
} from "../../ui/kit";
import {
  saveFields,
  saveStatus,
  tasks,
  useItems,
  usePlanning,
  useTaskActions,
} from "../shared-task";
import { reopenStatus } from "../shared-task/store";
import { saveViewChoice, usePrefs } from "../today/prefs";
import { Board } from "../work/Board";
import "../work/work.css";
import { applyEdit, type CellEdit, type TaskActions } from "./edits";
import { Filters } from "./Filters";
import { Gallery, GroupBoard, List, MonthView } from "./Layouts";
import {
  hasRefine,
  NO_REFINE,
  readRefine,
  refinePlace,
  refineRows,
  writeRefine,
  type Refine,
} from "./refine";
import { draftStore, onDraftError } from "./store";
import { Table } from "./Table";
import "./views.css";

const LAYOUT_ICONS: Record<ViewLayout, typeof Table2> = {
  list: LayoutList,
  board: Columns3,
  table: Table2,
  calendar: CalendarDays,
  gallery: GalleryVertical,
};

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const open = (id: string) => navigate(`/app/view/${id}`);
const noon = () => undefined;
/** The server refuses an assignee on a personal task, and some old tasks carry one. */
const personal = (item: Item, fields: Partial<ItemInput>) =>
  item.team_id ? fields : { ...fields, assignee_id: null };

function Rail({
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
    <div className="vw-rail-group">
      <h2>{label}</h2>
      {sorted.map((view) => (
        <button
          key={view.id}
          aria-current={selected === view.id ? "page" : undefined}
          dir="auto"
          onClick={() => onSelect(view.id)}
        >
          <span>{view.name}</span>
          {stars.has(view.id) && (
            <Star aria-label="Starred" fill="currentColor" />
          )}
          {view.pinned && <Pin aria-label="Pinned" />}
        </button>
      ))}
    </div>
  );
}

function NewView({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (
    name: string,
    definition: ViewDefinitionInput,
    teamId: string | null,
  ) => Promise<void>;
}) {
  const { teams } = usePlanning();
  const store = draftStore();
  const [source, setSource] = useState<ViewSource>(
    store.creation?.source ?? "tasks",
  );
  const [name, setName] = useState(store.creation?.name ?? "");
  const [teamId, setTeamId] = useState(store.creation?.team_id ?? "");
  const [preset, setPreset] = useState<number | null>(
    store.creation?.preset ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    store.keepCreation({ source, name, team_id: teamId || null, preset });
  }, [source, name, teamId, preset, store]);
  const presets = VIEW_PRESETS.map((p, n) => ({ ...p, n })).filter(
    (p) => p.definition.source === source,
  );
  const submit = async () => {
    const chosen = preset !== null ? VIEW_PRESETS[preset] : null;
    const finalName = name.trim() || chosen?.name || "";
    if (!finalName || busy) return;
    setBusy(true);
    setError("");
    try {
      await onCreate(
        finalName,
        chosen?.definition ?? {
          source,
          layout: source === "pages" ? "gallery" : "table",
        },
        teamId || null,
      );
    } catch (failure) {
      setError(messageOf(failure, "Couldn't create the view."));
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="New view"
      onClose={() => !busy && onClose()}
      actions={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!(name.trim() || preset !== null)}
            onClick={() => void submit()}
          >
            {busy ? "Creating…" : "Create view"}
          </Button>
        </>
      }
    >
      <Segmented
        label="What it shows"
        value={source}
        options={VIEW_SOURCES.map((s) => ({
          value: s,
          label: VIEW_SOURCE_LABELS[s],
        }))}
        onChange={(next) => {
          setSource(next);
          setPreset(null);
        }}
      />
      <Field label="Name">
        <Input
          autoFocus
          value={name}
          maxLength={80}
          placeholder={
            preset !== null ? VIEW_PRESETS[preset].name : "Exam week"
          }
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
        />
      </Field>
      {presets.length > 0 && (
        <fieldset className="vw-presets">
          <legend>Start from</legend>
          <label className="check">
            <input
              type="radio"
              name="preset"
              checked={preset === null}
              onChange={() => setPreset(null)}
            />
            Everything
          </label>
          {presets.map((p) => (
            <label key={p.n} className="check">
              <input
                type="radio"
                name="preset"
                checked={preset === p.n}
                onChange={() => setPreset(p.n)}
              />
              <span>
                {p.name} <span className="muted small">{p.blurb}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {teams.length > 0 && (
        <Field
          label="Who has it"
          hint="A shared view shows each person only what they can open."
        >
          <SelectBox
            value={teamId}
            onChange={(event) => setTeamId(event.target.value)}
          >
            <option value="">Only me</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                Everyone in {t.name}
              </option>
            ))}
          </SelectBox>
        </Field>
      )}
      {error && <ErrorNotice message={error} />}
    </Dialog>
  );
}

function Rename({
  view,
  onClose,
  onSaved,
}: {
  view: SavedView;
  onClose: () => void;
  onSaved: (view: SavedView) => void;
}) {
  const [name, setName] = useState(view.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    const next = name.trim();
    if (!next || busy) return;
    if (next === view.name) return onClose();
    setBusy(true);
    setError("");
    try {
      onSaved(await client.updateView(view.id, { name: next }));
    } catch (failure) {
      setError(messageOf(failure, "Couldn't rename the view."));
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Rename view"
      onClose={() => !busy && onClose()}
      actions={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!name.trim()}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save name"}
          </Button>
        </>
      }
    >
      <Field label="Name">
        <Input
          autoFocus
          value={name}
          maxLength={80}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
          }}
        />
      </Field>
      {error && <ErrorNotice message={error} />}
    </Dialog>
  );
}

export default function ViewsScreen({ params }: ScreenProps) {
  useTitle("Views");
  const { user } = useAccount();
  const userId = user?.id;
  const planning = usePlanning();
  const items = useItems();
  const toast = useToast();
  const confirm = useConfirm();
  const actions = useTaskActions();
  const store = draftStore();
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  const prefs = usePrefs();
  const library = useResource(async () => {
    const [views, favourites] = await Promise.all([
      client.listViews(),
      client.listFavourites(),
    ]);
    return {
      views,
      stars: new Set(
        favourites.filter((f) => f.kind === "view").map((f) => f.target_id),
      ),
    };
  }, [userId]);
  const names = useResource(async () => {
    const [projects, folders, fields] = await Promise.allSettled([
      client.listProjects(),
      client.listFolders(),
      client.listFields(),
    ]);
    return {
      projects:
        projects.status === "fulfilled" ? projects.value : ([] as Project[]),
      folders:
        folders.status === "fulfilled" ? folders.value : ([] as Folder[]),
      fields:
        fields.status === "fulfilled" ? fields.value : ([] as CustomField[]),
      failed: [projects, folders, fields].some((r) => r.status === "rejected"),
    };
  }, [userId]);
  useEffect(
    () =>
      onDraftError((e) =>
        toast({ text: messageOf(e, "Changes weren't saved."), error: true }),
      ),
    [toast],
  );
  const views = useMemo(() => library.data?.views ?? [], [library.data]);
  const stars = library.data?.stars ?? new Set<string>();
  const [libraryQuery, setLibraryQuery] = useState("");
  const asked = params.id ?? null;
  const fallback = views.find((v) => v.pinned)?.id ?? views[0]?.id ?? null;
  const selected = asked ?? fallback;
  const view = views.find((v) => v.id === selected) ?? null;
  const missing = !!asked && !!library.data && !view;
  const setViews = (update: (list: SavedView[]) => SavedView[]) =>
    library.set((d) => (d ? { ...d, views: update(d.views) } : d));

  const [def, setDef] = useState<ViewDefinition | null>(null);
  const definition = useRef(def);
  definition.current = def;
  const [result, setResult] = useState<ViewResult | null>(null);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState("");
  const [stamp, setStamp] = useState(0);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const cellBusy = useRef(false);
  const setCellBusy = useCallback((value: boolean) => {
    cellBusy.current = value;
  }, []);
  const [savingRows, setSavingRows] = useState<Set<string>>(new Set());
  const editing = useRef(new Set<string>());
  const viewId = view?.id;

  const refine = useMemo(
    () =>
      viewId ? readRefine(prefs.prefs.views[refinePlace(viewId)]) : NO_REFINE,
    [viewId, prefs.prefs.views],
  );
  const setRefine = (next: Refine) => {
    if (!viewId) return;
    saveViewChoice(refinePlace(viewId), writeRefine(next)).catch((e) =>
      toast({ text: messageOf(e, "Couldn't save that filter."), error: true }),
    );
  };

  // The working copy follows the open view, and a draft saved in place follows it back.
  useEffect(() => {
    setDef(view ? (store.drafts.get(view.id) ?? view.definition) : null);
    setFolded(new Set());
    setResult(null);
    setRowsError("");
    setFiltersOpen(false);
  }, [viewId]); // eslint-disable-line react-hooks/exhaustive-deps

  const running = useRef(0);
  const resultKey = useRef("");
  useEffect(() => {
    if (!def) return;
    const id = ++running.current;
    setRowsLoading(true);
    setRowsError("");
    const key = `${viewId}:${JSON.stringify(def)}:${refine.status}`;
    if (resultKey.current !== key) setResult(null);
    const timer = setTimeout(() => {
      const asking = refine.status
        ? { ...def, filters: { ...def.filters, status: "any" as const } }
        : def;
      client.runDefinition(asking).then(
        (value) => {
          if (id !== running.current) return;
          resultKey.current = key;
          setResult(value);
          setRowsLoading(false);
        },
        (failure) => {
          if (id !== running.current) return;
          setRowsLoading(false);
          setRowsError(messageOf(failure, "Couldn't load results."));
        },
      );
    }, 180);
    return () => clearTimeout(timer);
  }, [def, stamp, viewId, items, refine.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (next: Partial<ViewDefinitionInput>) => {
    const current = definition.current;
    if (!current || !view) return;
    if (cellBusy.current) {
      toast({ text: "Finish or cancel the cell edit first." });
      return;
    }
    const changed = fullDefinition({
      ...current,
      ...next,
    } as ViewDefinitionInput);
    definition.current = changed;
    store.change(view.id, changed, view.can_edit);
    setDef(changed);
  };
  const choose = (id: string) => {
    if (id === selected) return;
    if (cellBusy.current) {
      toast({ text: "Finish or cancel the cell edit first." });
      return;
    }
    open(id);
  };

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const itemOf = useCallback(
    (row: ViewRow) => itemById.get(row.id) ?? row.item,
    [itemById],
  );
  const openRow = (row: ViewRow) => {
    if (row.kind === "task") {
      const item = itemOf(row);
      tasks.open(item ?? row.id);
    } else
      navigate(`/app/${row.kind === "page" ? "doc" : "project"}/${row.id}`);
  };
  const taskActions: TaskActions = {
    toggle: async (item) => {
      const before = item.status;
      const next: Status = before === "done" ? reopenStatus(item) : "done";
      const saved = await saveStatus(item, next);
      if (next === "done")
        toast({
          text: "Done",
          action: item.rrule
            ? undefined
            : {
                label: "Undo",
                run: () =>
                  void saveStatus({ ...item, ...saved }, before).catch((e) =>
                    actions.fail(e, "Couldn't undo that."),
                  ),
              },
        });
    },
    status: (item, status) => saveStatus(item, status),
    change: (item, fields: Partial<ItemInput>) =>
      saveFields(item, personal(item, fields)),
  };
  const zone =
    result?.time_zone ??
    planning.prefs?.timezone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone;
  const edit = useCallback(
    async (row: ViewRow, cell: CellEdit) => {
      if (!row.can_write || editing.current.has(row.id)) return false;
      editing.current.add(row.id);
      setSavingRows(new Set(editing.current));
      try {
        await applyEdit(row, cell, itemOf(row), taskActions, zone);
        setStamp((n) => n + 1);
        return true;
      } catch (failure) {
        actions.fail(failure, "Couldn't save that.");
        return false;
      } finally {
        editing.current.delete(row.id);
        setSavingRows(new Set(editing.current));
      }
    },
    [itemOf, zone], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const manage = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await fn();
    } catch (failure) {
      actions.fail(failure, "Couldn't change the view.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const create = async (
    name: string,
    input: ViewDefinitionInput,
    teamId: string | null,
  ) => {
    const made = await client.createView({
      name,
      definition: input,
      team_id: teamId,
    });
    setViews((list) => [...list, made]);
    store.keepCreation(null);
    setCreating(false);
    open(made.id);
  };
  const setStar = (id: string, on: boolean) =>
    manage(async () => {
      await client.setFavourite("view", id, on);
      library.set((d) => {
        if (!d) return d;
        const next = new Set(d.stars);
        if (on) next.add(id);
        else next.delete(id);
        return { ...d, stars: next };
      });
    });
  const setPin = (target: SavedView, pinned: boolean) =>
    manage(async () => {
      await client.pinView(target.id, pinned);
      setViews((list) =>
        list.map((v) => (v.id === target.id ? { ...v, pinned } : v)),
      );
    });
  const remove = (target: SavedView) =>
    manage(async () => {
      const yes = await confirm({
        title: `Delete ${target.name}?`,
        body: target.team_id
          ? `It goes for everyone in ${target.team_name ?? "the team"}. Nothing it shows is deleted.`
          : "Nothing it shows is deleted.",
        action: "Delete view",
        danger: true,
      });
      if (!yes) return;
      await client.deleteView(target.id);
      store.forget(target.id);
      saveViewChoice(refinePlace(target.id), null).catch(noon);
      await library.reload();
      navigate("/app/views", true);
      toast({ text: `${target.name} deleted.` });
    });
  const exportCsv = (target: SavedView) =>
    manage(async () => {
      const { text, name } = await client.exportViewCsv(target.id);
      const url = URL.createObjectURL(
        new Blob([text], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

  const rows = useMemo(
    () => (result ? refineRows(result.rows, refine) : []),
    [result, refine],
  );
  const layoutRows = useMemo(
    () =>
      rows.map((row) =>
        savingRows.has(row.id) ? { ...row, can_write: false } : row,
      ),
    [rows, savingRows],
  );
  const groupNames = useMemo(() => {
    const projects = new Map<string, string>();
    for (const r of result?.rows ?? [])
      if (r.project_id && r.project_name)
        projects.set(r.project_id, r.project_name);
    return {
      lists: planning.lists,
      tags: planning.tags,
      projects: [...projects].map(([id, name]) => ({ id, name })),
      userId,
      fields: result?.fields ?? [],
      people: result?.people ?? [],
    };
  }, [result, planning.lists, planning.tags, userId]);
  const groups = useMemo(
    () => (result && def ? groupRows(layoutRows, def, groupNames) : []),
    [result, def, groupNames, layoutRows],
  );
  const toggleFold = (key: string) =>
    setFolded((f) => {
      const next = new Set(f);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const copyTable = async () => {
    if (!result || !def) return;
    const text = viewTable(
      rows,
      viewColumns(def),
      { now: new Date(), timeZone: zone },
      { fields: result.fields, people: result.people },
      "\t",
    );
    try {
      await navigator.clipboard.writeText(text);
      toast({ text: "Copied. Paste it into a spreadsheet." });
    } catch {
      toast({ text: "Couldn't copy here.", error: true });
    }
  };
  const copyLink = async (target: SavedView) => {
    try {
      await navigator.clipboard.writeText(
        `${location.origin}/app/view/${target.id}`,
      );
      toast({ text: "Link copied. It opens for anyone who has this view." });
    } catch {
      toast({ text: "Couldn't copy here.", error: true });
    }
  };

  const visible = searchSavedViews(views, libraryQuery);
  const mine = visible.filter((v) => !v.team_id);
  const byTeam = [
    ...new Set(visible.flatMap((v) => (v.team_id ? [v.team_id] : []))),
  ].map((id) => {
    const list = visible.filter((v) => v.team_id === id);
    return {
      id,
      name:
        planning.teams.find((t) => t.id === id)?.name ??
        list[0].team_name ??
        "A team",
      views: list,
    };
  });
  const allFields = names.data?.fields ?? [];
  const sourceFields = allFields.filter(
    (f) =>
      def &&
      def.source !== "tasks" &&
      f.applies_to === (def.source === "pages" ? "page" : "project"),
  );
  const dateFields = (result?.fields ?? allFields).filter(
    (f) =>
      f.type === "date" &&
      f.applies_to === (def?.source === "projects" ? "project" : "page"),
  );
  const filterCount = def
    ? Object.keys(def.filters).length + (hasRefine(refine) ? 1 : 0)
    : 0;

  const layout = () => {
    if (!def || !result) return null;
    if (!rows.length)
      return (
        <Empty title="Nothing matches">
          <span>Loosen a filter, or add something that fits.</span>
        </Empty>
      );
    const shared = {
      timeZone: zone,
      fields: result.fields,
      people: result.people,
      onOpen: openRow,
    };
    switch (def.layout) {
      case "table":
        return (
          <Table
            key={view?.id}
            source={def.source}
            groups={groups}
            rows={layoutRows}
            columns={viewColumns(def)}
            fields={result.fields}
            people={result.people}
            timeZone={zone}
            folded={folded}
            onToggleFold={toggleFold}
            onOpen={openRow}
            onEdit={edit}
            onBusy={setCellBusy}
          />
        );
      case "list":
        return (
          <List
            {...shared}
            groups={groups}
            folded={folded}
            onToggleFold={toggleFold}
            itemOf={itemOf}
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
          const cards = layoutRows.flatMap((r) => {
            const item = itemOf(r);
            return item ? [item] : [];
          });
          const columns = boardColumns(cards, by, groupNames);
          return (
            <Board
              columns={columns}
              by={by}
              targets={columns.map((c) => ({ key: c.key, title: c.title }))}
              busy={false}
              canWrite={(item: Item) =>
                layoutRows.find((r) => r.id === item.id)?.can_write ?? false
              }
              onMove={(item, from, to) => {
                const moved = dropChange(item, by, from, to, groupNames);
                if (!moved) return;
                if (!moved.ok) return toast({ text: moved.reason });
                const row = layoutRows.find((r) => r.id === item.id);
                if (row)
                  void saveFields(item, personal(item, moved.change)).then(
                    () => setStamp((n) => n + 1),
                    (failure) => actions.fail(failure, "Couldn't move that."),
                  );
              }}
              folded={folded}
              onToggleFold={toggleFold}
              parentOf={(item) =>
                item.parent_id ? itemById.get(item.parent_id)?.title : undefined
              }
              reviewCards={[]}
              onOpenReview={(id) => navigate(`/app/review/${id}`)}
              agentName="Orbyn"
              agentOf={() => undefined}
            />
          );
        }
        return (
          <GroupBoard
            {...shared}
            groups={groups}
            def={def}
            onSetField={(row, field, value) =>
              void edit(row, { column: `field:${field}`, field, value })
            }
          />
        );
      }
      case "calendar":
        return (
          <MonthView
            {...shared}
            rows={layoutRows}
            def={def}
            onMoveDay={(row, day) => {
              const field = fieldKeyId(def.date_by ?? "");
              if (field)
                void edit(row, { column: `field:${field}`, field, value: day });
              else void edit(row, { column: "due", value: day });
            }}
          />
        );
      case "gallery":
        return <Gallery {...shared} rows={layoutRows} />;
    }
  };

  return (
    <div className="vw">
      <aside className="vw-rail" aria-label="Your views">
        <div className="vw-rail-top">
          <h1>Views</h1>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" /> New view
          </Button>
        </div>
        <Input
          type="search"
          aria-label="Search saved views"
          placeholder="Search views"
          maxLength={120}
          value={libraryQuery}
          onChange={(event) => setLibraryQuery(event.target.value)}
        />
        {library.data && views.length > 0 && !visible.length && (
          <p className="muted small" role="status">
            No matching views.
          </p>
        )}
        {library.error && (
          <ErrorNotice
            message={library.error}
            onRetry={() => void library.reload()}
          />
        )}
        {names.data?.failed && (
          <ErrorNotice
            message="Some filter names couldn't load."
            onRetry={() => void names.reload()}
          />
        )}
        {library.data && !views.length && (
          <p className="muted small">Save a filter to use again.</p>
        )}
        <div className="vw-pick">
          <SelectBox
            aria-label="Open a view"
            value={selected ?? ""}
            onChange={(event) => choose(event.target.value)}
          >
            {views.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </SelectBox>
        </div>
        <div className="vw-lists">
          {mine.length > 0 && (
            <Rail
              label="Yours"
              views={mine}
              stars={stars}
              selected={selected}
              onSelect={choose}
            />
          )}
          {byTeam.map((group) => (
            <Rail
              key={group.id}
              label={group.name}
              views={group.views}
              stars={stars}
              selected={selected}
              onSelect={choose}
            />
          ))}
        </div>
      </aside>

      <section className="vw-main">
        {missing ? (
          <Empty title="That view isn't available">
            <span>It may have been deleted, or it isn't shared with you.</span>
            <Button onClick={() => navigate("/app/views", true)}>
              All views
            </Button>
          </Empty>
        ) : !view || !def ? (
          library.loading ? (
            <Loading label="Loading views" />
          ) : library.data ? (
            <Empty title="No view open">
              <Button variant="primary" onClick={() => setCreating(true)}>
                New view
              </Button>
            </Empty>
          ) : null
        ) : (
          <>
            <header className="vw-head">
              <div className="vw-title-block">
                <h2 dir="auto">{view.name}</h2>
                <small className="muted">
                  {VIEW_SOURCE_LABELS[view.source]}
                  {view.team_name ? ` · Shared with ${view.team_name}` : ""}
                  {view.team_id && view.user_id !== userId && view.owner_name
                    ? ` · by ${view.owner_name}`
                    : ""}
                </small>
              </div>
              <Menu
                label="View options"
                trigger={(trigger, expanded) => (
                  <IconButton
                    label="View options"
                    aria-expanded={expanded}
                    onClick={trigger}
                  >
                    <MoreHorizontal />
                  </IconButton>
                )}
              >
                {(close) => {
                  const pick = (fn: () => void) => () => {
                    close();
                    fn();
                  };
                  return (
                    <>
                      <button
                        onClick={pick(
                          () => void setStar(view.id, !stars.has(view.id)),
                        )}
                      >
                        <Star aria-hidden="true" />{" "}
                        {stars.has(view.id) ? "Unstar" : "Star"}
                      </button>
                      <button
                        onClick={pick(() => void setPin(view, !view.pinned))}
                      >
                        <Pin aria-hidden="true" />{" "}
                        {view.pinned ? "Unpin from sidebar" : "Pin to sidebar"}
                      </button>
                      {view.can_edit && (
                        <button onClick={pick(() => setRenaming(true))}>
                          Rename
                        </button>
                      )}
                      {view.user_id === userId && (
                        <button onClick={pick(() => setSharing(true))}>
                          <Users aria-hidden="true" /> Share with a team
                        </button>
                      )}
                      <button
                        onClick={pick(
                          () =>
                            void create(`${view.name} (copy)`, def, null).catch(
                              (e) =>
                                actions.fail(e, "Couldn't duplicate the view."),
                            ),
                        )}
                      >
                        <Copy aria-hidden="true" /> Duplicate
                      </button>
                      <button onClick={pick(() => void copyLink(view))}>
                        <Link2 aria-hidden="true" /> Copy link
                      </button>
                      <button onClick={pick(() => void exportCsv(view))}>
                        <Download aria-hidden="true" /> Export as CSV
                      </button>
                      <button
                        disabled={!rows.length}
                        onClick={pick(() => void copyTable())}
                      >
                        <Copy aria-hidden="true" /> Copy for a spreadsheet
                      </button>
                      {view.can_edit && (
                        <button
                          className="is-danger"
                          onClick={pick(() => void remove(view))}
                        >
                          <Trash2 aria-hidden="true" /> Delete view
                        </button>
                      )}
                    </>
                  );
                }}
              </Menu>
            </header>
            <div className="vw-tools">
              <div className="vw-layouts" role="group" aria-label="Layout">
                {layoutsFor(def.source).map((l) => {
                  const Icon = LAYOUT_ICONS[l];
                  return (
                    <button
                      key={l}
                      aria-pressed={def.layout === l}
                      onClick={() => change({ layout: l })}
                    >
                      <Icon aria-hidden="true" /> {VIEW_LAYOUT_LABELS[l]}
                    </button>
                  );
                })}
              </div>
              <div className="vw-layout-pick">
                <SelectBox
                  aria-label="Layout"
                  value={def.layout}
                  onChange={(event) =>
                    change({ layout: event.target.value as ViewLayout })
                  }
                >
                  {layoutsFor(def.source).map((l) => (
                    <option key={l} value={l}>
                      {VIEW_LAYOUT_LABELS[l]}
                    </option>
                  ))}
                </SelectBox>
              </div>
              {def.layout === "calendar" && def.source !== "tasks" && (
                <SelectBox
                  aria-label="Dates from"
                  value={def.date_by ?? "due"}
                  onChange={(event) =>
                    change({ date_by: event.target.value as never })
                  }
                >
                  <option value="due">
                    {def.source === "projects"
                      ? "Deadline"
                      : "Choose a date field"}
                  </option>
                  {dateFields.map((f) => (
                    <option key={f.id} value={`field:${f.id}`}>
                      {f.name}
                    </option>
                  ))}
                </SelectBox>
              )}
              {def.layout === "table" && (
                <Button onClick={() => setColumnsOpen(true)}>
                  <Columns3 aria-hidden="true" /> Columns
                </Button>
              )}
              <Button
                aria-expanded={filtersOpen}
                aria-controls="vw-options"
                onClick={() => setFiltersOpen(!filtersOpen)}
              >
                <SlidersHorizontal aria-hidden="true" />
                {filterCount
                  ? `Filters and sort · ${filterCount}`
                  : "Filters and sort"}
              </Button>
            </div>
            {filtersOpen && (
              <section
                id="vw-options"
                className="vw-options"
                aria-label="Filters and sort"
              >
                <div className="vw-arrange">
                  <Field label="Group">
                    <SelectBox
                      value={def.group_by}
                      onChange={(event) =>
                        change({ group_by: event.target.value })
                      }
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
                    </SelectBox>
                  </Field>
                  <Field label="Sort">
                    <SelectBox
                      value={`${def.sort.by}|${def.sort.dir}`}
                      onChange={(event) => {
                        const [by, dir] = event.target.value.split("|");
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
                    </SelectBox>
                  </Field>
                </div>
                <Filters
                  key={view.id}
                  def={def}
                  teams={planning.teams}
                  projects={names.data?.projects ?? []}
                  folders={names.data?.folders ?? []}
                  lists={planning.lists}
                  tags={planning.tags}
                  fields={sourceFields}
                  refine={refine}
                  onChange={(filters: ViewFilters) => change({ filters })}
                  onRefine={setRefine}
                />
                {def.source === "tasks" && (
                  <p className="muted small">
                    Only this status, Priority and Size stay on your account,
                    not in the view.
                  </p>
                )}
              </section>
            )}
            {!view.can_edit && !same(def, view.definition) && (
              <div className="vw-note" role="status">
                <span>
                  These changes are temporary. Save a copy to keep them.
                </span>
                <Button
                  onClick={() =>
                    void create(`${view.name} (my copy)`, def, null).catch(
                      (e) => actions.fail(e, "Couldn't save a copy."),
                    )
                  }
                >
                  Save a copy
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    store.drafts.delete(view.id);
                    setDef(view.definition);
                  }}
                >
                  Reset changes
                </Button>
              </div>
            )}
            {view.can_edit && store.states[view.id] === "failed" && (
              <div className="vw-note" role="status">
                <span>Changes weren't saved.</span>
                <Button onClick={() => store.change(view.id, def, true, true)}>
                  Retry save
                </Button>
              </div>
            )}
            {view.can_edit && store.states[view.id] === "saving" && (
              <p className="muted small" role="status">
                Saving view…
              </p>
            )}
            {busy && (
              <p className="muted small" role="status">
                Updating view…
              </p>
            )}
            <div aria-busy={rowsLoading} className="vw-body">
              {rowsError && (
                <ErrorNotice
                  message={rowsError}
                  onRetry={() => setStamp((n) => n + 1)}
                />
              )}
              {rowsLoading && !result && <Loading label="Loading results" />}
              {result && layout()}
              {result?.truncated && (
                <p className="muted small">
                  Showing the first {result.rows.length}. Narrow the filters to
                  see the rest.
                </p>
              )}
            </div>
          </>
        )}
      </section>
      {creating && (
        <NewView onClose={() => setCreating(false)} onCreate={create} />
      )}
      {renaming && view && (
        <Rename
          view={view}
          onClose={() => setRenaming(false)}
          onSaved={(saved) => {
            setViews((list) =>
              list.map((v) =>
                v.id === saved.id ? { ...v, name: saved.name } : v,
              ),
            );
            setRenaming(false);
          }}
        />
      )}
      {sharing && view && (
        <Dialog title="Share with a team" onClose={() => setSharing(false)}>
          <Field label="Shared with">
            <SelectBox
              value={view.team_id ?? ""}
              disabled={busy}
              onChange={(event) => {
                const teamId = event.target.value || null;
                setSharing(false);
                void manage(async () => {
                  const saved = await client.updateView(view.id, {
                    team_id: teamId,
                  });
                  setViews((list) =>
                    list.map((v) =>
                      v.id === saved.id
                        ? { ...saved, definition: v.definition }
                        : v,
                    ),
                  );
                  toast({
                    text: teamId
                      ? `Shared with ${saved.team_name}. Access permissions still apply.`
                      : "Only you have this view now.",
                  });
                });
              }}
            >
              <option value="">Only me</option>
              {planning.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </SelectBox>
          </Field>
        </Dialog>
      )}
      {columnsOpen && def && (
        <Dialog title="Columns" onClose={() => setColumnsOpen(false)}>
          <div className="vw-columns">
            {[
              ...VIEW_COLUMNS[def.source],
              ...sourceFields.map((f) => `field:${f.id}`),
            ].map((c) => {
              const cols = viewColumns(def);
              const on = cols.includes(c);
              return (
                <label key={c} className="check">
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
                  {columnLabel(c, sourceFields)}
                </label>
              );
            })}
          </div>
        </Dialog>
      )}
    </div>
  );
}
