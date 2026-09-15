import { useState } from "react";
import { Plus, Users } from "lucide-react";
import type { Team } from "@orbyn/core";
import { client } from "../../lib/api";
import { EmptyState } from "../../components/EmptyState";
import { RoleBadge } from "../../components/RoleBadge";
import { TeamDetail, type TeamActions } from "./TeamDetail";
import { stagger } from "../../lib/motion";

type Props = TeamActions & { teams: Team[] };

/** Your teams, a create-team form, and the selected team's detail panel. */
export function TeamsView({ teams, ...ctx }: Props) {
  const { busy, act, refresh } = ctx;
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  // Drop the selection once the team is gone (deleted, or you left it).
  const active =
    selected && teams.some((t) => t.id === selected) ? selected : null;

  return (
    <div className="teams-layout">
      <section className="card team-list">
        <div className="section-heading">
          <h2>
            Your teams <span>{teams.length}</span>
          </h2>
        </div>
        {teams.map((t, n) => (
          <button
            key={t.id}
            className={
              "team-row fade-up stagger " + (active === t.id ? "active" : "")
            }
            style={stagger(n)}
            aria-pressed={active === t.id}
            onClick={() => setSelected(t.id)}
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
        {!teams.length && (
          <EmptyState
            icon={Users}
            title="No teams yet."
            body="Create a team to share tasks and events with others."
          />
        )}
        <form
          className="inline-form create-team"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) return;
            void act(async () => {
              const team = await client.createTeam({ name: trimmed });
              setName("");
              await refresh();
              setSelected(team.id);
            });
          }}
        >
          <input
            aria-label="New team name"
            placeholder="New team name"
            maxLength={80}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="primary" disabled={busy || !name.trim()}>
            <Plus size={15} /> Create
          </button>
        </form>
      </section>
      {active ? (
        <TeamDetail
          key={active}
          teamId={active}
          onClose={() => setSelected(null)}
          {...ctx}
        />
      ) : (
        <section className="card">
          <EmptyState
            icon={Users}
            title="Pick a team."
            body="Select a team to see its members and shared plans."
          />
        </section>
      )}
    </div>
  );
}
