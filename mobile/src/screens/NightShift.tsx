import React, { useCallback, useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { NIGHT_SHIFT_KINDS, type NightShiftSettings } from "@orbyn/core";
import { Button } from "../components/Button";
import { Field } from "../components/Field";
import { ErrorBanner } from "../components/ErrorBanner";
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
  const mounted = useRef(true);
  const request = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const epoch = ++request.current;
    setLoading(true);
    try {
      const next = await client.nightShiftSettings();
      if (!mounted.current || epoch !== request.current) return;
      setValue(next);
      setError("");
    } catch {
      if (mounted.current && epoch === request.current)
        setError("Couldn't load night shift.");
    } finally {
      if (mounted.current && epoch === request.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      ++request.current;
    };
  }, [load]);
  if (!value)
    return (
      <View style={shared.card}>
        <Text style={shared.label}>Night shift</Text>
        <ErrorBanner error={error} />
        {loading ? (
          <Text style={shared.small}>Loading night shift…</Text>
        ) : (
          <Button
            title="Retry night shift"
            secondary
            disabled={busy}
            onPress={() => void load()}
          />
        )}
      </View>
    );
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
        Work runs while you're away. Changes wait for review unless you turn
        that off.
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
            if (!busy && chosen && event.type === "set")
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
          editable={!busy}
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
        Deletes, publishing, messages and permission requests always wait in
        Review.
      </Text>
      <Button
        title="Save night shift"
        disabled={busy}
        onPress={() =>
          void run(async () => {
            const next = await client.updateNightShiftSettings(value);
            if (mounted.current) setValue(next);
          })
        }
      />
    </View>
  );
}
