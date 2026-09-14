import { useState } from "react";
import {
  ArrowLeft,
  BellRing,
  CircleDashed,
  LayoutDashboard,
  ListTodo,
  Network,
  ScrollText,
  ShieldCheck,
  TriangleAlert,
  UserX,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { AdminOverview } from "@orbyn/core";
import { client } from "../../lib/api";
import { useRemote } from "../../hooks/useRemote";
import { RoleBadge } from "../../components/RoleBadge";
import { TeamDetail, type TeamActions } from "../teams/TeamDetail";
import { AdminUsers } from "./AdminUsers";
import { AdminAudit } from "./AdminAudit";

type Tab = "Overview" | "Users" | "Teams" | "Audit log";

const TABS: { label: Tab; icon: LucideIcon }[] = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Users", icon: Users },
  { label: "Teams", icon: Network },
  { label: "Audit log", icon: ScrollText },
];

const STATS: { key: keyof AdminOverview; label: string; icon: LucideIcon }[] = [
  { key: "users", label: "Users", icon: Users },
  { key: "admins", label: "Admins", icon: ShieldCheck },
  { key: "disabled_users", label: "Disabled users", icon: UserX },
  { key: "teams", label: "Teams", icon: Network },
  { key: "items", label: "Items", icon: ListTodo },
  { key: "open_items", label: "Open items", icon: CircleDashed },
  {
    key: "notifications_pending",
    label: "Pending notifications",
    icon: BellRing,
  },
  {
    key: "notifications_failed",
    label: "Failed notifications",
    icon: TriangleAlert,
  },
];

/** System admin console. Only rendered for `admin:access`; the server enforces it too. */
export function AdminView(props: TeamActions) {
  const [tab, setTab] = useState<Tab>("Overview");
  const [teamId, setTeamId] = useState<string | null>(null);

  return (
    <>
      <div className="tabs" role="tablist" aria-label="Admin sections">
        {TABS.map(({ label, icon: Icon }) => (
          <button
            key={label}
            role="tab"
            aria-selected={tab === label}
            className={tab === label ? "active" : ""}
            onClick={() => {
              setTab(label);
              setTeamId(null);
            }}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      {tab === "Overview" && (
        <OverviewPanel revision={props.revision} report={props.report} />
      )}
      {tab === "Users" && <AdminUsers {...props} />}
      {tab === "Teams" &&
        (teamId ? (
          <>
            <button className="text-button" onClick={() => setTeamId(null)}>
              <ArrowLeft size={14} /> All teams
            </button>
            <TeamDetail
              key={teamId}
              teamId={teamId}
              onClose={() => setTeamId(null)}
              {...props}
            />
          </>
        ) : (
          <TeamsPanel
            revision={props.revision}
            report={props.report}
            onOpen={setTeamId}
          />
        ))}
      {tab === "Audit log" && <AdminAudit report={props.report} />}
    </>
  );
}

function OverviewPanel({
  revision,
  report,
}: Pick<TeamActions, "revision" | "report">) {
  const data = useRemote(() => client.adminOverview(), [revision], report);
  return (
    <div className="stat-grid">
      {STATS.map(({ key, label, icon: Icon }) => (
        <div className="card stat-card" key={key}>
          <span>
            <Icon size={15} /> {label}
          </span>
          <strong>{data ? data[key] : "–"}</strong>
        </div>
      ))}
    </div>
  );
}

function TeamsPanel({
  revision,
  report,
  onOpen,
}: Pick<TeamActions, "revision" | "report"> & {
  onOpen: (id: string) => void;
}) {
  const teams = useRemote(() => client.adminListTeams(), [revision], report);
  return (
    <section className="card">
      <div className="section-heading">
        <h2>
          All teams <span>{teams?.length ?? 0}</span>
        </h2>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Team</th>
              <th>Your role</th>
              <th>Members</th>
              <th>Items</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {teams?.map((t) => (
              <tr key={t.id}>
                <td>
                  <button className="link-button" onClick={() => onOpen(t.id)}>
                    {t.name}
                  </button>
                </td>
                <td>
                  {t.role ? (
                    <RoleBadge role={t.role} />
                  ) : (
                    <span className="muted">Not a member</span>
                  )}
                </td>
                <td>{t.member_count}</td>
                <td>{t.item_count}</td>
                <td>{new Date(t.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
            {teams && !teams.length && (
              <tr>
                <td colSpan={5} className="muted table-empty">
                  No teams have been created yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
