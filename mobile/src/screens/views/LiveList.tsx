import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "../../motion";
import {
  daysLeft,
  daysLeftText,
  isOverdue,
  parseLiveList,
  VIEW_SOURCE_LABELS,
  type ViewResult,
  type ViewRow,
} from "@orbyn/core";
import { celebrate } from "../../components/Celebration";
import { Icon } from "../../components/Icon";
import { openAppUrl } from "../../hooks/useAppLinks";
import { client } from "../../lib/api";
import * as outbox from "../../lib/outbox";
import { toggledStatus } from "../../lib/progress";
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
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [queued, setQueued] = useState<Set<string>>(new Set());
  const queuedHere = useRef(new Set<string>());
  const writing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const update = (state: ReturnType<typeof outbox.outboxState>) => {
      const next = new Set(
        state.entries.flatMap((entry) =>
          entry.op.type === "item.post" ? [entry.op.id] : [],
        ),
      );
      setQueued(next);
      const sent = [...queuedHere.current].some((id) => !next.has(id));
      queuedHere.current = new Set(
        [...queuedHere.current].filter((id) => next.has(id)),
      );
      if (sent) {
        setNote("");
        setStamp((n) => n + 1);
      }
    };
    update(outbox.outboxState());
    const stop = outbox.subscribeOutbox(update);
    return () => {
      mounted.current = false;
      stop();
    };
  }, []);
  const key = JSON.stringify(spec);
  const currentKey = useRef(key);
  currentKey.current = key;
  useEffect(() => {
    if (!spec) return;
    let live = true;
    setFailed(null);
    setResult(null);
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
  // Days are read in the account's zone, as the server filtered them.
  const ctx = {
    now: new Date(),
    timeZone:
      result?.time_zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  /** Tick or untick as the app's ticks do: an update on the task's timeline. */
  const tick = async (row: ViewRow) => {
    if (!row.item || !row.can_write || writing.current || queued.has(row.id))
      return;
    writing.current = true;
    setPending(row.id);
    setNote("");
    const owner = key;
    const status = toggledStatus(row.item);
    try {
      const saved = await outbox.postItemUpdate(row.item, { status });
      if (!mounted.current) return;
      if (saved === null) {
        queuedHere.current.add(row.id);
        setQueued((ids) => new Set([...ids, row.id]));
        if (owner === currentKey.current) setNote("Waiting to sync");
      } else {
        if (owner === currentKey.current) {
          if (status === "done") celebrate(row.title);
          setStamp((n) => n + 1);
        }
      }
    } catch {
      if (mounted.current && owner === currentKey.current)
        setNote("Couldn’t change task. Try again.");
    } finally {
      writing.current = false;
      if (mounted.current) setPending(null);
    }
  };

  return (
    <View style={s.box}>
      <View style={s.head}>
        <Icon name="filter" size={13} color={colors.muted} />
        <Text style={s.title}>{title}</Text>
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
        <View style={s.recovery}>
          <Text style={s.empty}>{failed}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setStamp((n) => n + 1)}
            style={s.retry}
          >
            <Text style={s.link}>Retry list</Text>
          </Pressable>
        </View>
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
                    disabled:
                      !row.can_write || pending !== null || queued.has(row.id),
                  }}
                  disabled={
                    !row.can_write || pending !== null || queued.has(row.id)
                  }
                  hitSlop={11}
                  onPress={() => void tick(row)}
                  style={[s.tick, done && s.tickDone]}
                >
                  {done && (
                    <Icon
                      name="check"
                      size={12}
                      color={colors.onAccent}
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
                <Text style={[s.rowTitle, done && s.done]}>
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
      {!!note && (
        <Text style={s.empty} accessibilityLiveRegion="polite">
          {note}
        </Text>
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
    head: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 6,
    },
    title: {
      flex: 1,
      fontFamily: fonts.semibold,
      minWidth: 0,
      fontSize: 13,
      color: colors.muted,
    },
    link: { fontFamily: fonts.medium, fontSize: 13, color: colors.accent },
    recovery: { gap: 6 },
    retry: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
    empty: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 44,
    },
    flex: { flex: 1, minWidth: 0 },
    rowTitle: { fontFamily: fonts.regular, fontSize: 15, color: colors.text },
    done: { color: colors.muted, textDecorationLine: "line-through" },
    left: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
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
