import { useElementWidth } from "../../hooks/useElementWidth";
import { useState } from "react";
import { Select } from "../../components/Select";
import "./admin-workspace.css";
import {
  ArrowLeft,
  Bot,
  BellRing,
  CircleDashed,
  Activity,
  BarChart3,
  Database,
  HardDrive,
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
import { AdminStorage } from "./AdminStorage";
import { AdminRequests } from "./AdminRequests";
import { AdminAnalytics } from "./AdminAnalytics";
import { AdminAgents } from "./AdminAgents";
import { AdminUserDetail } from "./AdminUserDetail";
import { errorText } from "../../lib/errors";
import { session } from "../../lib/session";
import "./insights.css";

type Tab =
  | "Overview"
  | "Analytics"
  | "Requests"
  | "Users"
  | "Teams"
  | "Audit log"
  | "Database"
  | "Storage"
  | "AI"
  | "Agents"
  | "System";

const TABS: { label: Tab; icon: LucideIcon }[] = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Analytics", icon: BarChart3 },
  { label: "Requests", icon: Activity },
  { label: "Users", icon: Users },
  { label: "Teams", icon: Network },
  { label: "Audit log", icon: ScrollText },
  { label: "Database", icon: Database },
  { label: "Storage", icon: HardDrive },
  { label: "AI", icon: Sparkles },
  { label: "Agents", icon: Bot },
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
export function AdminView(
  props: TeamActions & { onMaintenanceChange?: (m: Maintenance) => void },
) {
  return (
    <AdminWorkspace
      key={`${session.get()}:${props.user?.id ?? ""}`}
      {...props}
    />
  );
}
function AdminWorkspace({
  onMaintenanceChange,
  ...props
}: TeamActions & { onMaintenanceChange?: (m: Maintenance) => void }) {
  const { ref: pageRef, width: pageWidth } = useElementWidth();
  const { ref: contentRef, width: contentWidth } = useElementWidth();
  const [tab, setTab] = useState<Tab>("Overview");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const canSeeRequests = hasSystemPermission(props.user?.role, "requests:read");
  const canSeeAnalytics = hasSystemPermission(
    props.user?.role,
    "analytics:read",
  );
  const canManageAi = hasSystemPermission(props.user?.role, "ai:manage");
  const canManageSystem = hasSystemPermission(
    props.user?.role,
    "system:manage",
  );
  const tabs = TABS.filter(
    (t) =>
      (t.label !== "AI" || canManageAi) &&
      (t.label !== "Requests" || canSeeRequests) &&
      (t.label !== "Analytics" || canSeeAnalytics) &&
      (t.label !== "Database" || canManageSystem) &&
      (t.label !== "Storage" || canManageSystem) &&
      (t.label !== "Agents" || canManageSystem) &&
      (t.label !== "System" || canManageSystem),
  );

  const activeTab = tabs.some((entry) => entry.label === tab)
    ? tab
    : "Overview";
  return (
    <div
      ref={pageRef}
      className={"admin-workspace" + (pageWidth < 900 ? " is-compact" : "")}
    >
      <aside className="admin-navigation" aria-label="Admin sections">
        {[
          { label: "People", items: ["Overview", "Users", "Teams"] },
          { label: "AI", items: ["AI", "Agents"] },
          {
            label: "Operations",
            items: [
              "Audit log",
              "Analytics",
              "Requests",
              "Database",
              "Storage",
              "System",
            ],
          },
        ].map((group) => {
          const entries = tabs.filter((entry) =>
            group.items.includes(entry.label),
          );
          if (!entries.length) return null;
          return (
            <div className="admin-navigation-group" key={group.label}>
              <h3>{group.label}</h3>
              {entries.map(({ label, icon: Icon }) => (
                <button
                  key={label}
                  aria-current={activeTab === label ? "page" : undefined}
                  className={activeTab === label ? "active" : ""}
                  onClick={() => {
                    setTab(label);
                    setTeamId(null);
                    setUserId(null);
                  }}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          );
        })}
      </aside>
      <section
        ref={contentRef}
        className={
          "admin-content" +
          (contentWidth < 780 ? " is-narrow" : "") +
          (contentWidth < 640 ? " is-small" : "")
        }
        aria-label={activeTab}
      >
        <label className="admin-section-picker">
          Section
          <Select
            value={activeTab}
            onChange={(event) => {
              const chosen = tabs.find(
                (entry) => entry.label === event.target.value,
              );
              if (chosen) {
                setTab(chosen.label);
                setTeamId(null);
                setUserId(null);
              }
            }}
          >
            {tabs.map(({ label }) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        {activeTab === "Overview" && (
          <OverviewPanel
            revision={props.revision}
            report={props.report}
            canManageSystem={canManageSystem}
            onNavigate={setTab}
          />
        )}
        {activeTab === "Analytics" && canSeeAnalytics && (
          <AdminAnalytics report={props.report} />
        )}
        {activeTab === "Requests" && canSeeRequests && (
          <AdminRequests report={props.report} />
        )}
        {activeTab === "Users" &&
          (userId ? (
            <AdminUserDetail
              key={userId}
              userId={userId}
              selfId={props.user?.id}
              report={props.report}
              onBack={() => setUserId(null)}
            />
          ) : (
            <AdminUsers {...props} onOpen={setUserId} />
          ))}
        {activeTab === "Teams" &&
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
        {activeTab === "Audit log" && <AdminAudit report={props.report} />}
        {activeTab === "Database" && canManageSystem && (
          <AdminDatabase
            report={props.report}
            user={props.user}
            refresh={props.refresh}
          />
        )}
        {activeTab === "Storage" && canManageSystem && (
          <AdminStorage report={props.report} />
        )}
        {activeTab === "AI" && canManageAi && <AdminAi {...props} />}
        {activeTab === "Agents" && canManageSystem && (
          <AdminAgents report={props.report} />
        )}
        {activeTab === "System" && canManageSystem && (
          <AdminSystem
            user={props.user}
            report={props.report}
            onMaintenanceChange={onMaintenanceChange}
          />
        )}
      </section>
    </div>
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
  const [retry, setRetry] = useState(0);
  const [dataError, setDataError] = useState("");
  const [activityError, setActivityError] = useState("");
  const data = useRemote(
    () => client.adminOverview(),
    [revision, retry],
    (e) => {
      setDataError(errorText(e));
      report(e);
    },
  );
  const activity = useRemote(
    () => client.adminListAudit({ limit: 6 }),
    [revision, retry],
    (e) => {
      setActivityError(errorText(e));
      report(e);
    },
  );
  return (
    <>
      {(dataError || activityError) && (
        <div className="error" role="alert">
          <p>{dataError || activityError}</p>
          <button
            className="secondary"
            onClick={() => {
              setDataError("");
              setActivityError("");
              setRetry((value) => value + 1);
            }}
          >
            Retry overview
          </button>
        </div>
      )}
      <div className="stat-grid">
        {STATS.map(({ key, label, icon: Icon }) => (
          <div className="stat-card" key={key}>
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
            <p className="muted admin-recent-empty">
              {activity === null
                ? activityError
                  ? "Recent changes unavailable."
                  : "Loading recent changes…"
                : "No changes recorded yet."}
            </p>
          )}
        </section>
        {canManageSystem && (
          <section className="admin-safety">
            <button
              className="secondary"
              onClick={() => onNavigate("Database")}
            >
              <Database size={14} /> Explore database
            </button>
            <details>
              <summary>Admin changes</summary>
              <p>Changes are logged. Database previews mask private content.</p>
            </details>
          </section>
        )}
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
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const teams = useRemote(
    () => client.adminListTeams(),
    [revision, retry],
    (e) => {
      setError(errorText(e));
      report(e);
    },
  );
  const filtered = teams?.filter((team) =>
    team.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <section className="card">
      <div className="section-heading">
        <h2>
          Teams <span>{teams === null ? "—" : teams.length}</span>
        </h2>
      </div>
      <label>
        Search teams
        <input
          type="search"
          value={query}
          maxLength={200}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {error && (
        <div className="error" role="alert">
          {error}
          <button
            className="secondary"
            onClick={() => {
              setError("");
              setRetry((value) => value + 1);
            }}
          >
            Retry teams
          </button>
        </div>
      )}
      {!teams && !error && <p className="muted">Loading teams…</p>}
      {teams && !!teams.length && !filtered?.length && (
        <p className="muted">No matching teams.</p>
      )}
      <div className="table-wrap">
        <table className="data-table stack-table">
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
            {filtered?.map((t) => (
              <tr key={t.id}>
                <td>
                  <button className="link-button" onClick={() => onOpen(t.id)}>
                    {t.name}
                  </button>
                </td>
                <td data-label="Your role">
                  {t.role ? (
                    <RoleBadge role={t.role} />
                  ) : (
                    <span className="muted">Not a member</span>
                  )}
                </td>
                <td data-label="Members">{t.member_count}</td>
                <td data-label="Items">{t.item_count}</td>
                <td data-label="Created">
                  {new Date(t.created_at).toLocaleDateString()}
                </td>
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
