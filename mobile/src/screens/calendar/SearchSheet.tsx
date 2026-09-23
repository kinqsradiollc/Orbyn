import React, { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { CalendarSearchResult } from "@orbyn/core";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Icon } from "../../components/Icon";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { client } from "../../lib/api";
import { clockLabel, shortDay } from "../../lib/planning";
import { colors, fonts, radii, themed } from "../../theme";
import { shared } from "../../styles";
import { errorText } from "../../lib/errors";

/** Wait this long after typing before searching. */
const DEBOUNCE_MS = 300;

/**
 * Find an event, past or future: your events and dated tasks and the
 * calendars you subscribe to, a year either side of today. Tapping a result
 * shows its day.
 */
export function SearchSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  /** Show this day on the calendar. */
  onPick: (day: Date) => void;
}) {
  return (
    <Sheet visible={visible} title="Find an event" onClose={onClose}>
      {visible && <Body onPick={onPick} />}
    </Sheet>
  );
}

function Body({ onPick }: { onPick: (day: Date) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CalendarSearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const words = q.trim();
    if (words.length < 2) {
      setResults(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      setLoading(true);
      client
        .searchCalendar(words)
        .then((found) => {
          if (!alive) return;
          setResults(found.results);
          setError("");
        })
        .catch((e: Error) => alive && setError(errorText(e)))
        .finally(() => alive && setLoading(false));
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q]);

  const now = Date.now();
  return (
    <ScrollView
      contentContainerStyle={sheetStyles.body}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <View style={sheetStyles.column}>
        <ErrorBanner error={error} onDismiss={() => setError("")} />
        <View style={s.search}>
          <View style={s.searchIcon} pointerEvents="none">
            <Icon name="search" size={17} color={colors.muted} />
          </View>
          <TextInput
            style={[shared.input, s.input]}
            value={q}
            onChangeText={setQ}
            // The server searches up to 100 characters.
            maxLength={100}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
            placeholder="Dentist, standup, Cafe Roma…"
            placeholderTextColor={colors.faint}
            accessibilityLabel="Search events"
          />
        </View>
        <Text style={[shared.small, s.hint]}>
          {q.trim().length < 2
            ? "Searches titles, notes and places in your calendar and the calendars you subscribe to, a year either way."
            : loading
              ? "Searching…"
              : results
                ? `${results.length === 100 ? "The first 100" : results.length} found.`
                : ""}
        </Text>
        {results && results.length === 0 && !loading && (
          <Text style={shared.small}>No events match.</Text>
        )}
        {results && results.length > 0 && (
          <View style={s.list}>
            {results.map((r, n) => {
              const external = r.source === "external";
              const past = Date.parse(r.end_at ?? r.start_at) < now;
              const detail = [
                external ? r.name : r.kind === "event" ? "Event" : "Task",
                r.location,
              ]
                .filter(Boolean)
                .join(" · ");
              const when = r.all_day ? "All day" : clockLabel(r.start_at);
              return (
                <Pressable
                  key={`${external ? r.subscription_id : r.item_id}-${r.start_at}-${n}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.title}, ${shortDay(r.start_at)}, ${when}, ${detail}. Shows that day`}
                  onPress={() => onPick(new Date(r.start_at))}
                  style={({ pressed }) => [
                    s.row,
                    n > 0 && s.divider,
                    pressed && { backgroundColor: colors.surfaceMuted },
                  ]}
                >
                  <View style={s.when}>
                    <Text style={[s.day, past && s.past]}>
                      {shortDay(r.start_at)}
                    </Text>
                    <Text style={shared.small}>{when}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.title} numberOfLines={2}>
                      {r.title}
                    </Text>
                    <View style={s.meta}>
                      {external && (
                        <Icon name="lock" size={10} color={r.color} />
                      )}
                      <Text style={shared.small} numberOfLines={1}>
                        {detail}
                      </Text>
                    </View>
                  </View>
                  <Icon name="chevronRight" size={16} color={colors.faint} />
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const s = themed(() =>
  StyleSheet.create({
    search: { justifyContent: "center" },
    searchIcon: { position: "absolute", left: 15, zIndex: 1 },
    input: { paddingLeft: 42 },
    hint: { marginTop: 10, marginBottom: 12 },
    list: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    when: { width: 92 },
    day: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
    past: { color: colors.muted },
    title: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
    meta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  }),
);
