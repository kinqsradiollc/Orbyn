import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Pressable } from "../../motion";
import {
  commandsOn,
  EMPTY_MEMORY,
  orderCommands,
  readMemory,
  recordCommand,
  type CommandDef,
  type CommandIcon,
  editedSince,
  findNamed,
  findSearchTeam,
  PERSONAL_SPACE,
  formatSearch,
  hasSearchFilters,
  parseSearch,
  searchHitTarget,
  searchSummary,
  SEARCH_DATE_CHIPS,
  SEARCH_KIND_CHIPS,
  snippetRuns,
  type FindHit,
  type Project,
  type SearchFilters,
  type SearchHit,
  type Team,
} from "@orbyn/core";
import { Chip } from "../../components/Chip";
import { InlineDetails } from "../../components/InlineDetails";
import { CONCEPT_ICON, Icon, type IconName } from "../../components/Icon";
import { ActionSheet, type MoreAction } from "../../components/MoreMenu";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { session } from "../../lib/session";
import { client } from "../../lib/api";
import { readLocal, saveLocal } from "../../lib/localPrefs";
import { errorText } from "../../lib/errors";
import { usePlanning } from "../planner/planningContext";
import { shared } from "../../styles";
import { colors, fonts, radii, themed } from "../../theme";

/** One thing found, from the recent list or a search. */
type Row = {
  key: string;
  /** What choosing it opens (a work record opens its project). */
  id: string;
  type: string;
  /** What it is, for its icon. */
  icon: string;
  title: string;
  hint: string;
  blockId: string | null;
};

const ICONS: Record<string, IconName> = {
  doc: CONCEPT_ICON.page,
  task: CONCEPT_ICON.task,
  event: CONCEPT_ICON.event,
  project: CONCEPT_ICON.project,
  record: "check",
};

/** The command list's icons, drawn with the phone's own set. */
const COMMAND_ICONS: Record<CommandIcon, IconName> = {
  view: "arrowRight",
  plus: "plus",
  calendarPlus: "calendar",
  filePlus: "filePlus",
  template: "layoutTemplate",
  boxes: "boxes",
  wand: "sparkles",
  focus: "target",
  calendar: "calendar",
  keyboard: "keyboardDown",
  panel: "layoutGrid",
  search: "search",
  link: "link",
  copy: "copy",
  download: "download",
  history: "clock",
  sparkles: "sparkles",
  shield: "shieldCheck",
  eye: "info",
  news: "sparkles",
  upload: "download",
  activity: "activity",
  settings: "settings",
  present: "presentation",
  window: "layoutGrid",
  archive: "archive",
  folder: "folder",
  star: "star",
  mic: "mic",
};

const MEMORY_KEY = "orbyn-phone-commands";

/** What someone did from here lately, kept on this phone. */
const memoryNow = () => {
  const raw = readLocal(MEMORY_KEY);
  return raw ? readMemory(raw) : EMPTY_MEMORY;
};

/** With nothing typed, the commands offered after what was opened. */
const STARTERS = [
  "new.task",
  "new.page",
  "plan.day",
  "plan.focus",
  "app.changes",
  "app.whats-new",
];

const duplicateName = (
  list: readonly { name: string }[],
  name: string | null,
) =>
  !!name &&
  list.filter(
    (row) => row.name.trim().toLowerCase() === name.trim().toLowerCase(),
  ).length > 1;
const uniqueNamed = <T extends { id: string; name: string }>(
  list: readonly T[],
  name: string | null,
) => (duplicateName(list, name) ? null : findNamed(list, name));

const plain = (snippet: string | null | undefined) =>
  snippetRuns(snippet ?? "")
    .map((r) => r.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Search & do (SRCH-01, MOB-10): pages, tasks and projects, with the same
 * filters and operators as the web's ⌘K (tag:, project:, team:, is:,
 * edited:), and below them the commands from the same list ⌘K reads, the
 * settings among them. Nothing typed lists what was opened last, on any
 * device, then a few things to do.
 */
export function SearchSheet({
  visible,
  initialQuery = "",
  teams,
  onClose,
  onDismiss,
  onOpen,
  canRun,
  onCommand,
}: {
  visible: boolean;
  /** Words to start with (orbyn://search?q=…). */
  initialQuery?: string;
  teams: Team[];
  onClose: () => void;
  onDismiss?: () => void;
  /** Open what was chosen: a page (at a line), a task or event, a project. */
  onOpen: (
    type: string,
    id: string,
    blockId: string | null,
  ) => void | Promise<void>;
  /** Whether the phone can run a command from the list (MOB-10). */
  canRun?: (command: CommandDef) => boolean;
  /** Run a command: what it opens comes over the search. */
  onCommand?: (command: CommandDef) => void | Promise<void>;
}) {
  return (
    <Sheet
      visible={visible}
      title="Search"
      onClose={onClose}
      onDismiss={onDismiss}
    >
      {visible && (
        <Body
          initialQuery={initialQuery}
          teams={teams}
          onOpen={onOpen}
          canRun={canRun}
          onCommand={onCommand}
        />
      )}
    </Sheet>
  );
}

function Body({
  initialQuery,
  teams,
  onOpen,
  canRun,
  onCommand,
}: {
  initialQuery: string;
  teams: Team[];
  onOpen: (
    type: string,
    id: string,
    blockId: string | null,
  ) => void | Promise<void>;
  canRun?: (command: CommandDef) => boolean;
  onCommand?: (command: CommandDef) => void | Promise<void>;
}) {
  const { tags } = usePlanning();
  const owner = useRef(session.token).current;
  const mounted = useRef(true);
  const owns = () => mounted.current && session.token === owner;
  const operation = useRef(false);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [projectStatus, setProjectStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [choices, setChoices] = useState<
    Partial<Record<"project" | "tag" | "team", { id: string; name: string }>>
  >({});
  const seed = useRef(initialQuery);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (seed.current === initialQuery || opening) return;
    seed.current = initialQuery;
    setQuery(initialQuery);
    setChoices({});
    setOpenError("");
  }, [initialQuery, opening]);
  const [query, setQuery] = useState(initialQuery);
  const [projects, setProjects] = useState<Project[]>([]);
  const [receipt, setReceipt] = useState<{
    key: string;
    rows: Row[];
    error: string;
  } | null>(null);
  const [picking, setPicking] = useState<
    "project" | "tag" | "team" | "date" | null
  >(null);

  useEffect(() => {
    let alive = true;
    setProjectStatus("loading");
    void client.listProjects().then(
      (rows) => {
        if (alive && owns()) {
          setProjects(rows);
          setProjectStatus("ready");
        }
      },
      () => {
        if (alive && owns()) {
          setProjects([]);
          setProjectStatus("error");
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

  const filters = useMemo(() => parseSearch(query), [query]);
  const filtering = hasSearchFilters(filters);
  const named = {
    project:
      choices.project?.name === filters.project
        ? (projects.find((p) => p.id === choices.project?.id) ?? null)
        : uniqueNamed(projects, filters.project),
    tag:
      choices.tag?.name === filters.tag
        ? (tags.find((t) => t.id === choices.tag?.id) ?? null)
        : uniqueNamed(tags, filters.tag),
    team:
      choices.team?.name === filters.team
        ? choices.team.id === PERSONAL_SPACE.id
          ? PERSONAL_SPACE
          : (teams.find((t) => t.id === choices.team?.id) ?? null)
        : duplicateName(teams, filters.team)
          ? null
          : findSearchTeam(teams, filters.team),
  };
  const unknown =
    filters.words.length > 200
      ? "Use up to 200 characters for search."
      : filters.project && !named.project
        ? projectStatus === "loading"
          ? "Loading projects…"
          : projectStatus === "error"
            ? "Project filters unavailable."
            : duplicateName(projects, filters.project)
              ? "Choose a project from the filter."
              : `No project called “${filters.project}”.`
        : filters.tag && !named.tag
          ? duplicateName(tags, filters.tag)
            ? "Choose a tag from the filter."
            : `No tag called “${filters.tag}”.`
          : filters.team && !named.team
            ? duplicateName(teams, filters.team)
              ? "Choose a team from the filter."
              : `No team called “${filters.team}”.`
            : "";
  const words = filters.words;

  // What to look for, as one key, so a search runs once per change.
  const key = JSON.stringify([
    words,
    filters.type,
    named.project?.id,
    named.tag?.id,
    named.team?.id,
    filters.date,
    unknown,
  ]);
  const rows = receipt?.key === key ? receipt.rows : null;
  const error = receipt?.key === key ? receipt.error : "";
  useEffect(() => {
    setReceipt(null);
    if (unknown) return;
    let alive = true;
    const timer = setTimeout(
      () => {
        const done = (found: Row[]) => {
          if (alive && owns()) setReceipt({ key, rows: found, error: "" });
        };
        const failed = (e: unknown) => {
          if (!alive || !owns()) return;
          setReceipt({ key, rows: [], error: errorText(e) });
        };
        // Nothing to go on: what was opened last.
        if (!filtering && !words) {
          void client.find("", { limit: 15 }).then(
            (hits: FindHit[]) =>
              done(
                hits.map((h) => ({
                  key: `${h.type}-${h.id}`,
                  id: h.id,
                  type: h.type,
                  icon: h.type,
                  title: h.title,
                  hint: h.hint ?? "",
                  blockId: null,
                })),
              ),
            failed,
          );
          return;
        }
        void client
          .search(words, {
            type: filters.type ?? undefined,
            project: named.project?.id,
            tag: named.tag?.id,
            team: named.team?.id,
            updated_after: filters.date ? editedSince(filters.date) : undefined,
            limit: 30,
          })
          .then(
            (hits: SearchHit[]) =>
              done(
                hits
                  .flatMap((h) => {
                    const to = searchHitTarget(h);
                    return to ? [{ ...h, to }] : [];
                  })
                  .map((h) => ({
                    key: `${h.type}-${h.id}`,
                    id: h.to.id,
                    type: h.to.type,
                    icon: h.type,
                    title: h.title || "Untitled",
                    hint:
                      plain(h.snippet) ||
                      (h.type !== "project" && h.project_name) ||
                      "",
                    blockId: h.block_id,
                  })),
              ),
            failed,
          );
      },
      words || filtering ? 250 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Change one filter, keeping the rest and the words. */
  const setFilter = (
    change: Partial<SearchFilters>,
    choice?: { kind: "project" | "tag" | "team"; id: string; name: string },
  ) => {
    if (!owns() || operation.current) return;
    setChoices((previous) => {
      const next = { ...previous };
      for (const kind of ["project", "tag", "team"] as const) {
        if (Object.prototype.hasOwnProperty.call(change, kind)) {
          if (choice?.kind === kind && change[kind] !== null)
            next[kind] = choice;
          else delete next[kind];
        }
      }
      return next;
    });
    setQuery(formatSearch({ ...filters, ...change }));
    setOpenError("");
  };

  const pickActions: MoreAction[] =
    picking === "project"
      ? projects
          .filter((p) => p.status !== "archived")
          .map((p) => ({
            id: p.id,
            label: `${named.project?.id === p.id ? "✓ " : ""}${p.name} · ${p.team_id ? p.team_name || teams.find((t) => t.id === p.team_id)?.name || "Team" : "Personal"}`,
            onPress: () =>
              setFilter(
                { project: named.project?.id === p.id ? null : p.name },
                { kind: "project", id: p.id, name: p.name },
              ),
          }))
      : picking === "tag"
        ? tags.map((t) => ({
            id: t.id,
            label: `${named.tag?.id === t.id ? "✓ " : ""}${t.name} · ${t.team_id ? teams.find((team) => team.id === t.team_id)?.name || "Team" : "Personal"}`,
            onPress: () =>
              setFilter(
                { tag: named.tag?.id === t.id ? null : t.name },
                { kind: "tag", id: t.id, name: t.name },
              ),
          }))
        : picking === "team"
          ? [
              {
                label:
                  named.team?.id === PERSONAL_SPACE.id
                    ? "✓ Personal (no team)"
                    : "Personal (no team)",
                onPress: () =>
                  setFilter(
                    {
                      team:
                        named.team?.id === PERSONAL_SPACE.id
                          ? null
                          : PERSONAL_SPACE.id,
                    },
                    {
                      kind: "team",
                      id: PERSONAL_SPACE.id,
                      name: PERSONAL_SPACE.id,
                    },
                  ),
              },
              ...teams.map((t) => ({
                id: t.id,
                label: named.team?.id === t.id ? `✓ ${t.name}` : t.name,
                onPress: () =>
                  setFilter(
                    { team: named.team?.id === t.id ? null : t.name },
                    { kind: "team", id: t.id, name: t.name },
                  ),
              })),
            ]
          : picking === "date"
            ? SEARCH_DATE_CHIPS.map((d) => ({
                label: filters.date === d.date ? `✓ ${d.label}` : d.label,
                onPress: () =>
                  setFilter({
                    date: filters.date === d.date ? null : d.date,
                  }),
              }))
            : [];

  // The commands, from the one list ⌘K reads: what matches the words, or a
  // few to start with; filters mean a search, so none then.
  const [memory, setMemory] = useState(memoryNow);
  const phone = new Set(commandsOn("phone").map((c) => c.id));
  const commands =
    !onCommand || filtering
      ? []
      : orderCommands(
          words,
          memory,
          (c) =>
            (phone.has(c.id) || (!!c.setting && c.on !== "web")) &&
            c.needs !== "page" &&
            (canRun?.(c) ?? true) &&
            (!!words.trim() ||
              STARTERS.includes(c.id) ||
              memory.recent.includes(c.id) ||
              memory.pinned.includes(c.id)),
        );
  const runCommand = async (c: CommandDef) => {
    if (!owns() || operation.current || !(canRun?.(c) ?? true)) return;
    operation.current = true;
    setOpening(true);
    setOpenError("");
    try {
      const next = recordCommand(memory, c.id);
      setMemory(next);
      saveLocal(MEMORY_KEY, JSON.stringify(next));
      await onCommand?.(c);
    } catch (error) {
      if (owns()) setOpenError(errorText(error));
    } finally {
      operation.current = false;
      if (owns()) setOpening(false);
    }
  };

  const openRow = async (row: Row) => {
    if (!owns() || operation.current) return;
    operation.current = true;
    setOpening(true);
    setOpenError("");
    try {
      await onOpen(row.type, row.id, row.blockId);
    } catch (error) {
      if (owns()) setOpenError(errorText(error));
    } finally {
      operation.current = false;
      if (owns()) setOpening(false);
    }
  };
  const filterButton = (
    kind: "project" | "tag" | "team" | "date",
    label: string,
    selected: boolean,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Choose ${kind}: ${label}`}
      accessibilityState={{ selected, disabled: opening }}
      disabled={opening}
      onPress={() => {
        if (owns() && !operation.current) setPicking(kind);
      }}
      style={[s.filterButton, selected && s.filterSelected]}
    >
      <Text style={[s.filterLabel, selected && s.filterSelectedText]}>
        {label}
      </Text>
      <Icon
        name="chevronDown"
        size={13}
        color={selected ? colors.accent : colors.textSoft}
      />
    </Pressable>
  );
  const summary =
    unknown ||
    (filtering
      ? unknown || searchSummary(filters)
      : words
        ? searchSummary(filters)
        : "Recently opened");

  return (
    <ScrollView
      contentContainerStyle={sheetStyles.body}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[sheetStyles.column, s.column]}>
        <View style={s.field}>
          <Icon name="search" size={17} color={colors.muted} />
          <TextInput
            style={s.input}
            value={query}
            editable={!opening}
            onChangeText={(nextQuery) => {
              const parsed = parseSearch(nextQuery);
              setChoices((previous) => {
                const next = { ...previous };
                for (const kind of ["project", "tag", "team"] as const)
                  if (next[kind]?.name !== parsed[kind]) delete next[kind];
                return next;
              });
              setQuery(nextQuery);
              setOpenError("");
            }}
            placeholder="Search or find an action…"
            placeholderTextColor={colors.faint}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
            maxLength={4000}
            accessibilityLabel="Search"
            accessibilityHint="Use the filters or Search tips to narrow results."
          />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.chips}
          accessibilityLabel="Narrow the search"
        >
          {SEARCH_KIND_CHIPS.map((chip) => (
            <Chip
              key={chip.kind}
              compact
              disabled={opening}
              label={chip.label}
              selected={filters.type === chip.kind}
              onPress={() =>
                setFilter({
                  type: filters.type === chip.kind ? null : chip.kind,
                })
              }
            />
          ))}
          {filterButton(
            "project",
            named.project?.name ?? "Project",
            !!named.project,
          )}
          {filterButton("tag", named.tag?.name ?? "Tag", !!named.tag)}
          {(teams.length > 0 || !!filters.team) &&
            filterButton("team", named.team?.name ?? "Team", !!named.team)}
          {filterButton(
            "date",
            SEARCH_DATE_CHIPS.find((d) => d.date === filters.date)?.label ??
              "Date",
            !!filters.date,
          )}
        </ScrollView>
        <Text style={s.summary} accessibilityLiveRegion="polite">
          {summary}
        </Text>
        <InlineDetails title="Search tips">
          <Text style={s.summary}>
            Use tag:, project: or is:task to narrow results.
          </Text>
        </InlineDetails>
        {!!(error || openError) && (
          <Text style={s.error} accessibilityRole="alert">
            {openError || error}
          </Text>
        )}
        {opening && (
          <Text style={s.summary} accessibilityLiveRegion="polite">
            Opening…
          </Text>
        )}
        {projectStatus === "error" && !filters.project && (
          <Text style={s.error} accessibilityRole="alert">
            Project filters unavailable.
          </Text>
        )}
        {(!!error || projectStatus === "error") && (
          <Pressable
            accessibilityRole="button"
            disabled={opening}
            onPress={() => setAttempt((a) => a + 1)}
            style={s.retry}
          >
            <Text style={[s.summary, { color: colors.accent }]}>Retry</Text>
          </Pressable>
        )}
        {!unknown && !error && (
          <View style={[shared.card, s.results]}>
            {rows === null ? (
              <Text style={s.empty}>Looking…</Text>
            ) : rows.length === 0 ? (
              <Text style={s.empty}>
                {filtering || words
                  ? "Nothing matches."
                  : "What you open shows here."}
              </Text>
            ) : (
              rows.map((row, n) => (
                <Pressable
                  key={row.key}
                  accessibilityRole="button"
                  accessibilityLabel={row.title}
                  accessibilityHint={row.hint || undefined}
                  disabled={opening}
                  onPress={() => void openRow(row)}
                  style={({ pressed }) => [
                    s.row,
                    n > 0 && s.divider,
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <Icon
                    name={ICONS[row.icon] ?? "search"}
                    size={16}
                    color={colors.accent}
                  />
                  <View style={s.rowText}>
                    <Text style={s.title}>{row.title}</Text>
                    {!!row.hint && <Text style={s.hint}>{row.hint}</Text>}
                  </View>
                </Pressable>
              ))
            )}
          </View>
        )}
        {commands.length > 0 && (
          <>
            <Text style={s.heading} accessibilityRole="header">
              Actions
            </Text>
            <View style={[shared.card, s.results]}>
              {commands.map((c, n) => (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  accessibilityLabel={c.label}
                  disabled={opening}
                  onPress={() => void runCommand(c)}
                  style={({ pressed }) => [
                    s.row,
                    n > 0 && s.divider,
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <Icon
                    name={COMMAND_ICONS[c.icon]}
                    size={16}
                    color={colors.textSoft}
                  />
                  <View style={s.rowText}>
                    <Text style={s.title}>{c.label}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </View>
      <ActionSheet
        visible={!!picking}
        label={`Choose a ${picking ?? "filter"}`}
        title={
          pickActions.length
            ? undefined
            : picking === "project" && projectStatus === "loading"
              ? "Loading projects…"
              : picking === "project" && projectStatus === "error"
                ? "Projects unavailable. Close and retry."
                : "Nothing to choose from yet."
        }
        actions={pickActions}
        onClose={() => setPicking(null)}
      />
    </ScrollView>
  );
}

const s = themed(() =>
  StyleSheet.create({
    column: { gap: 12 },
    field: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 46,
      paddingHorizontal: 14,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      backgroundColor: colors.surface,
    },
    input: {
      flex: 1,
      minWidth: 0,
      paddingVertical: 11,
      fontFamily: fonts.regular,
      fontSize: Platform.OS === "web" ? 16 : 15,
      color: colors.text,
    },
    chips: { flexDirection: "row", gap: 8, paddingVertical: 2 },
    filterButton: {
      minHeight: 44,
      maxWidth: 260,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.pill,
      backgroundColor: colors.surface,
    },
    filterSelected: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.accent,
    },
    filterLabel: {
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.textSoft,
      flexShrink: 1,
    },
    filterSelectedText: { color: colors.accent },
    retry: {
      minHeight: 44,
      minWidth: 44,
      justifyContent: "center",
      paddingHorizontal: 8,
      alignSelf: "flex-start",
    },
    summary: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    heading: {
      marginTop: 4,
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.textSoft,
    },
    error: { fontFamily: fonts.regular, fontSize: 13, color: colors.danger },
    results: { paddingVertical: 4 },
    empty: {
      paddingVertical: 14,
      fontFamily: fonts.regular,
      fontSize: 15,
      color: colors.muted,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 52,
      paddingVertical: 8,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    rowText: { flex: 1, minWidth: 0, gap: 2 },
    title: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
    hint: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  }),
);
