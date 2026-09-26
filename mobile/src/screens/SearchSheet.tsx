import React, { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
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
import { Chip } from "../components/Chip";
import { Icon, type IconName } from "../components/Icon";
import { ActionSheet, type MoreAction } from "../components/MoreMenu";
import { Sheet, sheetStyles } from "../components/Sheet";
import { client } from "../lib/api";
import { readLocal, saveLocal } from "../lib/localPrefs";
import { errorText } from "../lib/errors";
import { usePlanning } from "../lib/planningContext";
import { shared } from "../styles";
import { colors, fonts, radii, themed } from "../theme";

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
  doc: "fileText",
  task: "listTodo",
  event: "calendar",
  project: "boxes",
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
  onOpen: (type: string, id: string, blockId: string | null) => void;
  /** Whether the phone can run a command from the list (MOB-10). */
  canRun?: (command: CommandDef) => boolean;
  /** Run a command: what it opens comes over the search. */
  onCommand?: (command: CommandDef) => void;
}) {
  return (
    <Sheet
      visible={visible}
      title="Search & do"
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
  onOpen: (type: string, id: string, blockId: string | null) => void;
  canRun?: (command: CommandDef) => boolean;
  onCommand?: (command: CommandDef) => void;
}) {
  const { tags } = usePlanning();
  const [query, setQuery] = useState(initialQuery);
  const [projects, setProjects] = useState<Project[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [picking, setPicking] = useState<
    "project" | "tag" | "team" | "date" | null
  >(null);

  useEffect(() => {
    void client.listProjects().then(setProjects, () => setProjects([]));
  }, []);

  const filters = useMemo(() => parseSearch(query), [query]);
  const filtering = hasSearchFilters(filters);
  const named = {
    project: findNamed(projects, filters.project),
    tag: findNamed(tags, filters.tag),
    team: findSearchTeam(teams, filters.team),
  };
  const unknown =
    filters.project && !named.project
      ? `No project called “${filters.project}”.`
      : filters.tag && !named.tag
        ? `No tag called “${filters.tag}”.`
        : filters.team && !named.team
          ? `No team called “${filters.team}”.`
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
  useEffect(() => {
    setError("");
    if (unknown) {
      setRows([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(
      () => {
        const done = (found: Row[]) => alive && setRows(found);
        const failed = (e: unknown) => {
          if (!alive) return;
          setRows([]);
          setError(errorText(e));
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
          .search(words.slice(0, 200), {
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
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Change one filter, keeping the rest and the words. */
  const setFilter = (change: Partial<SearchFilters>) =>
    setQuery(formatSearch({ ...filters, ...change }));

  const pickActions: MoreAction[] =
    picking === "project"
      ? projects
          .filter((p) => p.status !== "archived")
          .map((p) => ({
            label: named.project?.id === p.id ? `✓ ${p.name}` : p.name,
            onPress: () =>
              setFilter({
                project: named.project?.id === p.id ? null : p.name,
              }),
          }))
      : picking === "tag"
        ? tags.map((t) => ({
            label: named.tag?.id === t.id ? `✓ ${t.name}` : t.name,
            onPress: () =>
              setFilter({ tag: named.tag?.id === t.id ? null : t.name }),
          }))
        : picking === "team"
          ? [
              {
                label:
                  named.team?.id === PERSONAL_SPACE.id
                    ? "✓ Personal (no team)"
                    : "Personal (no team)",
                onPress: () =>
                  setFilter({
                    team:
                      named.team?.id === PERSONAL_SPACE.id
                        ? null
                        : PERSONAL_SPACE.id,
                  }),
              },
              ...teams.map((t) => ({
                label: named.team?.id === t.id ? `✓ ${t.name}` : t.name,
                onPress: () =>
                  setFilter({ team: named.team?.id === t.id ? null : t.name }),
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
        ).slice(0, words.trim() ? 8 : 6);
  const runCommand = (c: CommandDef) => {
    const next = recordCommand(memory, c.id);
    setMemory(next);
    saveLocal(MEMORY_KEY, JSON.stringify(next));
    onCommand?.(c);
  };

  const summary = filtering
    ? unknown || searchSummary(filters)
    : words
      ? searchSummary(filters)
      : "Opened lately. Try tag:, project: or is:task to narrow it.";

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
            onChangeText={setQuery}
            placeholder="Search, or type what to do"
            placeholderTextColor={colors.faint}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
            maxLength={300}
            accessibilityLabel="Search"
            accessibilityHint="Words to find. tag:, project:, team:, is: and edited: narrow the search."
          />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.chips}
          accessibilityLabel="Narrow the search"
        >
          {SEARCH_KIND_CHIPS.map((chip) => (
            <Chip
              key={chip.kind}
              compact
              label={chip.label}
              selected={filters.type === chip.kind}
              onPress={() =>
                setFilter({
                  type: filters.type === chip.kind ? null : chip.kind,
                })
              }
            />
          ))}
          <Chip
            compact
            multi
            label={named.project?.name ?? "Project"}
            selected={!!named.project}
            onPress={() => setPicking("project")}
          />
          <Chip
            compact
            multi
            label={named.tag?.name ?? "Tag"}
            selected={!!named.tag}
            onPress={() => setPicking("tag")}
          />
          {(teams.length > 0 || !!filters.team) && (
            <Chip
              compact
              multi
              label={named.team?.name ?? "Team"}
              selected={!!named.team}
              onPress={() => setPicking("team")}
            />
          )}
          <Chip
            compact
            multi
            label={
              SEARCH_DATE_CHIPS.find((d) => d.date === filters.date)?.label ??
              "Date"
            }
            selected={!!filters.date}
            onPress={() => setPicking("date")}
          />
        </ScrollView>
        <Text style={s.summary} accessibilityLiveRegion="polite">
          {summary}
        </Text>
        {!!error && <Text style={s.error}>{error}</Text>}
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
                onPress={() => onOpen(row.type, row.id, row.blockId)}
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
                  <Text style={s.title} numberOfLines={1}>
                    {row.title}
                  </Text>
                  {!!row.hint && (
                    <Text style={s.hint} numberOfLines={1}>
                      {row.hint}
                    </Text>
                  )}
                </View>
              </Pressable>
            ))
          )}
        </View>
        {commands.length > 0 && (
          <>
            <Text style={s.heading} accessibilityRole="header">
              Do
            </Text>
            <View style={[shared.card, s.results]}>
              {commands.map((c, n) => (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  accessibilityLabel={c.label}
                  onPress={() => runCommand(c)}
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
                    <Text style={s.title} numberOfLines={1}>
                      {c.label}
                    </Text>
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
        title={pickActions.length ? undefined : "Nothing to choose from yet."}
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
      paddingVertical: 11,
      fontFamily: fonts.regular,
      fontSize: 15,
      color: colors.text,
    },
    chips: { flexDirection: "row", gap: 8, paddingVertical: 2 },
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
      fontSize: 14,
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
    rowText: { flex: 1, gap: 2 },
    title: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
    hint: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  }),
);
