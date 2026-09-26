import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  hasSystemPermission,
  type AdminOverview,
  type AdminUser,
  type AuditEntry,
  type Maintenance,
  type Team,
  type User,
} from "@orbyn/core";
import { Button } from "../components/Button";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import type { Editing } from "../components/ItemEditor";
import { Pill } from "../components/Pill";
import { Segmented } from "../components/Segmented";
import { Sheet, sheetStyles } from "../components/Sheet";
import { SmallAction } from "../components/SmallAction";
import { TeamList } from "../components/TeamList";
import { client } from "../lib/api";
import { FadeIn } from "../motion";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";
import { AdminAgents } from "./AdminAgents";
import { AdminAi } from "./AdminAi";
import { LegalCard } from "./AdminLegal";
import { AdminDatabase } from "./AdminDatabase";
import { AdminStorage } from "./AdminStorage";
import {
  AdminAccount,
  AdminAnalyticsView,
  AdminRequests,
  AnnouncementCard,
  RetentionCard,
} from "./AdminInsights";
import { MoreMenu } from "../components/MoreMenu";
import { confirmAction } from "../lib/confirm";
import { AdminSystem } from "./AdminSystem";
import { TeamDetailPage } from "./TeamDetail";

type Act = (fn: () => Promise<void>) => Promise<void>;
type Segment =
  | "overview"
  | "analytics"
  | "requests"
  | "users"
  | "teams"
  | "audit"
  | "database"
  | "storage"
  | "ai"
  | "agents"
  | "system";

const SEGMENTS: Segment[] = ["overview", "users", "teams", "audit"];
const SEGMENT_LABELS = {
  analytics: "Analytics",
  requests: "Requests",
  database: "Database",
  storage: "Storage",
  ai: "AI",
  agents: "Agents",
  system: "System",
} as const;
const AUDIT_PAGE = 30;

/**
 * System-admin console. Only rendered for users with `admin:access`; the
 * backend enforces every permission regardless.
 */
export function AdminSheet({
  visible,
  user,
  busy,
  error,
  clearError,
  act,
  refresh,
  onClose,
  onDismiss,
  onOpenItem,
  onMaintenance,
}: {
  visible: boolean;
  user: User | null;
  busy: boolean;
  error: string;
  clearError: () => void;
  act: Act;
  refresh: () => Promise<void>;
  onClose: () => void;
  onDismiss?: () => void;
  onOpenItem: (editing: Editing) => void;
  /** New maintenance state after an admin switches it, for the app banner. */
  onMaintenance: (m: Maintenance) => void;
}) {
  const [segment, setSegment] = useState<Segment>("overview");
  const [team, setTeam] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const canManageAi = hasSystemPermission(user?.role, "ai:manage");
  const canManageSystem = hasSystemPermission(user?.role, "system:manage");
  const segments: Segment[] = [
    ...SEGMENTS,
    ...(hasSystemPermission(user?.role, "analytics:read")
      ? (["analytics"] as const)
      : []),
    ...(hasSystemPermission(user?.role, "requests:read")
      ? (["requests"] as const)
      : []),
    // The database is shown to those who run the system, as on the desktop.
    ...(canManageSystem ? (["database", "storage"] as const) : []),
    ...(canManageAi ? (["ai"] as const) : []),
    // Outside agents (MCP): the switches need system:manage, as on the web.
    ...(canManageSystem ? (["agents", "system"] as const) : []),
  ];
  const banner = <ErrorBanner error={error} onDismiss={clearError} />;
  const close = () => {
    setTeam(null);
    clearError();
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      title={team ? "Team" : "Admin console"}
      onClose={close}
      onBack={team ? () => setTeam(null) : undefined}
      onDismiss={onDismiss}
    >
      {team ? (
        <TeamDetailPage
          key={team}
          teamId={team}
          user={user}
          busy={busy}
          act={act}
          banner={banner}
          onGone={() => setTeam(null)}
          onChanged={refresh}
          onOpenItem={onOpenItem}
        />
      ) : (
        <ScrollView
          contentContainerStyle={sheetStyles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
        >
          <View style={sheetStyles.column}>
            {banner}
            <Segmented
              accessibilityLabel="Admin section"
              options={segments}
              labels={SEGMENT_LABELS}
              // Five or more segments truncate "Overview" as a fixed row; let them flow.
              wrap={segments.length > SEGMENTS.length}
              value={segment}
              onChange={setSegment}
            />
            <View style={s.spacer} />
            {segment === "overview" && <Overview act={act} />}
            {segment === "analytics" && <AdminAnalyticsView act={act} />}
            {segment === "requests" && <AdminRequests act={act} busy={busy} />}
            {segment === "users" &&
              (account ? (
                <AdminAccount
                  key={account}
                  userId={account}
                  meId={user?.id}
                  act={act}
                  busy={busy}
                  onBack={() => setAccount(null)}
                />
              ) : (
                <Users
                  act={act}
                  busy={busy}
                  me={user}
                  onChanged={refresh}
                  onOpen={setAccount}
                />
              ))}
            {segment === "teams" && (
              <Teams act={act} onSelect={(t) => setTeam(t.id)} />
            )}
            {segment === "audit" && <Audit act={act} busy={busy} />}
            {segment === "database" && canManageSystem && (
              <AdminDatabase act={act} busy={busy} meId={user?.id} />
            )}
            {segment === "storage" && canManageSystem && (
              <AdminStorage act={act} busy={busy} />
            )}
            {segment === "ai" && canManageAi && (
              <AdminAi act={act} busy={busy} />
            )}
            {segment === "agents" && canManageSystem && (
              <AdminAgents act={act} busy={busy} />
            )}
            {segment === "system" && canManageSystem && (
              <>
                <AdminSystem
                  act={act}
                  busy={busy}
                  onMaintenance={onMaintenance}
                />
                <View style={s.spacer} />
                <AnnouncementCard act={act} busy={busy} />
                <View style={s.spacer} />
                <LegalCard act={act} busy={busy} />
                <View style={s.spacer} />
                <RetentionCard act={act} busy={busy} />
              </>
            )}
          </View>
        </ScrollView>
      )}
    </Sheet>
  );
}

function Overview({ act }: { act: Act }) {
  const [data, setData] = useState<AdminOverview | null>(null);
  useEffect(() => {
    void act(async () => setData(await client.adminOverview()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!data) return <Text style={shared.small}>Loading overview…</Text>;
  const stats = [
    { label: "Users", value: data.users },
    { label: "Admins", value: data.admins },
    { label: "Disabled users", value: data.disabled_users },
    { label: "Teams", value: data.teams },
    { label: "Plans", value: data.items },
    { label: "Open plans", value: data.open_items },
    { label: "Notifications pending", value: data.notifications_pending },
    { label: "Notifications failed", value: data.notifications_failed },
  ];
  return (
    <View style={s.grid}>
      {stats.map((stat, n) => (
        <FadeIn key={stat.label} index={n} style={s.tile}>
          <Text style={s.tileValue}>{stat.value}</Text>
          <Text style={shared.small}>{stat.label}</Text>
        </FadeIn>
      ))}
    </View>
  );
}

function Users({
  act,
  busy,
  me,
  onChanged,
  onOpen,
}: {
  act: Act;
  busy: boolean;
  me: User | null;
  onChanged: () => Promise<void>;
  /** Open one account with everything an admin can do for it. */
  onOpen: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    const page = await client.adminListUsers({ search, limit: 100 });
    setRows(page.rows);
    setTotal(page.total);
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(() => void act(load), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const run = (fn: () => Promise<unknown>) =>
    act(async () => {
      await fn();
      await load();
      await onChanged();
    });

  // confirmAction rather than Alert: Alert does nothing in the web build.
  const remove = (u: AdminUser) =>
    confirmAction(
      "Delete this account?",
      `${u.email} and their personal plans are removed permanently.`,
      "Delete",
      () => void run(() => client.adminDeleteUser(u.id)),
    );

  return (
    <>
      <View style={s.search}>
        <View style={s.searchIcon} pointerEvents="none">
          <Icon name="search" size={17} color={colors.muted} />
        </View>
        <TextInput
          style={[shared.input, s.searchInput]}
          placeholder="Search name or email…"
          placeholderTextColor={colors.faint}
          value={search}
          onChangeText={setSearch}
          // The server searches up to 100 characters.
          maxLength={100}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
          accessibilityLabel="Search users"
        />
      </View>
      <Text style={[shared.small, s.caption]}>
        {rows.length === total
          ? `${total} user${total === 1 ? "" : "s"}`
          : `Showing ${rows.length} of ${total} users`}
      </Text>
      <View style={s.list}>
        {rows.map((u, n) => {
          const self = u.id === me?.id;
          return (
            <FadeIn
              key={u.id}
              index={n}
              style={[s.userRow, n > 0 && s.divider]}
            >
              <View style={s.userTop}>
                <Pressable
                  style={{ flex: 1 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${u.name}`}
                  onPress={() => onOpen(u.id)}
                >
                  <Text style={s.userName} numberOfLines={1}>
                    {u.name}
                    {self ? " (you)" : ""}
                  </Text>
                  <Text style={shared.small} numberOfLines={1}>
                    {u.email}
                  </Text>
                  <Text style={shared.small} numberOfLines={1}>
                    {u.team_count} team{u.team_count === 1 ? "" : "s"} ·{" "}
                    {u.item_count} plan{u.item_count === 1 ? "" : "s"}
                  </Text>
                </Pressable>
                <View style={s.pills}>
                  <Pill
                    label={u.role === "admin" ? "Admin" : "Member"}
                    tone={u.role === "admin" ? "accent" : "muted"}
                  />
                  {u.disabled && <Pill label="Disabled" tone="danger" />}
                </View>
                <MoreMenu
                  label={`${u.name} options`}
                  disabled={busy}
                  actions={[
                    { label: "Open account", onPress: () => onOpen(u.id) },
                    ...(self
                      ? []
                      : [
                          {
                            label:
                              u.role === "admin" ? "Make member" : "Make admin",
                            onPress: () =>
                              void run(() =>
                                client.adminUpdateUser(u.id, {
                                  role: u.role === "admin" ? "member" : "admin",
                                }),
                              ),
                          },
                          {
                            label: u.disabled ? "Enable" : "Disable",
                            destructive: !u.disabled,
                            onPress: () =>
                              void run(() =>
                                client.adminUpdateUser(u.id, {
                                  disabled: !u.disabled,
                                }),
                              ),
                          },
                          {
                            label: "Delete account",
                            destructive: true,
                            onPress: () => remove(u),
                          },
                        ]),
                  ]}
                />
              </View>
            </FadeIn>
          );
        })}
      </View>
    </>
  );
}

function Teams({ act, onSelect }: { act: Act; onSelect: (t: Team) => void }) {
  const [teams, setTeams] = useState<Team[] | null>(null);
  useEffect(() => {
    void act(async () => setTeams(await client.adminListTeams()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!teams) return <Text style={shared.small}>Loading teams…</Text>;
  if (!teams.length)
    return <Text style={shared.small}>No teams in this workspace yet.</Text>;
  return <TeamList teams={teams} onSelect={onSelect} />;
}

function Audit({ act, busy }: { act: Act; busy: boolean }) {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);

  /** Guards Load more against a second tap while a page is still loading. */
  const loading = useRef(false);
  const loadMore = (offset: number) => {
    if (loading.current) return Promise.resolve();
    loading.current = true;
    return act(async () => {
      const page = await client.adminListAudit({ limit: AUDIT_PAGE, offset });
      setRows((prev) => (offset === 0 ? page.rows : [...prev, ...page.rows]));
      setTotal(page.total);
      setLoaded(true);
    }).finally(() => {
      loading.current = false;
    });
  };

  useEffect(() => {
    void loadMore(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!loaded) return <Text style={shared.small}>Loading activity…</Text>;
  if (!rows.length) return <Text style={shared.small}>No activity yet.</Text>;
  return (
    <>
      <View style={s.list}>
        {rows.map((a, n) => (
          <FadeIn key={a.id} index={n} style={[s.auditRow, n > 0 && s.divider]}>
            <Text style={s.auditAction}>{a.action}</Text>
            <Text style={shared.body} numberOfLines={2}>
              {auditTarget(a)}
            </Text>
            <Text style={shared.small} numberOfLines={1}>
              {a.actor_email ?? "System"} ·{" "}
              {new Date(a.created_at).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </Text>
          </FadeIn>
        ))}
      </View>
      {rows.length < total && (
        <Button
          secondary
          title="Load more"
          disabled={busy}
          onPress={() => loadMore(rows.length)}
        />
      )}
    </>
  );
}

/** "user · ada@example.com", falling back to a short id. */
function auditTarget(a: AuditEntry) {
  const d = a.details as Record<string, unknown>;
  const label =
    (typeof d.email === "string" && d.email) ||
    (typeof d.name === "string" && d.name) ||
    (a.target_id ? a.target_id.slice(0, 8) : "");
  return label ? `${a.target_type} · ${label}` : a.target_type;
}

const s = themed(() =>
  StyleSheet.create({
    spacer: { height: 18 },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    tile: {
      flexGrow: 1,
      flexBasis: "45%",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      padding: 16,
    },
    tileValue: {
      fontFamily: fonts.display,
      fontSize: 26,
      color: colors.text,
      marginBottom: 2,
    },
    search: { marginBottom: 10, justifyContent: "center" },
    searchIcon: { position: "absolute", left: 15, zIndex: 1 },
    searchInput: { paddingLeft: 42 },
    caption: { marginBottom: 10 },
    list: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      overflow: "hidden",
      marginBottom: 16,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    userRow: { paddingVertical: 14, paddingHorizontal: 16, gap: 10 },
    userTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
    userName: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
      marginBottom: 1,
    },
    pills: { gap: 5, alignItems: "flex-end" },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    auditRow: { paddingVertical: 13, paddingHorizontal: 16, gap: 2 },
    auditAction: {
      fontFamily: fonts.semibold,
      fontSize: 14,
      color: colors.text,
    },
  }),
);
