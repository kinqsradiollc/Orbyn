import { PanResponder, View } from "react-native";
import { useMemo, useRef } from "react";
import { colors } from "../theme";
export type DocumentDividerProps = {
  value: number;
  width: number;
  onChange: (value: number) => void;
};
export function DocumentDivider({
  value,
  width,
  onChange,
}: DocumentDividerProps) {
  const start = useRef(value),
    latest = useRef({ value, width, onChange });
  latest.current = { value, width, onChange };
  const change = (n: number) =>
    latest.current.onChange(Math.max(30, Math.min(70, Math.round(n))));
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          start.current = latest.current.value;
        },
        onPanResponderMove: (_, gesture) =>
          change(
            start.current +
              (gesture.dx / Math.max(1, latest.current.width)) * 100,
          ),
      }),
    [],
  );
  return (
    <View
      {...responder.panHandlers}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Resize source and preview"
      accessibilityValue={{ min: 30, max: 70, now: value }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) =>
        change(value + (event.nativeEvent.actionName === "increment" ? 5 : -5))
      }
      style={{
        width: 12,
        alignSelf: "stretch",
        backgroundColor: colors.surfaceMuted,
        borderColor: colors.border,
        borderLeftWidth: 1,
        borderRightWidth: 1,
      }}
    />
  );
}
