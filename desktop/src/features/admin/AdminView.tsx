import { useState } from "react";
import {
  ArrowLeft,
  BellRing,
  CircleDashed,
  Database,
  LayoutDashboard,
  ListTodo,
  Network,
  ScrollText,
  ServerCog,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UserX,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  hasSystemPermission,
  type AdminOverview,
  type Maintenance,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { useRemote } from "../../hooks/useRemote";
import { RoleBadge } from "../../components/RoleBadge";
import { TeamDetail, type TeamActions } from "../teams/TeamDetail";
import { AdminUsers } from "./AdminUsers";
import { AdminAudit } from "./AdminAudit";
import { AdminAi } from "./AdminAi";
import { AdminSystem } from "./AdminSystem";
import { AdminDatabase } from "./AdminDatabase";
import { stagger } from "../../lib/motion";

type Tab =
  "Overview" | "Users" | "Teams" | "Audit log" | "Database" | "AI" | "System";

const TABS: { label: Tab; icon: LucideIcon }[] = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Users", icon: Users },
  { label: "Teams", icon: Network },
  { label: "Audit log", icon: ScrollText },
  { label: "Database", icon: Database },
  { label: "AI", icon: Sparkles },
  { label: "System", icon: ServerCog },
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
export function AdminView({
  onMaintenanceChange,
  ...props
}: TeamActions & { onMaintenanceChange?: (m: Maintenance) => void }) {
  const [tab, setTab] = useState<Tab>("Overview");
  const [teamId, setTeamId] = useState<string | null>(null);
  const canManageAi = hasSystemPermission(props.user?.role, "ai:manage");
  const canManageSystem = hasSystemPermission(
    props.user?.role,
    "system:manage",
  );
  const tabs = TABS.filter(
    (t) =>
      (t.label !== "AI" || canManageAi) &&
      (t.label !== "Database" || canManageSystem) &&
      (t.label !== "System" || canManageSystem),
  );

  return (
    <>
      <div className="tabs" role="tablist" aria-label="Admin sections">
        {tabs.map(({ label, icon: Icon }) => (
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
        <OverviewPanel
          revision={props.revision}
          report={props.report}
          canManageSystem={canManageSystem}
          onNavigate={setTab}
        />
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
              warnOnChanges
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
      {tab === "Database" && canManageSystem && (
        <AdminDatabase
          report={props.report}
          user={props.user}
          refresh={props.refresh}
        />
      )}
      {tab === "AI" && canManageAi && <AdminAi {...props} />}
      {tab === "System" && canManageSystem && (
        <AdminSystem
          user={props.user}
          report={props.report}
          onMaintenanceChange={onMaintenanceChange}
        />
      )}
    </>
  );
}

function OverviewPanel({
  revision,
  report,
  canManageSystem,
  onNavigate,
}: Pick<TeamActions, "revision" | "report"> & {
  canManageSystem: boolean;
  onNavigate: (tab: Tab) => void;
}) {
  const data = useRemote(() => client.adminOverview(), [revision], report);
  const activity = useRemote(
    () => client.adminListAudit({ limit: 6 }),
    [revision],
    report,
  );
  return (
    <>
      <div className="stat-grid">
        {STATS.map(({ key, label, icon: Icon }, n) => (
          <div
            className="card stat-card fade-up stagger"
            style={stagger(n)}
            key={key}
          >
            <span>
              <Icon size={15} /> {label}
            </span>
            <strong>{data ? data[key] : "–"}</strong>
          </div>
        ))}
      </div>
      <div className="admin-overview-lower">
        <section className="card admin-recent">
          <div className="section-heading">
            <h2>Recent changes</h2>
            <button
              className="link-button"
              onClick={() => onNavigate("Audit log")}
            >
              View audit log
            </button>
          </div>
          {activity?.rows.length ? (
            <div className="admin-recent-list">
              {activity.rows.map((entry) => (
                <div key={entry.id}>
                  <span>
                    <strong>{entry.action.replaceAll(".", " · ")}</strong>
                    <small>{entry.actor_email ?? "System"}</small>
                  </span>
                  <time dateTime={entry.created_at}>
                    {new Date(entry.created_at).toLocaleString()}
                  </time>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted admin-recent-empty">No changes recorded yet.</p>
          )}
        </section>
        <section className="card admin-safety">
          <ShieldCheck size={20} />
          <h2>Changes stay deliberate</h2>
          <p>
            Admin actions show a warning before they apply. The audit log
            records changes, and database previews mask private content.
          </p>
          {canManageSystem && (
            <button
              className="secondary"
              onClick={() => onNavigate("Database")}
            >
              <Database size={14} /> Explore database
            </button>
          )}
        </section>
      </div>
    </>
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
            {teams?.map((t, n) => (
              <tr key={t.id} className="fade-up stagger" style={stagger(n)}>
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
