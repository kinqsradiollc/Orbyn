import React, { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Pressable } from "../motion";
import {
  changeEdits,
  changeTime,
  changeVerb,
  groupChangesByDay,
  type TeamChange,
} from "@orbyn/core";
import { Icon } from "../components/Icon";
import { Sheet, sheetStyles } from "../components/Sheet";
import { client } from "../lib/api";
import { deviceTimeZone } from "../lib/planning";
import { errorText } from "../lib/errors";
import { readLocal, saveLocal } from "../lib/localPrefs";
import { shared } from "../styles";
import { colors, fonts, themed } from "../theme";

const HIDE_KEY = "orbyn-changes-hide-mine";

/**
 * Recent changes (SHR-02): who changed which team page or task, grouped by
 * day, with your own hidden unless you ask. For one team, or every team.
 */
export function RecentChangesList({
  teamId,
  limit = 30,
  onOpen,
}: {
  teamId?: string;
  limit?: number;
  /** Open what changed: a page, or a task or event. */
  onOpen: (kind: "doc" | "task", id: string) => void;
}) {
  const [hideMine, setHideMine] = useState(() => readLocal(HIDE_KEY) !== "0");
  const [changes, setChanges] = useState<TeamChange[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState("");
  const zone = deviceTimeZone();
  const request = useRef(0);
  const fetching = useRef(false);
  const [loading, setLoading] = useState(false);
  const load = useCallback(
    async (before?: string) => {
      if (before && fetching.current) return;
      const version = ++request.current;
      fetching.current = true;
      setLoading(true);
      setError("");
      try {
        const page = await client.listChanges({
          team_id: teamId,
          hide_mine: hideMine,
          before,
          limit,
        });
        if (version !== request.current) return;
        setChanges((was) =>
          before ? [...(was ?? []), ...page.changes] : page.changes,
        );
        setNext(page.next);
      } catch (error) {
        if (version === request.current) setError(errorText(error));
      } finally {
        if (version === request.current) {
          fetching.current = false;
          setLoading(false);
        }
      }
    },
    [teamId, hideMine, limit],
  );
  useEffect(() => {
    setChanges(null);
    setNext(null);
    void load();
    return () => {
      request.current++;
      fetching.current = false;
    };
  }, [load]);

  const days = groupChangesByDay(changes ?? [], zone);
  return (
    <View style={s.list}>
      <View style={[shared.card, s.toggle]}>
        <Text style={s.toggleText}>Hide my changes</Text>
        <Switch
          value={hideMine}
          trackColor={{ true: colors.accent }}
          accessibilityLabel="Hide my changes"
          onValueChange={(on) => {
            setHideMine(on);
            saveLocal(HIDE_KEY, on ? "1" : "0");
          }}
        />
      </View>
      {!!error && (
        <View>
          <Text style={s.error} accessibilityRole="alert">
            {error}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={loading}
            onPress={() => void load(changes ? (next ?? undefined) : undefined)}
            style={s.more}
          >
            <Text style={s.moreText}>Retry</Text>
          </Pressable>
        </View>
      )}
      {changes === null && !error && <Text style={s.muted}>Loading…</Text>}
      {changes && !changes.length && (
        <Text style={s.muted}>
          {hideMine ? "No recent changes from others." : "No recent changes."}
        </Text>
      )}
      {days.map((day) => (
        <View key={day.day} style={s.day}>
          <Text style={s.dayLabel} accessibilityRole="header">
            {day.label}
          </Text>
          <View style={[shared.card, s.rows]}>
            {day.changes.map((c, n) => {
              const edits = changeEdits(c);
              return (
                <Pressable
                  key={c.id}
                  disabled={!c.open}
                  accessibilityRole="button"
                  accessibilityHint={
                    c.open ? undefined : "It was deleted since."
                  }
                  onPress={() =>
                    onOpen(c.kind === "page" ? "doc" : "task", c.object_id)
                  }
                  style={({ pressed }) => [
                    s.row,
                    n > 0 && s.divider,
                    pressed && { backgroundColor: colors.surfaceMuted },
                    !c.open && { opacity: 0.6 },
                  ]}
                >
                  <Icon
                    name={
                      c.kind === "page"
                        ? "fileText"
                        : c.kind === "event"
                          ? "calendar"
                          : "listTodo"
                    }
                    size={16}
                    color={colors.muted}
                  />
                  <View style={s.rowText}>
                    <Text style={s.who}>
                      {changeVerb(c)}
                      {c.via_agent ? ` via ${c.via_agent}` : ""}
                    </Text>
                    <Text style={s.title}>{c.title || "Untitled"}</Text>
                    {(!!edits || !teamId) && (
                      <Text style={s.muted}>
                        {[edits, teamId ? "" : c.team_name]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    )}
                    <Text style={s.time}>
                      {changeTime(c.at, zone)}
                      {!c.open ? " · Deleted" : ""}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      {next && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: loading }}
          disabled={loading}
          onPress={() => void load(next)}
          style={s.more}
        >
          <Text style={s.moreText}>
            {loading ? "Loading…" : "Earlier changes"}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/** Recent changes in every team you are in, as a sheet. */
export function RecentChangesSheet({
  visible,
  onClose,
  onDismiss,
  onOpen,
}: {
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
  onOpen: (kind: "doc" | "task", id: string) => void;
}) {
  return (
    <Sheet
      visible={visible}
      title="Recent changes"
      onClose={onClose}
      onDismiss={onDismiss}
    >
      <ScrollView contentContainerStyle={sheetStyles.body}>
        <View style={sheetStyles.column}>
          {visible && <RecentChangesList onOpen={onOpen} />}
        </View>
      </ScrollView>
    </Sheet>
  );
}

const s = themed(() =>
  StyleSheet.create({
    list: { gap: 12 },
    toggle: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
    toggleText: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
    day: { gap: 6 },
    dayLabel: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.textSoft,
    },
    rows: { paddingVertical: 2 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 56,
      paddingVertical: 10,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    rowText: { flex: 1, minWidth: 0, gap: 2 },
    who: { fontFamily: fonts.regular, fontSize: 13, color: colors.textSoft },
    title: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
    time: { fontFamily: fonts.regular, fontSize: 11, color: colors.muted },
    muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    error: { fontFamily: fonts.regular, fontSize: 13, color: colors.danger },
    more: {
      alignSelf: "center",
      minHeight: 44,
      justifyContent: "center",
      paddingVertical: 10,
    },
    moreText: { fontFamily: fonts.medium, fontSize: 15, color: colors.accent },
  }),
);
