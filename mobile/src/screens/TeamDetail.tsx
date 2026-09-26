import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  TEAM_ROLES,
  TEAM_ROLE_LABELS,
  assignableTeamRoles,
  canChangeTeamMember,
  freshItem,
  hasSystemPermission,
  hasTeamPermission,
  type Item,
  type TeamDetail,
  type TeamMember,
  type TeamRole,
  type User,
} from "@orbyn/core";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { ItemCard } from "../components/ItemCard";
import type { Editing } from "../components/ItemEditor";
import { RecentChangesList } from "./RecentChanges";
import { Pill } from "../components/Pill";
import { Segmented } from "../components/Segmented";
import { sheetStyles } from "../components/Sheet";
import { client } from "../lib/api";
import * as outbox from "../lib/outbox";
import { toggledStatus } from "../lib/progress";
import { FadeIn, animateLayout } from "../motion";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";
import { TeamAgents } from "./TeamAgents";
import { TeamTime } from "./TeamTime";
import { MoreMenu } from "../components/MoreMenu";

type Act = (fn: () => Promise<void>) => Promise<void>;

export const roleTone = (role: TeamRole | null) =>
  role === "owner" || role === "admin" ? "accent" : "muted";

/**
 * One team, pushed inside the Teams or Admin sheet: rename/delete, members and
 * roles, add member, leave, and the team's shared plans. System admins manage
 * every team as an owner but never see its plans unless they are a member.
 */
export function TeamDetailPage({
  teamId,
  user,
  busy,
  act,
  banner,
  onGone,
  onChanged,
  onOpenItem,
  onOpenChange,
}: {
  teamId: string;
  user: User | null;
  busy: boolean;
  act: Act;
  /** Rendered at the top of the page (the sheet's error banner). */
  banner?: React.ReactNode;
  /** The team was deleted or you left it: go back to the list. */
  onGone: () => void;
  /** Refresh planner data (teams, items) after a mutation. */
  onChanged: () => Promise<void>;
  onOpenItem: (editing: Editing) => void;
  /** Open a page or task from the team's recent changes (SHR-02). */
  onOpenChange?: (kind: "doc" | "task", id: string) => void;
}) {
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<TeamRole>("member");
  const [expanded, setExpanded] = useState<string | null>(null);

  /** Fetch the team and its plans; `animate` eases rows into new places. */
  const load = useCallback(
    async (animate = false) => {
      const d = await client.getTeam(teamId);
      const list = hasTeamPermission(d.role, "items:read")
        ? await client.listItems({ team_id: teamId, limit: 500 })
        : [];
      if (animate) animateLayout();
      setDetail(d);
      setName(d.name);
      setItems(list);
    },
    [teamId],
  );

  useEffect(() => {
    void act(() => load());
    // Load once per team; `act` is recreated every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  /** Mutate, then reload this page and the planner. */
  const run = (fn: () => Promise<unknown>, animate = false) =>
    act(async () => {
      // Null: kept on the phone until it's back online; nothing to re-read.
      if ((await fn()) === null) return;
      await load(animate);
      await onChanged();
    });

  if (!detail)
    return (
      <ScrollView contentContainerStyle={sheetStyles.body}>
        <View style={sheetStyles.column}>
          {banner}
          <Text style={shared.small}>Loading team…</Text>
        </View>
      </ScrollView>
    );

  const isSystemAdmin = hasSystemPermission(user?.role, "teams:manage_all");
  // Mirrors the server: system admins act as owners for team management.
  const manage: TeamRole | null = isSystemAdmin ? "owner" : detail.role;
  const canManage = hasTeamPermission(manage, "members:manage");
  const canRead = hasTeamPermission(detail.role, "items:read");
  const canWrite = hasTeamPermission(detail.role, "items:write");
  const assignable = assignableTeamRoles(manage);
  const addRole = assignable.includes(newRole) ? newRole : assignable[0];

  const leave = () =>
    Alert.alert(
      "Leave this team?",
      `You’ll lose access to ${detail.name} and its plans.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: () =>
            act(async () => {
              if (!user) return;
              await client.removeTeamMember(teamId, user.id);
              await onChanged();
              onGone();
            }),
        },
      ],
    );

  const remove = (m: TeamMember) =>
    Alert.alert("Remove member?", `${m.name} will lose access to this team.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => run(() => client.removeTeamMember(teamId, m.user_id)),
      },
    ]);

  const destroy = () =>
    Alert.alert(
      "Delete this team?",
      "Its shared plans are deleted for everyone. This can’t be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () =>
            act(async () => {
              await client.deleteTeam(teamId);
              await onChanged();
              onGone();
            }),
        },
      ],
    );

  const menu = [
    ...(hasTeamPermission(manage, "team:update")
      ? [{ label: "Rename team", onPress: () => setRenaming(true) }]
      : []),
    ...(detail.role
      ? [{ label: "Leave team", destructive: true, onPress: leave }]
      : []),
    ...(hasTeamPermission(manage, "team:delete")
      ? [{ label: "Delete team", destructive: true, onPress: destroy }]
      : []),
  ];
  return (
    <ScrollView
      contentContainerStyle={sheetStyles.body}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      <View style={sheetStyles.column}>
        {banner}
        <View style={s.titleRow}>
          <Text style={[shared.title, { flexShrink: 1 }]} numberOfLines={2}>
            {detail.name}
          </Text>
          {detail.role && (
            <Pill
              label={TEAM_ROLE_LABELS[detail.role]}
              tone={roleTone(detail.role)}
            />
          )}
          <View style={{ flex: 1 }} />
          <MoreMenu label="Team options" disabled={busy} actions={menu} />
        </View>
        <Text style={[shared.subtitle, s.gap]}>
          {detail.member_count} member{detail.member_count === 1 ? "" : "s"} ·{" "}
          {detail.item_count} plan{detail.item_count === 1 ? "" : "s"} · created{" "}
          {new Date(detail.created_at).toLocaleDateString([], {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </Text>

        {!detail.role && (
          <View style={shared.softCard}>
            <Text style={shared.body}>
              You’re managing this team as a system admin. Its plans stay
              private to members.
            </Text>
          </View>
        )}
        {!!detail.role && canRead && !canWrite && (
          <View style={shared.softCard}>
            <Text style={shared.body}>
              View only: you’re a viewer in {detail.name}. You can see its plans
              but not change them.
            </Text>
          </View>
        )}

        {renaming && hasTeamPermission(manage, "team:update") && (
          <View style={shared.card}>
            <Text style={shared.label}>Team name</Text>
            <TextInput
              style={[shared.input, s.gap]}
              value={name}
              onChangeText={setName}
              maxLength={80}
              placeholder="Team name"
              placeholderTextColor={colors.faint}
              returnKeyType="done"
            />
            <Button
              secondary
              title="Rename team"
              icon="check"
              style={{ marginBottom: 0 }}
              disabled={busy || !name.trim() || name.trim() === detail.name}
              onPress={() => {
                setRenaming(false);
                void run(() =>
                  client.updateTeam(teamId, { name: name.trim() }),
                );
              }}
            />
          </View>
        )}

        {/* Who changed which of the team's pages and tasks (SHR-02). */}
        {canRead && onOpenChange && (
          <>
            <Text style={[shared.eyebrow, s.eyebrow]}>RECENT CHANGES</Text>
            <RecentChangesList
              teamId={teamId}
              limit={10}
              onOpen={onOpenChange}
            />
          </>
        )}

        <Text style={[shared.eyebrow, s.eyebrow]}>MEMBERS</Text>
        <View style={s.list}>
          {detail.members.map((m, n) => {
            const me = m.user_id === user?.id;
            const roles = TEAM_ROLES.filter(
              (r) => r === m.role || canChangeTeamMember(manage, m.role, r),
            );
            const canRemove = !me && canChangeTeamMember(manage, m.role, null);
            const editable = roles.length > 1 || canRemove;
            const open = expanded === m.user_id && editable;
            return (
              <FadeIn key={m.user_id} index={n} style={n > 0 && s.divider}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open, disabled: !editable }}
                  accessibilityLabel={`${m.name}, ${TEAM_ROLE_LABELS[m.role]}`}
                  disabled={!editable}
                  onPress={() => {
                    animateLayout();
                    setExpanded(open ? null : m.user_id);
                  }}
                  style={({ pressed }) => [s.member, pressed && s.pressed]}
                >
                  <View style={s.avatar}>
                    <Text style={s.avatarText}>
                      {(m.name[0] || m.email[0] || "?").toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.memberName} numberOfLines={1}>
                      {m.name}
                      {me ? " (you)" : ""}
                    </Text>
                    <Text style={shared.small} numberOfLines={1}>
                      {m.email}
                    </Text>
                  </View>
                  <Pill
                    label={TEAM_ROLE_LABELS[m.role]}
                    tone={roleTone(m.role)}
                  />
                  {editable && (
                    <Icon name="chevronRight" size={16} color={colors.faint} />
                  )}
                </Pressable>
                {open && (
                  <View style={s.memberActions}>
                    {roles.length > 1 && (
                      <Segmented
                        wrap
                        accessibilityLabel={`Role for ${m.name}`}
                        disabled={busy}
                        options={roles}
                        labels={TEAM_ROLE_LABELS}
                        value={m.role}
                        onChange={(role) => {
                          if (role === m.role) return;
                          const change = () =>
                            void run(() =>
                              client.updateTeamMember(teamId, m.user_id, {
                                role,
                              }),
                            );
                          if (!me) return change();
                          Alert.alert(
                            `Change your own role to ${TEAM_ROLE_LABELS[role]}?`,
                            "You may lose access to some controls.",
                            [
                              { text: "Cancel", style: "cancel" },
                              { text: "Change role", onPress: change },
                            ],
                          );
                        }}
                      />
                    )}
                    {canRemove && (
                      <Button
                        destructive
                        title="Remove from team"
                        disabled={busy}
                        style={s.removeButton}
                        onPress={() => remove(m)}
                      />
                    )}
                  </View>
                )}
              </FadeIn>
            );
          })}
        </View>

        {canManage && assignable.length > 0 && (
          <View style={shared.card}>
            <Text style={shared.label}>Add a member</Text>
            <TextInput
              style={[shared.input, s.gap]}
              value={email}
              onChangeText={setEmail}
              placeholder="name@example.com"
              placeholderTextColor={colors.faint}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="emailAddress"
            />
            <Segmented
              wrap
              accessibilityLabel="Role for new member"
              options={assignable}
              labels={TEAM_ROLE_LABELS}
              value={addRole}
              onChange={setNewRole}
            />
            <Button
              title="Add member"
              icon="userPlus"
              style={s.addButton}
              disabled={busy || !email.trim()}
              onPress={() =>
                run(async () => {
                  await client.addTeamMember(teamId, {
                    email: email.trim(),
                    role: addRole,
                  });
                  setEmail("");
                })
              }
            />
          </View>
        )}

        {canRead && detail.role && (
          <TeamTime
            teamId={teamId}
            members={detail.members}
            userId={user?.id}
            canWrite={canWrite}
            canManage={canManage}
            onOpenItem={onOpenItem}
            onCreated={() =>
              void load(true)
                .then(onChanged)
                .catch(() => {})
            }
          />
        )}

        {detail.role && (
          <TeamAgents
            teamId={teamId}
            teamName={detail.name}
            canManage={hasTeamPermission(detail.role, "team:update")}
            busy={busy}
            act={act}
          />
        )}

        {canRead && (
          <>
            <View style={s.heading}>
              <Text style={shared.sectionTitle}>Team plans</Text>
              <View style={s.count}>
                <Text style={s.countText}>{items.length}</Text>
              </View>
            </View>
            {items.length > 0 ? (
              <View style={s.list}>
                {items.map((i, n) => (
                  <FadeIn key={i.id} index={n}>
                    <ItemCard
                      item={{ ...i, team_name: null }}
                      busy={busy}
                      first={n === 0}
                      readOnly={!canWrite}
                      onOpen={(item) =>
                        onOpenItem({ ...item, team_name: i.team_name })
                      }
                      onToggle={(item) =>
                        run(
                          () =>
                            outbox.postItemUpdate(item, {
                              status: toggledStatus(item),
                            }),
                          true,
                        )
                      }
                    />
                  </FadeIn>
                ))}
              </View>
            ) : (
              <Text style={[shared.small, s.gap]}>
                Nothing shared with this team yet.
              </Text>
            )}
            {canWrite && (
              <Button
                secondary
                icon="plus"
                title="Add a team plan"
                onPress={() => onOpenItem({ ...freshItem(), team_id: teamId })}
              />
            )}
          </>
        )}
      </View>
    </ScrollView>
  );
}

const s = themed(() =>
  StyleSheet.create({
    titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    gap: { marginBottom: 14 },
    eyebrow: { marginTop: 8 },
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
    member: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 13,
      paddingHorizontal: 16,
    },
    pressed: { backgroundColor: colors.surfaceMuted },
    avatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      fontFamily: fonts.display,
      fontSize: 15,
      color: colors.accent,
    },
    memberName: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
      marginBottom: 1,
    },
    memberActions: { paddingHorizontal: 16, paddingBottom: 14, gap: 10 },
    removeButton: { marginBottom: 0 },
    addButton: { marginTop: 12, marginBottom: 0 },
    heading: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 8,
      marginBottom: 10,
    },
    count: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: 6,
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    countText: {
      fontFamily: fonts.semibold,
      fontSize: 11,
      color: colors.muted,
    },
  }),
);
