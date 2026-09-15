import React, { useRef } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/Button";
import type { IconName } from "../../components/Icon";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { shared } from "../../styles";

export type MenuAction = {
  label: string;
  icon?: IconName;
  destructive?: boolean;
  run: () => void;
};

export type Menu = { title: string; detail: string; actions: MenuAction[] };

/**
 * Options for something on the calendar, as a sheet of buttons (an Alert
 * shows at most three on Android). The chosen action runs once the sheet has
 * closed, so it can open another sheet or ask a question.
 */
export function ActionMenu({
  menu,
  onClose,
}: {
  menu: Menu | null;
  onClose: () => void;
}) {
  const pending = useRef<(() => void) | null>(null);
  const runPending = () => {
    const next = pending.current;
    pending.current = null;
    next?.();
  };
  const pick = (action: MenuAction) => {
    pending.current = action.run;
    onClose();
    // iOS runs it from onDismiss, after the sheet's animation.
    if (Platform.OS !== "ios") runPending();
  };
  return (
    <Sheet
      visible={!!menu}
      title={menu?.title ?? ""}
      onClose={onClose}
      onDismiss={runPending}
    >
      <ScrollView contentContainerStyle={sheetStyles.body}>
        <View style={sheetStyles.column}>
          {!!menu?.detail && (
            <Text style={[shared.subtitle, s.detail]}>{menu.detail}</Text>
          )}
          {menu?.actions.map((a) => (
            <Button
              key={a.label}
              secondary={!a.destructive}
              destructive={a.destructive}
              icon={a.icon}
              title={a.label}
              onPress={() => pick(a)}
            />
          ))}
        </View>
      </ScrollView>
    </Sheet>
  );
}

const s = StyleSheet.create({
  detail: { marginTop: 0, marginBottom: 16 },
});
