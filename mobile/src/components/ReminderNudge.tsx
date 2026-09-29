import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { localDateKey, type ReminderNudgeCard } from "@orbyn/core";
import {
  performReminderAction,
  type ReminderActionReceipt,
} from "@orbyn/api-client";
import { client } from "../lib/api";
import { Button } from "./Button";
import { MoreMenu } from "./MoreMenu";
import { Field } from "./Field";
import { DateTimeControl } from "./DateTimeControl";
import { shared } from "../styles";

/** The phone's explicit personal work actions, with Undo. */
export function ReminderNudge({
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
  const [pending, setPending] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<ReminderActionReceipt | null>(
    skipped && chatId
      ? {
          message: "Skipped this reminder.",
          undo: async () => {
            await client.updateAiChat(chatId, {
              turn_id: turnId,
              outcome: "info",
            });
          },
        }
      : null,
  );
  const [choosing, setChoosing] = useState<"move" | "book" | null>(null);
  const [day, setDay] = useState("");
  const [picking, setPicking] = useState(false);
  const [minutes, setMinutes] = useState("30");
  useEffect(() => {
    void client.getPlannerPrefs().then(
      (prefs) => setDay(localDateKey(new Date(), prefs.timezone)),
      (e) =>
        setError(
          e instanceof Error
            ? e.message
            : "Could not load your planning settings.",
        ),
    );
  }, []);
  const run = async (work: () => Promise<void>) => {
    setPending(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update this work.");
    } finally {
      setPending(false);
    }
  };
  const act = (action: ReminderNudgeCard["actions"][number]) =>
    void run(async () => {
      setReceipt(
        await performReminderAction(client, card, action, {
          day,
          minutes: Number(minutes),
          ...(chatId ? { chatId } : {}),
          turnId,
        }),
      );
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
            disabled={busy || pending}
            onPress={() =>
              void run(async () => {
                await receipt.undo();
                setReceipt(null);
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
              disabled={busy || pending}
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
        <View style={{ gap: 8 }}>
          <Field
            label={
              choosing === "move" ? "New deadline day" : "Day to book time"
            }
          >
            <Button
              title={day || "Choose a day"}
              disabled={busy || pending}
              onPress={() => setPicking(true)}
            />
          </Field>
          {picking && (
            <DateTimeControl
              mode="date"
              value={day ? new Date(`${day}T12:00:00`) : new Date()}
              onChange={(event, chosen) => {
                if (chosen && event.type === "set")
                  setDay(
                    `${chosen.getFullYear()}-${String(chosen.getMonth() + 1).padStart(2, "0")}-${String(chosen.getDate()).padStart(2, "0")}`,
                  );
                setPicking(false);
              }}
            />
          )}
          {choosing === "book" && card.entity_kind !== "habit" && (
            <Field label="Minutes">
              <TextInput
                accessibilityLabel="Minutes to book"
                style={shared.input}
                keyboardType="number-pad"
                value={minutes}
                onChangeText={setMinutes}
              />
            </Field>
          )}
          <Button
            title={choosing === "move" ? "Move deadline" : "Book time"}
            disabled={busy || pending || !day}
            onPress={() => act(choosing)}
          />
          <Button
            title="Cancel"
            disabled={pending}
            onPress={() => {
              setChoosing(null);
              setPicking(false);
            }}
          />
        </View>
      )}
      {stopped ? (
        <Text style={shared.small}>Reminders stopped for this thing.</Text>
      ) : (
        <MoreMenu
          label="Reminder options"
          disabled={busy || pending}
          actions={[
            {
              label: "Stop reminders for this thing",
              onPress: () =>
                void run(async () => {
                  await client.stopReminderNudge(card.id);
                  setStopped(true);
                }),
            },
          ]}
        />
      )}
      {error !== "" && (
        <Text accessibilityRole="alert" style={shared.small}>
          {error}
        </Text>
      )}
    </View>
  );
}
