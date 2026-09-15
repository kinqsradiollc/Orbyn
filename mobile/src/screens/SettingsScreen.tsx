import React from "react";
import { Alert, StyleSheet, Switch, Text, View } from "react-native";
import type { User } from "@orbyn/core";
import { Button } from "../components/Button";
import { client } from "../lib/api";
import { disablePush, enablePush } from "../lib/push";
import { colors, fonts } from "../theme";
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
    <>
      <View style={[shared.card, s.account]}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>
            {(user?.name[0] || "O").toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={shared.sectionTitle} numberOfLines={1}>
            {user?.name}
          </Text>
          <Text style={shared.small} numberOfLines={1}>
            {user?.email}
          </Text>
        </View>
      </View>

      <Text style={[shared.eyebrow, s.section]}>STAY IN THE LOOP</Text>
      <View style={shared.card}>
        <View style={s.preference}>
          <View style={{ flex: 1 }}>
            <Text style={s.prefTitle}>Email reminders</Text>
            <Text style={shared.small}>
              Receive a reminder before your tasks and events are due.
            </Text>
          </View>
          <Switch
            value={user?.email_reminders}
            disabled={busy}
            trackColor={{ true: colors.accent }}
            accessibilityLabel="Email reminders"
            onValueChange={(value) =>
              act(async () =>
                onUser(
                  await client.updatePreferences({ email_reminders: value }),
                ),
              )
            }
          />
        </View>
        <View style={s.divider} />
        <Text style={s.prefTitle}>Push notifications</Text>
        <Text style={[shared.small, s.prefText]}>
          Get deadline reminders on this device.
        </Text>
        <Button
          title="Enable on this device"
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
          title="Turn off on this device"
          disabled={busy}
          style={{ marginBottom: 0 }}
          onPress={() =>
            act(async () => {
              await disablePush();
              Alert.alert("Notifications disabled");
            })
          }
        />
      </View>

      <Text style={[shared.eyebrow, s.section]}>AI PROVIDER</Text>
      <View style={shared.card}>
        <Text style={shared.body}>
          Your server administrator configures the provider URL, API key, and
          model. Keys stay on the backend, never on this device.
        </Text>
      </View>

      <Button
        destructive
        title="Sign out"
        disabled={busy}
        onPress={onSignOut}
        style={s.signOut}
      />
    </>
  );
}

const s = StyleSheet.create({
  account: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontFamily: fonts.display, fontSize: 20, color: colors.accent },
  section: { marginTop: 8 },
  preference: { flexDirection: "row", alignItems: "center", gap: 16 },
  prefTitle: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.text,
    marginBottom: 3,
  },
  prefText: { marginBottom: 14 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: 16,
  },
  signOut: { marginTop: 8 },
});
