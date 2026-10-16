import { AgentWarmStartCards } from "./AgentContext";
import * as Crypto from "expo-crypto";
import { BottomSheet } from "../components/BottomSheet";
import { EmailToTaskSection } from "./settings/EmailToTaskSection";
import { ChatDeliverySection } from "./settings/ChatDeliverySection";
import { ActivitySheet } from "./ActivitySheet";
import { ChatgptModelsSection } from "./settings/ChatgptModelsSection";
import { AssistantRulesSection } from "./settings/AssistantRulesSection";
import { AssistantBudgetSection } from "./settings/AssistantBudgetSection";
import {
  SettingsAnchor,
  SettingsWorkspace,
  SettingsOverview,
  SettingsSection,
} from "./settings/SettingsSection";
import { PrivacySection } from "./settings/PrivacySection";
import { ArrangeList, StartChoice } from "./settings/LayoutSection";
import { ErrorBanner } from "../components/ErrorBanner";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { session } from "../lib/session";
import { Pressable } from "../motion";
import { Switch } from "../components/Switch";
import {
  hasSystemPermission,
  durationText,
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
  SETTINGS_INDEX,
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
import { ActionSheet } from "../components/MoreMenu";
import { InlineDetails } from "../components/InlineDetails";
import * as WebBrowser from "expo-web-browser";
import { client, webOrigin } from "../lib/api";

import { saveFile } from "../lib/download";
import { disablePush, enablePush } from "../lib/push";
import {
  inputFontSize,
  colors,
  fonts,
  radii,
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

export function SettingsScreen(
  props: React.ComponentProps<typeof SettingsBody>,
) {
  return (
    <SettingsBody
      key={`${session.token}:${props.user?.id ?? "signed-out"}`}
      {...props}
    />
  );
}

const CATEGORIES = [
  { id: "account", label: "Account" },
  { id: "planning", label: "Planning" },
  { id: "assistants", label: "Assistants" },
  { id: "connections", label: "Connections" },
  { id: "privacy", label: "Privacy" },
] as const;
type Category = (typeof CATEGORIES)[number]["id"];
function categoryForSection(section: string): Category {
  const key = sectionKey(section);
  if (key === sectionKey("Work limits")) return "assistants";
  const tab = SETTINGS_INDEX.find(
    (entry) =>
      entry.phone &&
      "section" in entry.phone &&
      sectionKey(entry.phone.section) === key,
  )?.tab;
  return tab && tab !== "tags" ? tab : "account";
}
function SettingsGroup({
  category,
  selected,
  children,
}: {
  category: Category;
  selected: Category;
  children: React.ReactNode;
}) {
  const hidden = category !== selected;
  return (
    <View
      style={hidden ? { display: "none" } : undefined}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
    >
      {children}
    </View>
  );
}

function SettingsBody({
  user,
  busy: parentBusy,
  act: parentAct,
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
  preferencesReady = true,
  preferencesError = "",
  onReloadPreferences,
  onBusyChange,
}: {
  onBusyChange?: (busy: boolean) => void;
  /** The one Arrange list (NAV-08), and saving it. */
  arrangement?: SidebarArrangement;
  onArrange?: (next: SidebarArrangement) => void;
  preferencesReady?: boolean;
  preferencesError?: string;
  onReloadPreferences?: () => void;
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
  const contentRoot = useRef<View>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [category, setCategory] = useState<Category>("account");
  const [categoryPicker, setCategoryPicker] = useState(false);
  const [statusHeadline, setStatusHeadline] = useState("");
  const [notices, setNotices] = useState<NoticePrefs | null>(null);
  /** Completing a task counts its blocks' past time as spent; null until loaded. */
  const [countBlocks, setCountBlocks] = useState<boolean | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [sessionQuery, setSessionQuery] = useState("");
  const [allSessions, setAllSessions] = useState(false);
  const matchedSessions = (sessions ?? []).filter((value) =>
    `${deviceName(value.user_agent)} ${value.user_agent}`
      .toLowerCase()
      .includes(sessionQuery.trim().toLowerCase()),
  );
  const [tfaOn, setTfaOn] = useState<boolean | null>(null);
  const [tfaSetup, setTfaSetup] = useState<TwoFactorSetup | null>(null);
  const [tfaCode, setTfaCode] = useState("");
  const [tfaCodes, setTfaCodes] = useState<string[] | null>(null);
  const [tfaPassword, setTfaPassword] = useState("");
  const [disabling, setDisabling] = useState(false);
  const [transferMode, setTransferMode] = useState<
    "export" | "tasks" | "pages" | null
  >(null);
  const [transferError, setTransferError] = useState("");
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
    if (openAt) {
      setCategory(categoryForSection(openAt.section));
      setFocus({ key: sectionKey(openAt.section), seq: openAt.seq });
    }
  }, [openAt?.seq]);
  const found = query.trim() ? searchSettings(query, "phone") : [];
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
    setCategory(categoryForSection(place.section));
    setFocus({ key: sectionKey(place.section), seq: Date.now() });
  };
  const focusValue = useMemo(
    () =>
      focus
        ? {
            ...focus,
            root: contentRoot,
            scrollTo: (y: number) => scrollTo?.(y),
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focus?.key, focus?.seq, scrollTo],
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
  const [tasksDone, setTasksDone] = useState("");
  const importAttempts = useRef(
    new Map<string, { key: string; started: number }>(),
  );
  const importKey = async (input: unknown) => {
    const fingerprint = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      JSON.stringify(input),
    );
    let attempt = importAttempts.current.get(fingerprint);
    if (attempt && Date.now() - attempt.started >= 23 * 60 * 60 * 1000) {
      setTransferError(
        "This import attempt expired. Check imported content before starting another import.",
      );
      throw new Error("Import attempt expired");
    }
    if (!attempt) {
      attempt = { key: Crypto.randomUUID(), started: Date.now() };
      importAttempts.current.set(fingerprint, attempt);
    }
    return attempt.key;
  };
  const finishImport = (key: string) => {
    for (const [fingerprint, value] of importAttempts.current)
      if (value.key === key) importAttempts.current.delete(fingerprint);
  };

  const transferInput = useRef({
    data: importText,
    format: importFormat,
    file: pageFile,
    pageFormat,
  });
  transferInput.current = {
    data: importText,
    format: importFormat,
    file: pageFile,
    pageFormat,
  };
  const taskPreviewInput = useRef<{
    data: string;
    format: TaskImportFormat;
  } | null>(null);
  const pagePreviewInput = useRef<{
    file: NonNullable<typeof pageFile>;
    format: typeof pageFormat;
  } | null>(null);

  const [chatKind, setChatKind] = useState<"slack" | "discord">("slack");
  const [chatUrl, setChatUrl] = useState("");
  const takePrefs = (p: PlannerPrefs) => {
    setNotices(noticePrefs(p));
    setCountBlocks(p.count_blocks_as_spent ?? false);
  };
  type ReadKind =
    | "planner"
    | "sessions"
    | "twoFactor"
    | "inbox"
    | "analytics"
    | "chat"
    | "status";
  const mounted = useRef(false);
  const owner = useRef(session.token);
  const writeLock = useRef(false);
  const busyReporter = useRef(onBusyChange);
  busyReporter.current = onBusyChange;
  const [writing, setWriting] = useState(false);
  const [pushStatus, setPushStatus] = useState("");
  const busy = parentBusy || writing;
  const act = async (operation: () => Promise<void>) => {
    if (
      writeLock.current ||
      parentBusy ||
      !mounted.current ||
      owner.current !== session.token
    )
      return;
    writeLock.current = true;
    busyReporter.current?.(true);
    setWriting(true);
    try {
      await parentAct(async () => {
        if (mounted.current && owner.current === session.token)
          await operation();
      });
    } finally {
      writeLock.current = false;
      if (mounted.current && owner.current === session.token) {
        setWriting(false);
        busyReporter.current?.(false);
      }
    }
  };
  const transferAct = (operation: () => Promise<void>) =>
    act(async () => {
      setTransferError("");
      try {
        await operation();
      } catch (error) {
        if (mounted.current && owner.current === session.token)
          setTransferError(
            (previous) =>
              previous || "Couldn't finish this transfer. Try again.",
          );
        throw error;
      }
    });
  const openTransfer = (mode: "export" | "tasks" | "pages") => {
    setTransferError("");
    setTransferMode(mode);
  };
  const readEpoch = useRef<Partial<Record<ReadKind, number>>>({});
  const [readErrors, setReadErrors] = useState<
    Partial<Record<ReadKind, boolean>>
  >({});
  const [readPending, setReadPending] = useState<
    Partial<Record<ReadKind, boolean>>
  >({});
  const read = useCallback(
    async <T,>(
      kind: ReadKind,
      operation: () => Promise<T>,
      commit: (value: T) => void,
    ) => {
      const epoch = (readEpoch.current[kind] ?? 0) + 1;
      readEpoch.current[kind] = epoch;
      setReadPending((value) => ({ ...value, [kind]: true }));
      try {
        const value = await operation();
        if (!mounted.current || readEpoch.current[kind] !== epoch) return false;
        commit(value);
        setReadErrors((previous) => ({ ...previous, [kind]: false }));
        return true;
      } catch {
        if (mounted.current && readEpoch.current[kind] === epoch)
          setReadErrors((value) => ({ ...value, [kind]: true }));
        return false;
      } finally {
        if (mounted.current && readEpoch.current[kind] === epoch)
          setReadPending((value) => ({ ...value, [kind]: false }));
      }
    },
    [],
  );
  const reload = useCallback(
    (kind: ReadKind) => {
      switch (kind) {
        case "planner":
          return read(
            kind,
            () => client.getPlannerPrefs(),
            (value) => {
              setNotices(noticePrefs(value));
              setCountBlocks(value.count_blocks_as_spent ?? false);
            },
          );
        case "sessions":
          return read(kind, () => client.listSessions(), setSessions);
        case "twoFactor":
          return read(
            kind,
            () => client.getTwoFactor(),
            (value) => setTfaOn(value.enabled),
          );
        case "inbox":
          return read(kind, () => client.getInbox(), setInbox);
        case "analytics":
          return read(kind, () => client.getAnalytics(30), setAnalytics);
        case "chat":
          return read(kind, () => client.getChat(), setChat);
        case "status":
          return read(
            kind,
            () => client.getStatus(),
            (value) => setStatusHeadline(statusHeadlines[value.state]),
          );
      }
    },
    [read],
  );
  useEffect(() => {
    mounted.current = true;
    for (const kind of [
      "planner",
      "sessions",
      "twoFactor",
      "inbox",
      "analytics",
      "chat",
      "status",
    ] as const)
      void reload(kind);
    return () => {
      mounted.current = false;
      busyReporter.current?.(false);
      readEpoch.current = {};
    };
  }, [reload]);
  const saveNotices = (input: PlannerPrefsInput) =>
    act(async () => {
      const value = await client.updatePlannerPrefs(input);
      if (mounted.current) takePrefs(value);
    });
  const loadSessions = () => reload("sessions");
  const recovery = (kind: ReadKind, label: string) =>
    readErrors[kind] ? (
      <View>
        <ErrorBanner error={`Couldn't load ${label}.`} />
        <Button
          title={`Retry ${label}`}
          secondary
          disabled={busy || !!readPending[kind]}
          onPress={() => void reload(kind)}
        />
      </View>
    ) : null;
  return (
    <SettingsWorkspace focus={focusValue} resetKey={category}>
      <View ref={contentRoot}>
        <View style={[shared.card, s.account]}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>
              {(user?.name[0] || "O").toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={s.nameRow}>
              <Text style={[s.prefTitle, { flexShrink: 1 }]}>{user?.name}</Text>
              {isAdmin && <Pill label="Admin" tone="accent" />}
            </View>
            <Text style={shared.small}>{user?.email}</Text>
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
              style={s.searchClear}
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

        <Pressable
          style={s.categoryPicker}
          accessibilityRole="button"
          accessibilityLabel={`Settings category: ${CATEGORIES.find((value) => value.id === category)?.label}`}
          accessibilityState={{ expanded: categoryPicker, disabled: busy }}
          disabled={busy}
          onPress={() => setCategoryPicker(true)}
        >
          <Text style={s.prefTitle}>
            {CATEGORIES.find((value) => value.id === category)?.label}
          </Text>
          <Icon name="chevronDown" size={18} color={colors.muted} />
        </Pressable>
        <ActionSheet
          visible={categoryPicker}
          label="Settings category"
          actions={CATEGORIES.map((value) => ({
            label: value.label,
            onPress: () => {
              setCategory(value.id);
              scrollTo?.(0);
            },
          }))}
          onClose={() => setCategoryPicker(false)}
        />
        {activityOpen && (
          <ActivitySheet onClose={() => setActivityOpen(false)} />
        )}
        <SettingsGroup category="account" selected={category}>
          <SettingsOverview>
            {/* Teams, Documents, Booking and the admin console are destinations on
          the desktop's sidebar, not settings; they live on Browse now, where
          the sidebar's other sections are. What is left here is what the
          desktop's Settings page also holds. */}
            <Text style={[shared.eyebrow, s.section]}>Workspace</Text>
            <View style={[shared.card, s.rows]}>
              <LinkRow
                icon="activity"
                title="Activity"
                detail="Completed tasks and focus time"
                onPress={() => setActivityOpen(true)}
              />
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
                detail="Device status and pending changes"
                onPress={onOpenSync}
              />
              {onOpenWhatsNew && (
                <SettingsAnchor name="What's new">
                  <LinkRow
                    divider
                    icon="sparkles"
                    title="What's new"
                    detail="Recent releases"
                    onPress={onOpenWhatsNew}
                  />
                </SettingsAnchor>
              )}
            </View>
          </SettingsOverview>
        </SettingsGroup>
        <SettingsGroup category="planning" selected={category}>
          <SettingsOverview>
            <Text style={[shared.eyebrow, s.section]}>Planning</Text>
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
                detail="Scheduled routines"
                onPress={onOpenHabits}
              />
            </View>
          </SettingsOverview>
        </SettingsGroup>
        <SettingsGroup category="account" selected={category}>
          <ChatgptModelsSection userId={user?.id ?? ""} />
        </SettingsGroup>
        <SettingsGroup category="assistants" selected={category}>
          <AgentWarmStartCards busy={busy} run={act} />
          <AssistantRulesSection userId={user?.id ?? ""} />
          <AssistantBudgetSection userId={user?.id ?? ""} />
        </SettingsGroup>
        <SettingsGroup category="planning" selected={category}>
          <SettingsOverview>
            {recovery("analytics", "time summary")}
            {recovery("planner", "planning preferences")}
            {analytics && analytics.planned_minutes > 0 && (
              <SettingsAnchor name="Where your time goes">
                <Text style={[shared.eyebrow, s.section]}>Time summary</Text>
                <View style={shared.card}>
                  <Text style={shared.body}>
                    {durationText(analytics.planned_minutes)} scheduled ·{" "}
                    {analytics.completed} task
                    {analytics.completed === 1 ? "" : "s"} finished in the last
                    30 days.
                  </Text>
                  <InlineDetails title="Time by list">
                    {analytics.by_list.map((l, i) => (
                      <View
                        key={`${l.name}:${i}`}
                        style={[s.analyticsRow, i > 0 && s.sessionDivider]}
                      >
                        <Text style={[shared.body, { flex: 1, minWidth: 0 }]}>
                          {l.name}
                        </Text>
                        <Text style={s.prefTitle}>
                          {durationText(l.minutes)}
                        </Text>
                      </View>
                    ))}
                  </InlineDetails>
                </View>
              </SettingsAnchor>
            )}

            {countBlocks !== null && (
              <>
                <Text style={[shared.eyebrow, s.section]}>Time tracking</Text>
                <View style={shared.card}>
                  <View style={s.preference}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.prefTitle}>
                        Count completed session time
                      </Text>
                      <Text style={shared.small}>
                        Past sessions count once toward time spent.
                      </Text>
                    </View>
                    <Switch
                      value={countBlocks}
                      disabled={
                        busy || !!readErrors.planner || !!readPending.planner
                      }
                      trackColor={{ true: colors.accent }}
                      accessibilityLabel="Count completed session time"
                      onValueChange={(value) =>
                        void saveNotices({ count_blocks_as_spent: value })
                      }
                    />
                  </View>
                </View>
              </>
            )}
          </SettingsOverview>
        </SettingsGroup>
        <SettingsGroup category="account" selected={category}>
          <SettingsSection title="Appearance">
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
          </SettingsSection>

          <SettingsSection title="Reading">
            <View style={s.preference}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.prefTitle}>Open pages for reading</Text>
                <Text style={shared.small}>Choose Edit to change a page.</Text>
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
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.prefTitle}>Hide the header while reading</Text>
                <Text style={shared.small}>Reappears when you scroll up.</Text>
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
              {preferencesError && <ErrorBanner error={preferencesError} />}
              {preferencesReady ? (
                <ArrangeList
                  arrangement={arrangement}
                  onChange={onArrange}
                  isAdmin={isAdmin}
                />
              ) : (
                <Text style={shared.small}>
                  {preferencesError
                    ? "Navigation preferences unavailable."
                    : "Loading navigation…"}
                </Text>
              )}
              {!preferencesReady && preferencesError && onReloadPreferences && (
                <Button
                  title="Retry preferences"
                  secondary
                  onPress={onReloadPreferences}
                />
              )}
            </SettingsSection>
          )}

          <SettingsSection title="Notifications">
            <View style={s.preference}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.prefTitle}>Email reminders</Text>
                <Text style={shared.small}>
                  Reminders before items are due.
                </Text>
              </View>
              <Switch
                value={user?.email_reminders}
                disabled={busy}
                trackColor={{ true: colors.accent }}
                accessibilityLabel="Email reminders"
                onValueChange={(value) =>
                  act(async () => {
                    const updated = await client.updatePreferences({
                      email_reminders: value,
                    });
                    if (mounted.current) onUser(updated);
                  })
                }
              />
            </View>
            {recovery("planner", "planner notices")}
            {notices && (
              <>
                <View style={s.divider} />
                <Text style={s.prefTitle}>Planner notices</Text>
                <Text style={[shared.small, s.prefText]}>
                  Rollovers, due tasks, risks and clashes also appear in your
                  inbox.
                </Text>
                {(["push", "email"] as const).map((channel) => (
                  <View
                    key={channel}
                    style={[s.preference, { marginBottom: 10 }]}
                  >
                    <Text style={[s.prefTitle, { flex: 1 }]}>
                      {channel === "push" ? "Push" : "Email"}
                    </Text>
                    <Switch
                      value={notices[channel]}
                      disabled={
                        busy || !!readErrors.planner || !!readPending.planner
                      }
                      trackColor={{ true: colors.accent }}
                      accessibilityLabel={`Planner notices by ${channel}`}
                      onValueChange={(value) =>
                        void saveNotices({
                          planner_notices: { [channel]: value },
                        })
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
                          n === 0
                            ? "Off"
                            : `${n} day${n === 1 ? "" : "s"} before`
                        }
                        disabled={
                          busy || !!readErrors.planner || !!readPending.planner
                        }
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
                  if (mounted.current && owner.current === session.token)
                    setPushStatus("Push notifications enabled on this device.");
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
                  if (mounted.current && owner.current === session.token)
                    setPushStatus(
                      "Push notifications disabled on this device.",
                    );
                })
              }
            />
            {!!pushStatus && (
              <Text accessibilityRole="text" style={shared.small}>
                {pushStatus}
              </Text>
            )}
          </SettingsSection>

          <SettingsSection title="Two-step verification">
            {recovery("twoFactor", "two-step status")}
            {tfaOn === null && !readErrors.twoFactor && (
              <Text style={shared.small}>Loading two-step status…</Text>
            )}
            <Text style={shared.body}>
              Ask for a code from an authenticator app at sign-in, on top of
              your password.
            </Text>
            {tfaCodes ? (
              <View style={{ marginTop: 12 }}>
                <Text style={s.prefTitle}>Save your recovery codes</Text>
                <Text style={shared.small}>
                  Each works once if you lose your authenticator, and they won’t
                  be shown again.
                </Text>
                {tfaCodes.map((c) => (
                  <Text key={c} style={s.recoveryCode}>
                    {c}
                  </Text>
                ))}
                <Button
                  secondary
                  title="I’ve saved them"
                  disabled={
                    busy || !!readErrors.twoFactor || !!readPending.twoFactor
                  }
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
                    editable={!busy}
                    value={tfaPassword}
                    onChangeText={setTfaPassword}
                    accessibilityLabel="Password to turn off two-step"
                  />
                  <Button
                    destructive
                    title="Turn off two-step"
                    disabled={
                      busy ||
                      !!readErrors.twoFactor ||
                      !!readPending.twoFactor ||
                      !tfaPassword
                    }
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
                  disabled={
                    busy || !!readErrors.twoFactor || !!readPending.twoFactor
                  }
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
                  editable={!busy}
                  value={tfaCode}
                  onChangeText={setTfaCode}
                  keyboardType="number-pad"
                  maxLength={6}
                  accessibilityLabel="Authenticator code"
                />
                <Button
                  title="Turn on"
                  disabled={
                    busy ||
                    !!readErrors.twoFactor ||
                    !!readPending.twoFactor ||
                    !/^\d{6}$/.test(tfaCode)
                  }
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
                disabled={
                  busy ||
                  !!readErrors.twoFactor ||
                  !!readPending.twoFactor ||
                  tfaOn === null
                }
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
            {recovery("sessions", "signed-in devices")}
            {sessions === null && !readErrors.sessions && (
              <Text style={shared.small}>Loading devices…</Text>
            )}
            {sessions?.length === 0 && (
              <Text style={shared.small}>No signed-in devices.</Text>
            )}
            {sessions && sessions.length > 6 && (
              <TextInput
                style={shared.input}
                accessibilityLabel="Search signed-in devices"
                placeholder="Search devices"
                placeholderTextColor={colors.faint}
                value={sessionQuery}
                onChangeText={(value) => {
                  setSessionQuery(value);
                  setAllSessions(false);
                }}
              />
            )}
            {sessions && sessionQuery.trim() && !matchedSessions.length && (
              <Text style={shared.small}>No matching devices.</Text>
            )}
            {matchedSessions
              .slice(0, allSessions ? undefined : 6)
              .map((sess, i) => (
                <View
                  key={sess.id}
                  style={[s.sessionRow, i > 0 && s.sessionDivider]}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
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
                      disabled={
                        busy || !!readErrors.sessions || !!readPending.sessions
                      }
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
            {matchedSessions.length > 6 && (
              <Button
                title={
                  allSessions
                    ? "Show fewer devices"
                    : `Show all ${matchedSessions.length} devices`
                }
                secondary
                onPress={() => setAllSessions(!allSessions)}
              />
            )}
            {(sessions ?? []).some((x) => !x.current) && (
              <Button
                secondary
                title="Sign out everywhere else"
                icon="logOut"
                disabled={
                  busy || !!readErrors.sessions || !!readPending.sessions
                }
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
        </SettingsGroup>
        <SettingsGroup category="connections" selected={category}>
          <SettingsOverview>
            <View style={[shared.card, s.rows]}>
              <LinkRow
                icon="link"
                title="Connected apps"
                detail="Agents, API keys and calendar feed"
                onPress={onOpenConnections}
              />
            </View>
          </SettingsOverview>
          <ChatDeliverySection
            channel={chat}
            kind={chatKind}
            url={chatUrl}
            onKind={setChatKind}
            onUrl={setChatUrl}
            busy={busy}
            unavailable={!!readErrors.chat || !!readPending.chat}
            recovery={recovery("chat", "chat delivery")}
            act={act}
            onChanged={(value) => {
              if (!mounted.current || owner.current !== session.token) return;
              readEpoch.current.chat = (readEpoch.current.chat ?? 0) + 1;
              setReadPending((previous) => ({ ...previous, chat: false }));
              setReadErrors((previous) => ({ ...previous, chat: false }));
              setChat(value);
            }}
          />

          <EmailToTaskSection
            inbox={inbox}
            busy={busy}
            unavailable={!!readErrors.inbox || !!readPending.inbox}
            recovery={recovery("inbox", "email-to-task settings")}
            act={act}
            onChanged={(value) => {
              if (!mounted.current || owner.current !== session.token) return;
              readEpoch.current.inbox = (readEpoch.current.inbox ?? 0) + 1;
              setReadPending((previous) => ({ ...previous, inbox: false }));
              setReadErrors((previous) => ({ ...previous, inbox: false }));
              setInbox(value);
            }}
          />

          <SettingsSection title="Import & export">
            <View style={s.importRow}>
              <SmallAction
                label="Export"
                disabled={busy}
                onPress={() => openTransfer("export")}
              />
              <SmallAction
                label={importText ? "Import tasks · Draft" : "Import tasks"}
                disabled={busy}
                onPress={() => openTransfer("tasks")}
              />
              <SmallAction
                label={pageFile ? "Import pages · File ready" : "Import pages"}
                disabled={busy}
                onPress={() => openTransfer("pages")}
              />
            </View>
            <BottomSheet
              visible={transferMode !== null}
              title={
                transferMode === "export"
                  ? "Export your data"
                  : transferMode === "tasks"
                    ? "Import tasks"
                    : "Import pages"
              }
              closeDisabled={busy}
              onClose={() => {
                if (!writeLock.current) setTransferMode(null);
              }}
            >
              <ErrorBanner error={transferError} />
              {busy && (
                <Text style={shared.small} accessibilityLiveRegion="polite">
                  {transferMode === "export"
                    ? "Preparing export…"
                    : "Processing import…"}
                </Text>
              )}
              <View
                style={
                  transferMode === "export" ? { gap: 8 } : { display: "none" }
                }
              >
                <Button
                  secondary
                  title="Export everything (.zip)"
                  disabled={busy}
                  style={{ marginTop: 12, marginBottom: 0 }}
                  onPress={() =>
                    void transferAct(async () => {
                      const { blob, name } = await client.exportArchive();
                      if (!mounted.current || owner.current !== session.token)
                        return;
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
                    void transferAct(async () => {
                      const archive = await client.exportData();
                      if (mounted.current && owner.current === session.token)
                        setExported(JSON.stringify(archive, null, 2));
                    })
                  }
                />
                {!!exported && (
                  <InlineDetails title="JSON export">
                    <TextInput
                      style={[shared.input, s.exportBox]}
                      value={exported}
                      multiline
                      editable={false}
                      selectTextOnFocus
                      accessibilityLabel="JSON export"
                    />
                  </InlineDetails>
                )}
              </View>
              <View
                style={
                  transferMode === "tasks" ? { gap: 8 } : { display: "none" }
                }
              >
                <Text style={shared.small}>
                  Preview the selected file or pasted data before importing.
                </Text>
                <View style={{ marginTop: 8 }}>
                  <Segmented
                    accessibilityLabel="Import format"
                    disabled={busy}
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
                      taskPreviewInput.current = null;
                    }}
                  />
                </View>
                <TextInput
                  style={[shared.input, s.exportBox, { marginTop: 10 }]}
                  value={importText}
                  accessibilityLabel="Task import data"
                  editable={!busy}
                  multiline
                  placeholder="Paste a CSV (with a title column) or an Orbyn export"
                  placeholderTextColor={colors.faint}
                  onChangeText={(t) => {
                    setImportText(t);
                    setImportPreview(null);
                    taskPreviewInput.current = null;
                  }}
                />
                <View style={s.importRow}>
                  <SmallAction
                    label="Choose a file…"
                    disabled={busy}
                    onPress={() =>
                      void transferAct(async () => {
                        const file = await pickFileText([
                          "text/csv",
                          "text/comma-separated-values",
                          "application/json",
                          "text/plain",
                        ]);
                        if (
                          !file ||
                          !mounted.current ||
                          owner.current !== session.token
                        )
                          return;
                        setImportText(file.text);
                        setImportFormat(
                          /\.csv$/i.test(file.name)
                            ? csvFormat(file.text)
                            : "orbyn",
                        );
                        setImportPreview(null);
                        taskPreviewInput.current = null;
                      })
                    }
                  />
                  <SmallAction
                    label="Preview"
                    disabled={busy || !importText.trim()}
                    onPress={() =>
                      void transferAct(async () => {
                        const target = {
                          format: importFormat,
                          data: importText,
                        };
                        const result = await client.importData({
                          ...target,
                          dry_run: true,
                        });
                        if (
                          mounted.current &&
                          owner.current === session.token &&
                          transferInput.current.data === target.data &&
                          transferInput.current.format === target.format
                        ) {
                          taskPreviewInput.current = target;
                          setImportPreview(result);
                        }
                      })
                    }
                  />
                  {importPreview && importPreview.created > 0 && (
                    <SmallAction
                      label={`Import ${importPreview.created}`}
                      disabled={busy}
                      onPress={() =>
                        void transferAct(async () => {
                          const target = taskPreviewInput.current;
                          if (
                            !target ||
                            transferInput.current.data !== target.data ||
                            transferInput.current.format !== target.format
                          ) {
                            setTransferError(
                              "Preview this data before importing.",
                            );
                            return;
                          }
                          const input = { ...target, dry_run: false };
                          const key = await importKey(input);
                          if (
                            !mounted.current ||
                            owner.current !== session.token
                          )
                            return;
                          const done = await client.once(key, () =>
                            client.importData(input),
                          );
                          if (
                            !mounted.current ||
                            owner.current !== session.token
                          )
                            return;
                          finishImport(key);
                          setTasksDone(
                            `Imported ${pagesText(done.created, "item")}${done.skipped ? ` · ${done.skipped} skipped` : ""}.`,
                          );
                          setImportText("");
                          setImportPreview(null);
                          taskPreviewInput.current = null;
                        })
                      }
                    />
                  )}
                </View>
                {!!tasksDone && (
                  <Text style={shared.small} accessibilityLiveRegion="polite">
                    {tasksDone}
                  </Text>
                )}
                {importPreview && (
                  <Text style={[shared.small, { marginTop: 8 }]}>
                    {importPreview.created} item
                    {importPreview.created === 1 ? "" : "s"},{" "}
                    {importPreview.lists_added} new list
                    {importPreview.lists_added === 1 ? "" : "s"},{" "}
                    {importPreview.tags_added} new tag
                    {importPreview.tags_added === 1 ? "" : "s"}
                    {importPreview.skipped
                      ? `, ${importPreview.skipped} skipped`
                      : ""}
                    .
                  </Text>
                )}

                {!!importPreview?.errors.length && (
                  <InlineDetails title="Import issues">
                    {importPreview.errors.map((issue, index) => (
                      <Text key={index} style={shared.small}>
                        {issue}
                      </Text>
                    ))}
                  </InlineDetails>
                )}
              </View>
              <View
                style={
                  transferMode === "pages" ? { gap: 8 } : { display: "none" }
                }
              >
                <Text style={[shared.small, { marginTop: 4 }]}>
                  Folders and links stay. Notion databases become projects.
                </Text>
                <View style={{ marginTop: 8 }}>
                  <Segmented
                    accessibilityLabel="Pages from"
                    disabled={busy}
                    options={["markdown", "notion"] as const}
                    labels={{ markdown: "Markdown", notion: "Notion" }}
                    value={pageFormat}
                    onChange={(f) => {
                      setPageFormat(f);
                      setPagePreview(null);
                      pagePreviewInput.current = null;
                    }}
                  />
                </View>
                <View style={s.importRow}>
                  <SmallAction
                    label={pageFile ? pageFile.name : "Choose a file…"}
                    disabled={busy}
                    onPress={() =>
                      void transferAct(async () => {
                        const file = await pickFileBase64([
                          "application/zip",
                          "application/x-zip-compressed",
                          "text/markdown",
                          "text/plain",
                          "*/*",
                        ]);
                        if (
                          !file ||
                          !mounted.current ||
                          owner.current !== session.token
                        )
                          return;
                        setPageFile({ name: file.name, data: file.data });
                        setPagePreview(null);
                        pagePreviewInput.current = null;
                        setPagesDone("");
                      })
                    }
                  />
                  <SmallAction
                    label="Preview"
                    disabled={busy || !pageFile}
                    onPress={() =>
                      void transferAct(async () => {
                        const target = { file: pageFile, format: pageFormat };
                        if (!target.file) return;
                        const result = await client.importPages({
                          format: target.format,
                          file_name: target.file.name,
                          data: target.file.data,
                          dry_run: true,
                        });
                        if (
                          mounted.current &&
                          owner.current === session.token &&
                          transferInput.current.file === target.file &&
                          transferInput.current.pageFormat === target.format
                        ) {
                          pagePreviewInput.current = {
                            ...target,
                            file: target.file,
                          };
                          setPagePreview(result);
                        }
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
                          void transferAct(async () => {
                            const target = pagePreviewInput.current;
                            if (
                              !target ||
                              transferInput.current.file !== target.file ||
                              transferInput.current.pageFormat !== target.format
                            ) {
                              setTransferError(
                                "Preview this file before importing.",
                              );
                              return;
                            }
                            const input = {
                              format: target.format,
                              file_name: target.file.name,
                              data: target.file.data,
                              dry_run: false,
                            };
                            const key = await importKey(input);
                            if (
                              !mounted.current ||
                              owner.current !== session.token
                            )
                              return;
                            const done = await client.once(key, () =>
                              client.importPages(input),
                            );
                            if (
                              !mounted.current ||
                              owner.current !== session.token
                            )
                              return;
                            finishImport(key);
                            if (done.errors.length) {
                              setPagePreview(done);
                              pagePreviewInput.current = null;
                              throw new Error(
                                "Pages weren’t imported. Review the import issues.",
                              );
                            }
                            setPagePreview(null);
                            pagePreviewInput.current = null;
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
                      <Text style={shared.small}>
                        {describePages(pagePreview)}.
                      </Text>
                    )}
                    {(pagePreview.sample.length > 0 ||
                      pagePreview.left_out.length > 0) && (
                      <InlineDetails title="Import details">
                        {pagePreview.sample.length > 0 && (
                          <Text style={shared.small}>
                            Examples: {pagePreview.sample.join(", ")}
                          </Text>
                        )}
                        {pagePreview.left_out.length > 0 && (
                          <Text style={shared.small}>
                            Excluded: {pagePreview.left_out.join(", ")}
                          </Text>
                        )}
                      </InlineDetails>
                    )}
                    {pagePreview.errors.map((e, i) => (
                      <Text
                        key={i}
                        style={[shared.small, { color: colors.danger }]}
                      >
                        {e}
                      </Text>
                    ))}
                  </View>
                )}
                {!!pagesDone && (
                  <Text style={[shared.small, { marginTop: 8 }]}>
                    {pagesDone}
                  </Text>
                )}
              </View>
            </BottomSheet>
          </SettingsSection>
        </SettingsGroup>
        <SettingsGroup category="privacy" selected={category}>
          <PrivacySection
            email={user?.email ?? ""}
            busy={busy}
            act={act}
            onDeleted={onAccountDeleted}
          />
        </SettingsGroup>
        <SettingsGroup category="account" selected={category}>
          <SettingsOverview>
            <Button
              destructive
              title="Sign out"
              disabled={busy}
              onPress={onSignOut}
              style={s.signOut}
            />
          </SettingsOverview>
        </SettingsGroup>
      </View>
    </SettingsWorkspace>
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
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.prefTitle}>{title}</Text>
        <Text style={shared.small}>{detail}</Text>
      </View>
      <Icon name="chevronRight" size={18} color={colors.faint} />
    </Pressable>
  );
}

const s = themed(() =>
  StyleSheet.create({
    nameRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
    },
    rows: { padding: 0, overflow: "hidden" },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 44,
      paddingVertical: 8,
      paddingHorizontal: 12,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    rowIcon: {
      width: 20,
      height: 20,
      alignItems: "center",
      justifyContent: "center",
    },
    account: { flexDirection: "row", alignItems: "center", gap: 14 },
    avatar: {
      width: 32,
      height: 32,
      borderRadius: radii.pill,
      backgroundColor: colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      fontFamily: fonts.display,
      fontSize: 18,
      color: colors.accent,
    },
    section: {
      marginTop: 8,
      fontSize: 13,
      letterSpacing: 0,
      textTransform: "none",
    },
    preference: { flexDirection: "row", alignItems: "center", gap: 16 },
    analyticsRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 12,
      paddingVertical: 6,
    },
    sessionRow: {
      flexDirection: "row",
      flexWrap: "wrap",
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
      fontSize: inputFontSize,
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
      paddingVertical: 0,
      marginTop: 12,
    },
    searchClear: {
      minHeight: 44,
      minWidth: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    searchInput: {
      flex: 1,
      minHeight: 44,
      minWidth: 0,
      fontFamily: fonts.regular,
      fontSize: inputFontSize,
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
    categoryPicker: {
      minHeight: 44,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginVertical: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 8,
    },
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
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [removing, setRemoving] = useState<Passkey | null>(null);
  const mounted = useRef(false);
  const request = useRef(0);
  const load = useCallback(async () => {
    const epoch = ++request.current;
    setLoading(true);
    try {
      const value = await client.listPasskeys();
      if (mounted.current && epoch === request.current) {
        setKeys(value);
        setFailed(false);
      }
    } catch {
      if (mounted.current && epoch === request.current) setFailed(true);
    } finally {
      if (mounted.current && epoch === request.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, [load]);
  return (
    <>
      <ActionSheet
        visible={!!removing}
        label="Remove passkey"
        title={`Remove “${removing?.name ?? "passkey"}”?`}
        message="You won't be able to sign in with it again."
        onClose={() => setRemoving(null)}
        actions={[
          {
            label: "Remove passkey",
            destructive: true,
            disabled: busy || loading || failed,
            onPress: () => {
              if (removing && mounted.current)
                void act(async () => {
                  if (!mounted.current) return;
                  await client.deletePasskey(removing.id);
                  if (mounted.current) await load();
                });
            },
          },
        ]}
      />
      <Text style={shared.body}>
        Sign in with Face ID, Touch ID or a security key instead of your
        password.
      </Text>
      {failed && (
        <View>
          <ErrorBanner error="Couldn't refresh passkeys." />
          <Button
            title="Retry passkeys"
            secondary
            disabled={busy || loading}
            onPress={() => void load()}
          />
        </View>
      )}
      {keys === null && !failed ? (
        <Text style={[shared.small, { marginTop: 8 }]}>Loading…</Text>
      ) : keys?.length === 0 ? (
        <Text style={[shared.small, { marginTop: 8 }]}>No passkeys yet.</Text>
      ) : (
        keys?.map((k, i) => (
          <View key={k.id} style={[s.sessionRow, i > 0 && s.sessionDivider]}>
            <View style={{ flex: 1, minWidth: 0 }}>
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
              disabled={busy || loading || failed}
              onPress={() => {
                if (!busy && !loading && !failed) setRemoving(k);
              }}
            />
          </View>
        ))
      )}
      <Button
        title="Add a passkey"
        secondary
        disabled={busy || loading || failed}
        style={{ marginTop: 12, marginBottom: 0 }}
        onPress={() =>
          void act(async () => {
            await WebBrowser.openBrowserAsync(`${webOrigin}/app`);
            if (mounted.current) await load();
          })
        }
      />
      <Text style={[shared.small, { marginTop: 6 }]}>
        Opens web Settings → Account → Passkeys.
      </Text>
    </>
  );
}
