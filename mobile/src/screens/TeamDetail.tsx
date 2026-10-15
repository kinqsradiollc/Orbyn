import React, { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { session } from "../lib/session";
import { errorText } from "../lib/errors";
import { ErrorBanner } from "../components/ErrorBanner";
import { showToast } from "../components/Toast";
import {
  TEAM_ROLES,
  TEAM_ROLE_LABELS,
  assignableTeamRoles,
  canChangeTeamMember,
  freshItem,
  hasSystemPermission,
  hasTeamPermission,
  initialsOf,
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
import { Sheet, sheetStyles } from "../components/Sheet";
import { client } from "../lib/api";
import * as outbox from "../lib/outbox";
import { toggledStatus } from "../lib/progress";
import { Pressable } from "../motion";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";
import { TeamAgents } from "./TeamAgents";
import { TeamPolicies } from "./TeamPolicies";
import { TeamTime } from "./TeamTime";
import { InlineDetails } from "../components/InlineDetails";
import { ActionSheet, MoreMenu } from "../components/MoreMenu";

type Act = (fn: () => Promise<void>) => Promise<void>;

export const roleTone = (role: TeamRole | null) =>
  role === "owner" || role === "admin" ? "accent" : "muted";

/**
 * One team, pushed inside the Teams or Admin sheet: rename/delete, members and
 * roles, add member, leave, and the team's shared plans. System admins manage
 * every team as an owner but never see its plans unless they are a member.
 */
export function TeamDetailPage(
  props: React.ComponentProps<typeof TeamDetailBody>,
) {
  return (
    <TeamDetailBody
      key={`${session.token}:${props.user?.id ?? ""}:${props.teamId}`}
      {...props}
    />
  );
}
function TeamDetailBody({
  teamId,
  user,
  busy: parentBusy,
  act,
  banner,
  onGone,
  onChanged,
  onOpenItem,
  onOpenChange,
  beforeLeave,
  onBusyChange,
}: {
  beforeLeave?: React.MutableRefObject<(() => Promise<boolean>) | null>;
  onBusyChange?: (busy: boolean) => void;
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
  const [memberQuery, setMemberQuery] = useState("");
  const [showAllMembers, setShowAllMembers] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [writing, setWriting] = useState(false);
  const [childBusy, setChildBusy] = useState(false);
  const childLock = useRef(false);
  const busy = parentBusy || writing || childBusy;
  const [readError, setReadError] = useState("");
  const [actionError, setActionError] = useState("");
  const owner = useRef(session.token).current;
  const mounted = useRef(true),
    lock = useRef(false),
    sequence = useRef(0);
  const owns = () => mounted.current && session.token === owner;
  const live = useRef({ name, renaming, email, detail });
  live.current = { name, renaming, email, detail };
  const [confirmation, setConfirmation] = useState<{
    title: string;
    message: string;
    label: string;
    action: () => void;
    destructive?: boolean;
    cancel?: () => void;
  } | null>(null);
  const confirm = (
    title: string,
    message: string,
    label: string,
    action: () => void,
    destructive = false,
  ) => {
    if (!busy && !lock.current && owns())
      setConfirmation({ title, message, label, action, destructive });
  };
  const leaveResolver = useRef<((allow: boolean) => void) | null>(null);
  const guard = async () => {
    if (!owns() || lock.current || childLock.current) return false;
    if (!(
      live.current.email.trim() ||
      (live.current.renaming && live.current.name !== live.current.detail?.name)
    ))
      return true;
    if (leaveResolver.current) return false;
    return new Promise<boolean>((resolve) => {
      leaveResolver.current = resolve;
      const settle = (allowed: boolean) => {
        leaveResolver.current = null;
        resolve(allowed);
      };
      setConfirmation({
        title: "Discard team edits?",
        message: "Your unsaved team name and member details will be discarded.",
        label: "Discard",
        destructive: true,
        action: () => {
          if (!owns()) return settle(false);
          setEmail("");
          setName(live.current.detail?.name ?? "");
          setRenaming(false);
          settle(true);
        },
        cancel: () => settle(false),
      });
    });
  };
  const depart = (action: () => void) => {
    void guard().then((allow) => {
      if (allow && owns()) action();
    });
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current++;
      leaveResolver.current?.(false);
      onBusyChange?.(false);
    };
  }, []);
  useEffect(() => {
    if (!beforeLeave) return;
    beforeLeave.current = guard;
    return () => {
      if (beforeLeave.current === guard) beforeLeave.current = null;
    };
  }, [beforeLeave]);
  useEffect(() => {
    onBusyChange?.(writing || childBusy);
  }, [writing, childBusy, onBusyChange]);

  const load = useCallback(
    async (_animate = false) => {
      const request = ++sequence.current;
      setReadError("");
      try {
        const d = await client.getTeam(teamId);
        const list = hasTeamPermission(d.role, "items:read")
          ? await client.listItems({ team_id: teamId, limit: 500 })
          : [];
        if (!owns() || request !== sequence.current) return;
        setDetail(d);
        if (!live.current.renaming) setName(d.name);
        setItems(list);
      } catch (e) {
        if (!owns() || request !== sequence.current) return;
        const status = (e as { status?: number }).status;
        if (status === 401 || status === 403 || status === 404) {
          setDetail(null);
          setItems([]);
        }
        setReadError(errorText(e));
        throw e;
      }
    },
    [teamId],
  );
  useEffect(() => {
    void load().catch(() => {});
  }, [load]);
  const run = async (fn: () => Promise<unknown>, _animate = false) => {
    if (!owns() || parentBusy || lock.current || childLock.current)
      return false;
    lock.current = true;
    setWriting(true);
    setActionError("");
    let saved = false;
    try {
      await act(async () => {
        try {
          const result = await fn();
          saved = true;
          if (!owns() || result === null) return;
          if (typeof result === "object" && result && "gone" in result) {
            try {
              await onChanged();
            } catch (e) {
              if (owns())
                showToast({ text: "Team updated. Couldn't refresh teams." });
            } finally {
              if (owns()) onGone();
            }
            return;
          }
          await load();
          if (owns()) await onChanged();
        } catch (e) {
          if (owns())
            setActionError(
              saved ? "Saved. Couldn't refresh the team." : errorText(e),
            );
        }
      });
      return saved;
    } finally {
      lock.current = false;
      if (owns()) setWriting(false);
    }
  };
  if (!detail)
    return (
      <ScrollView contentContainerStyle={sheetStyles.body}>
        <View style={sheetStyles.column}>
          {banner}
          <ErrorBanner error={readError} />
          {readError ? (
            <Button
              title="Retry"
              secondary
              onPress={() => {
                void load().catch(() => {});
              }}
            />
          ) : (
            <Text style={shared.small}>Loading team…</Text>
          )}
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
  const filteredMembers = detail.members.filter((member) =>
    `${member.name} ${member.email}`
      .toLocaleLowerCase()
      .includes(memberQuery.trim().toLocaleLowerCase()),
  );

  const leave = () => {
    if (!user) return;
    confirm(
      "Leave this team?",
      `You’ll lose access to ${detail.name} and its plans.`,
      "Leave",
      () => {
        void run(async () => {
          await client.removeTeamMember(teamId, user.id);
          return { gone: true };
        });
      },
      true,
    );
  };
  const remove = (m: TeamMember) =>
    confirm(
      "Remove member?",
      `${m.name} will lose access to this team.`,
      "Remove",
      () => {
        void run(() => client.removeTeamMember(teamId, m.user_id));
      },
      true,
    );
  const destroy = () =>
    confirm(
      "Delete this team?",
      "Its shared plans are deleted for everyone. This can’t be undone.",
      "Delete",
      () => {
        void run(async () => {
          await client.deleteTeam(teamId);
          return { gone: true };
        });
      },
      true,
    );
  const closeRename = () => {
    if (busy || lock.current || !owns()) return;
    if (name !== detail.name)
      confirm(
        "Discard name change?",
        "The saved team name stays unchanged.",
        "Discard",
        () => {
          setName(detail.name);
          setRenaming(false);
        },
        true,
      );
    else setRenaming(false);
  };
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
    <>
      <ScrollView
        contentContainerStyle={sheetStyles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <View style={sheetStyles.column}>
          {banner}
          <ErrorBanner
            error={actionError}
            onDismiss={() => setActionError("")}
          />
          {!!readError && (
            <View>
              <ErrorBanner error={readError} />
              <Button
                secondary
                title="Retry"
                disabled={busy}
                onPress={() => {
                  void load().catch(() => {});
                }}
              />
            </View>
          )}
          <View style={s.titleRow}>
            <Text style={[shared.sectionTitle, { flex: 1, minWidth: 0 }]}>
              {detail.name}
            </Text>
            {detail.role && (
              <Pill
                label={TEAM_ROLE_LABELS[detail.role]}
                tone={roleTone(detail.role)}
              />
            )}
            <MoreMenu label="Team options" disabled={busy} actions={menu} />
          </View>
          <Text style={[shared.subtitle, s.gap]}>
            {detail.member_count} member{detail.member_count === 1 ? "" : "s"} ·{" "}
            {detail.item_count} plan{detail.item_count === 1 ? "" : "s"} ·
            created{" "}
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
                View only: you can’t change this team’s plans.
              </Text>
            </View>
          )}

          {renaming && hasTeamPermission(manage, "team:update") && (
            <Sheet
              visible
              title="Rename team"
              guardedClose
              closeDisabled={busy}
              onClose={closeRename}
            >
              <ScrollView contentContainerStyle={sheetStyles.body}>
                <View style={sheetStyles.column}>
                  <Text style={shared.label}>Team name</Text>
                  <TextInput
                    style={shared.input}
                    value={name}
                    onChangeText={setName}
                    editable={!busy}
                    maxLength={80}
                    accessibilityLabel="Team name"
                    placeholderTextColor={colors.faint}
                    returnKeyType="done"
                  />
                  <ErrorBanner error={actionError} />
                  <Button
                    title={writing ? "Saving…" : "Save name"}
                    disabled={
                      busy || !name.trim() || name.trim() === detail.name
                    }
                    onPress={() => {
                      const value = name.trim();
                      void run(() =>
                        client.updateTeam(teamId, { name: value }),
                      ).then((saved) => {
                        if (saved && owns()) {
                          setName(value);
                          setRenaming(false);
                        }
                      });
                    }}
                  />
                </View>
              </ScrollView>
            </Sheet>
          )}
          {/* Who changed which of the team's pages and tasks (SHR-02). */}
          {canRead && onOpenChange && (
            <>
              <Text style={[shared.eyebrow, s.eyebrow]}>RECENT CHANGES</Text>
              <RecentChangesList
                teamId={teamId}
                limit={10}
                onOpen={(kind, id) => depart(() => onOpenChange(kind, id))}
              />
            </>
          )}

          <Text style={[shared.eyebrow, s.eyebrow]}>MEMBERS</Text>
          {/* Calm, as on the web: add someone by email, then everyone with
            their initials and role. */}
          {canManage && assignable.length > 0 && (
            <InlineDetails title="Add member">
              <View style={s.addCard}>
                <TextInput
                  style={[shared.input, s.gap]}
                  value={email}
                  editable={!busy}
                  maxLength={254}
                  onChangeText={setEmail}
                  placeholder="Add someone by email"
                  accessibilityLabel="Add someone by email"
                  placeholderTextColor={colors.faint}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="emailAddress"
                />
                <Segmented
                  wrap
                  accessibilityLabel="Role for new member"
                  disabled={busy}
                  options={assignable}
                  labels={TEAM_ROLE_LABELS}
                  value={addRole}
                  onChange={setNewRole}
                />
                <Button
                  title="Add"
                  icon="userPlus"
                  style={s.addButton}
                  disabled={busy || !email.trim()}
                  onPress={() =>
                    run(async () => {
                      await client.addTeamMember(teamId, {
                        email: email.trim(),
                        role: addRole,
                      });
                      if (owns())
                        setEmail((current) =>
                          current === email ? "" : current,
                        );
                    })
                  }
                />
              </View>
            </InlineDetails>
          )}

          {(detail.members.length > 8 || memberQuery) && (
            <TextInput
              style={shared.input}
              value={memberQuery}
              onChangeText={(value) => {
                setMemberQuery(value);
                setShowAllMembers(false);
              }}
              placeholder="Search members"
              accessibilityLabel="Search members"
              placeholderTextColor={colors.faint}
              autoCorrect={false}
            />
          )}
          {!!memberQuery.trim() && !filteredMembers.length && (
            <Text style={shared.small}>No matching members.</Text>
          )}
          <View style={s.list}>
            {filteredMembers
              .slice(0, showAllMembers ? undefined : 25)
              .map((m, n) => {
                const me = m.user_id === user?.id;
                const roles = TEAM_ROLES.filter(
                  (r) => r === m.role || canChangeTeamMember(manage, m.role, r),
                );
                const canRemove =
                  !me && canChangeTeamMember(manage, m.role, null);
                const editable = roles.length > 1 || canRemove;
                const open = expanded === m.user_id && editable;
                return (
                  <View key={m.user_id} style={n > 0 && s.divider}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{
                        expanded: open,
                        disabled: !editable,
                      }}
                      accessibilityLabel={`${m.name}, ${TEAM_ROLE_LABELS[m.role]}`}
                      disabled={!editable}
                      onPress={() => {
                        setExpanded(open ? null : m.user_id);
                      }}
                      style={({ pressed }) => [s.member, pressed && s.pressed]}
                    >
                      <View style={s.avatar}>
                        <Text style={s.avatarText}>
                          {initialsOf(m.name || m.email)}
                        </Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.memberName}>
                          {m.name}
                          {me ? " (you)" : ""}
                        </Text>
                        <Text style={shared.small}>{m.email}</Text>
                      </View>
                      <Pill
                        label={TEAM_ROLE_LABELS[m.role]}
                        tone={roleTone(m.role)}
                      />
                      {editable && (
                        <Icon
                          name="chevronRight"
                          size={16}
                          color={colors.faint}
                        />
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
                              confirm(
                                `Change your own role to ${TEAM_ROLE_LABELS[role]}?`,
                                "You may lose access to some controls.",
                                "Change role",
                                change,
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
                  </View>
                );
              })}
          </View>

          {!showAllMembers && filteredMembers.length > 25 && (
            <Button
              secondary
              title={`Show all ${filteredMembers.length} members`}
              onPress={() => setShowAllMembers(true)}
            />
          )}
          {canRead && detail.role && (
            <TeamTime
              disabled={busy}
              onBusyChange={(pending) => {
                childLock.current = pending;
                setChildBusy(pending);
              }}
              teamId={teamId}
              members={detail.members}
              userId={user?.id}
              canWrite={canWrite}
              canManage={canManage}
              onOpenItem={(item) => depart(() => onOpenItem(item))}
              onCreated={() =>
                void load(true)
                  .then(onChanged)
                  .catch(() => {})
              }
            />
          )}

          {detail.role && (
            <TeamPolicies
              teamId={teamId}
              busy={busy}
              act={async (fn) => {
                await run(fn);
              }}
            />
          )}

          {detail.role && (
            <TeamAgents
              teamId={teamId}
              teamName={detail.name}
              canManage={hasTeamPermission(detail.role, "team:update")}
              busy={busy}
              act={async (fn) => {
                await run(fn);
              }}
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
                    <View key={i.id}>
                      <ItemCard
                        item={{ ...i, team_name: null }}
                        busy={busy}
                        first={n === 0}
                        readOnly={!canWrite}
                        onOpen={(item) =>
                          depart(() =>
                            onOpenItem({ ...item, team_name: i.team_name }),
                          )
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
                    </View>
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
                  onPress={() =>
                    depart(() =>
                      onOpenItem({ ...freshItem(), team_id: teamId }),
                    )
                  }
                />
              )}
            </>
          )}
        </View>
      </ScrollView>
      <ActionSheet
        visible={!!confirmation}
        label="Confirm team action"
        title={confirmation?.title}
        message={confirmation?.message}
        actions={
          confirmation
            ? [
                {
                  label: confirmation.label,
                  destructive: confirmation.destructive,
                  disabled: busy,
                  onPress: () => {
                    if (owns()) confirmation.action();
                  },
                },
              ]
            : []
        }
        onClose={(selection) => {
          if (selection !== "selected") confirmation?.cancel?.();
          setConfirmation(null);
        }}
      />
    </>
  );
}

const s = themed(() =>
  StyleSheet.create({
    titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    gap: { marginBottom: 14 },
    eyebrow: { marginTop: 16 },
    addCard: { marginBottom: 12 },
    list: {
      backgroundColor: colors.surface,
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
      paddingHorizontal: 8,
    },
    pressed: { backgroundColor: colors.surfaceMuted },
    avatar: {
      width: 36,
      height: 36,
      borderRadius: radii.pill,
      backgroundColor: colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      fontFamily: fonts.display,
      fontSize: 13,
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
      borderRadius: radii.input,
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    countText: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.muted,
    },
  }),
);
