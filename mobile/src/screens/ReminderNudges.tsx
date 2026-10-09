import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { ReminderNudgeSettings } from "@orbyn/core";
import { client } from "../lib/api";
import { Button } from "../components/Button";
import { Switch } from "../components/Switch";
import { Field } from "../components/Field";
import { DateTimeControl } from "../components/DateTimeControl";
import { shared } from "../styles";
import { colors } from "../theme";

/** The phone's personal reminder channels and quiet window. */
export function ReminderNudges({
  busy,
  run,
}: {
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<unknown>;
}) {
  const [value, setValue] = useState<ReminderNudgeSettings | null>(null);
  const [picking, setPicking] = useState<"quiet_start" | "quiet_end" | null>(
    null,
  );
  useEffect(() => {
    void run(async () => setValue(await client.reminderNudgeSettings()));
  }, []);
  if (!value) return <Text style={shared.small}>Loading reminders…</Text>;
  const date = new Date();
  if (picking) {
    const [hours, minutes] = value[picking].split(":").map(Number);
    date.setHours(hours, minutes, 0, 0);
  }
  return (
    <View style={shared.card}>
      <Text style={shared.label}>Reminder nudges</Text>
      <Text style={shared.small}>
        No AI request. At most three a day, once per item in 24 hours.
      </Text>
      {(["enabled", "chat", "push", "email"] as const).map((key) => {
        const label = {
          enabled: "Send reminder nudges",
          chat: "Private Reminders chat",
          push: "Push notifications",
          email: "Email overdue work and underbooked deadlines",
        }[key];
        return (
          <View
            key={key}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              minHeight: 44,
            }}
          >
            <Text style={[shared.small, { flex: 1 }]}>{label}</Text>
            <Switch
              accessibilityLabel={label}
              value={value[key]}
              disabled={busy}
              trackColor={{ true: colors.accent }}
              onValueChange={(enabled) =>
                setValue({ ...value, [key]: enabled })
              }
            />
          </View>
        );
      })}
      {(["quiet_start", "quiet_end"] as const).map((key) => (
        <Field
          label={
            key === "quiet_start" ? "Quiet hours start" : "Quiet hours end"
          }
          key={key}
        >
          <Button
            title={value[key]}
            disabled={busy}
            onPress={() => setPicking(key)}
          />
        </Field>
      ))}
      {picking && (
        <DateTimeControl
          mode="time"
          value={date}
          onChange={(event, chosen) => {
            if (chosen && event.type === "set")
              setValue({
                ...value,
                [picking]: `${String(chosen.getHours()).padStart(2, "0")}:${String(chosen.getMinutes()).padStart(2, "0")}`,
              });
            setPicking(null);
          }}
        />
      )}
      <Text style={shared.small}>
        Times use your planning time zone. Stop reminders for one thing from its
        Reminders chat card.
      </Text>
      <Button
        title="Save reminders"
        disabled={busy}
        onPress={() =>
          void run(async () =>
            setValue(await client.updateReminderNudgeSettings(value)),
          )
        }
      />
    </View>
  );
}
