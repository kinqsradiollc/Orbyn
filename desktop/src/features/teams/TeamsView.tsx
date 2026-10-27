import { useElementWidth } from "../../hooks/useElementWidth";
import { useContext, useEffect, useRef, useState } from "react";
import { session } from "../../lib/session";
import { useConfirm } from "../../components/Confirm";
import { SettingsEditor } from "../settings/SettingsEditor";
import {
  PageCommandScope,
  preparePageLeave,
  usePaneLeaveGuard,
} from "../../app/page-commands";
import { errorText } from "../planner/planning";
import { newId } from "@orbyn/core";
import { Plus, Users } from "lucide-react";
import type { Team } from "@orbyn/core";
import { client } from "../../lib/api";
import { EmptyState } from "../../components/EmptyState";
import { RoleBadge } from "../../components/RoleBadge";
import { TeamDetail, type TeamActions } from "./TeamDetail";

type Props = TeamActions & { teams: Team[] };

/** Your teams, a create-team form, and the selected team's detail panel. */
export function TeamsView(props: Props) {
  return (
    <TeamsBody key={`${session.get()}:${props.user?.id ?? ""}`} {...props} />
  );
}
function TeamsBody({ teams, ...ctx }: Props) {
  const { ref: pageRef, width: pageWidth } = useElementWidth();
  const { busy, refresh } = ctx;
  const commandScope = useContext(PageCommandScope);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Team | null>(null);
  const requests = useRef(new Map<string, string>());
  const lock = useRef(false);
  const owner = useRef(session.get()).current;
  const mounted = useRef(true);
  const owns = () => mounted.current && session.get() === owner;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { ask } = useConfirm();
  const closeCreate = async () => {
    if (lock.current || !owns()) return;
    lock.current = true;
    try {
      if (
        name.trim() &&
        !(await ask({
          title: "Discard this team draft?",
          confirmLabel: "Discard",
          destructive: true,
        }))
      )
        return;
      if (!owns()) return false;
      setName("");
      setError("");
      setCreating(false);
      return true;
    } finally {
      lock.current = false;
    }
  };
  usePaneLeaveGuard(async () => {
    if (!owns() || lock.current) return false;
    if (!creating) return true;
    return (await closeCreate()) === true;
  });
  const selectTeam = async (id: string) => {
    if (!(await preparePageLeave(commandScope)) || !owns()) return;
    setSelected(id);
  };
  const openCreate = async () => {
    if (!(await preparePageLeave(commandScope)) || !owns()) return;
    setCreating(true);
  };
  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy || lock.current || !owns()) return;
    lock.current = true;
    setWriting(true);
    setError("");
    const request = requests.current.get(trimmed) ?? newId();
    requests.current.set(trimmed, request);
    try {
      const team = await client.once(request, () =>
        client.createTeam({ name: trimmed }),
      );
      if (!owns()) return;
      setCreated(team);
      setSelected(team.id);
      setName("");
      setCreating(false);
      try {
        await refresh();
      } catch (e) {
        if (owns()) setError("Team created. Couldn't refresh the list.");
      }
    } catch (e) {
      if (owns()) setError(errorText(e));
    } finally {
      lock.current = false;
      if (owns()) setWriting(false);
    }
  };
  useEffect(() => {
    if (created && teams.some((team) => team.id === created.id))
      setCreated(null);
  }, [created, teams]);
  const availableTeams =
    created && !teams.some((t) => t.id === created.id)
      ? [created, ...teams]
      : teams;
  // Drop the selection once the team is gone (deleted, or you left it).
  const active =
    selected && availableTeams.some((t) => t.id === selected) ? selected : null;

  return (
    <div
      ref={pageRef}
      className={
        "teams-layout" +
        (pageWidth < 900 ? " is-compact" : "") +
        (active ? " is-detail-open" : "")
      }
    >
      <section className="card team-list">
        <div className="section-heading">
          <span className="muted">
            {availableTeams.length}{" "}
            {availableTeams.length === 1 ? "team" : "teams"}
          </span>
          <button
            type="button"
            className="primary"
            disabled={busy || writing}
            onClick={() => {
              void openCreate();
            }}
          >
            <Plus size={15} /> New team
          </button>
        </div>
        {error && !creating && (
          <div className="error" role="alert">
            {error}
            <button
              type="button"
              className="text-button"
              onClick={() =>
                void refresh().then(
                  () => {
                    if (owns()) setError("");
                  },
                  (e) => {
                    if (owns()) setError(errorText(e));
                  },
                )
              }
            >
              Retry
            </button>
          </div>
        )}
        {availableTeams.map((t) => (
          <button
            key={t.id}
            className={"team-row " + (active === t.id ? "active" : "")}
            aria-pressed={active === t.id}
            onClick={() => {
              void selectTeam(t.id);
            }}
          >
            <span className="team-avatar">{t.name[0]?.toUpperCase()}</span>
            <span className="team-row-main">
              <strong>{t.name}</strong>
              <small>
                {t.member_count} {t.member_count === 1 ? "member" : "members"} ·{" "}
                {t.item_count} {t.item_count === 1 ? "item" : "items"}
              </small>
            </span>
            <RoleBadge role={t.role} />
          </button>
        ))}
        {!availableTeams.length && (
          <EmptyState icon={Users} title="No teams yet." />
        )}
        {creating && (
          <SettingsEditor
            title="New team"
            pending={writing}
            onClose={() => {
              void closeCreate();
            }}
          >
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <label className="settings-field">
                Team name
                <input
                  autoFocus
                  required
                  maxLength={80}
                  value={name}
                  disabled={writing}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button
                className="primary"
                disabled={busy || writing || !name.trim()}
              >
                {writing ? "Creating…" : "Create team"}
              </button>
            </form>
          </SettingsEditor>
        )}
      </section>
      {active ? (
        <TeamDetail
          key={active}
          teamId={active}
          onClose={() => setSelected(null)}
          onGone={() => {
            setCreated(null);
            setSelected(null);
          }}
          {...ctx}
        />
      ) : (
        <section className="card">
          <EmptyState
            icon={Users}
            title="Pick a team."
            body="Members and shared plans appear here."
          />
        </section>
      )}
    </div>
  );
}
