import { session } from "../../lib/session";
import { errorText } from "../../lib/planning";
import { SettingsEditor } from "../settings/SettingsEditor";
import {
  preparePaneDrafts,
  PageCommandScope,
  usePaneLeaveGuard,
} from "../../app/page-commands";
import { Select } from "../../components/Select";
import { useConfirm } from "../../components/Confirm";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  ListTodo,
  MoreHorizontal,
  LogOut,
  Pencil,
  Plus,
  Trash2,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import {
  assignableTeamRoles,
  canChangeTeamMember,
  hasSystemPermission,
  hasTeamPermission,
  initialsOf,
  TEAM_ROLE_LABELS,
  TEAM_ROLES,
  type HttpError,
  type Item,
  type ItemInput,
  type TeamDetail as TeamDetailData,
  type TeamMember,
  type TeamRole,
  type User,
} from "@orbyn/core";
import { client } from "../../lib/api";
import type { Planner } from "../../hooks/usePlanner";
import { EmptyState } from "../../components/EmptyState";
import { ItemRow } from "../../components/ItemRow";
import { RoleBadge } from "../../components/RoleBadge";
import { Popover } from "../../components/Popover";
import { TeamPlanning } from "./TeamPlanning";
import { TeamAgents } from "./TeamAgents";
import { TeamPolicies } from "./TeamPolicies";
import { RecentChanges } from "../changes/RecentChanges";

/** Planner plumbing shared by the Teams and Admin views. */
export type TeamActions = {
  user: User | null;
  busy: boolean;
  revision: number;
  act: Planner["act"];
  refresh: Planner["refresh"];
  report: Planner["report"];
  /** Opens the task detail panel. */
  onOpenItem: (item: Item) => void;
  /** Whether you can change this item (false for team viewers). */
  canWrite: (item: Item) => boolean;
  /** Starts a new team item, optionally prefilled (a meeting time). */
  onNewTeamItem: (teamId: string, draft?: Partial<ItemInput>) => void;
  onToggle: (item: Item) => void;
};

type Props = TeamActions & {
  teamId: string;
  onClose: () => void;
  onGone?: () => void;
  warnOnChanges?: boolean;
};

/**
 * One team: settings, members and shared items. Controls follow the actor's
 * effective role — their membership role, or "owner" for a system admin who
 * is not a member (the server grants admins management but not item access).
 */
export function TeamDetail(props: Props) {
  return (
    <TeamDetailBody
      key={`${session.get()}:${props.user?.id ?? ""}:${props.teamId}`}
      {...props}
    />
  );
}
function TeamDetailBody({
  teamId,
  onClose,
  onGone = onClose,
  user,
  busy: parentBusy,
  revision,
  act,
  refresh,
  report,
  onOpenItem,
  onNewTeamItem,
  onToggle,
  warnOnChanges = false,
}: Props) {
  const { ask: askDialog } = useConfirm();
  const confirmationLock = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const ask = async (options: Parameters<typeof askDialog>[0]) => {
    if (!owns() || confirmationLock.current) return false;
    confirmationLock.current = true;
    setConfirming(true);
    try {
      const accepted = await askDialog(options);
      return owns() && accepted;
    } finally {
      confirmationLock.current = false;
      if (owns()) setConfirming(false);
    }
  };
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamRole>("member");
  const [memberQuery, setMemberQuery] = useState("");
  const [showAllMembers, setShowAllMembers] = useState(false);
  const [optionsAnchor, setOptionsAnchor] = useState<DOMRect | null>(null);
  const [team, setTeam] = useState<TeamDetailData | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const seq = useRef(0);
  const owner = useRef(session.get()).current;
  const mounted = useRef(true),
    lock = useRef(false);
  const [writing, setWriting] = useState(false);
  const busy = parentBusy || writing || confirming;
  const [readError, setReadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const owns = () => mounted.current && owner === session.get();
  const editState = useRef({ name, renaming, inviteEmail, inviteRole, team });
  editState.current = { name, renaming, inviteEmail, inviteRole, team };
  const pageScope = useContext(PageCommandScope);
  const beforeLeave = async () => {
    if (!owns() || lock.current || confirmationLock.current) return false;
    const snapshot = editState.current;
    const dirty =
      snapshot.inviteEmail.trim() ||
      snapshot.inviteRole !== "member" ||
      (snapshot.renaming && snapshot.name !== snapshot.team?.name);
    if (!dirty) return true;
    if (
      !(await ask({
        title: "Discard team edits?",
        body: "Your unsaved name and member details will be discarded.",
        confirmLabel: "Discard",
        destructive: true,
      }))
    )
      return false;
    const latest = editState.current;
    if (
      !owns() ||
      latest.name !== snapshot.name ||
      latest.inviteEmail !== snapshot.inviteEmail ||
      latest.inviteRole !== snapshot.inviteRole
    )
      return false;
    setInviteEmail("");
    setInviteRole("member");
    setName(latest.team?.name ?? "");
    setRenaming(false);
    return true;
  };
  usePaneLeaveGuard(beforeLeave);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      seq.current++;
    };
  }, []);
  const latest = useRef({ onClose, onGone, report });
  latest.current = { onClose, onGone, report };

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setReadError("");
    try {
      const detail = await client.getTeam(teamId);
      const teamItems = hasTeamPermission(detail.role, "items:read")
        ? await client.listItems({ team_id: teamId, limit: 500 })
        : null;
      if (!owns() || mine !== seq.current) return;
      setTeam(detail);
      setItems(teamItems);
    } catch (e) {
      if (!owns() || mine !== seq.current) return;
      const status = (e as HttpError).status;
      if (status === 401 || status === 403 || status === 404) {
        setTeam(null);
        setItems(null);
      }
      if (status === 404) latest.current.onGone();
      setReadError(errorText(e));
    }
  }, [teamId]);

  // Reload on open and after every planner refresh (which follows mutations).
  useEffect(() => {
    void load();
  }, [load, revision]);

  if (!team)
    return (
      <section className="card team-detail">
        <div className="empty">
          {readError ? (
            <>
              <p role="alert">{readError}</p>
              <button
                type="button"
                className="secondary"
                onClick={() => void load()}
              >
                Retry
              </button>
            </>
          ) : (
            <p>Loading team…</p>
          )}
        </div>
      </section>
    );

  const override = team.role === null;
  const actor: TeamRole | null =
    team.role ??
    (hasSystemPermission(user?.role, "teams:manage_all") ? "owner" : null);
  const canManage = hasTeamPermission(actor, "members:manage");
  const canWrite = hasTeamPermission(team.role, "items:write");
  const filteredMembers = team.members.filter((member) =>
    `${member.name} ${member.email}`
      .toLocaleLowerCase()
      .includes(memberQuery.trim().toLocaleLowerCase()),
  );

  /** Run a mutation, then refresh the planner (which reloads this panel). */
  const mutate = async (fn: () => Promise<unknown>, onSaved?: () => void) => {
    if (!owns() || parentBusy || lock.current) return false;
    lock.current = true;
    setWriting(true);
    setActionError("");
    let saved = false;
    try {
      await act(async () => {
        try {
          await fn();
          saved = true;
          if (!owns()) return;
          onSaved?.();
          await refresh();
        } catch (e) {
          if (owns())
            setActionError(
              saved ? "Saved. Couldn't refresh the team." : errorText(e),
            );
          else if (saved && session.get() === owner) latest.current.report(e);
        }
      });
      return saved;
    } finally {
      lock.current = false;
      if (owns()) setWriting(false);
    }
  };
  const closeRename = async () => {
    if (!owns() || busy || lock.current) return;
    if (
      name !== team.name &&
      !(await ask({
        title: "Discard name change?",
        confirmLabel: "Discard",
        destructive: true,
      }))
    )
      return;
    if (owns()) setRenaming(false);
  };

  const changeRole = async (m: TeamMember, role: TeamRole) => {
    if (
      (warnOnChanges || m.user_id === user?.id) &&
      !(await ask({
        title:
          m.user_id === user?.id
            ? `Change your role to ${TEAM_ROLE_LABELS[role]}?`
            : `Change ${m.name}'s role in ${team.name} to ${TEAM_ROLE_LABELS[role]}?`,
        body:
          m.user_id === user?.id
            ? "You may lose access to some controls."
            : undefined,
      }))
    )
      return;
    if (!owns() || !canChangeTeamMember(actor, m.role, role)) return;
    void mutate(() => client.updateTeamMember(team.id, m.user_id, { role }));
  };

  const remove = async (m: TeamMember) => {
    if (
      !(await ask({
        title: `Remove ${m.name} from ${team.name}?`,
        confirmLabel: "Remove",
        destructive: true,
      }))
    )
      return;
    if (!owns() || !canChangeTeamMember(actor, m.role, null)) return;
    void mutate(() => client.removeTeamMember(team.id, m.user_id));
  };

  const leave = async () => {
    if (!user) return;
    if (
      !(await ask({
        title: `Leave ${team.name}?`,
        body: "You’ll lose access to its shared items.",
        confirmLabel: "Leave",
      }))
    )
      return;
    void mutate(() => client.removeTeamMember(team.id, user.id), onGone);
  };

  const deleteTeam = async () => {
    if (
      !(await ask({
        title: `Delete ${team.name}?`,
        body: "Deletes the team for everyone. This can’t be undone.",
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    void mutate(() => client.deleteTeam(team.id), onGone);
  };

  return (
    <section className="card team-detail" aria-busy={writing}>
      {readError && (
        <div className="error" role="alert">
          {readError}
          <button
            type="button"
            className="text-button"
            onClick={() => void load()}
          >
            Retry
          </button>
        </div>
      )}
      {actionError && (
        <p className="error" role="alert">
          {actionError}
        </p>
      )}
      <div className="section-heading">
        <div>
          <h2>{team.name}</h2>
          <small className="muted">
            {team.member_count} {team.member_count === 1 ? "member" : "members"}{" "}
            · {team.item_count} {team.item_count === 1 ? "item" : "items"} ·
            created {new Date(team.created_at).toLocaleDateString()}
          </small>
        </div>
        <div className="heading-actions">
          <RoleBadge role={team.role} />
          {(hasTeamPermission(actor, "team:update") ||
            hasTeamPermission(actor, "team:delete")) && (
            <button
              className="icon-button"
              aria-label="Team options"
              aria-expanded={!!optionsAnchor}
              disabled={busy}
              onClick={(e) =>
                setOptionsAnchor(
                  optionsAnchor
                    ? null
                    : e.currentTarget.getBoundingClientRect(),
                )
              }
            >
              <MoreHorizontal size={18} />
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Close team"
            disabled={busy}
            onClick={() => {
              void preparePaneDrafts(pageScope).then((allowed) => {
                if (allowed && owns()) onClose();
              });
            }}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {override && (
        <p className="rbac-note">
          You aren't a member. As system admin, you can manage the team, but its
          items stay private to members.
        </p>
      )}

      {optionsAnchor &&
        (hasTeamPermission(actor, "team:update") ||
          hasTeamPermission(actor, "team:delete")) && (
          <Popover
            anchor={optionsAnchor}
            label="Team options"
            onClose={() => setOptionsAnchor(null)}
          >
            <div className="team-settings">
              {hasTeamPermission(actor, "team:update") && (
                <button
                  type="button"
                  onClick={() => {
                    setName(team.name);
                    setRenaming(true);
                    setOptionsAnchor(null);
                  }}
                  disabled={busy}
                >
                  <Pencil size={14} /> Rename team
                </button>
              )}
              {hasTeamPermission(actor, "team:delete") && (
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={() => {
                    setOptionsAnchor(null);
                    void deleteTeam();
                  }}
                >
                  <Trash2 size={15} /> Delete team
                </button>
              )}
            </div>
          </Popover>
        )}

      {renaming && (
        <SettingsEditor
          title="Rename team"
          pending={writing}
          onClose={() => {
            void closeRename();
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const value = name.trim();
              if (!value || value === team.name) return;
              void (async () => {
                if (
                  warnOnChanges &&
                  !(await ask({
                    title: `Rename ${team.name} to ${value} for everyone?`,
                    confirmLabel: "Rename",
                  }))
                )
                  return;
                if (!owns()) return;
                await mutate(
                  () => client.updateTeam(team.id, { name: value }),
                  () => {
                    setTeam(
                      (current) => current && { ...current, name: value },
                    );
                    setRenaming(false);
                  },
                );
              })();
            }}
          >
            <label className="settings-field">
              Team name
              <input
                required
                maxLength={80}
                value={name}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {actionError && (
              <p className="error" role="alert">
                {actionError}
              </p>
            )}
            <button
              className="primary"
              disabled={busy || !name.trim() || name.trim() === team.name}
            >
              {writing ? "Saving…" : "Save name"}
            </button>
          </form>
        </SettingsEditor>
      )}

      {/* The members card, kept calm: add someone by email, then everyone
          with their initials and a role. Nothing else lives here. */}
      <div className="subheading">
        <h3>
          Members <span>{team.members.length}</span>
        </h3>
      </div>
      {canManage && (
        <details className="team-add-details">
          <summary>Add member</summary>
          <form
            className="inline-form add-member"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const d = new FormData(form);
              const email = String(d.get("email")).trim();
              const role = d.get("role") as TeamRole;
              if (
                warnOnChanges &&
                !(await ask({
                  title: `Add ${email} to ${team.name} as ${TEAM_ROLE_LABELS[role]}?`,
                  confirmLabel: "Add member",
                }))
              )
                return;
              if (!owns() || !assignableTeamRoles(actor).includes(role)) return;
              void mutate(
                () => client.addTeamMember(team.id, { email, role }),
                () => {
                  const shown = new FormData(form);
                  if (
                    String(shown.get("email")).trim() === email &&
                    shown.get("role") === role
                  ) {
                    setInviteEmail((current) =>
                      current.trim() === email ? "" : current,
                    );
                    setInviteRole((current) =>
                      current === role ? "member" : current,
                    );
                  }
                },
              );
            }}
          >
            <input
              name="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              disabled={busy}
              type="email"
              required
              maxLength={254}
              aria-label="Add someone by email"
              placeholder="Add someone by email"
            />
            <Select
              name="role"
              aria-label="Their role"
              value={
                assignableTeamRoles(actor).includes(inviteRole)
                  ? inviteRole
                  : (assignableTeamRoles(actor)[0] ?? "member")
              }
              onChange={(e) => setInviteRole(e.target.value as TeamRole)}
              disabled={busy}
            >
              {assignableTeamRoles(actor).map((r) => (
                <option key={r} value={r}>
                  {TEAM_ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
            <button className="primary" disabled={busy}>
              <UserPlus size={15} /> Add
            </button>
          </form>
        </details>
      )}
      {(team.members.length > 8 || memberQuery) && (
        <div className="team-member-search">
          <input
            type="search"
            aria-label="Search members"
            placeholder="Search members"
            value={memberQuery}
            onChange={(e) => {
              setMemberQuery(e.target.value);
              setShowAllMembers(false);
            }}
          />
        </div>
      )}
      {!!memberQuery.trim() && !filteredMembers.length && (
        <p className="muted">No matching members.</p>
      )}
      <ul className="member-list">
        {filteredMembers.slice(0, showAllMembers ? undefined : 25).map((m) => {
          const self = m.user_id === user?.id;
          const options = TEAM_ROLES.filter(
            (r) => r === m.role || canChangeTeamMember(actor, m.role, r),
          );
          const canRemove = !self && canChangeTeamMember(actor, m.role, null);
          return (
            <li key={m.user_id}>
              <span className="member-initials" aria-hidden="true">
                {initialsOf(m.name)}
              </span>
              <span className="member-main">
                <strong>
                  <span className="member-name">{m.name}</span>
                  {self && <span className="you-tag">You</span>}
                </strong>
                <small>{m.email}</small>
              </span>
              <Select
                className="role-select"
                aria-label={`Role for ${m.name}`}
                value={m.role}
                disabled={busy || options.length < 2}
                onChange={(e) => changeRole(m, e.target.value as TeamRole)}
              >
                {options.map((r) => (
                  <option key={r} value={r}>
                    {TEAM_ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
              {self ? (
                <button
                  className="icon-button danger-text"
                  aria-label="Leave team"
                  title="Leave team"
                  disabled={busy}
                  onClick={leave}
                >
                  <LogOut size={15} />
                </button>
              ) : canRemove ? (
                <button
                  className="icon-button danger-text"
                  aria-label={`Remove ${m.name}`}
                  title="Remove from team"
                  disabled={busy}
                  onClick={() => remove(m)}
                >
                  <UserMinus size={15} />
                </button>
              ) : (
                <span className="member-action-space" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ul>
      {!showAllMembers && filteredMembers.length > 25 && (
        <button
          type="button"
          className="text-button"
          onClick={() => setShowAllMembers(true)}
        >
          Show all {filteredMembers.length} members
        </button>
      )}

      {!override && (
        <TeamAgents
          teamId={team.id}
          teamName={team.name}
          canManage={hasTeamPermission(team.role, "team:update")}
          report={report}
        />
      )}

      {!override && <TeamPolicies teamId={team.id} />}

      {!override && hasTeamPermission(team.role, "items:read") && (
        <RecentChanges teamId={team.id} showTeam={false} />
      )}

      {!override && hasTeamPermission(team.role, "items:read") && (
        <TeamPlanning
          team={team}
          userId={user?.id}
          canWrite={canWrite}
          canManage={canManage}
          report={report}
          onNewEvent={(draft) => onNewTeamItem(team.id, draft)}
        />
      )}

      {!override && (
        <>
          <div className="subheading">
            <h3>
              Team items <span>{items?.length ?? 0}</span>
            </h3>
            {canWrite && (
              <button
                className="secondary"
                onClick={() => onNewTeamItem(team.id)}
              >
                <Plus size={15} /> New team item
              </button>
            )}
          </div>
          {!canWrite && (
            <p className="rbac-note">
              View only — you&apos;re a viewer in {team.name}.
            </p>
          )}
          {items?.map((i, n) => (
            <ItemRow
              key={i.id}
              item={i}
              index={n}
              busy={busy}
              readOnly={!canWrite}
              onToggle={onToggle}
              onOpen={onOpenItem}
            />
          ))}
          {items && !items.length && (
            <EmptyState
              icon={ListTodo}
              title="Nothing shared yet."
              body={
                canWrite
                  ? "Add a task or event everyone in the team can see."
                  : "Items shared with this team will show up here."
              }
            />
          )}
        </>
      )}
    </section>
  );
}
