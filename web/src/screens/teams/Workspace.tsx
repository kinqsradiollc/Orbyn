import { useEffect, useRef, useState } from "react";
import {
  hasSystemPermission,
  hasTeamPermission,
  teamInput,
  TEAM_ROLE_LABELS,
  type Team,
  type TeamDetail,
  type TeamPermission,
} from "@orbyn/core";
import { useAccount } from "../../app/account";
import { client } from "../../lib/session";
import {
  Button,
  ErrorNotice,
  Field,
  Input,
  Pill,
  useConfirm,
} from "../../ui/kit";
import { Members } from "./Members";
import { Work } from "./Work";
import { Planning } from "./Planning";
import { Policies } from "./Policies";
import { Activity } from "./Activity";
import {
  ActionState,
  ReadState,
  readTeam,
  teamAbsent,
  useCommand,
  useOwned,
  useRead,
  useTeamsExit,
  useTeamsLeave,
} from "./state";
const tabs = ["work", "people", "time", "settings", "activity"] as const;
export type PermissionCheck = (
  permission: TeamPermission,
  membershipOnly?: boolean,
) => Promise<void>;
export function Workspace({
  teamId,
  onGone,
  onChanged,
  revision = 0,
}: {
  teamId: string;
  revision?: number;
  onGone: () => void;
  onChanged: () => void;
}) {
  const { user } = useAccount(),
    owned = useOwned(),
    read = useRead(() => readTeam(teamId), [teamId]),
    leave = useTeamsLeave(),
    confirm = useConfirm(),
    command = useCommand(),
    [tab, setTab] = useState<(typeof tabs)[number]>("work"),
    [rename, setRename] = useState(false),
    [name, setName] = useState(""),
    [validation, setValidation] = useState(""),
    confirmation = useRef(false),
    [confirming, setConfirming] = useState(false);
  const team = read.data,
    actor =
      team?.role ??
      (hasSystemPermission(user?.role, "teams:manage_all") ? "owner" : null),
    canManage = !!user && hasTeamPermission(actor, "members:manage"),
    dirty = rename && name !== team?.name;
  useTeamsExit({
    live: () => ({
      ...command.live(),
      pending: command.live().pending || confirmation.current,
    }),
    dirty,
    pending: command.pending || confirming,
    uncertain: command.unknown,
    fingerprint: JSON.stringify([rename, name]),
    discard: () => {
      setRename(false);
      setName(team?.name ?? "");
    },
  });
  const previousRevision = useRef(revision);
  useEffect(() => {
    if (previousRevision.current !== revision) {
      previousRevision.current = revision;
      void read.reload();
    }
  }, [revision, read.reload]);
  const refresh = () => {
    void read.reload();
    onChanged();
  };
  const check: PermissionCheck = async (permission, membershipOnly = false) => {
    const fresh = await readTeam(teamId);
    if (!owned()) throw Error("This team session ended.");
    read.commit(fresh);
    const effective = membershipOnly
      ? fresh.role
      : (fresh.role ??
        (hasSystemPermission(user?.role, "teams:manage_all") ? "owner" : null));
    if (!hasTeamPermission(effective, permission))
      throw Error("Your current team role does not allow this action.");
  };
  const renameTeam = () => {
    const parsed = teamInput.safeParse({ name });
    if (!parsed.success) {
      setValidation(parsed.error.issues[0]?.message ?? "Enter a valid name.");
      return;
    }
    setValidation("");
    const input = parsed.data;
    if (input.name === team?.name) return;
    void command.run<Team>({
      label: "Rename team",
      prepare: () => check("team:update"),
      perform: () => client.updateTeam(teamId, input),
      validate: (t) => t.id === teamId && t.name === input.name,
      check: async () => {
        const t = await readTeam(teamId);
        return { done: t.name === input.name, value: t };
      },
      saved: (t) => {
        void read.reload();
        setRename(false);
        onChanged();
      },
    });
  };
  const remove = async (kind: "leave" | "delete") => {
    if (
      !team ||
      !owned() ||
      command.blocked ||
      confirmation.current ||
      (kind === "leave" && !user)
    )
      return;
    if (
      !(await leave()) ||
      !owned() ||
      confirmation.current ||
      command.live().pending ||
      command.live().uncertain
    )
      return;
    confirmation.current = true;
    setConfirming(true);
    try {
      const accepted = await confirm({
        title:
          kind === "leave" ? `Leave ${team.name}?` : `Delete ${team.name}?`,
        body:
          kind === "leave"
            ? "You will lose access to shared team work. A team must retain an owner."
            : "This deletes the team for everyone and cannot be undone.",
        action: kind === "leave" ? "Leave" : "Delete team",
        danger: true,
      });
      if (!accepted || !owned()) return;
      void command.run<void>({
        label: kind,
        prepare: () =>
          check(
            kind === "delete" ? "team:delete" : "team:view",
            kind === "leave",
          ),
        perform: () =>
          kind === "delete"
            ? client.deleteTeam(teamId)
            : client.removeTeamMember(teamId, user!.id),
        validate: () => true,
        check: async () => ({
          done:
            kind === "delete"
              ? await teamAbsent(teamId)
              : !(await client.listTeams()).some((t) => t.id === teamId),
        }),
        saved: () => onGone(),
      });
    } finally {
      confirmation.current = false;
      if (owned()) setConfirming(false);
    }
  };
  return (
    <>
      <ReadState read={read} label="team" />
      {!team && !read.loading && !read.error && (
        <p>This team is unavailable.</p>
      )}
      {team && (
        <>
          <header className="teams-heading">
            <div>
              <h2 dir="auto">{team.name}</h2>
              <p className="small">
                {team.member_count} members · {team.item_count} items · created{" "}
                {new Date(team.created_at).toLocaleDateString()}
              </p>
            </div>
            <Pill>
              {team.role
                ? TEAM_ROLE_LABELS[team.role]
                : "Administrative access"}
            </Pill>
          </header>
          {team.role === null && (
            <p className="teams-warning">
              You can manage this team as a system administrator. Its shared
              work remains private to members.
            </p>
          )}
          <nav className="teams-tabs" aria-label="Team sections">
            {tabs
              .filter(
                (t) => team.role !== null || t === "people" || t === "settings",
              )
              .map((t) => (
                <Button
                  key={t}
                  aria-pressed={tab === t}
                  onClick={() =>
                    void (tab === t ? Promise.resolve(false) : leave()).then(
                      (ok) => {
                        if (ok && owned()) setTab(t);
                      },
                    )
                  }
                >
                  {
                    {
                      work: "Work",
                      people: "People",
                      time: "Team time",
                      settings: "Settings",
                      activity: "Changes",
                    }[t]
                  }
                </Button>
              ))}
          </nav>
          <ActionState command={command} />
          {(tab === "settings" || (team.role === null && tab !== "people")) && (
            <>
              <section className="teams-section">
                <h3>Team name</h3>
                {(hasTeamPermission(actor, "team:update") || rename) &&
                  (rename ? (
                    <>
                      <Field label="Name">
                        <Input
                          value={name}
                          maxLength={80}
                          disabled={
                            !hasTeamPermission(actor, "team:update") ||
                            command.blocked ||
                            confirming
                          }
                          onChange={(e) => setName(e.target.value)}
                        />
                      </Field>
                      {validation && <ErrorNotice message={validation} />}
                      <div className="teams-actions">
                        <Button
                          disabled={command.blocked || confirming}
                          onClick={() => void leave()}
                        >
                          Cancel edits
                        </Button>
                        <Button
                          variant="primary"
                          disabled={
                            !hasTeamPermission(actor, "team:update") ||
                            !hasTeamPermission(actor, "team:update") ||
                            !dirty ||
                            !name.trim() ||
                            name.trim() === team.name ||
                            command.blocked ||
                            confirming
                          }
                          busy={command.pending}
                          onClick={renameTeam}
                        >
                          Save name
                        </Button>
                      </div>
                    </>
                  ) : (
                    <Button
                      disabled={command.blocked || confirming}
                      onClick={() => {
                        setName(team.name);
                        setRename(true);
                      }}
                    >
                      Rename team
                    </Button>
                  ))}
              </section>
              {team.role !== null && <Policies teamId={teamId} check={check} />}
              <section className="teams-section">
                <h3>Membership and deletion</h3>
                {team.role !== null && (
                  <Button
                    disabled={command.blocked || confirming}
                    onClick={() => void remove("leave")}
                  >
                    Leave team
                  </Button>
                )}
                {hasTeamPermission(actor, "team:delete") && (
                  <Button
                    variant="danger"
                    disabled={command.blocked || confirming}
                    onClick={() => void remove("delete")}
                  >
                    Delete team
                  </Button>
                )}
              </section>
            </>
          )}
          {tab === "people" && (
            <Members
              team={team}
              actor={actor}
              canManage={canManage}
              check={check}
              onChanged={refresh}
            />
          )}
          {team.role !== null && tab === "work" && (
            <Work team={team} revision={revision} />
          )}
          {team.role !== null && tab === "time" && (
            <Planning team={team} canManage={canManage} check={check} />
          )}
          {team.role !== null && tab === "activity" && (
            <Activity teamId={teamId} />
          )}
        </>
      )}
    </>
  );
}
