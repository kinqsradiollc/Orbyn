import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { addDays, dateLabel, localDateKey, type TaskAsk } from "@orbyn/core";
import { Chip, ChipRow } from "../Chip";
import { Icon } from "../Icon";
import { SmallAction } from "../SmallAction";
import { client } from "../../lib/api";
import { onLive } from "../../lib/live";
import { deviceTimeZone } from "../../lib/planning";
import { animateLayout } from "../../motion";
import { colors, fonts, radii, themed } from "../../theme";
import { shared } from "../../styles";
import { errorText } from "../../lib/errors";

type Turn = "mine" | "theirs" | "settled";
const when = (iso: string | null) => (iso ? dateLabel(iso) : "no set date");

/**
 * One ask, answered in place: take it on, suggest another day, or say you
 * can't; or, for a suggestion to you, agree or keep your date.
 */
export function AskCard({
  ask,
  turn,
  onChanged,
}: {
  ask: TaskAsk;
  turn: Turn;
  onChanged: () => void;
}) {
  const zone = deviceTimeZone();
  const today = localDateKey(new Date(), zone);
  const days = Array.from({ length: 14 }, (_, n) => addDays(today, n));
  const [mode, setMode] = useState<"idle" | "counter" | "decline">("idle");
  const [day, setDay] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      animateLayout();
      setMode("idle");
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const countered = ask.status === "countered";
  const asked = turn === "mine" && !countered;
  const text =
    ask.status === "accepted"
      ? `${ask.asked_of_name} took this on, by ${when(ask.due_at)}.`
      : ask.status === "declined"
        ? `${ask.asked_of_name} couldn't take this on${ask.reply ? `: “${ask.reply}”` : "."}`
        : ask.status === "withdrawn"
          ? "This ask was withdrawn."
          : asked
            ? `${ask.asked_by_name} asked you to do this by ${when(ask.due_at)}.`
            : turn === "mine"
              ? `${ask.asked_of_name} suggests ${when(ask.counter_due_at)} instead of ${when(ask.due_at)}.`
              : countered
                ? `You suggested ${when(ask.counter_due_at)}. Waiting for ${ask.asked_by_name}.`
                : `Waiting for ${ask.asked_of_name} to answer.`;
  const quote = countered ? ask.reply : ask.message;
  return (
    <View style={[s.card, turn === "settled" && s.settled]}>
      <View style={s.textRow}>
        <Icon name="users" size={15} color={colors.accent} />
        <View style={{ flex: 1 }}>
          <Text style={s.text}>{text}</Text>
          {!!quote && ask.status !== "declined" && (
            <Text style={shared.small}>“{quote}”</Text>
          )}
        </View>
      </View>
      {turn === "mine" && mode === "idle" && (
        <View style={s.actions}>
          {asked ? (
            <>
              <SmallAction
                label="Take it on"
                disabled={busy}
                onPress={() =>
                  void act(() =>
                    client.replyToAsk(ask.id, { action: "accept" }),
                  )
                }
              />
              <SmallAction
                label="Another day"
                disabled={busy}
                onPress={() => setMode("counter")}
              />
              <SmallAction
                label="Can't do it"
                destructive
                disabled={busy}
                onPress={() => setMode("decline")}
              />
            </>
          ) : (
            <>
              <SmallAction
                label={`Agree to ${when(ask.counter_due_at)}`}
                disabled={busy}
                onPress={() =>
                  void act(() => client.settleAsk(ask.id, "agree"))
                }
              />
              <SmallAction
                label={`Keep ${when(ask.due_at)}`}
                disabled={busy}
                onPress={() => void act(() => client.settleAsk(ask.id, "keep"))}
              />
            </>
          )}
        </View>
      )}
      {turn === "theirs" && !countered && (
        <View style={s.actions}>
          <SmallAction
            label="Withdraw the ask"
            disabled={busy}
            onPress={() => void act(() => client.settleAsk(ask.id, "withdraw"))}
          />
        </View>
      )}
      {mode === "counter" && (
        <View style={s.form}>
          <Text style={shared.small}>I can do it by</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <ChipRow label="Day">
              {days.map((d) => (
                <Chip
                  key={d}
                  compact
                  label={
                    d === today
                      ? "Today"
                      : new Date(`${d}T12:00:00`).toLocaleDateString([], {
                          weekday: "short",
                          day: "numeric",
                        })
                  }
                  selected={day === d}
                  onPress={() => setDay(d)}
                />
              ))}
            </ChipRow>
          </ScrollView>
          <TextInput
            style={shared.input}
            value={message}
            onChangeText={setMessage}
            maxLength={500}
            placeholder="A word about why (optional)"
            placeholderTextColor={colors.faint}
            accessibilityLabel="Why"
          />
          <View style={s.actions}>
            <SmallAction
              label="Send suggestion"
              disabled={busy || !day}
              onPress={() =>
                void act(() =>
                  client.replyToAsk(ask.id, {
                    action: "counter",
                    due_at: new Date(`${day}T17:00:00`).toISOString(),
                    message: message.trim(),
                  }),
                )
              }
            />
            <SmallAction
              label="Cancel"
              disabled={false}
              onPress={() => setMode("idle")}
            />
          </View>
        </View>
      )}
      {mode === "decline" && (
        <View style={s.form}>
          <TextInput
            style={shared.input}
            value={message}
            onChangeText={setMessage}
            maxLength={500}
            placeholder="Why you can't — they'll see this"
            placeholderTextColor={colors.faint}
            accessibilityLabel="Why you can't"
          />
          <View style={s.actions}>
            <SmallAction
              label="Send"
              destructive
              disabled={busy || !message.trim()}
              onPress={() =>
                void act(() =>
                  client.replyToAsk(ask.id, {
                    action: "decline",
                    message: message.trim(),
                  }),
                )
              }
            />
            <SmallAction
              label="Cancel"
              disabled={false}
              onPress={() => setMode("idle")}
            />
          </View>
        </View>
      )}
      {!!error && <Text style={[shared.small, s.bad]}>{error}</Text>}
    </View>
  );
}

const turnOf = (
  a: TaskAsk,
  lists: { to_me: TaskAsk[]; from_me: TaskAsk[] },
): Turn =>
  lists.to_me.some((x) => x.id === a.id)
    ? "mine"
    : lists.from_me.some((x) => x.id === a.id)
      ? "theirs"
      : "settled";

/** The ask on one task, in its sheet. Nothing when there isn't one. */
export function AskBox({
  itemId,
  onChanged,
}: {
  itemId: string;
  onChanged: () => void;
}) {
  const [state, setState] = useState<{ ask: TaskAsk; turn: Turn } | null>(null);
  const load = useCallback(() => {
    client.listAsks().then(
      (lists) => {
        const ask = [...lists.to_me, ...lists.from_me, ...lists.recent].find(
          (a) => a.item_id === itemId,
        );
        setState(ask ? { ask, turn: turnOf(ask, lists) } : null);
      },
      () => setState(null),
    );
  }, [itemId]);
  useEffect(load, [load]);
  if (!state) return null;
  return (
    <AskCard
      ask={state.ask}
      turn={state.turn}
      onChanged={() => {
        load();
        onChanged();
      }}
    />
  );
}

/** Asks waiting for you, and the ones you're waiting on, atop the Inbox. */
export function AsksList({
  onOpenItem,
}: {
  onOpenItem: (itemId: string) => void;
}) {
  const [lists, setLists] = useState<{
    to_me: TaskAsk[];
    from_me: TaskAsk[];
  } | null>(null);
  const load = useCallback(() => {
    client.listAsks().then(setLists, () => setLists(null));
  }, []);
  useEffect(() => {
    load();
    return onLive((news) => news.kind === "changed" && load());
  }, [load]);
  if (!lists || (!lists.to_me.length && !lists.from_me.length)) return null;
  const group = (title: string, asks: TaskAsk[], turn: Turn) =>
    asks.length > 0 && (
      <View style={s.group}>
        <Text style={shared.eyebrow}>
          {title} · {asks.length}
        </Text>
        {asks.map((a) => (
          <View key={a.id} style={s.item}>
            <Text
              style={s.itemTitle}
              accessibilityRole="link"
              onPress={() => onOpenItem(a.item_id)}
            >
              {a.item_title}
            </Text>
            <AskCard ask={a} turn={turn} onChanged={load} />
          </View>
        ))}
      </View>
    );
  return (
    <View style={s.list}>
      {group("WAITING FOR YOUR ANSWER", lists.to_me, "mine")}
      {group("WAITING ON OTHERS", lists.from_me, "theirs")}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    card: {
      gap: 10,
      padding: 12,
      marginVertical: 8,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.softBorder,
      backgroundColor: colors.soft,
    },
    settled: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.border,
    },
    textRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
    text: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    form: { gap: 8 },
    bad: { color: colors.danger },
    list: { gap: 14, marginBottom: 14 },
    group: { gap: 4 },
    item: { gap: 2 },
    itemTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  }),
);
