import React, { useState } from "react";
import { Platform, Text, TextInput, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Button } from "./Button";
import { shared } from "../styles";

type Props = React.ComponentProps<typeof DateTimePicker> & {
  mode: "date" | "time";
};

/** Native date picker with a validated, local-time web control for previews. */
export function DateTimeControl(props: Props) {
  if (Platform.OS !== "web") return <DateTimePicker {...props} />;
  return <WebDateTime key={props.mode} {...props} />;
}

function WebDateTime(props: Props) {
  const time = props.mode === "time";
  const pad = (n: number) => String(n).padStart(2, "0");
  const [text, setText] = useState(() =>
    time
      ? `${pad(props.value.getHours())}:${pad(props.value.getMinutes())}`
      : `${props.value.getFullYear()}-${pad(props.value.getMonth() + 1)}-${pad(props.value.getDate())}`,
  );
  const match = text.match(
    time ? /^(\d{2}):(\d{2})$/ : /^(\d{4})-(\d{2})-(\d{2})$/,
  );
  const date = new Date(props.value);
  let valid = !!match;
  if (match) {
    const [, a, b, c] = match.map(Number);
    if (time) {
      valid = a < 24 && b < 60;
      date.setHours(a, b, 0, 0);
    } else {
      date.setFullYear(a, b - 1, c);
      valid =
        a >= 1900 &&
        date.getFullYear() === a &&
        date.getMonth() === b - 1 &&
        date.getDate() === c;
    }
  }
  return (
    <View style={{ gap: 8 }}>
      <Text style={shared.small}>
        {time ? "Time (HH:MM)" : "Date (YYYY-MM-DD)"}
      </Text>
      <TextInput
        accessibilityLabel={
          time ? "Time in hours and minutes" : "Date in year month day format"
        }
        value={text}
        onChangeText={setText}
        style={shared.input}
        autoCapitalize="none"
      />
      <Button
        title={time ? "Set time" : "Set date"}
        disabled={!valid}
        onPress={() =>
          props.onChange?.(
            {
              type: "set",
              nativeEvent: {
                timestamp: date.getTime(),
                utcOffset: -date.getTimezoneOffset(),
              },
            },
            date,
          )
        }
      />
    </View>
  );
}
