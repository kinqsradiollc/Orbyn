import { Select } from "../../components/Select";
import { useConfirm } from "../../components/Confirm";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ListTodo,
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
import { stagger } from "../../lib/motion";
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
  warnOnChanges?: boolean;
};

/**
 * One team: settings, members and shared items. Controls follow the actor's
 * effective role — their membership role, or "owner" for a system admin who
 * is not a member (the server grants admins management but not item access).
 */
export function TeamDetail({
  teamId,
  onClose,
  user,
  busy,
  revision,
  act,
  refresh,
  report,
  onOpenItem,
  onNewTeamItem,
  onToggle,
  warnOnChanges = false,
}: Props) {
  const { ask, tell } = useConfirm();
  const [team, setTeam] = useState<TeamDetailData | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const seq = useRef(0);
  const latest = useRef({ onClose, report });
  latest.current = { onClose, report };

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const detail = await client.getTeam(teamId);
      const teamItems = hasTeamPermission(detail.role, "items:read")
        ? await client.listItems({ team_id: teamId, limit: 500 })
        : null;
      if (mine !== seq.current) return;
      setTeam(detail);
      setItems(teamItems);
    } catch (e) {
      if (mine !== seq.current) return;
      if ((e as HttpError).status === 404) latest.current.onClose();
      latest.current.report(e);
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
          <p>Loading team…</p>
        </div>
      </section>
    );

  const override = team.role === null;
  const actor: TeamRole | null =
    team.role ??
    (hasSystemPermission(user?.role, "teams:manage_all") ? "owner" : null);
  const canManage = hasTeamPermission(actor, "members:manage");
  const canWrite = hasTeamPermission(team.role, "items:write");

  /** Run a mutation, then refresh the planner (which reloads this panel). */
  const mutate = (fn: () => Promise<unknown>) =>
    void act(async () => {
      await fn();
      await refresh();
    });

  const changeRole = async (m: TeamMember, role: TeamRole) => {
    if (
      (warnOnChanges || m.user_id === user?.id) &&
      !(await ask({
        title:
          m.user_id === user?.id
            ? `Change your own role to ${TEAM_ROLE_LABELS[role]}? You may lose access to some controls.`
            : `Change ${m.name}'s role in ${team.name} to ${TEAM_ROLE_LABELS[role]}?`,
      }))
    )
      return;
    mutate(() => client.updateTeamMember(team.id, m.user_id, { role }));
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
    mutate(() => client.removeTeamMember(team.id, m.user_id));
  };

  const leave = async () => {
    if (!user) return;
    if (
      !(await ask({
        title: `Leave ${team.name}? You'll lose access to its shared items.`,
      }))
    )
      return;
    void act(async () => {
      await client.removeTeamMember(team.id, user.id);
      onClose();
      await refresh();
    });
  };

  const deleteTeam = async () => {
    if (
      !(await ask({
        title: `Delete ${team.name} for everyone? This can't be undone.`,
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    void act(async () => {
      await client.deleteTeam(team.id);
      onClose();
      await refresh();
    });
  };

  return (
    <section className="card team-detail">
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
          <button
            className="icon-button"
            aria-label="Close team"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {override && (
        <p className="rbac-note">
          You&apos;re not a member of this team. As a system admin you can
          manage its settings and members, but its items stay private to
          members.
        </p>
      )}

      {(hasTeamPermission(actor, "team:update") ||
        hasTeamPermission(actor, "team:delete")) && (
        <div className="team-settings">
          {hasTeamPermission(actor, "team:update") && (
            <form
              key={team.name}
              className="inline-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const name = String(
                  new FormData(e.currentTarget).get("name"),
                ).trim();
                if (!name || name === team.name) return;
                if (
                  warnOnChanges &&
                  !(await ask({
                    title: `Rename ${team.name} to ${name} for everyone?`,
                    confirmLabel: "Rename",
                  }))
                )
                  return;
                mutate(() => client.updateTeam(team.id, { name }));
              }}
            >
              <input
                name="name"
                aria-label="Team name"
                defaultValue={team.name}
                maxLength={80}
                required
              />
              <button className="secondary" disabled={busy}>
                <Pencil size={14} /> Rename
              </button>
            </form>
          )}
          {hasTeamPermission(actor, "team:delete") && (
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={deleteTeam}
            >
              <Trash2 size={15} /> Delete team
            </button>
          )}
        </div>
      )}

      {/* The members card, kept calm: add someone by email, then everyone
          with their initials and a role. Nothing else lives here. */}
      <div className="subheading">
        <h3>
          Members <span>{team.members.length}</span>
        </h3>
      </div>
      {canManage && (
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
            void act(async () => {
              await client.addTeamMember(team.id, {
                email,
                role,
              });
              form.reset();
              await refresh();
            });
          }}
        >
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            aria-label="Add someone by email"
            placeholder="Add someone by email"
          />
          <Select name="role" aria-label="Their role" defaultValue="member">
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
      )}
      <ul className="member-list">
        {team.members.map((m, n) => {
          const self = m.user_id === user?.id;
          const options = TEAM_ROLES.filter(
            (r) => r === m.role || canChangeTeamMember(actor, m.role, r),
          );
          const canRemove = !self && canChangeTeamMember(actor, m.role, null);
          return (
            <li key={m.user_id} className="fade-up stagger" style={stagger(n)}>
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
