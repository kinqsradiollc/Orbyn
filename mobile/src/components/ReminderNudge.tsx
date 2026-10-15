import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { localDateKey, type ReminderNudgeCard } from "@orbyn/core";
import {
  performReminderAction,
  type ReminderActionReceipt,
} from "@orbyn/api-client";
import { session } from "../lib/session";
import { client } from "../lib/api";
import { Button } from "./Button";
import { MoreMenu } from "./MoreMenu";
import { Field, DateField } from "./Field";
import { Sheet, sheetStyles } from "./Sheet";
import { shared } from "../styles";

/** The phone's explicit personal work actions, with Undo. */
export function ReminderNudge(props: Parameters<typeof ReminderNudgeBody>[0]) {
  return (
    <ReminderNudgeBody key={`${session.token}:${props.card.id}`} {...props} />
  );
}

function ReminderNudgeBody({
  card,
  busy,
  chatId,
  turnId,
  skipped,
}: {
  card: ReminderNudgeCard;
  busy: boolean;
  chatId: string | null;
  turnId: string;
  skipped: boolean;
}) {
  const mutation = useRef(false);
  const owner = useRef(session.token).current;
  const mounted = useRef(true);
  const owns = () => mounted.current && session.token === owner;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [receiptFailed, setReceiptFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<ReminderActionReceipt | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setReceiptLoading(true);
    setReceiptFailed(false);
    setError("");
    void client
      .reminderActionReceipt(card.id)
      .then(
        (saved) => {
          if (!cancelled && owns())
            setReceipt(
              saved && !saved.undone
                ? {
                    id: saved.id,
                    message: saved.message,
                    undo: () => client.undoReminderAction(saved.id),
                  }
                : null,
            );
        },
        (error) => {
          if (!cancelled && owns()) {
            setReceiptFailed(true);
            setError(
              error instanceof Error
                ? error.message
                : "Could not restore this reminder action.",
            );
          }
        },
      )
      .finally(() => {
        if (!cancelled && owns()) setReceiptLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [card.id, retry]);
  const [choosing, setChoosing] = useState<"move" | "book" | null>(null);
  const [day, setDay] = useState("");
  const [minutes, setMinutes] = useState("30");
  const [prefsFailed, setPrefsFailed] = useState(false);
  const [prefsAttempt, setPrefsAttempt] = useState(0);
  const dateEdited = useRef(false);
  const invalidMinutes =
    !minutes.trim() ||
    !Number.isInteger(Number(minutes)) ||
    Number(minutes) < 5 ||
    Number(minutes) > 1440;
  useEffect(() => {
    let alive = true;
    setPrefsFailed(false);
    void client.getPlannerPrefs().then(
      (prefs) => {
        if (alive && owns() && !dateEdited.current)
          setDay(localDateKey(new Date(), prefs.timezone));
      },
      () => {
        if (alive && owns()) setPrefsFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [prefsAttempt]);
  const run = async (work: () => Promise<void>) => {
    if (!owns() || busy || mutation.current || receiptLoading || receiptFailed)
      return;
    mutation.current = true;
    setPending(true);
    setError("");
    try {
      await work();
    } catch (e) {
      if (owns())
        setError(
          e instanceof Error ? e.message : "Could not update this work.",
        );
    } finally {
      mutation.current = false;
      if (owns()) setPending(false);
    }
  };
  const act = (action: ReminderNudgeCard["actions"][number]) =>
    void run(async () => {
      if (!card.actions.includes(action)) return;
      if ((action === "move" || action === "book") && !day) return;
      if (action === "book" && card.entity_kind !== "habit" && invalidMinutes)
        return;
      const saved = await performReminderAction(client, card, action, {
        day,
        minutes: Number(minutes),
        ...(chatId ? { chatId } : {}),
        turnId,
      });
      if (!owns()) return;
      setReceipt(saved);
      setChoosing(null);
    });
  return (
    <View style={{ gap: 8 }}>
      {receipt ? (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="alert" style={shared.small}>
            {receipt.message}
          </Text>
          <Button
            title="Undo"
            disabled={busy || pending || receiptLoading || receiptFailed}
            onPress={() =>
              void run(async () => {
                await receipt.undo();
                if (owns()) setReceipt(null);
              })
            }
          />
        </View>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {card.actions.map((action) => (
            <Button
              key={action}
              title={
                { done: "Done", move: "Move", skip: "Skip", book: "Book time" }[
                  action
                ]
              }
              disabled={busy || pending || receiptLoading || receiptFailed}
              onPress={() =>
                action === "move" || action === "book"
                  ? setChoosing(action)
                  : act(action)
              }
            />
          ))}
        </View>
      )}
      {choosing && (
        <Sheet
          visible
          title={choosing === "move" ? "Move deadline" : "Book time"}
          onClose={() => {
            if (!mutation.current) setChoosing(null);
          }}
        >
          <ScrollView contentContainerStyle={sheetStyles.body}>
            <View style={{ gap: 8 }}>
              <DateField
                label={choosing === "move" ? "New deadline" : "Day"}
                value={day}
                onChange={(value) => {
                  dateEdited.current = true;
                  setDay(value ?? "");
                }}
                disabled={busy || pending}
              />
              {choosing === "book" && card.entity_kind !== "habit" && (
                <Field label="Minutes">
                  <TextInput
                    accessibilityLabel="Minutes to book"
                    style={shared.input}
                    keyboardType="number-pad"
                    value={minutes}
                    editable={!busy && !pending}
                    onChangeText={setMinutes}
                  />
                </Field>
              )}
              {choosing === "book" &&
                card.entity_kind !== "habit" &&
                invalidMinutes && (
                  <Text accessibilityRole="alert" style={shared.small}>
                    Use 5–1440 whole minutes.
                  </Text>
                )}
              {prefsFailed && (
                <View style={{ gap: 8 }}>
                  <Text style={shared.small}>
                    Choose a date or retry planning settings.
                  </Text>
                  <Button
                    title="Retry settings"
                    secondary
                    disabled={pending}
                    onPress={() => setPrefsAttempt((value) => value + 1)}
                  />
                </View>
              )}
              <Button
                title={choosing === "move" ? "Move deadline" : "Book time"}
                disabled={
                  busy ||
                  pending ||
                  receiptFailed ||
                  !day ||
                  (choosing === "book" &&
                    card.entity_kind !== "habit" &&
                    invalidMinutes)
                }
                onPress={() => act(choosing)}
              />
              <Button
                title="Cancel"
                disabled={pending}
                onPress={() => {
                  setChoosing(null);
                }}
              />
              {!!error && (
                <Text accessibilityRole="alert" style={shared.small}>
                  {error}
                </Text>
              )}
            </View>
          </ScrollView>
        </Sheet>
      )}
      {stopped ? (
        <Text style={shared.small}>Reminders stopped for this item.</Text>
      ) : (
        <MoreMenu
          label="Reminder options"
          disabled={busy || pending || receiptLoading || receiptFailed}
          actions={[
            {
              label: "Stop reminders for this item",
              onPress: () =>
                void run(async () => {
                  await client.stopReminderNudge(card.id);
                  if (owns()) setStopped(true);
                }),
            },
          ]}
        />
      )}
      {receiptFailed && (
        <Button
          secondary
          title="Retry action status"
          onPress={() => setRetry((value) => value + 1)}
        />
      )}
      {error !== "" && !choosing && (
        <Text accessibilityRole="alert" style={shared.small}>
          {error}
        </Text>
      )}
    </View>
  );
}
