import React, { useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import type { Item, UpNext } from "@orbyn/core";
import { Button } from "../../components/Button";
import { InlineDetails } from "../../components/InlineDetails";
import { client } from "../../lib/api";
import { Pressable } from "../../motion";
import { colors, fonts, radii, themed } from "../../theme";
import { shared } from "../../styles";

/** How often "Up next" looks again while Today stays open. */
const REFRESH_MS = 5 * 60_000;

const minutesText = (m: number) => {
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return h ? (rest ? `${h} h ${rest} min` : `${h} h`) : `${m} min`;
};

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function windowText(next: UpNext) {
  const w = next.window;
  if (!w) return "No free time right now";
  return w.until
    ? `${minutesText(w.minutes)} free before ${w.until}`
    : `${minutesText(w.minutes)} free until ${clock(w.end_at)}`;
}

/**
 * What to do now, as on the web's Overview: the task most worth starting in
 * the free time before the next event, the planner's reasons, and two
 * alternatives (GET /planner/next).
 */
export function UpNextCard({
  items,
  onOpen,
  onFocus,
  excludeIds,
}: {
  items: Item[];
  excludeIds?: Set<string>;
  onOpen: (item: Item) => void;
  onFocus: (item: Item) => void;
}) {
  const [next, setNext] = useState<UpNext | null>(null);
  const [failed, setFailed] = useState(false);
  const fetched = useRef(0);

  // Again when tasks change (at most every 15 seconds), every few minutes,
  // and when the app comes back to the front.
  useEffect(() => {
    let alive = true;
    let version = 0;
    const load = () => {
      const current = ++version;
      fetched.current = Date.now();
      client.getUpNext().then(
        (n) => {
          if (!alive || current !== version) return;
          setNext(n);
          setFailed(false);
        },
        () => alive && current === version && setFailed(true),
      );
    };
    const wait = Math.max(0, 15_000 - (Date.now() - fetched.current));
    const soon = setTimeout(load, fetched.current ? wait : 0);
    const every = setInterval(load, REFRESH_MS);
    const front = AppState.addEventListener("change", (state) => {
      if (state === "active") load();
    });
    return () => {
      alive = false;
      clearTimeout(soon);
      clearInterval(every);
      front.remove();
    };
  }, [items]);

  // Older servers have no suggestions; Today works without them.
  if (failed && !next) return null;
  if (!next) return null;

  const byId = new Map(items.map((i) => [i.id, i]));
  const shown = next.suggestions.filter(
    (s) => byId.has(s.item_id) && !excludeIds?.has(s.item_id),
  );
  const [first, ...rest] = shown;
  const firstItem = first && byId.get(first.item_id);

  return (
    <View style={shared.card}>
      <Text style={shared.sectionTitle} accessibilityRole="header">
        Up next
      </Text>
      <Text style={[shared.small, s.window]}>{windowText(next)}</Text>
      {first && firstItem ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Opens the task"
            onPress={() => onOpen(firstItem)}
          >
            <Text style={s.title}>{first.title}</Text>
          </Pressable>
          <InlineDetails title="Why this task?">
            <View style={s.reasons}>
              {first.reasons.map((r) => (
                <Text key={r} style={s.reason}>
                  {r}
                </Text>
              ))}
            </View>
          </InlineDetails>
          <View style={s.actions}>
            <Button
              title="Start focus"
              icon="play"
              style={s.action}
              onPress={() => onFocus(firstItem)}
            />
          </View>
          <Text style={[shared.small, s.session]}>
            {first.planned_now
              ? `${first.minutes} min remaining`
              : `${first.minutes} min suggested`}
          </Text>
          {rest.map((r) => (
            <Pressable
              key={r.item_id}
              accessibilityRole="button"
              onPress={() => onOpen(byId.get(r.item_id)!)}
              style={({ pressed }) => [s.row, pressed && s.rowPressed]}
            >
              <Text style={s.rowTitle}>{r.title}</Text>
              <Text style={shared.small}>{r.reasons[0]}</Text>
            </Pressable>
          ))}
        </>
      ) : (
        <Text style={shared.small}>
          {next.suggestions.some((suggestion) =>
            excludeIds?.has(suggestion.item_id),
          )
            ? "Suggested tasks are already listed."
            : "No suggested task right now."}
        </Text>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    window: { marginTop: 2, marginBottom: 12 },
    title: {
      fontFamily: fonts.semibold,
      fontSize: 18,
      lineHeight: 21,
      color: colors.text,
    },
    reasons: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      marginTop: 10,
    },
    reason: {
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.textSoft,
      backgroundColor: colors.surfaceMuted,
      borderRadius: radii.pill,
      paddingHorizontal: 10,
      paddingVertical: 4,
      overflow: "hidden",
    },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
    action: { marginBottom: 0 },
    session: { marginTop: 8 },
    row: {
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      gap: 2,
    },
    rowPressed: { opacity: 0.7 },
    rowTitle: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.text,
    },
  }),
);
