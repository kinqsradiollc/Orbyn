import { TEAM_ROLE_LABELS, type TeamRole } from "@orbyn/core";

/** Pill showing a team role. `null` means a system admin managing a team they are not in. */
export function RoleBadge({ role }: { role: TeamRole | null }) {
  if (!role) return <span className="role-badge override">Admin access</span>;
  return <span className={"role-badge " + role}>{TEAM_ROLE_LABELS[role]}</span>;
}
