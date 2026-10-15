import React, { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { dateLabel, localDateKey, type TaskAsk } from "@orbyn/core";
import { DateField } from "../Field";
import { Sheet, sheetStyles } from "../Sheet";
import { Icon } from "../Icon";
import { SmallAction } from "../SmallAction";
import { client } from "../../lib/api";
import { onLive } from "../../lib/live";
import { deviceTimeZone } from "../../lib/planning";
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
  const mutation = useRef(false);
  const [mode, setMode] = useState<"idle" | "counter" | "decline">("idle");
  const [day, setDay] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const act = async (fn: () => Promise<unknown>) => {
    if (mutation.current || turn === "settled") return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
      setMode("idle");
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    setMode("idle");
  }, [ask.status]);
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
        <View style={{ flex: 1, minWidth: 0 }}>
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
            label="Withdraw request"
            disabled={busy}
            onPress={() => void act(() => client.settleAsk(ask.id, "withdraw"))}
          />
        </View>
      )}
      {mode === "counter" && (
        <Sheet
          visible
          title="Suggest a date"
          hideClose={busy}
          onClose={() => {
            if (!busy) setMode("idle");
          }}
        >
          <ScrollView contentContainerStyle={sheetStyles.body}>
            <View style={s.form}>
              <DateField
                value={day}
                label="Suggested date"
                disabled={busy}
                minimumDate={new Date(`${today}T00:00:00`)}
                onChange={setDay}
              />
              <TextInput
                style={shared.input}
                editable={!busy}
                value={message}
                onChangeText={setMessage}
                maxLength={500}
                placeholder="Reason (optional)"
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
                  disabled={busy}
                  onPress={() => setMode("idle")}
                />
              </View>
              {!!error && (
                <Text style={s.bad} accessibilityRole="alert">
                  {error}
                </Text>
              )}
            </View>
          </ScrollView>
        </Sheet>
      )}
      {mode === "decline" && (
        <Sheet
          visible
          title="Decline request"
          hideClose={busy}
          onClose={() => {
            if (!busy) setMode("idle");
          }}
        >
          <ScrollView contentContainerStyle={sheetStyles.body}>
            <View style={s.form}>
              <TextInput
                style={shared.input}
                editable={!busy}
                value={message}
                onChangeText={setMessage}
                maxLength={500}
                placeholder="Reason · shared with requester"
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
                  disabled={busy}
                  onPress={() => setMode("idle")}
                />
              </View>
              {!!error && (
                <Text style={s.bad} accessibilityRole="alert">
                  {error}
                </Text>
              )}
            </View>
          </ScrollView>
        </Sheet>
      )}
      {!!error && mode === "idle" && (
        <Text accessibilityRole="alert" style={[shared.small, s.bad]}>
          {error}
        </Text>
      )}
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

export function AskBox(props: Parameters<typeof AskBoxBody>[0]) {
  return <AskBoxBody key={props.itemId} {...props} />;
}

/** The ask on one task, in its sheet. Nothing when there isn't one. */
function AskBoxBody({
  itemId,
  onChanged,
}: {
  itemId: string;
  onChanged: () => void;
}) {
  const [state, setState] = useState<{ ask: TaskAsk; turn: Turn } | null>(null);
  const [error, setError] = useState("");
  const request = useRef(0);
  const load = useCallback(async () => {
    const version = ++request.current;
    try {
      const lists = await client.listAsks();
      if (version !== request.current) return;
      const ask = [...lists.to_me, ...lists.from_me, ...lists.recent].find(
        (row) => row.item_id === itemId,
      );
      setState(ask ? { ask, turn: turnOf(ask, lists) } : null);
      setError("");
    } catch (reason) {
      if (version === request.current) setError(errorText(reason));
    }
  }, [itemId]);
  useEffect(() => {
    setState(null);
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);
  if (error)
    return (
      <View>
        <Text style={s.bad} accessibilityRole="alert">
          {error}
        </Text>
        <SmallAction
          label="Retry"
          disabled={false}
          onPress={() => {
            void load();
          }}
        />
      </View>
    );
  if (!state) return null;
  return (
    <AskCard
      key={state.ask.id}
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
  const [error, setError] = useState("");
  const request = useRef(0);
  const load = useCallback(async () => {
    const version = ++request.current;
    try {
      const rows = await client.listAsks();
      if (version === request.current) {
        setLists(rows);
        setError("");
      }
    } catch (reason) {
      if (version === request.current) setError(errorText(reason));
    }
  }, []);
  useEffect(() => {
    void load();
    const unsubscribe = onLive((news) => {
      if (news.kind === "changed") void load();
    });
    return () => {
      request.current += 1;
      unsubscribe();
    };
  }, [load]);
  if (error && !lists)
    return (
      <View>
        <Text style={s.bad} accessibilityRole="alert">
          {error}
        </Text>
        <SmallAction
          label="Retry"
          disabled={false}
          onPress={() => {
            void load();
          }}
        />
      </View>
    );
  if (!lists || (!lists.to_me.length && !lists.from_me.length && !error))
    return null;
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
      {!!error && (
        <View>
          <Text style={s.bad} accessibilityRole="alert">
            {error}
          </Text>
          <SmallAction
            label="Retry"
            disabled={false}
            onPress={() => {
              void load();
            }}
          />
        </View>
      )}
      {group("Waiting for you", lists.to_me, "mine")}
      {group("Waiting on others", lists.from_me, "theirs")}
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
    text: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    form: { gap: 8 },
    bad: { color: colors.danger },
    list: { gap: 14, marginBottom: 14 },
    group: { gap: 4 },
    item: { gap: 2 },
    itemTitle: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
  }),
);
