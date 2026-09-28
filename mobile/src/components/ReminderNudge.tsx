import { useState } from "react";
import { Text, View } from "react-native";
import type { ReminderNudgeCard } from "@orbyn/core";
import { client } from "../lib/api";
import { Button } from "./Button";
import { shared } from "../styles";

/** Remember a source-level stop from its personal reminder card. */
export function ReminderNudge({
  card,
  busy,
}: {
  card: ReminderNudgeCard;
  busy: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState("");
  return (
    <View style={{ gap: 8 }}>
      <Button
        title={
          stopped
            ? "Reminders stopped for this thing"
            : "Stop reminders for this thing"
        }
        disabled={busy || pending || stopped}
        onPress={() => {
          setPending(true);
          setError("");
          void client
            .stopReminderNudge(card.id)
            .then(
              () => setStopped(true),
              (e) =>
                setError(
                  e instanceof Error
                    ? e.message
                    : "Could not stop this reminder.",
                ),
            )
            .finally(() => setPending(false));
        }}
      />
      {error !== "" && (
        <Text accessibilityRole="alert" style={shared.small}>
          {error}
        </Text>
      )}
    </View>
  );
}
