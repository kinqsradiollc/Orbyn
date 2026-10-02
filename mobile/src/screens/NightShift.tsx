import React, { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { NIGHT_SHIFT_KINDS, type NightShiftSettings } from "@orbyn/core";
import { Button } from "../components/Button";
import { Field } from "../components/Field";
import { Switch } from "../components/Switch";
import { DateTimeControl } from "../components/DateTimeControl";
import { client } from "../lib/api";
import { shared } from "../styles";
import { colors } from "../theme";
const labels = {
  plan: "Plan tomorrow",
  deadlines: "Deadlines",
  study: "Study",
  meetings: "Meetings",
  tidy: "Tidy up",
  handed: "Tasks handed to me",
  follow_through: "Follow through",
  reflection: "Reflect on recent work",
};

/** The phone's personal night-shift settings. */
export function NightShift({
  busy,
  run,
}: {
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<unknown>;
}) {
  const [value, setValue] = useState<NightShiftSettings | null>(null);
  const [picking, setPicking] = useState<"start" | "end" | null>(null);
  useEffect(() => {
    void run(async () => setValue(await client.nightShiftSettings()));
  }, []);
  if (!value) return <Text style={shared.small}>Loading night shift…</Text>;
  const toggle = (
    label: string,
    checked: boolean,
    change: (value: boolean) => void,
  ) => (
    <View
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
        value={checked}
        onValueChange={change}
        disabled={busy}
        trackColor={{ true: colors.accent }}
      />
    </View>
  );
  const date = new Date();
  if (picking) {
    const [hours, minutes] = value[picking].split(":").map(Number);
    date.setHours(hours, minutes, 0, 0);
  }
  return (
    <View style={shared.card}>
      <Text style={shared.label}>Night shift</Text>
      <Text style={shared.small}>
        Your assistant can work while you’re away. Changes wait for your morning
        review unless you turn that off.
      </Text>
      {toggle("Work overnight", value.enabled, (enabled) =>
        setValue({ ...value, enabled }),
      )}
      <Field label="Start">
        <Button
          title={value.start}
          onPress={() => setPicking("start")}
          disabled={busy}
        />
      </Field>
      <Field label="End">
        <Button
          title={value.end}
          onPress={() => setPicking("end")}
          disabled={busy}
        />
      </Field>
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
      <Field label="Time zone">
        <TextInput
          accessibilityLabel="Night shift time zone"
          style={shared.input}
          value={value.timezone}
          onChangeText={(timezone) => setValue({ ...value, timezone })}
          autoCapitalize="none"
        />
      </Field>
      <Text style={shared.label}>What to work on</Text>
      {NIGHT_SHIFT_KINDS.map((kind) => (
        <React.Fragment key={kind}>
          {toggle(labels[kind], value.kinds[kind], (enabled) =>
            setValue({ ...value, kinds: { ...value.kinds, [kind]: enabled } }),
          )}
        </React.Fragment>
      ))}
      {toggle(
        "Wait for my OK in the morning",
        value.wait_for_ok,
        (wait_for_ok) => setValue({ ...value, wait_for_ok }),
      )}
      <Text style={shared.small}>
        Deletes, publishing, messages to other people, and work that needs
        permission always wait in Review.
      </Text>
      <Button
        title="Save night shift"
        disabled={busy}
        onPress={() =>
          void run(async () =>
            setValue(await client.updateNightShiftSettings(value)),
          )
        }
      />
    </View>
  );
}
