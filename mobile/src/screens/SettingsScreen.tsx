import {
  SettingsAnchor,
  SettingsFocus,
  SettingsSection,
} from "./settings/SettingsSection";
import { PrivacySection } from "./settings/PrivacySection";
import { ChatgptModelsSection } from "./settings/ChatgptModelsSection";
import { ArrangeList, StartChoice } from "./settings/LayoutSection";
import React, { useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "../motion";
import { Switch } from "../components/Switch";
import {
  hasSystemPermission,
  statusHeadlines,
  type PlannerPrefs,
  type PlannerPrefsInput,
  type User,
  type Session,
  type TwoFactorSetup,
  type ImportSummary,
  type InboxInfo,
  type PlannerAnalytics,
  type ChatChannel,
  type Passkey,
  csvFormat,
  searchSettings,
  sectionKey,
  type PagesImportSummary,
  type SettingEntry,
  type TaskImportFormat,
  type SidebarArrangement,
} from "@orbyn/core";
import {
  hidesHeaderWhileReading,
  readsFirst,
  setHidesHeaderWhileReading,
  setReadsFirst,
} from "../lib/reading";
import { pickFileBase64, pickFileText } from "../lib/pickFile";
import { Button } from "../components/Button";
import { Icon, type IconName } from "../components/Icon";
import { Chip, ChipRow } from "../components/Chip";
import { Pill } from "../components/Pill";
import { Segmented } from "../components/Segmented";
import { SmallAction } from "../components/SmallAction";
import * as WebBrowser from "expo-web-browser";
import { client, webOrigin } from "../lib/api";
import { confirmAction } from "../lib/confirm";
import { saveFile } from "../lib/download";
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

/** A friendly device name from a User-Agent string. */
function deviceName(ua: string): string {
  if (!ua) return "Unknown device";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X|Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : "";
  const app = /Orbyn/.test(ua)
    ? "Orbyn app"
    : /Edg\//.test(ua)
      ? "Edge"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "";
  return [app, os].filter(Boolean).join(" · ") || ua.slice(0, 32);
}
const sessionAgo = (iso: string) => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString();
};

export function SettingsScreen({
  user,
  busy,
  act,
  onUser,
  onSignOut,
  onOpenStatus,
  onOpenPlanning,
  onOpenConnections,
  onOpenTags,
  onOpenHabits,
  onOpenSync,
  onOpenWhatsNew,
  openAt,
  scrollTo,
  onAccountDeleted,
  arrangement,
  onArrange,
}: {
  /** The one Arrange list (NAV-08), and saving it. */
  arrangement?: SidebarArrangement;
  onArrange?: (next: SidebarArrangement) => void;
  user: User | null;
  busy: boolean;
  act: (fn: () => Promise<void>) => Promise<void>;
  onUser: (user: User) => void;
  onSignOut: () => void;
  onOpenStatus: () => void;
  onOpenPlanning: () => void;
  onOpenConnections: () => void;
  onOpenTags: () => void;
  onOpenHabits: () => void;
  /** Sync and devices: what's waiting on this phone, and where Orbyn is open. */
  onOpenSync: () => void;
  /** What's new in Orbyn (DSN-03). */
  onOpenWhatsNew?: () => void;
  /** A section to open at and scroll to, chosen from a search (NAV-10). */
  openAt?: { section: string; seq: number } | null;
  /** Scroll Settings to a place in it. */
  scrollTo?: (y: number) => void;
  /** After deleting your own account: leave the app. */
  onAccountDeleted: () => void;
}) {
  const isAdmin = hasSystemPermission(user?.role, "admin:access");
  const theme = useTheme();
  const [statusHeadline, setStatusHeadline] = useState("");
  const [notices, setNotices] = useState<NoticePrefs | null>(null);
  /** Completing a task counts its blocks' past time as spent; null until loaded. */
  const [countBlocks, setCountBlocks] = useState<boolean | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [tfaOn, setTfaOn] = useState<boolean | null>(null);
  const [tfaSetup, setTfaSetup] = useState<TwoFactorSetup | null>(null);
  const [tfaCode, setTfaCode] = useState("");
  const [tfaCodes, setTfaCodes] = useState<string[] | null>(null);
  const [tfaPassword, setTfaPassword] = useState("");
  const [disabling, setDisabling] = useState(false);
  const [exported, setExported] = useState("");
  const [importText, setImportText] = useState("");
  const [importFormat, setImportFormat] = useState<TaskImportFormat>("csv");
  const [importPreview, setImportPreview] = useState<ImportSummary | null>(
    null,
  );
  const [inbox, setInbox] = useState<InboxInfo | null>(null);
  const [analytics, setAnalytics] = useState<PlannerAnalytics | null>(null);
  const [chat, setChat] = useState<ChatChannel | null>(null);
  // Search in Settings (NAV-10): the same index as the web's and ⌘K's.
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<{ key: string; seq: number } | null>(null);
  useEffect(() => {
    if (openAt) setFocus({ key: sectionKey(openAt.section), seq: openAt.seq });
  }, [openAt?.seq]);
  const found = query.trim() ? searchSettings(query, "phone").slice(0, 8) : [];
  const sheets: Record<string, () => void> = {
    status: onOpenStatus,
    planning: onOpenPlanning,
    tags: onOpenTags,
    habits: onOpenHabits,
    connections: onOpenConnections,
    sync: onOpenSync,
  };
  const goTo = (entry: SettingEntry) => {
    const place = entry.phone;
    if (!place) return;
    setQuery("");
    if ("sheet" in place) return sheets[place.sheet]?.();
    setFocus({ key: sectionKey(place.section), seq: Date.now() });
  };
  const focusValue = useMemo(
    () => (focus ? { ...focus, scrollTo: (y: number) => scrollTo?.(y) } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focus?.key, focus?.seq],
  );
  // Reading on this phone (EDT-10, MOB-03).
  const [readFirst, setReadFirst] = useState(readsFirst);
  const [hideHeader, setHideHeader] = useState(hidesHeaderWhileReading);
  // Pages from Markdown or Notion (DATA-08).
  const [pageFormat, setPageFormat] = useState<"markdown" | "notion">(
    "markdown",
  );
  const [pageFile, setPageFile] = useState<{
    name: string;
    data: string;
  } | null>(null);
  const [pagePreview, setPagePreview] = useState<PagesImportSummary | null>(
    null,
  );
  const [pagesDone, setPagesDone] = useState("");
  const [chatKind, setChatKind] = useState<"slack" | "discord">("slack");
  const [chatUrl, setChatUrl] = useState("");
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
  const loadSessions = () =>
    client.listSessions().then(setSessions, () => setSessions([]));
  useEffect(() => {
    void loadSessions();
    client.getTwoFactor().then(
      (r) => setTfaOn(r.enabled),
      () => setTfaOn(false),
    );
    client.getInbox().then(setInbox, () => setInbox(null));
    client.getAnalytics(30).then(setAnalytics, () => setAnalytics(null));
    client.getChat().then(setChat, () => setChat({ kind: null }));
  }, []);
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
    <SettingsFocus.Provider value={focusValue}>
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

      {/* Search in Settings (NAV-10): a setting by name, opened in place. */}
      <View style={[shared.card, s.searchBox]}>
        <Icon name="search" size={16} color={colors.muted} />
        <TextInput
          style={s.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search settings"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search settings"
          onSubmitEditing={() => found[0] && goTo(found[0])}
        />
        {!!query && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear the search"
            hitSlop={10}
            onPress={() => setQuery("")}
          >
            <Icon name="x" size={16} color={colors.muted} />
          </Pressable>
        )}
      </View>
      {!!query.trim() && (
        <View style={[shared.card, s.rows]}>
          {found.length ? (
            found.map((e, n) => (
              <LinkRow
                key={e.id}
                divider={n > 0}
                icon="settings"
                title={e.label}
                detail={e.hint}
                onPress={() => goTo(e)}
              />
            ))
          ) : (
            <Text style={[shared.small, s.noMatch]}>
              No setting matches “{query.trim()}”.
            </Text>
          )}
        </View>
      )}

      {/* Teams, Documents, Booking and the admin console are destinations on
          the desktop's sidebar, not settings; they live on Browse now, where
          the sidebar's other sections are. What is left here is what the
          desktop's Settings page also holds. */}
      <Text style={[shared.eyebrow, s.section]}>WORKSPACE</Text>
      <View style={[shared.card, s.rows]}>
        <LinkRow
          icon="activity"
          title="Service status"
          detail={statusHeadline || "Uptime and incidents"}
          onPress={onOpenStatus}
        />
        <LinkRow
          divider
          icon="refreshCw"
          title="Sync & devices"
          detail="What's waiting on this phone, and where Orbyn is open"
          onPress={onOpenSync}
        />
        {onOpenWhatsNew && (
          <SettingsAnchor name="What's new">
            <LinkRow
              divider
              icon="sparkles"
              title="What's new"
              detail="What changed in Orbyn lately"
              onPress={onOpenWhatsNew}
            />
          </SettingsAnchor>
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
          icon="repeat"
          title="Habits"
          detail="Routines the planner fits into free time"
          onPress={onOpenHabits}
        />
        <LinkRow
          divider
          icon="link"
          title="Connections"
          detail="API keys, webhooks and calendar feed"
          onPress={onOpenConnections}
        />
      </View>

      {analytics && analytics.planned_minutes > 0 && (
        <SettingsAnchor name="Where your time goes">
          <Text style={[shared.eyebrow, s.section]}>WHERE YOUR TIME GOES</Text>
          <View style={shared.card}>
            <Text style={shared.body}>
              {Math.round(analytics.planned_minutes / 60)} h in sessions and{" "}
              {analytics.completed} task
              {analytics.completed === 1 ? "" : "s"} finished in the last 30
              days.
            </Text>
            {analytics.by_list.slice(0, 5).map((l, i) => (
              <View
                key={l.name}
                style={[s.analyticsRow, i > 0 && s.sessionDivider]}
              >
                <Text style={[shared.body, { flex: 1 }]} numberOfLines={1}>
                  {l.name}
                </Text>
                <Text style={s.prefTitle}>
                  {l.minutes >= 60
                    ? `${Math.round(l.minutes / 60)} h`
                    : `${l.minutes} min`}
                </Text>
              </View>
            ))}
          </View>
        </SettingsAnchor>
      )}

      {countBlocks !== null && (
        <>
          <Text style={[shared.eyebrow, s.section]}>TIME TRACKING</Text>
          <View style={shared.card}>
            <View style={s.preference}>
              <View style={{ flex: 1 }}>
                <Text style={s.prefTitle}>
                  Count session time as worked when I complete a task
                </Text>
                <Text style={shared.small}>
                  The sessions you had for it so far are added to its time
                  spent, each once.
                </Text>
              </View>
              <Switch
                value={countBlocks}
                disabled={busy}
                trackColor={{ true: colors.accent }}
                accessibilityLabel="Count session time as worked when I complete a task"
                onValueChange={(value) =>
                  void saveNotices({ count_blocks_as_spent: value })
                }
              />
            </View>
          </View>
        </>
      )}

      <SettingsAnchor name="Appearance">
        <Text style={[shared.eyebrow, s.section]}>APPEARANCE</Text>
      </SettingsAnchor>
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

      <SettingsSection title="Reading">
        <View style={s.preference}>
          <View style={{ flex: 1 }}>
            <Text style={s.prefTitle}>Open pages for reading</Text>
            <Text style={shared.small}>
              No handles or keyboard until you double-tap a line or choose Edit
              this page.
            </Text>
          </View>
          <Switch
            value={readFirst}
            trackColor={{ true: colors.accent }}
            accessibilityLabel="Open pages for reading"
            onValueChange={(on) => {
              setReadFirst(on);
              setReadsFirst(on);
            }}
          />
        </View>
        <View style={[s.preference, { marginTop: 16 }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.prefTitle}>Hide the header while reading</Text>
            <Text style={shared.small}>
              On a long page the header steps aside as you read down, and comes
              back when you scroll up.
            </Text>
          </View>
          <Switch
            value={hideHeader}
            trackColor={{ true: colors.accent }}
            accessibilityLabel="Hide the header while reading"
            onValueChange={(on) => {
              setHideHeader(on);
              setHidesHeaderWhileReading(on);
            }}
          />
        </View>
      </SettingsSection>

      <SettingsSection title="Start">
        <StartChoice />
      </SettingsSection>

      {arrangement && onArrange && (
        <SettingsSection title="Arrange">
          <ArrangeList
            arrangement={arrangement}
            onChange={onArrange}
            isAdmin={isAdmin}
          />
        </SettingsSection>
      )}

      <SettingsSection title="Stay in the loop">
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
              Work to roll forward, tasks at risk or due soon, and clashes,
              which always show in your inbox too.
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
              When a task has no sessions planned yet.
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
      </SettingsSection>

      <SettingsSection title="Two-step verification">
        <Text style={shared.body}>
          Ask for a code from an authenticator app at sign-in, on top of your
          password.
        </Text>
        {tfaCodes ? (
          <View style={{ marginTop: 12 }}>
            <Text style={s.prefTitle}>Save your recovery codes</Text>
            <Text style={shared.small}>
              Each works once if you lose your authenticator, and they won’t be
              shown again.
            </Text>
            {tfaCodes.map((c) => (
              <Text key={c} style={s.recoveryCode}>
                {c}
              </Text>
            ))}
            <Button
              secondary
              title="I’ve saved them"
              disabled={busy}
              style={{ marginTop: 12, marginBottom: 0 }}
              onPress={() => setTfaCodes(null)}
            />
          </View>
        ) : tfaOn ? (
          disabling ? (
            <View style={{ marginTop: 12 }}>
              <TextInput
                style={shared.input}
                placeholder="Your password"
                placeholderTextColor={colors.faint}
                secureTextEntry
                value={tfaPassword}
                onChangeText={setTfaPassword}
                accessibilityLabel="Password to turn off two-step"
              />
              <Button
                destructive
                title="Turn off two-step"
                disabled={busy || !tfaPassword}
                style={{ marginTop: 10, marginBottom: 0 }}
                onPress={() =>
                  void act(async () => {
                    await client.disableTwoFactor(tfaPassword);
                    setTfaOn(false);
                    setDisabling(false);
                    setTfaPassword("");
                  })
                }
              />
            </View>
          ) : (
            <Button
              secondary
              title="Turn off"
              disabled={busy}
              style={{ marginTop: 12, marginBottom: 0 }}
              onPress={() => setDisabling(true)}
            />
          )
        ) : tfaSetup ? (
          <View style={{ marginTop: 12 }}>
            <Text style={shared.small}>
              Add this key to your authenticator app:
            </Text>
            <Text style={s.recoveryCode}>{tfaSetup.secret}</Text>
            <TextInput
              style={[shared.input, { marginTop: 10 }]}
              placeholder="6-digit code"
              placeholderTextColor={colors.faint}
              value={tfaCode}
              onChangeText={setTfaCode}
              keyboardType="number-pad"
              maxLength={10}
              accessibilityLabel="Authenticator code"
            />
            <Button
              title="Turn on"
              disabled={busy || tfaCode.length < 6}
              style={{ marginTop: 10, marginBottom: 0 }}
              onPress={() =>
                void act(async () => {
                  const { recovery_codes } =
                    await client.enableTwoFactor(tfaCode);
                  setTfaOn(true);
                  setTfaSetup(null);
                  setTfaCode("");
                  setTfaCodes(recovery_codes);
                })
              }
            />
          </View>
        ) : (
          <Button
            secondary
            title="Set up two-step"
            icon="lock"
            disabled={busy || tfaOn === null}
            style={{ marginTop: 12, marginBottom: 0 }}
            onPress={() =>
              void act(async () => {
                setTfaSetup(await client.setupTwoFactor());
              })
            }
          />
        )}
      </SettingsSection>

      <SettingsSection title="Passkeys">
        <Passkeys act={act} busy={busy} />
      </SettingsSection>

      <SettingsSection title="Signed-in devices">
        {(sessions ?? []).map((sess, i) => (
          <View key={sess.id} style={[s.sessionRow, i > 0 && s.sessionDivider]}>
            <View style={{ flex: 1 }}>
              <Text style={s.prefTitle}>
                {deviceName(sess.user_agent)}
                {sess.current ? "  · this device" : ""}
              </Text>
              <Text style={shared.small}>
                Last active {sessionAgo(sess.last_seen_at)}
              </Text>
            </View>
            {!sess.current && (
              <SmallAction
                label="Sign out"
                disabled={busy}
                onPress={() =>
                  void act(async () => {
                    await client.revokeSession(sess.id);
                    await loadSessions();
                  })
                }
              />
            )}
          </View>
        ))}
        {(sessions ?? []).some((x) => !x.current) && (
          <Button
            secondary
            title="Sign out everywhere else"
            icon="logOut"
            disabled={busy}
            style={{ marginTop: 12, marginBottom: 0 }}
            onPress={() =>
              void act(async () => {
                await client.revokeOtherSessions();
                await loadSessions();
              })
            }
          />
        )}
      </SettingsSection>

      <SettingsSection title="Chat delivery">
        <Text style={shared.body}>
          Get your daily digest in Slack or Discord by pasting an
          incoming-webhook URL.
        </Text>
        {chat === null ? null : chat.kind ? (
          <View style={s.importRow}>
            <Text style={[s.prefTitle, { flex: 1 }]}>
              {chat.kind === "slack" ? "Slack" : "Discord"} connected
            </Text>
            <SmallAction
              label="Test"
              disabled={busy}
              onPress={() =>
                void act(async () => {
                  await client.testChat();
                })
              }
            />
            <SmallAction
              label="Disconnect"
              disabled={busy}
              destructive
              onPress={() =>
                void act(async () => {
                  await client.disableChat();
                  setChat({ kind: null });
                })
              }
            />
          </View>
        ) : (
          <>
            <View style={{ marginTop: 12 }}>
              <Segmented
                accessibilityLabel="Chat service"
                options={["slack", "discord"] as const}
                labels={{ slack: "Slack", discord: "Discord" }}
                value={chatKind}
                onChange={setChatKind}
              />
            </View>
            <TextInput
              style={[shared.input, { marginTop: 10 }]}
              value={chatUrl}
              onChangeText={setChatUrl}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={
                chatKind === "slack"
                  ? "https://hooks.slack.com/services/…"
                  : "https://discord.com/api/webhooks/…"
              }
              placeholderTextColor={colors.faint}
              accessibilityLabel="Webhook URL"
            />
            <Button
              secondary
              title="Connect"
              disabled={busy || !chatUrl.trim()}
              style={{ marginTop: 10, marginBottom: 0 }}
              onPress={() =>
                void act(async () => {
                  setChat(await client.setChat(chatKind, chatUrl.trim()));
                  setChatUrl("");
                })
              }
            />
          </>
        )}
      </SettingsSection>

      <SettingsSection title="Email to task">
        <Text style={shared.body}>
          Mail from your own address sent to your private address becomes a
          task: the subject is the title and the body its notes.
        </Text>
        {inbox === null ? null : !inbox.configured ? (
          <Text style={[shared.small, { marginTop: 8 }]}>
            Your admin hasn’t set up inbound mail yet.
          </Text>
        ) : inbox.address ? (
          <>
            <TextInput
              style={[shared.input, { marginTop: 12 }]}
              value={inbox.address}
              editable={false}
              selectTextOnFocus
              accessibilityLabel="Your email-to-task address"
            />
            <View style={s.importRow}>
              <SmallAction
                label="New address"
                disabled={busy}
                onPress={() =>
                  void act(async () => setInbox(await client.rotateInbox()))
                }
              />
              <SmallAction
                label="Turn off"
                disabled={busy}
                destructive
                onPress={() =>
                  void act(async () => {
                    await client.disableInbox();
                    setInbox((i) => (i ? { ...i, address: null } : i));
                  })
                }
              />
            </View>
          </>
        ) : (
          <Button
            secondary
            title="Turn on email-to-task"
            disabled={busy}
            style={{ marginTop: 12, marginBottom: 0 }}
            onPress={() =>
              void act(async () => setInbox(await client.rotateInbox()))
            }
          />
        )}
      </SettingsSection>

      <SettingsSection title="Import & export">
        <Text style={shared.body}>
          Take everything with you — every page as Markdown in its folders — or
          bring tasks and pages in from another app.
        </Text>
        <Button
          secondary
          title="Export everything (.zip)"
          disabled={busy}
          style={{ marginTop: 12, marginBottom: 0 }}
          onPress={() =>
            void act(async () => {
              const { blob, name } = await client.exportArchive();
              await saveFile(name, blob, "application/zip");
            })
          }
        />
        <Button
          secondary
          title="Export my data (JSON)"
          disabled={busy}
          style={{ marginTop: 8, marginBottom: 0 }}
          onPress={() =>
            void act(async () => {
              const archive = await client.exportData();
              setExported(JSON.stringify(archive, null, 2));
            })
          }
        />
        {!!exported && (
          <TextInput
            style={[shared.input, s.exportBox]}
            value={exported}
            multiline
            editable={false}
            selectTextOnFocus
            accessibilityLabel="Your export — long-press to copy"
          />
        )}
        <Text style={[shared.label, { marginTop: 16 }]}>Tasks</Text>
        <Text style={[shared.small, { marginTop: 4 }]}>
          An Orbyn export, a Todoist or TickTick CSV, or any CSV with a title
          column, written only once you confirm.
        </Text>
        <View style={{ marginTop: 8 }}>
          <Segmented
            accessibilityLabel="Import format"
            options={["csv", "todoist", "ticktick", "orbyn"] as const}
            labels={{
              csv: "CSV",
              todoist: "Todoist",
              ticktick: "TickTick",
              orbyn: "Orbyn",
            }}
            value={importFormat}
            onChange={(f) => {
              setImportFormat(f);
              setImportPreview(null);
            }}
          />
        </View>
        <TextInput
          style={[shared.input, s.exportBox, { marginTop: 10 }]}
          value={importText}
          multiline
          placeholder="Paste a CSV (with a title column) or an Orbyn export"
          placeholderTextColor={colors.faint}
          onChangeText={(t) => {
            setImportText(t);
            setImportPreview(null);
          }}
        />
        <View style={s.importRow}>
          <SmallAction
            label="Choose a file…"
            disabled={busy}
            onPress={() =>
              void act(async () => {
                const file = await pickFileText([
                  "text/csv",
                  "text/comma-separated-values",
                  "application/json",
                  "text/plain",
                ]);
                if (!file) return;
                setImportText(file.text);
                setImportFormat(
                  /\.csv$/i.test(file.name) ? csvFormat(file.text) : "orbyn",
                );
                setImportPreview(null);
              })
            }
          />
          <SmallAction
            label="Preview"
            disabled={busy || !importText.trim()}
            onPress={() =>
              void act(async () => {
                setImportPreview(
                  await client.importData({
                    format: importFormat,
                    data: importText,
                    dry_run: true,
                  }),
                );
              })
            }
          />
          {importPreview && importPreview.created > 0 && (
            <SmallAction
              label={`Import ${importPreview.created}`}
              disabled={busy}
              onPress={() =>
                void act(async () => {
                  await client.importData({
                    format: importFormat,
                    data: importText,
                    dry_run: false,
                  });
                  setImportText("");
                  setImportPreview(null);
                })
              }
            />
          )}
        </View>
        {importPreview && (
          <Text style={[shared.small, { marginTop: 8 }]}>
            {importPreview.created} item
            {importPreview.created === 1 ? "" : "s"},{" "}
            {importPreview.lists_added} new list
            {importPreview.lists_added === 1 ? "" : "s"},{" "}
            {importPreview.tags_added} new tag
            {importPreview.tags_added === 1 ? "" : "s"}
            {importPreview.skipped ? `, ${importPreview.skipped} skipped` : ""}.
            {importPreview.errors.map((e) => `\n${e}`).join("")}
          </Text>
        )}

        <Text style={[shared.label, { marginTop: 20 }]}>
          Pages from Markdown or Notion
        </Text>
        <Text style={[shared.small, { marginTop: 4 }]}>
          Markdown notes (a .zip or one .md) or a Notion export, keeping folders
          and [[links]], with Notion databases becoming projects.
        </Text>
        <View style={{ marginTop: 8 }}>
          <Segmented
            accessibilityLabel="Pages from"
            options={["markdown", "notion"] as const}
            labels={{ markdown: "Markdown", notion: "Notion" }}
            value={pageFormat}
            onChange={(f) => {
              setPageFormat(f);
              setPagePreview(null);
            }}
          />
        </View>
        <View style={s.importRow}>
          <SmallAction
            label={pageFile ? pageFile.name : "Choose a file…"}
            disabled={busy}
            onPress={() =>
              void act(async () => {
                const file = await pickFileBase64([
                  "application/zip",
                  "application/x-zip-compressed",
                  "text/markdown",
                  "text/plain",
                  "*/*",
                ]);
                if (!file) return;
                setPageFile({ name: file.name, data: file.data });
                setPagePreview(null);
                setPagesDone("");
              })
            }
          />
          <SmallAction
            label="Preview"
            disabled={busy || !pageFile}
            onPress={() =>
              void act(async () => {
                setPagePreview(
                  await client.importPages({
                    format: pageFormat,
                    file_name: pageFile!.name,
                    data: pageFile!.data,
                    dry_run: true,
                  }),
                );
              })
            }
          />
          {pagePreview &&
            !pagePreview.errors.length &&
            (pagePreview.pages > 0 || pagePreview.projects > 0) && (
              <SmallAction
                label={`Import ${pagesText(pagePreview.pages, "page")}`}
                disabled={busy}
                onPress={() =>
                  void act(async () => {
                    const done = await client.importPages({
                      format: pageFormat,
                      file_name: pageFile!.name,
                      data: pageFile!.data,
                      dry_run: false,
                    });
                    setPagePreview(null);
                    setPageFile(null);
                    setPagesDone(
                      `Imported ${describePages(done)}. They're in Documents.`,
                    );
                  })
                }
              />
            )}
        </View>
        {pagePreview && (
          <View style={{ marginTop: 8, gap: 4 }}>
            {!pagePreview.errors.length && (
              <Text style={shared.small}>{describePages(pagePreview)}.</Text>
            )}
            {pagePreview.sample.length > 0 && (
              <Text style={shared.small}>
                e.g. {pagePreview.sample.join(", ")}
              </Text>
            )}
            {pagePreview.left_out.length > 0 && (
              <Text style={shared.small}>
                Left out: {pagePreview.left_out.join(", ")}.
              </Text>
            )}
            {pagePreview.errors.map((e, i) => (
              <Text key={i} style={[shared.small, { color: colors.danger }]}>
                {e}
              </Text>
            ))}
          </View>
        )}
        {!!pagesDone && (
          <Text style={[shared.small, { marginTop: 8 }]}>{pagesDone}</Text>
        )}
      </SettingsSection>

      <PrivacySection
        email={user?.email ?? ""}
        busy={busy}
        act={act}
        onDeleted={onAccountDeleted}
      />

      <ChatgptModelsSection userId={user?.id ?? ""} />

      <SettingsSection title="AI provider">
        <Text style={shared.body}>
          An admin connects the AI provider in Admin → AI, and its keys stay on
          the server, never on this device.
        </Text>
      </SettingsSection>

      <Button
        destructive
        title="Sign out"
        disabled={busy}
        onPress={onSignOut}
        style={s.signOut}
      />
    </SettingsFocus.Provider>
  );
}

const pagesText = (n: number, word: string) =>
  `${n} ${word}${n === 1 ? "" : "s"}`;

/** What a page import brings in, in a few words. */
const describePages = (s: PagesImportSummary) =>
  [
    pagesText(s.pages, "page"),
    s.folders ? pagesText(s.folders, "folder") : "",
    s.projects
      ? `${pagesText(s.projects, "project")} with ${pagesText(s.tasks, "task")}`
      : "",
    s.links ? `${pagesText(s.links, "link")} between them` : "",
  ]
    .filter(Boolean)
    .join(", ");

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
      fontSize: 18,
      color: colors.accent,
    },
    section: { marginTop: 8 },
    preference: { flexDirection: "row", alignItems: "center", gap: 16 },
    analyticsRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 6,
    },
    sessionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 6,
    },
    sessionDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      marginTop: 6,
      paddingTop: 12,
    },
    exportBox: {
      marginTop: 12,
      minHeight: 90,
      maxHeight: 200,
      fontFamily: fonts.regular,
      fontSize: 13,
    },
    importRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 12,
      marginTop: 10,
    },
    searchBox: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 10,
      marginTop: 12,
    },
    searchInput: {
      flex: 1,
      minHeight: 32,
      fontFamily: fonts.regular,
      fontSize: 15,
      color: colors.text,
      padding: 0,
    },
    noMatch: { padding: 18 },
    recoveryCode: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
      marginTop: 4,
      letterSpacing: 1,
    },
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

/**
 * Passkeys: sign in with Face ID, Touch ID or a security key instead of a
 * password. Listed and removed here; a new one is made in the web app
 * (opened in a browser sheet), where the passkey belongs to Orbyn's
 * address, and it then works on every device synced to the same account.
 */
function Passkeys({
  act,
  busy,
}: {
  act: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
}) {
  const [keys, setKeys] = useState<Passkey[] | null>(null);
  const load = () => client.listPasskeys().then(setKeys, () => setKeys([]));
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <Text style={shared.body}>
        Sign in with Face ID, Touch ID or a security key instead of your
        password.
      </Text>
      {keys === null ? (
        <Text style={[shared.small, { marginTop: 8 }]}>Loading…</Text>
      ) : keys.length === 0 ? (
        <Text style={[shared.small, { marginTop: 8 }]}>No passkeys yet.</Text>
      ) : (
        keys.map((k, i) => (
          <View key={k.id} style={[s.sessionRow, i > 0 && s.sessionDivider]}>
            <View style={{ flex: 1 }}>
              <Text style={s.prefTitle}>{k.name}</Text>
              <Text style={shared.small}>
                Added {new Date(k.created_at).toLocaleDateString()}
                {k.last_used_at
                  ? ` · last used ${new Date(k.last_used_at).toLocaleDateString()}`
                  : " · not used yet"}
              </Text>
            </View>
            <SmallAction
              label="Remove"
              destructive
              disabled={busy}
              onPress={() =>
                confirmAction(
                  `Remove “${k.name}”?`,
                  "You won't be able to sign in with it any more.",
                  "Remove",
                  () =>
                    void act(async () => {
                      await client.deletePasskey(k.id);
                      await load();
                    }),
                )
              }
            />
          </View>
        ))
      )}
      <Button
        title="Add a passkey"
        secondary
        disabled={busy}
        style={{ marginTop: 12, marginBottom: 0 }}
        onPress={() =>
          void WebBrowser.openBrowserAsync(`${webOrigin}/app`).then(
            () => void load(),
          )
        }
      />
      <Text style={[shared.small, { marginTop: 6 }]}>
        Opens Orbyn on the web: go to Settings → Security → Add a passkey.
      </Text>
    </>
  );
}
