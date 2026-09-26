import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  fullDefinition,
  groupRows,
  layoutsFor,
  VIEW_GROUP_LABELS,
  VIEW_GROUPS,
  VIEW_LAYOUT_LABELS,
  VIEW_PRESETS,
  VIEW_SORT_LABELS,
  VIEW_SORTS,
  VIEW_SOURCE_LABELS,
  VIEW_SOURCES,
  viewFileName,
  type SavedView,
  type Team,
  type ViewDefinition,
  type ViewDefinitionInput,
  type ViewFilters,
  type ViewLayout,
  type ViewResult,
  type ViewRow,
  type ViewSource,
} from "@orbyn/core";
import { Chip, ChipRow } from "../../components/Chip";
import { Disclosure } from "../../components/Disclosure";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Icon } from "../../components/Icon";
import { MoreMenu } from "../../components/MoreMenu";
import { Segmented } from "../../components/Segmented";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { confirmAction } from "../../lib/confirm";
import { saveFile } from "../../lib/download";
import { errorText } from "../../lib/errors";
import { usePlanning } from "../../lib/planningContext";
import { shared } from "../../styles";
import { colors, fonts, radii, themed } from "../../theme";
import { applyEdit, type CellEdit, type TaskActions } from "./edits";
import { ViewBody } from "./ViewBody";

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

type Due = "any" | "overdue" | "today" | "week" | "month" | "none";
const DUE_LABELS: Record<Due, string> = {
  any: "Any time",
  overdue: "Overdue",
  today: "Today",
  week: "Next 7 days",
  month: "Next 30 days",
  none: "No deadline",
};
const dueOf = (f: ViewFilters): Due =>
  f.overdue
    ? "overdue"
    : f.no_due
      ? "none"
      : f.due_within_days === 0
        ? "today"
        : f.due_within_days === 7
          ? "week"
          : f.due_within_days === 30
            ? "month"
            : "any";
const tidy = (f: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(f).filter(
      ([, v]) => v !== undefined && v !== "" && v !== false,
    ),
  ) as ViewFilters;

/**
 * Saved views on a phone (DATA-01): your own and your teams', each a named
 * filter, sort, grouping and layout over tasks, pages or projects. Opened
 * from Browse, a pinned view, or a link (orbyn://view/<id>). Changes to a
 * view you may change are saved as you make them.
 */
export function ViewsSheet({
  visible,
  teams,
  userId,
  openViewId,
  onViewOpened,
  actions,
  onOpenRow,
  onClose,
  onDismiss,
}: {
  visible: boolean;
  teams: Team[];
  userId?: string;
  /** A view to open (from a link), then cleared. */
  openViewId: string | null;
  onViewOpened: () => void;
  actions: TaskActions;
  onOpenRow: (row: ViewRow) => void;
  onClose: () => void;
  onDismiss?: () => void;
}) {
  const [views, setViews] = useState<SavedView[] | null>(null);
  const [stars, setStars] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  /** The name being typed while an open view is renamed. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const report = (e: unknown) => setError(errorText(e as Error));
  const reportRef = useRef(report);
  reportRef.current = report;

  const load = async () => {
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
    if (!visible) return;
    load().then(
      (list) => {
        if (openViewId) {
          if (list.some((v) => v.id === openViewId)) setSelected(openViewId);
          else
            reportRef.current(
              new Error("That view isn't shared with you, or was deleted."),
            );
          onViewOpened();
        }
      },
      (e) => reportRef.current(e),
    );
  }, [visible, openViewId]); // eslint-disable-line react-hooks/exhaustive-deps

  const view = views?.find((v) => v.id === selected) ?? null;
  const replace = (saved: SavedView) =>
    setViews((vs) => vs?.map((v) => (v.id === saved.id ? saved : v)) ?? vs);

  const setStar = (id: string, on: boolean) => {
    setStars((s0) => {
      const next = new Set(s0);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
    client.setFavourite("view", id, on).catch(report);
  };
  const setPin = (v: SavedView, pinned: boolean) => {
    replace({ ...v, pinned });
    client.pinView(v.id, pinned).catch(report);
  };

  const create = (
    name: string,
    definition: ViewDefinitionInput,
    teamId: string | null,
  ) =>
    client.createView({ name, definition, team_id: teamId }).then((made) => {
      setViews((vs) => [...(vs ?? []), made]);
      setSelected(made.id);
      setCreating(false);
    }, report);

  const title = view ? view.name : "Views";
  return (
    <Sheet
      visible={visible}
      title={title}
      onClose={() => {
        setSelected(null);
        onClose();
      }}
      onDismiss={onDismiss}
      onBack={
        view || creating
          ? () => (setSelected(null), setCreating(false))
          : undefined
      }
      actions={
        view ? (
          <View style={s.headActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={stars.has(view.id) ? "Unstar" : "Star"}
              accessibilityState={{ selected: stars.has(view.id) }}
              hitSlop={8}
              onPress={() => setStar(view.id, !stars.has(view.id))}
              style={s.headButton}
            >
              <Icon
                name={stars.has(view.id) ? "starFilled" : "star"}
                size={18}
                color={stars.has(view.id) ? colors.accent : colors.textSoft}
              />
            </Pressable>
            <ViewMenu
              view={view}
              userId={userId}
              teams={teams}
              onRename={() => setRenaming(view.name)}
              onPin={() => setPin(view, !view.pinned)}
              onShare={(teamId) =>
                client
                  .updateView(view.id, { team_id: teamId })
                  .then(replace, report)
              }
              onDuplicate={() =>
                void create(`${view.name} (copy)`, view.definition, null)
              }
              onExport={() =>
                void client
                  .exportViewCsv(view.id)
                  .then(
                    ({ text, name }) =>
                      saveFile(
                        name || viewFileName(view.name),
                        text,
                        "text/csv",
                      ),
                    report,
                  )
              }
              onDelete={() =>
                confirmAction(
                  `Delete ${view.name}?`,
                  view.team_id
                    ? `It goes for everyone in ${view.team_name ?? "the team"}. Nothing it shows is deleted.`
                    : "Nothing it shows is deleted.",
                  "Delete view",
                  () =>
                    void client.deleteView(view.id).then(() => {
                      setSelected(null);
                      void load();
                    }, report),
                )
              }
            />
          </View>
        ) : undefined
      }
    >
      {view ? (
        <OpenView
          key={view.id}
          view={view}
          renaming={renaming}
          onRenaming={setRenaming}
          onRename={(name) => {
            setRenaming(null);
            if (name.trim() && name.trim() !== view.name)
              void client
                .updateView(view.id, { name: name.trim().slice(0, 80) })
                .then(replace, report);
          }}
          teams={teams}
          userId={userId}
          actions={actions}
          onOpenRow={onOpenRow}
          onSaved={replace}
          onCopy={(def) => void create(`${view.name} (my copy)`, def, null)}
          report={report}
          error={error}
          onDismissError={() => setError("")}
        />
      ) : creating ? (
        <ScrollView contentContainerStyle={sheetStyles.body}>
          <View style={sheetStyles.column}>
            <NewView
              teams={teams}
              onCancel={() => setCreating(false)}
              onCreate={create}
            />
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={sheetStyles.body}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={() => void load().catch(report)}
            />
          }
        >
          <View style={sheetStyles.column}>
            {!!error && (
              <ErrorBanner error={error} onDismiss={() => setError("")} />
            )}
            <Text style={shared.body}>
              A view keeps a filter, a sort and a layout you come back to, like
              “Exam week” or “Lab reports”.
            </Text>
            <View style={[s.newRow, s.gapTop]}>
              <SmallAction
                label="New view"
                disabled={false}
                onPress={() => setCreating(true)}
              />
            </View>
            <ViewList
              views={views}
              stars={stars}
              teams={teams}
              onOpen={setSelected}
            />
          </View>
        </ScrollView>
      )}
    </Sheet>
  );
}

function ViewList({
  views,
  stars,
  teams,
  onOpen,
}: {
  views: SavedView[] | null;
  stars: Set<string>;
  teams: Team[];
  onOpen: (id: string) => void;
}) {
  if (views === null) return <Text style={shared.small}>Loading views…</Text>;
  if (!views.length)
    return (
      <View style={[shared.card, shared.empty]}>
        <Text style={shared.sectionTitle}>No views yet.</Text>
        <Text style={[shared.subtitle, s.center]}>
          Make one to keep a filter you come back to.
        </Text>
      </View>
    );
  const teamIds = [
    ...new Set(views.flatMap((v) => (v.team_id ? [v.team_id] : []))),
  ];
  const sections = [
    { key: "mine", title: "YOURS", list: views.filter((v) => !v.team_id) },
    ...teamIds.map((id) => {
      const list = views.filter((v) => v.team_id === id);
      return {
        key: id,
        title: (
          teams.find((t) => t.id === id)?.name ??
          list[0].team_name ??
          "A team"
        ).toUpperCase(),
        list,
      };
    }),
  ].filter((sec) => sec.list.length);
  return (
    <>
      {sections.map((sec) => (
        <View key={sec.key} style={s.section}>
          <Text style={shared.eyebrow}>{sec.title}</Text>
          <View style={s.card}>
            {[...sec.list]
              .sort(
                (a, b) =>
                  Number(stars.has(b.id)) - Number(stars.has(a.id)) ||
                  a.name.localeCompare(b.name),
              )
              .map((v, n) => (
                <Pressable
                  key={v.id}
                  accessibilityRole="button"
                  accessibilityLabel={v.name}
                  onPress={() => onOpen(v.id)}
                  style={({ pressed }) => [
                    s.viewRow,
                    n > 0 && s.divider,
                    pressed && s.pressed,
                  ]}
                >
                  <View style={s.flex}>
                    <Text style={s.viewName}>{v.name}</Text>
                    <Text style={shared.small}>
                      {VIEW_SOURCE_LABELS[v.source]} ·{" "}
                      {VIEW_LAYOUT_LABELS[v.definition.layout]}
                    </Text>
                  </View>
                  {stars.has(v.id) && (
                    <Icon name="starFilled" size={14} color={colors.accent} />
                  )}
                  {v.pinned && (
                    <Icon name="pin" size={14} color={colors.muted} />
                  )}
                  <Icon name="chevronRight" size={16} color={colors.faint} />
                </Pressable>
              ))}
          </View>
        </View>
      ))}
    </>
  );
}

/** The ⋯ beside an open view: rename, pin, share, duplicate, CSV, delete. */
function ViewMenu({
  view,
  userId,
  teams,
  onRename,
  onPin,
  onShare,
  onDuplicate,
  onExport,
  onDelete,
}: {
  view: SavedView;
  userId?: string;
  teams: Team[];
  onRename: () => void;
  onPin: () => void;
  onShare: (teamId: string | null) => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const mine = view.user_id === userId;
  return (
    <MoreMenu
      label="View options"
      title={view.name}
      actions={[
        ...(view.can_edit ? [{ label: "Rename", onPress: onRename }] : []),
        {
          label: view.pinned ? "Unpin from Browse" : "Pin to Browse",
          onPress: onPin,
        },
        ...(mine
          ? [
              ...teams
                .filter((t) => t.id !== view.team_id)
                .map((t) => ({
                  label: `Share with ${t.name}`,
                  onPress: () => onShare(t.id),
                })),
              ...(view.team_id
                ? [{ label: "Keep it to myself", onPress: () => onShare(null) }]
                : []),
            ]
          : []),
        { label: "Duplicate", onPress: onDuplicate },
        { label: "Export as CSV", onPress: onExport },
        ...(view.can_edit
          ? [{ label: "Delete view", destructive: true, onPress: onDelete }]
          : []),
      ]}
    />
  );
}

function OpenView({
  view,
  renaming,
  onRenaming,
  onRename,
  teams,
  userId,
  actions,
  onOpenRow,
  onSaved,
  onCopy,
  report,
  error,
  onDismissError,
}: {
  view: SavedView;
  /** The new name being typed, while renaming. */
  renaming: string | null;
  onRenaming: (name: string | null) => void;
  onRename: (name: string) => void;
  teams: Team[];
  userId?: string;
  actions: TaskActions;
  onOpenRow: (row: ViewRow) => void;
  onSaved: (view: SavedView) => void;
  onCopy: (def: ViewDefinition) => void;
  report: (e: unknown) => void;
  error: string;
  onDismissError: () => void;
}) {
  const planning = usePlanning();
  const [def, setDef] = useState<ViewDefinition>(view.definition);
  const [result, setResult] = useState<ViewResult | null>(null);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [stamp, setStamp] = useState(0);
  const tz = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );
  const reportRef = useRef(report);
  reportRef.current = report;

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      client.runDefinition(def).then(
        (r) => live && setResult(r),
        (e) => live && reportRef.current(e),
      );
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [def, stamp]);

  // Kept as it's changed, for a view you may change.
  useEffect(() => {
    if (!view.can_edit || same(def, view.definition)) return;
    const timer = setTimeout(() => {
      client.updateView(view.id, { definition: def }).then(onSaved, report);
    }, 700);
    return () => clearTimeout(timer);
  }, [def]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (next: Partial<ViewDefinitionInput>) =>
    setDef((d) => fullDefinition({ ...d, ...next } as ViewDefinitionInput));
  const setFilters = (next: Partial<ViewFilters>) =>
    change({ filters: tidy({ ...def.filters, ...next }) });

  const names = useMemo(() => {
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
    () => (result ? groupRows(result.rows, def, names) : []),
    [result, def, names],
  );
  const edit = (row: ViewRow, e: CellEdit) =>
    applyEdit(row, e, actions, tz).then(
      () => setTimeout(() => setStamp((n) => n + 1), 400),
      (err) => {
        report(err);
        setStamp((n) => n + 1);
      },
    );

  const fields = (result?.fields ?? []).filter((f) => f.type !== "text");
  const dateFields = (result?.fields ?? []).filter((f) => f.type === "date");
  const layouts = layoutsFor(def.source);
  return (
    <ScrollView
      contentContainerStyle={sheetStyles.body}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={() => setStamp((n) => n + 1)}
        />
      }
    >
      <View style={[sheetStyles.column, s.open]}>
        {!!error && <ErrorBanner error={error} onDismiss={onDismissError} />}
        {renaming !== null && (
          <TextInput
            style={shared.input}
            accessibilityLabel="View name"
            value={renaming}
            maxLength={80}
            autoFocus
            returnKeyType="done"
            onChangeText={onRenaming}
            onSubmitEditing={() => onRename(renaming)}
            onBlur={() => onRename(renaming)}
          />
        )}
        <Text style={shared.small}>
          {VIEW_SOURCE_LABELS[view.source]}
          {view.team_name ? ` · Shared with ${view.team_name}` : ""}
          {view.team_id && view.user_id !== userId && view.owner_name
            ? ` · by ${view.owner_name}`
            : ""}
        </Text>
        <Segmented
          options={layouts}
          value={def.layout}
          labels={VIEW_LAYOUT_LABELS as Record<ViewLayout, string>}
          onChange={(layout) => change({ layout })}
          accessibilityLabel="Layout"
        />
        <Disclosure
          title="Filter, group and sort"
          detail={
            Object.keys(def.filters).length
              ? `${Object.keys(def.filters).length} filter${Object.keys(def.filters).length === 1 ? "" : "s"}`
              : "Everything"
          }
        >
          <View style={s.options}>
            {def.source !== "pages" && (
              <>
                <Text style={shared.label}>Status</Text>
                <ChipRow label="Status">
                  {(["open", "done", "any"] as const).map((st) => (
                    <Chip
                      key={st}
                      compact
                      label={
                        st === "open"
                          ? def.source === "projects"
                            ? "Active"
                            : "Open"
                          : st === "done"
                            ? def.source === "projects"
                              ? "Finished"
                              : "Done"
                            : "Any"
                      }
                      selected={(def.filters.status ?? "open") === st}
                      onPress={() =>
                        setFilters({ status: st === "open" ? undefined : st })
                      }
                    />
                  ))}
                </ChipRow>
                <Text style={shared.label}>Due</Text>
                <ChipRow label="Due">
                  {(Object.keys(DUE_LABELS) as Due[]).map((d) => (
                    <Chip
                      key={d}
                      compact
                      label={DUE_LABELS[d]}
                      selected={dueOf(def.filters) === d}
                      onPress={() =>
                        setFilters({
                          overdue: d === "overdue" || undefined,
                          no_due: d === "none" || undefined,
                          due_within_days:
                            d === "today"
                              ? 0
                              : d === "week"
                                ? 7
                                : d === "month"
                                  ? 30
                                  : undefined,
                        })
                      }
                    />
                  ))}
                </ChipRow>
              </>
            )}
            {teams.length > 0 && (
              <>
                <Text style={shared.label}>Team</Text>
                <ChipRow label="Team">
                  <Chip
                    compact
                    label="Everything"
                    selected={!def.filters.team}
                    onPress={() => setFilters({ team: undefined })}
                  />
                  <Chip
                    compact
                    label="Only my own"
                    selected={def.filters.team === "personal"}
                    onPress={() => setFilters({ team: "personal" })}
                  />
                  {teams.map((t) => (
                    <Chip
                      key={t.id}
                      compact
                      label={t.name}
                      selected={def.filters.team === t.id}
                      onPress={() => setFilters({ team: t.id })}
                    />
                  ))}
                </ChipRow>
              </>
            )}
            <Text style={shared.label}>Group by</Text>
            <ChipRow label="Group by">
              {VIEW_GROUPS[def.source].map((g) => (
                <Chip
                  key={g}
                  compact
                  label={VIEW_GROUP_LABELS[g] ?? g}
                  selected={def.group_by === g}
                  onPress={() => change({ group_by: g })}
                />
              ))}
              {def.source !== "tasks" &&
                fields.map((f) => (
                  <Chip
                    key={f.id}
                    compact
                    label={f.name}
                    selected={def.group_by === `field:${f.id}`}
                    onPress={() => change({ group_by: `field:${f.id}` })}
                  />
                ))}
            </ChipRow>
            <Text style={shared.label}>Sort by</Text>
            <ChipRow label="Sort by">
              {VIEW_SORTS.filter(
                (so) =>
                  def.source === "tasks" ||
                  (so !== "priority" && so !== "estimate"),
              ).map((so) => (
                <Chip
                  key={so}
                  compact
                  label={VIEW_SORT_LABELS[so]}
                  selected={def.sort.by === so}
                  onPress={() => change({ sort: { by: so, dir: "asc" } })}
                />
              ))}
            </ChipRow>
            {def.layout === "calendar" && def.source !== "tasks" && (
              <>
                <Text style={shared.label}>Dates from</Text>
                <ChipRow label="Dates from">
                  {def.source === "projects" && (
                    <Chip
                      compact
                      label="Deadline"
                      selected={(def.date_by ?? "due") === "due"}
                      onPress={() => change({ date_by: "due" })}
                    />
                  )}
                  {dateFields.map((f) => (
                    <Chip
                      key={f.id}
                      compact
                      label={f.name}
                      selected={def.date_by === `field:${f.id}`}
                      onPress={() =>
                        change({ date_by: `field:${f.id}` as never })
                      }
                    />
                  ))}
                </ChipRow>
              </>
            )}
          </View>
        </Disclosure>
        {!view.can_edit && !same(def, view.definition) && (
          <View style={s.unsaved}>
            <Text style={s.unsavedText}>
              Only {view.owner_name ?? "whoever made it"} or the team’s admins
              can change this view, so these changes are just for now.
            </Text>
            <View style={s.newRow}>
              <SmallAction
                label="Save as my own view"
                disabled={false}
                onPress={() => onCopy(def)}
              />
              <SmallAction
                label="Put it back"
                disabled={false}
                onPress={() => setDef(view.definition)}
              />
            </View>
          </View>
        )}
        {result ? (
          <ViewBody
            def={def}
            result={result}
            groups={groups}
            timeZone={tz}
            folded={folded}
            onToggleFold={(key) =>
              setFolded((f) => {
                const next = new Set(f);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })
            }
            onOpen={onOpenRow}
            onEdit={(row, e) => void edit(row, e)}
          />
        ) : (
          <Text style={shared.small}>Loading…</Text>
        )}
      </View>
    </ScrollView>
  );
}

/** A new view: what it shows, a name, where to start and who has it. */
function NewView({
  teams,
  onCancel,
  onCreate,
}: {
  teams: Team[];
  onCancel: () => void;
  onCreate: (
    name: string,
    definition: ViewDefinitionInput,
    teamId: string | null,
  ) => Promise<unknown>;
}) {
  const [source, setSource] = useState<ViewSource>("tasks");
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<number | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const presets = VIEW_PRESETS.map((p, n) => ({ ...p, n })).filter(
    (p) => p.definition.source === source,
  );
  const chosen = preset !== null ? VIEW_PRESETS[preset] : null;
  const finalName = name.trim() || chosen?.name || "";
  return (
    <View style={s.open}>
      <Text style={shared.label}>What it shows</Text>
      <Segmented
        options={VIEW_SOURCES}
        value={source}
        labels={VIEW_SOURCE_LABELS}
        onChange={(v) => {
          setSource(v);
          setPreset(null);
        }}
        accessibilityLabel="What it shows"
      />
      <Text style={shared.label}>Name</Text>
      <TextInput
        style={shared.input}
        accessibilityLabel="Name"
        placeholder={chosen?.name ?? "Exam week"}
        placeholderTextColor={colors.faint}
        value={name}
        maxLength={80}
        onChangeText={setName}
      />
      {presets.length > 0 && (
        <>
          <Text style={shared.label}>Start from</Text>
          <ChipRow label="Start from">
            <Chip
              compact
              label="Everything"
              selected={preset === null}
              onPress={() => setPreset(null)}
            />
            {presets.map((p) => (
              <Chip
                key={p.n}
                compact
                label={p.name}
                accessibilityHint={p.blurb}
                selected={preset === p.n}
                onPress={() => setPreset(p.n)}
              />
            ))}
          </ChipRow>
          {chosen && <Text style={shared.small}>{chosen.blurb}</Text>}
        </>
      )}
      {teams.length > 0 && (
        <>
          <Text style={shared.label}>Who has it</Text>
          <ChipRow label="Who has it">
            <Chip
              compact
              label="Only me"
              selected={teamId === null}
              onPress={() => setTeamId(null)}
            />
            {teams.map((t) => (
              <Chip
                key={t.id}
                compact
                label={`Everyone in ${t.name}`}
                selected={teamId === t.id}
                onPress={() => setTeamId(t.id)}
              />
            ))}
          </ChipRow>
          <Text style={shared.small}>
            A shared view shows each person only what they can open.
          </Text>
        </>
      )}
      <View style={s.newRow}>
        <SmallAction label="Cancel" disabled={busy} onPress={onCancel} />
        <SmallAction
          label="Make view"
          disabled={busy || !finalName}
          onPress={() => {
            setBusy(true);
            void onCreate(
              finalName,
              chosen?.definition ?? {
                source,
                layout: source === "pages" ? "gallery" : "list",
              },
              teamId,
            ).finally(() => setBusy(false));
          }}
        />
      </View>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    flex: { flex: 1 },
    center: { textAlign: "center" },
    headActions: { flexDirection: "row", alignItems: "center", gap: 6 },
    headButton: {
      width: 34,
      height: 34,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radii.pill,
    },
    newRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    gapTop: { marginTop: 12 },
    section: { marginTop: 18 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radii.card,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 16,
    },
    viewRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 60,
      paddingVertical: 10,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    pressed: { opacity: 0.7 },
    viewName: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
    open: { gap: 12 },
    options: { gap: 6, paddingTop: 4 },
    unsaved: {
      gap: 8,
      padding: 12,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.warningBorder,
      backgroundColor: colors.warningSoft,
    },
    unsavedText: {
      fontFamily: fonts.regular,
      fontSize: 13,
      color: colors.warningStrong,
    },
  }),
);
