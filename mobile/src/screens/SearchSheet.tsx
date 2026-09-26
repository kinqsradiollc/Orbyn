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
  editedSince,
  findNamed,
  formatSearch,
  hasSearchFilters,
  parseSearch,
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
import { errorText } from "../lib/errors";
import { usePlanning } from "../lib/planningContext";
import { shared } from "../styles";
import { colors, fonts, radii, themed } from "../theme";

/** One thing found, from the recent list or a search. */
type Row = {
  key: string;
  id: string;
  type: string;
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

const plain = (snippet: string | null | undefined) =>
  snippetRuns(snippet ?? "")
    .map((r) => r.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Search everything (SRCH-01): pages, tasks and projects, with the same
 * filters and operators as the web's ⌘K (tag:, project:, team:, is:,
 * edited:) and one line saying what is being searched. Nothing typed lists
 * what was opened last, on any device.
 */
export function SearchSheet({
  visible,
  initialQuery = "",
  teams,
  onClose,
  onDismiss,
  onOpen,
}: {
  visible: boolean;
  /** Words to start with (orbyn://search?q=…). */
  initialQuery?: string;
  teams: Team[];
  onClose: () => void;
  onDismiss?: () => void;
  /** Open what was chosen: a page (at a line), a task or event, a project. */
  onOpen: (type: string, id: string, blockId: string | null) => void;
}) {
  return (
    <Sheet
      visible={visible}
      title="Search"
      onClose={onClose}
      onDismiss={onDismiss}
    >
      {visible && (
        <Body initialQuery={initialQuery} teams={teams} onOpen={onOpen} />
      )}
    </Sheet>
  );
}

function Body({
  initialQuery,
  teams,
  onOpen,
}: {
  initialQuery: string;
  teams: Team[];
  onOpen: (type: string, id: string, blockId: string | null) => void;
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
    team: findNamed(teams, filters.team),
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
                hits.map((h) => ({
                  key: `${h.type}-${h.id}`,
                  id: h.id,
                  type: h.type,
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
          ? teams.map((t) => ({
              label: named.team?.id === t.id ? `✓ ${t.name}` : t.name,
              onPress: () =>
                setFilter({ team: named.team?.id === t.id ? null : t.name }),
            }))
          : picking === "date"
            ? SEARCH_DATE_CHIPS.map((d) => ({
                label: filters.date === d.date ? `✓ ${d.label}` : d.label,
                onPress: () =>
                  setFilter({
                    date: filters.date === d.date ? null : d.date,
                  }),
              }))
            : [];

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
            placeholder="Search pages, tasks and projects"
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
          {teams.length > 0 && (
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
                  name={ICONS[row.type] ?? "search"}
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
