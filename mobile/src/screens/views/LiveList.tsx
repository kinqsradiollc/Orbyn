import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  daysLeft,
  daysLeftText,
  isOverdue,
  itemBody,
  parseLiveList,
  VIEW_SOURCE_LABELS,
  type ViewResult,
  type ViewRow,
} from "@orbyn/core";
import { Icon } from "../../components/Icon";
import { openAppUrl } from "../../hooks/useAppLinks";
import { client } from "../../lib/api";
import * as outbox from "../../lib/outbox";
import { colors, fonts, radii, themed } from "../../theme";

const open = (row: ViewRow) =>
  openAppUrl(`orbyn://${row.kind === "page" ? "doc" : row.kind}/${row.id}`);

/**
 * A live list in a page (SRCH-02), on a phone: the rows of a saved view or
 * of a filter of its own, read afresh each time the page is shown, with
 * working ticks. Everyone sees only what they can open. What it lists is
 * chosen on the web or desktop; here it is read and ticked.
 */
export function LiveList({ text }: { text: string }) {
  const spec = useMemo(() => parseLiveList(text), [text]);
  const [result, setResult] = useState<ViewResult | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [stamp, setStamp] = useState(0);
  const key = JSON.stringify(spec);
  useEffect(() => {
    if (!spec) return;
    let live = true;
    setFailed(null);
    const run =
      "id" in spec
        ? client.runView(spec.id, spec.limit)
        : client.runDefinition(spec.definition, spec.limit);
    run.then(
      (r) => live && setResult(r),
      (e: { statusCode?: number }) =>
        live &&
        setFailed(
          e?.statusCode === 404
            ? "This list’s view isn’t shared with you, or was deleted."
            : "This list couldn’t be read just now.",
        ),
    );
    return () => {
      live = false;
    };
  }, [key, stamp]); // eslint-disable-line react-hooks/exhaustive-deps

  const title =
    spec && "id" in spec
      ? (result?.view?.name ?? "A saved view")
      : spec && "title" in spec && spec.title
        ? spec.title
        : spec
          ? VIEW_SOURCE_LABELS[spec.definition.source]
          : "Live list";
  const ctx = {
    now: new Date(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  const tick = (row: ViewRow) => {
    if (!row.item) return;
    const status = row.status === "done" ? "todo" : "done";
    void outbox
      .updateItem(row.item, { ...itemBody(row.item), status })
      .finally(() => setStamp((n) => n + 1));
  };

  return (
    <View style={s.box}>
      <View style={s.head}>
        <Icon name="filter" size={13} color={colors.muted} />
        <Text style={s.title} numberOfLines={1}>
          {title}
        </Text>
        {spec && "id" in spec && (
          <Pressable
            accessibilityRole="link"
            hitSlop={8}
            onPress={() => openAppUrl(`orbyn://view/${spec.id}`)}
          >
            <Text style={s.link}>Open as a view</Text>
          </Pressable>
        )}
      </View>
      {!spec ? (
        <Text style={s.empty}>This list’s settings can’t be read.</Text>
      ) : failed ? (
        <Text style={s.empty}>{failed}</Text>
      ) : !result ? (
        <Text style={s.empty}>Loading…</Text>
      ) : !result.rows.length ? (
        <Text style={s.empty}>Nothing here right now.</Text>
      ) : (
        result.rows.map((row) => {
          const left = row.kind !== "page" ? daysLeft(row, ctx) : null;
          const done = row.status === "done";
          return (
            <View key={row.id} style={s.row}>
              {row.kind === "task" && (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={`${done ? "Reopen" : "Finish"} ${row.title}`}
                  accessibilityState={{
                    checked: done,
                    disabled: !row.can_write,
                  }}
                  disabled={!row.can_write}
                  hitSlop={11}
                  onPress={() => tick(row)}
                  style={[s.tick, done && s.tickDone]}
                >
                  {done && (
                    <Icon
                      name="check"
                      size={12}
                      color={colors.white}
                      strokeWidth={3}
                    />
                  )}
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                onPress={() => open(row)}
                style={s.flex}
              >
                <Text style={[s.rowTitle, done && s.done]} numberOfLines={1}>
                  {row.title || "Untitled"}
                </Text>
              </Pressable>
              {left !== null && !done && (
                <Text style={[s.left, isOverdue(row, ctx) && s.late]}>
                  {daysLeftText(left)}
                </Text>
              )}
            </View>
          );
        })
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    box: {
      gap: 8,
      padding: 12,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
    },
    head: { flexDirection: "row", alignItems: "center", gap: 6 },
    title: {
      flex: 1,
      fontFamily: fonts.semibold,
      fontSize: 11,
      letterSpacing: 0.6,
      textTransform: "uppercase",
      color: colors.muted,
    },
    link: { fontFamily: fonts.medium, fontSize: 13, color: colors.accent },
    empty: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 34,
    },
    flex: { flex: 1 },
    rowTitle: { fontFamily: fonts.regular, fontSize: 15, color: colors.text },
    done: { color: colors.muted, textDecorationLine: "line-through" },
    left: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
    late: { color: colors.warning, fontFamily: fonts.semibold },
    tick: {
      width: 20,
      height: 20,
      borderRadius: radii.check,
      borderWidth: 1.5,
      borderColor: colors.checkBorder,
      alignItems: "center",
      justifyContent: "center",
    },
    tickDone: { backgroundColor: colors.accent, borderColor: colors.accent },
  }),
);
