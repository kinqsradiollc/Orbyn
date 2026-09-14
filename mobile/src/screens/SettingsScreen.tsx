import React from "react";
import { Alert, StyleSheet, Switch, Text, View } from "react-native";
import type { User } from "@orbyn/core";
import { Button } from "../components/Button";
import { client } from "../lib/api";
import { disablePush, enablePush } from "../lib/push";
import { colors } from "../theme";
import { shared } from "../styles";

export function SettingsScreen({
  user,
  busy,
  act,
  onUser,
  onSignOut,
}: {
  user: User | null;
  busy: boolean;
  act: (fn: () => Promise<void>) => Promise<void>;
  onUser: (user: User) => void;
  onSignOut: () => void;
}) {
  return (
    <View style={shared.card}>
      <Text style={shared.sectionTitle}>{user?.name}</Text>
      <Text style={shared.subtitle}>{user?.email}</Text>
      <View style={s.preference}>
        <Text style={shared.itemTitle}>Email reminders</Text>
        <Switch
          value={user?.email_reminders}
          disabled={busy}
          trackColor={{ true: colors.switchOn }}
          onValueChange={(value) =>
            act(async () =>
              onUser(
                await client.updatePreferences({ email_reminders: value }),
              ),
            )
          }
        />
      </View>
      <Button
        title="Enable mobile notifications"
        disabled={busy}
        onPress={() =>
          act(async () => {
            await enablePush();
            Alert.alert(
              "You’re in the loop",
              "Deadline reminders will reach this device.",
            );
          })
        }
      />
      <Button
        secondary
        title="Disable mobile notifications"
        disabled={busy}
        onPress={() =>
          act(async () => {
            await disablePush();
            Alert.alert("Notifications disabled");
          })
        }
      />
      <Text style={shared.small}>
        The AI provider is configured on your server. Provider keys never live
        on this device.
      </Text>
      <Button secondary title="Sign out" disabled={busy} onPress={onSignOut} />
    </View>
  );
}

const s = StyleSheet.create({
  preference: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 23,
  },
});
