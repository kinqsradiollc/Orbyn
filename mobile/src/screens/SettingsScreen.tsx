import React, { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import {
  hasSystemPermission,
  statusHeadlines,
  type PlannerPrefs,
  type PlannerPrefsInput,
  type User,
} from "@orbyn/core";
import { Button } from "../components/Button";
import { Icon, type IconName } from "../components/Icon";
import { Chip, ChipRow } from "../components/Chip";
import { Pill } from "../components/Pill";
import { Segmented } from "../components/Segmented";
import { client } from "../lib/api";
import { disablePush, enablePush } from "../lib/push";
import {
  colors,
  fonts,
  themed,
  THEME_PREFERENCES,
  useTheme,
  type ThemePreference,
} from "../theme";
import { shared } from "../styles";

/** Days before a due date to warn about a task with no time set aside. */
const NOTICE_DAYS = [0, 1, 2, 3, 7];
type NoticePrefs = { days: number; push: boolean; email: boolean };
const noticePrefs = (p: PlannerPrefs): NoticePrefs => ({
  days: p.deadline_notice_days ?? 1,
  push: p.planner_notices?.push ?? true,
  email: p.planner_notices?.email ?? false,
});

const THEME_LABELS: Record<ThemePreference, string> = {
  system: "Automatic",
  light: "Light",
  dark: "Dark",
};

export function SettingsScreen({
  user,
  busy,
  act,
  onUser,
  onSignOut,
  teamCount,
  onOpenTeams,
  onOpenAdmin,
  onOpenStatus,
  onOpenPlanning,
  onOpenConnections,
  onOpenBooking,
  onOpenTags,
}: {
  user: User | null;
  busy: boolean;
  act: (fn: () => Promise<void>) => Promise<void>;
  onUser: (user: User) => void;
  onSignOut: () => void;
  teamCount: number;
  onOpenTeams: () => void;
  onOpenAdmin: () => void;
  onOpenStatus: () => void;
  onOpenPlanning: () => void;
  onOpenConnections: () => void;
  onOpenBooking: () => void;
  onOpenTags: () => void;
}) {
  const isAdmin = hasSystemPermission(user?.role, "admin:access");
  const theme = useTheme();
  const [statusHeadline, setStatusHeadline] = useState("");
  const [notices, setNotices] = useState<NoticePrefs | null>(null);
  /** Completing a task counts its blocks' past time as spent; null until loaded. */
  const [countBlocks, setCountBlocks] = useState<boolean | null>(null);
  const takePrefs = (p: PlannerPrefs) => {
    setNotices(noticePrefs(p));
    setCountBlocks(p.count_blocks_as_spent ?? false);
  };
  useEffect(() => {
    let live = true;
    client
      .getPlannerPrefs()
      .then((p) => {
        if (!live) return;
        setNotices(noticePrefs(p));
        setCountBlocks(p.count_blocks_as_spent ?? false);
      })
      .catch(() => {
        // Older servers have no planner notices; the controls stay hidden.
      });
    return () => {
      live = false;
    };
  }, []);
  const saveNotices = (input: PlannerPrefsInput) =>
    act(async () => takePrefs(await client.updatePlannerPrefs(input)));
  useEffect(() => {
    let live = true;
    client
      .getStatus()
      .then((r) => live && setStatusHeadline(statusHeadlines[r.state]))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return (
    <>
      <View style={[shared.card, s.account]}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>
            {(user?.name[0] || "O").toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={s.nameRow}>
            <Text
              style={[shared.sectionTitle, { flexShrink: 1 }]}
              numberOfLines={1}
            >
              {user?.name}
            </Text>
            {isAdmin && <Pill label="Admin" tone="accent" />}
          </View>
          <Text style={shared.small} numberOfLines={1}>
            {user?.email}
          </Text>
        </View>
      </View>

      <Text style={[shared.eyebrow, s.section]}>WORKSPACE</Text>
      <View style={[shared.card, s.rows]}>
        <LinkRow
          icon="users"
          title="Teams"
          detail={
            teamCount
              ? `${teamCount} team${teamCount === 1 ? "" : "s"}`
              : "Share plans with others"
          }
          onPress={onOpenTeams}
        />
        <LinkRow
          divider
          icon="activity"
          title="Service status"
          detail={statusHeadline || "Uptime and incidents"}
          onPress={onOpenStatus}
        />
        {isAdmin && (
          <LinkRow
            divider
            icon="shieldCheck"
            title="Admin console"
            detail="Users, teams and activity"
            onPress={onOpenAdmin}
          />
        )}
      </View>

      <Text style={[shared.eyebrow, s.section]}>PLANNING</Text>
      <View style={[shared.card, s.rows]}>
        <LinkRow
          icon="clock"
          title="Planning"
          detail="Working hours, frames and places"
          onPress={onOpenPlanning}
        />
        <LinkRow
          divider
          icon="tag"
          title="Tags"
          detail="Yours and your teams’"
          onPress={onOpenTags}
        />
        <LinkRow
          divider
          icon="calendar"
          title="Booking pages"
          detail="Let people book time with you"
          onPress={onOpenBooking}
        />
        <LinkRow
          divider
          icon="link"
          title="Connections"
          detail="API keys, webhooks and calendar feed"
          onPress={onOpenConnections}
        />
      </View>

      {countBlocks !== null && (
        <>
          <Text style={[shared.eyebrow, s.section]}>TIME TRACKING</Text>
          <View style={shared.card}>
            <View style={s.preference}>
              <View style={{ flex: 1 }}>
                <Text style={s.prefTitle}>
                  Count blocked time as worked when I complete a task
                </Text>
                <Text style={shared.small}>
                  The time blocks you had for it, up to now, are added to its
                  time spent. Each block counts once.
                </Text>
              </View>
              <Switch
                value={countBlocks}
                disabled={busy}
                trackColor={{ true: colors.accent }}
                accessibilityLabel="Count blocked time as worked when I complete a task"
                onValueChange={(value) =>
                  void saveNotices({ count_blocks_as_spent: value })
                }
              />
            </View>
          </View>
        </>
      )}

      <Text style={[shared.eyebrow, s.section]}>APPEARANCE</Text>
      <View style={shared.card}>
        <Text style={s.prefTitle}>Theme</Text>
        <Text style={[shared.small, s.prefText]}>
          Automatic follows your device’s light or dark setting.
        </Text>
        <Segmented
          accessibilityLabel="Theme"
          options={THEME_PREFERENCES}
          labels={THEME_LABELS}
          value={theme.preference}
          onChange={theme.setPreference}
        />
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
        {notices && (
          <>
            <View style={s.divider} />
            <Text style={s.prefTitle}>Planner notices</Text>
            <Text style={[shared.small, s.prefText]}>
              Work to roll forward, tasks at risk or due soon, and clashes. They
              always show in your inbox.
            </Text>
            {(["push", "email"] as const).map((channel) => (
              <View key={channel} style={[s.preference, { marginBottom: 10 }]}>
                <Text style={[s.prefTitle, { flex: 1 }]}>
                  {channel === "push" ? "Push" : "Email"}
                </Text>
                <Switch
                  value={notices[channel]}
                  disabled={busy}
                  trackColor={{ true: colors.accent }}
                  accessibilityLabel={`Planner notices by ${channel}`}
                  onValueChange={(value) =>
                    void saveNotices({ planner_notices: { [channel]: value } })
                  }
                />
              </View>
            ))}
            <Text style={[s.prefTitle, { marginTop: 8 }]}>
              Warn before a due date
            </Text>
            <Text style={[shared.small, s.prefText]}>
              When a task has no time set aside yet.
            </Text>
            <ChipRow label="Days before a due date">
              {[...new Set([...NOTICE_DAYS, notices.days])]
                .sort((a, b) => a - b)
                .map((n) => (
                  <Chip
                    key={n}
                    label={
                      n === 0 ? "Off" : `${n} day${n === 1 ? "" : "s"} before`
                    }
                    disabled={busy}
                    selected={notices.days === n}
                    onPress={() =>
                      void saveNotices({ deadline_notice_days: n })
                    }
                  />
                ))}
            </ChipRow>
          </>
        )}
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
          An admin connects the AI provider in Admin → AI. Keys stay on the
          server, never on this device.
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

/** Tappable settings row: icon, title, detail, chevron. */
function LinkRow({
  icon,
  title,
  detail,
  divider = false,
  onPress,
}: {
  icon: IconName;
  title: string;
  detail: string;
  divider?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        divider && s.rowDivider,
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}
    >
      <View style={s.rowIcon}>
        <Icon name={icon} size={18} color={colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.prefTitle}>{title}</Text>
        <Text style={shared.small}>{detail}</Text>
      </View>
      <Icon name="chevronRight" size={18} color={colors.faint} />
    </Pressable>
  );
}

const s = themed(() =>
  StyleSheet.create({
    nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    rows: { padding: 0, overflow: "hidden" },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      paddingVertical: 14,
      paddingHorizontal: 18,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    rowIcon: {
      width: 36,
      height: 36,
      borderRadius: 11,
      backgroundColor: colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    account: { flexDirection: "row", alignItems: "center", gap: 14 },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      fontFamily: fonts.display,
      fontSize: 20,
      color: colors.accent,
    },
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
  }),
);
