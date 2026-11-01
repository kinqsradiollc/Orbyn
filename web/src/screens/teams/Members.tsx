import { useRef, useState } from "react";
import {
  assignableTeamRoles,
  canChangeTeamMember,
  hasSystemPermission,
  memberInput,
  TEAM_ROLE_LABELS,
  TEAM_ROLES,
  type TeamDetail,
  type TeamMember,
  type TeamRole,
} from "@orbyn/core";
import { useAccount } from "../../app/account";
import { client } from "../../lib/session";
import {
  Button,
  ErrorNotice,
  Field,
  Input,
  SelectBox,
  useConfirm,
} from "../../ui/kit";
import {
  ActionState,
  readTeam,
  validId,
  useCommand,
  useOwned,
  useTeamsExit,
} from "./state";
import type { PermissionCheck } from "./Workspace";
export function Members({
  team,
  actor,
  canManage,
  check,
  onChanged,
}: {
  team: TeamDetail;
  actor: TeamRole | null;
  canManage: boolean;
  check: PermissionCheck;
  onChanged: () => void;
}) {
  const [email, setEmail] = useState(""),
    [role, setRole] = useState<TeamRole>("member"),
    [query, setQuery] = useState(""),
    [validation, setValidation] = useState(""),
    [confirming, setConfirming] = useState(false),
    confirmation = useRef(false),
    command = useCommand(),
    owned = useOwned(),
    confirm = useConfirm(),
    { user } = useAccount();
  const reset = () => {
    setEmail("");
    setRole("member");
    setValidation("");
  };
  useTeamsExit({
    live: () => ({
      ...command.live(),
      pending: command.live().pending || confirmation.current,
    }),
    dirty: !!email || role !== "member",
    pending: command.pending || confirming,
    uncertain: command.unknown,
    fingerprint: JSON.stringify([email, role]),
    discard: reset,
  });
  const freshRole = async (
    from: TeamRole | null,
    to: TeamRole | null,
    userId?: string,
  ) => {
    await check("members:manage");
    if (!owned()) throw Error("This team session ended.");
    const fresh = await readTeam(team.id);
    if (!owned()) throw Error("This team session ended.");
    const currentActor =
        fresh.role ??
        (hasSystemPermission(user?.role, "teams:manage_all") ? "owner" : null),
      target = userId ? fresh.members.find((m) => m.user_id === userId) : null;
    if (userId && (!target || target.role !== from))
      throw Error("This membership changed. Refresh before acting.");
    if (!canChangeTeamMember(currentActor, from, to))
      throw Error("Your role no longer permits this membership change.");
    return fresh;
  };
  const add = () => {
    const parsed = memberInput.safeParse({ email, role });
    if (!parsed.success) {
      setValidation(
        parsed.error.issues[0]?.message ?? "Enter an active account email.",
      );
      return;
    }
    const input = parsed.data,
      priorIds = new Set(team.members.map((m) => m.user_id));
    if (team.members.some((m) => m.email === input.email)) {
      setValidation("This person is already a member.");
      return;
    }
    setValidation("");
    void command.run<TeamMember>({
      label: "Add member",
      prepare: async () => {
        const fresh = await freshRole(null, input.role);
        if (fresh.members.some((m) => m.email === input.email))
          throw Error("This account is already a member. Refresh the team.");
        priorIds.clear();
        fresh.members.forEach((m) => priorIds.add(m.user_id));
      },
      perform: () => client.addTeamMember(team.id, input),
      validate: (m) =>
        validId(m.user_id) &&
        !priorIds.has(m.user_id) &&
        m.email === input.email &&
        m.role === input.role,
      check: async () => {
        const fresh = await readTeam(team.id);
        const match = fresh.members.find(
          (m) =>
            validId(m.user_id) &&
            !priorIds.has(m.user_id) &&
            m.email === input.email &&
            m.role === input.role,
        );
        return { done: !!match, value: match };
      },
      saved: () => {
        reset();
        onChanged();
      },
    });
  };
  const change = async (member: TeamMember, next: TeamRole | null) => {
    if (next === member.role) return;
    if (
      command.blocked ||
      confirmation.current ||
      !owned() ||
      !canChangeTeamMember(actor, member.role, next)
    )
      return;
    confirmation.current = true;
    setConfirming(true);
    try {
      if (
        !(await confirm({
          title: next
            ? `Change ${member.name} to ${TEAM_ROLE_LABELS[next]}?`
            : `Remove ${member.name}?`,
          body:
            member.user_id === user?.id
              ? "You may lose team access or management controls. The team must retain an owner."
              : next
                ? "This changes their access to the team."
                : "They will lose access to shared team work.",
          action: next ? "Change role" : "Remove",
          danger: !next,
        })) ||
        !owned()
      )
        return;
      if (next)
        void command.run<TeamMember>({
          label: "Change role",
          prepare: () => freshRole(member.role, next, member.user_id),
          perform: () =>
            client.updateTeamMember(team.id, member.user_id, { role: next }),
          validate: (m) => m.user_id === member.user_id && m.role === next,
          check: async () => {
            const t = await readTeam(team.id),
              m = t.members.find((m) => m.user_id === member.user_id);
            return { done: m?.role === next, value: m };
          },
          saved: () => onChanged(),
        });
      else
        void command.run<void>({
          label: "Remove member",
          prepare: () => freshRole(member.role, null, member.user_id),
          perform: () => client.removeTeamMember(team.id, member.user_id),
          validate: () => true,
          check: async () => {
            if (member.user_id === user?.id)
              return {
                done: !(await client.listTeams()).some((t) => t.id === team.id),
              };
            const t = await readTeam(team.id);
            return {
              done: !t.members.some((m) => m.user_id === member.user_id),
            };
          },
          saved: () => onChanged(),
        });
    } finally {
      confirmation.current = false;
      if (owned()) setConfirming(false);
    }
  };
  const filtered = team.members.filter((m) =>
    `${m.name} ${m.email}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <section className="teams-section">
      <h3>People</h3>
      <Field label="Find a member">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </Field>
      <ActionState command={command} />
      {!filtered.length && <p>No members match your search.</p>}
      <ul className="teams-people">
        {filtered.map((m) => (
          <li key={m.user_id}>
            <div>
              <strong dir="auto">{m.name}</strong>
              <span dir="auto">{m.email}</span>
            </div>
            <div className="teams-actions">
              {canManage && canChangeTeamMember(actor, m.role, m.role) ? (
                <SelectBox
                  aria-label={`Role for ${m.name}`}
                  value={m.role}
                  disabled={!canManage || command.blocked || confirming}
                  onChange={(e) => void change(m, e.target.value as TeamRole)}
                >
                  {TEAM_ROLES.filter((r) =>
                    canChangeTeamMember(actor, m.role, r),
                  ).map((r) => (
                    <option key={r} value={r}>
                      {TEAM_ROLE_LABELS[r]}
                    </option>
                  ))}
                </SelectBox>
              ) : (
                <span>{TEAM_ROLE_LABELS[m.role]}</span>
              )}
              {canManage && canChangeTeamMember(actor, m.role, null) && (
                <Button
                  variant="ghost"
                  disabled={!canManage || command.blocked || confirming}
                  onClick={() => void change(m, null)}
                >
                  Remove
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {(canManage || !!email || role !== "member") && (
        <form
          className="teams-form"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <h4>Add an existing Orbyn account</h4>
          {!canManage && (
            <p role="alert">
              Your role no longer allows adding people. Your draft is retained.
            </p>
          )}
          <Field label="Email">
            <Input
              type="email"
              value={email}
              disabled={!canManage || command.blocked || confirming}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Role">
            <SelectBox
              value={role}
              disabled={!canManage || command.blocked || confirming}
              onChange={(e) => setRole(e.target.value as TeamRole)}
            >
              {!assignableTeamRoles(actor).includes(role) && (
                <option value={role} disabled>
                  {TEAM_ROLE_LABELS[role]} (no longer allowed)
                </option>
              )}
              {assignableTeamRoles(actor).map((r) => (
                <option key={r} value={r}>
                  {TEAM_ROLE_LABELS[r]}
                </option>
              ))}
            </SelectBox>
          </Field>
          <p className="small">
            This adds the account immediately. Their connected agent may receive
            a team notification; no invitation link is created.
          </p>
          {validation && <ErrorNotice message={validation} />}
          <Button
            type="submit"
            variant="primary"
            disabled={
              !canManage ||
              !assignableTeamRoles(actor).includes(role) ||
              !email.trim() ||
              command.blocked ||
              confirming
            }
            busy={command.pending}
          >
            Add member
          </Button>
        </form>
      )}
    </section>
  );
}
