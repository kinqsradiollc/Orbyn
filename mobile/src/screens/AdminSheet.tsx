import React, { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
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
import { InlineDetails } from "../components/InlineDetails";
import { Icon } from "../components/Icon";
import type { Editing } from "../components/ItemEditor";
import { Pill } from "../components/Pill";
import { ActionSheet } from "../components/MoreMenu";
import { Sheet, sheetStyles } from "../components/Sheet";
import { SmallAction } from "../components/SmallAction";
import { TeamList } from "../components/TeamList";
import { client } from "../lib/api";
import { Pressable } from "../motion";
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
import { session } from "../lib/session";
import { errorText } from "../lib/errors";
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
  overview: "Overview",
  users: "Users",
  teams: "Teams",
  audit: "Audit log",
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
export function AdminSheet(props: Parameters<typeof AdminBody>[0]) {
  return (
    <AdminBody key={`${session.token}:${props.user?.id ?? ""}`} {...props} />
  );
}
function AdminBody({
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
  const [sectionsOpen, setSectionsOpen] = useState(false);
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
  const selected = segments.includes(segment) ? segment : "overview";
  const banner = <ErrorBanner error={error} onDismiss={clearError} />;
  const teamDepartureOwner = useRef(session.token).current;
  const teamDepartureAlive = useRef(true);
  useEffect(() => {
    teamDepartureAlive.current = true;
    return () => {
      teamDepartureAlive.current = false;
    };
  }, []);
  const teamBeforeLeave = useRef<(() => Promise<boolean>) | null>(null);
  const [teamWriting, setTeamWriting] = useState(false);
  const departTeam = (action: () => void) => {
    if (teamWriting || busy) return;
    void (async () => {
      if (
        (!teamBeforeLeave.current || (await teamBeforeLeave.current())) &&
        teamDepartureAlive.current &&
        session.token === teamDepartureOwner
      )
        action();
    })();
  };
  const close = () =>
    departTeam(() => {
      setTeam(null);
      setSectionsOpen(false);
      clearError();
      onClose();
    });

  return (
    <Sheet
      visible={visible}
      title={team ? "Team" : "Admin console"}
      guardedClose
      closeDisabled={teamWriting}
      onClose={close}
      onBack={team ? () => departTeam(() => setTeam(null)) : undefined}
      onDismiss={onDismiss}
    >
      {team ? (
        <TeamDetailPage
          key={team}
          teamId={team}
          beforeLeave={teamBeforeLeave}
          onBusyChange={setTeamWriting}
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Admin section: ${SEGMENT_LABELS[selected]}`}
              accessibilityState={{ expanded: sectionsOpen }}
              onPress={() => setSectionsOpen(true)}
              style={({ pressed }) => [
                s.sectionPicker,
                pressed && s.sectionPressed,
              ]}
            >
              <Text style={shared.small}>Section</Text>
              <Text style={s.sectionName}>{SEGMENT_LABELS[selected]}</Text>
              <Icon name="chevronDown" size={18} color={colors.muted} />
            </Pressable>
            <ActionSheet
              visible={sectionsOpen}
              label="Choose admin section"
              title="Admin sections"
              onClose={() => setSectionsOpen(false)}
              actions={segments.map((section) => ({
                label: `${SEGMENT_LABELS[section]}${section === selected ? " · current" : ""}`,
                onPress: () => {
                  setSegment(section);
                  setAccount(null);
                },
              }))}
            />
            {selected === "overview" && <Overview act={act} />}
            {selected === "analytics" && <AdminAnalyticsView act={act} />}
            {selected === "requests" && <AdminRequests act={act} busy={busy} />}
            {selected === "users" &&
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
            {selected === "teams" && (
              <Teams act={act} onSelect={(t) => setTeam(t.id)} />
            )}
            {selected === "audit" && <Audit act={act} busy={busy} />}
            {selected === "database" && canManageSystem && (
              <AdminDatabase act={act} busy={busy} meId={user?.id} />
            )}
            {selected === "storage" && canManageSystem && (
              <AdminStorage act={act} busy={busy} />
            )}
            {selected === "ai" && canManageAi && (
              <AdminAi act={act} busy={busy} />
            )}
            {selected === "agents" && canManageSystem && (
              <AdminAgents act={act} busy={busy} />
            )}
            {selected === "system" && canManageSystem && (
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

function useAdminLifetime() {
  const mounted = useRef(false);
  const owner = useRef(session.token);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return () => mounted.current && owner.current === session.token;
}
function useAdminRead<T>(read: () => Promise<T>) {
  const latest = useRef(read);
  latest.current = read;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    const token = session.token;
    setError("");
    void latest.current().then(
      (next) => {
        if (live && token === session.token) setData(next);
      },
      (e) => {
        if (live && token === session.token) setError(errorText(e));
      },
    );
    return () => {
      live = false;
    };
  }, [retry]);
  return { data, error, reload: () => setRetry((value) => value + 1) };
}
function Overview({ act }: { act: Act }) {
  const { data, error, reload } = useAdminRead(() => client.adminOverview());
  if (!data)
    return (
      <View>
        <Text style={shared.small}>{error || "Loading overview…"}</Text>
        {error && <Button title="Retry overview" secondary onPress={reload} />}
      </View>
    );
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
      {stats.map((stat) => (
        <View key={stat.label} style={s.tile}>
          <Text style={s.tileValue}>{stat.value}</Text>
          <Text style={shared.small}>{stat.label}</Text>
        </View>
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
  const [total, setTotal] = useState<number | null>(null);
  const [localError, setLocalError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [working, setWorking] = useState(false);
  const [deleteUser, setDeleteUser] = useState<AdminUser | null>(null);
  const owns = useAdminLifetime();
  const readSequence = useRef(0);
  const writeLock = useRef(false);

  const load = useCallback(
    async (offset = 0) => {
      const request = ++readSequence.current;
      if (!owns()) return;
      setLoading(true);
      setLocalError("");
      try {
        const page = await client.adminListUsers({
          search,
          limit: 100,
          offset,
        });
        if (owns() && request === readSequence.current) {
          setRows((previous) =>
            offset === 0
              ? page.rows
              : [
                  ...previous,
                  ...page.rows.filter(
                    (entry) => !previous.some((saved) => saved.id === entry.id),
                  ),
                ],
          );
          setTotal(page.total);
        }
      } catch (e) {
        if (owns() && request === readSequence.current)
          setLocalError(errorText(e));
      } finally {
        if (owns() && request === readSequence.current) setLoading(false);
      }
    },
    [search],
  );
  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => {
      clearTimeout(timer);
      readSequence.current++;
    };
  }, [load, retry]);
  const run = async (fn: () => Promise<unknown>) => {
    if (writeLock.current || busy || !owns()) return;
    writeLock.current = true;
    setWorking(true);
    setLocalError("");
    let saved = false;
    try {
      await fn();
      saved = true;
      if (owns()) {
        await load();
        await onChanged();
      }
    } catch (e) {
      if (owns())
        setLocalError(
          saved ? "Account updated. Couldn’t refresh the list." : errorText(e),
        );
    } finally {
      writeLock.current = false;
      if (owns()) setWorking(false);
    }
  };
  const remove = (u: AdminUser) => {
    if (!writeLock.current && owns()) setDeleteUser(u);
  };

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
          editable={!working}
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
        {total === null
          ? ""
          : rows.length === total
            ? `${total} user${total === 1 ? "" : "s"}`
            : `Showing ${rows.length} of ${total} users`}
      </Text>
      {loading && <Text style={shared.small}>Loading users…</Text>}
      {!!localError && (
        <View>
          <Text accessibilityRole="alert" style={shared.small}>
            {localError}
          </Text>
          <Button
            title="Retry users"
            secondary
            disabled={working}
            onPress={() => setRetry((value) => value + 1)}
          />
        </View>
      )}
      <ActionSheet
        visible={!!deleteUser}
        label="Delete account"
        title="Delete this account?"
        message={`${deleteUser?.email ?? ""} and their personal plans are removed permanently.`}
        onClose={() => setDeleteUser(null)}
        actions={[
          {
            label: "Delete account",
            destructive: true,
            disabled: busy || working,
            onPress: () => {
              if (deleteUser && deleteUser.id !== me?.id)
                void run(() => client.adminDeleteUser(deleteUser.id));
            },
          },
        ]}
      />
      <View style={s.list}>
        {rows.map((u, n) => {
          const self = u.id === me?.id;
          return (
            <View key={u.id} style={[s.userRow, n > 0 && s.divider]}>
              <View style={s.userTop}>
                <Pressable
                  disabled={working}
                  style={{ flex: 1, minWidth: 0, minHeight: 44 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${u.name}`}
                  onPress={() => onOpen(u.id)}
                >
                  <Text style={s.userName}>
                    {u.name}
                    {self ? " (you)" : ""}
                  </Text>
                  <Text style={shared.small}>{u.email}</Text>
                  <Text style={shared.small}>
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
                  disabled={busy || working}
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
            </View>
          );
        })}
      </View>
      {total !== null && rows.length < total && (
        <Button
          title={loading ? "Loading…" : "Load more users"}
          secondary
          disabled={busy || working || loading}
          onPress={() => void load(rows.length)}
        />
      )}
      {total === 0 && !loading && !localError && (
        <Text style={shared.small}>No matching users.</Text>
      )}
    </>
  );
}

function Teams({ act, onSelect }: { act: Act; onSelect: (t: Team) => void }) {
  const {
    data: teams,
    error,
    reload,
  } = useAdminRead(() => client.adminListTeams());
  const [query, setQuery] = useState("");
  if (!teams)
    return (
      <View>
        <Text style={shared.small}>{error || "Loading teams…"}</Text>
        {error && <Button title="Retry teams" secondary onPress={reload} />}
      </View>
    );
  const filtered = teams.filter((team) =>
    team.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <View>
      <TextInput
        style={shared.input}
        accessibilityLabel="Search teams"
        value={query}
        onChangeText={setQuery}
        placeholder="Search teams"
        placeholderTextColor={colors.faint}
      />
      {!filtered.length && (
        <Text style={shared.small}>
          {query.trim() ? "No matching teams." : "No teams yet."}
        </Text>
      )}
      <TeamList teams={filtered} onSelect={onSelect} />
    </View>
  );
}

function Audit({ act, busy }: { act: Act; busy: boolean }) {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const [localError, setLocalError] = useState("");
  const [fetching, setFetching] = useState(false);
  const owns = useAdminLifetime();
  const loading = useRef(false);
  const loadMore = async (offset: number) => {
    if (loading.current || !owns()) return;
    loading.current = true;
    setFetching(true);
    setLocalError("");
    try {
      const page = await client.adminListAudit({ limit: AUDIT_PAGE, offset });
      if (!owns()) return;
      setRows((prev) =>
        offset === 0
          ? page.rows
          : [
              ...prev,
              ...page.rows.filter(
                (entry) => !prev.some((saved) => saved.id === entry.id),
              ),
            ],
      );
      setTotal(page.total);
      setLoaded(true);
    } catch (e) {
      if (owns()) setLocalError(errorText(e));
    } finally {
      loading.current = false;
      if (owns()) setFetching(false);
    }
  };

  useEffect(() => {
    void loadMore(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!loaded)
    return (
      <View>
        <Text style={shared.small}>{localError || "Loading activity…"}</Text>
        {localError && (
          <Button
            title="Retry activity"
            secondary
            disabled={fetching}
            onPress={() => void loadMore(0)}
          />
        )}
      </View>
    );
  if (!rows.length) return <Text style={shared.small}>No activity yet.</Text>;
  return (
    <>
      <View style={s.list}>
        {rows.map((a, n) => (
          <View key={a.id} style={[s.auditRow, n > 0 && s.divider]}>
            <Text style={s.auditAction}>{a.action}</Text>
            <Text style={shared.body}>{auditTarget(a)}</Text>
            <Text style={shared.small}>
              {a.actor_email ?? "System"} ·{" "}
              {new Date(a.created_at).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </Text>
            {Object.keys(a.details ?? {}).length > 0 && (
              <InlineDetails title="Event details">
                <Text selectable style={shared.small}>
                  {JSON.stringify(a.details, null, 2)}
                </Text>
              </InlineDetails>
            )}
          </View>
        ))}
      </View>
      {!!localError && (
        <View>
          <Text accessibilityRole="alert" style={shared.small}>
            {localError}
          </Text>
          <Button
            title="Retry activity"
            secondary
            disabled={fetching}
            onPress={() => void loadMore(rows.length)}
          />
        </View>
      )}
      {rows.length < total && (
        <Button
          secondary
          title={fetching ? "Loading…" : "Load more"}
          disabled={busy || fetching}
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
    (a.target_id ? a.target_id : "");
  return label ? `${a.target_type} · ${label}` : a.target_type;
}

const s = themed(() =>
  StyleSheet.create({
    sectionPicker: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 44,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      backgroundColor: colors.surface,
      marginBottom: 16,
    },
    sectionPressed: { backgroundColor: colors.surfaceMuted },
    sectionName: {
      flex: 1,
      minWidth: 0,
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
    },
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
      fontSize: 24,
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
    userTop: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "flex-start",
      gap: 10,
    },
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
      fontSize: 15,
      color: colors.text,
    },
  }),
);
