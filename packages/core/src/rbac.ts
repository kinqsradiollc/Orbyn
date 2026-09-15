/**
 * Role-based access control shared by the backend (enforcement) and the
 * clients (deciding what to show). The backend is the only authority; clients
 * use these helpers purely for UI.
 */

/** Account-wide roles. Admins run the workspace; members use it. */
export const SYSTEM_ROLES = ["admin", "member"] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

/** Roles inside a team, from most to least privileged. */
export const TEAM_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const SYSTEM_PERMISSIONS = [
  "admin:access",
  "users:read",
  "users:manage",
  "teams:read_all",
  "teams:manage_all",
  "audit:read",
  "ai:manage",
  "system:manage",
] as const;
export type SystemPermission = (typeof SYSTEM_PERMISSIONS)[number];

export const TEAM_PERMISSIONS = [
  "team:view",
  "items:read",
  "items:write",
  "members:manage",
  "team:update",
  "team:delete",
] as const;
export type TeamPermission = (typeof TEAM_PERMISSIONS)[number];

export const SYSTEM_ROLE_PERMISSIONS: Record<
  SystemRole,
  readonly SystemPermission[]
> = {
  admin: SYSTEM_PERMISSIONS,
  member: [],
};

export const TEAM_ROLE_PERMISSIONS: Record<
  TeamRole,
  readonly TeamPermission[]
> = {
  owner: TEAM_PERMISSIONS,
  admin: [
    "team:view",
    "items:read",
    "items:write",
    "members:manage",
    "team:update",
  ],
  member: ["team:view", "items:read", "items:write"],
  viewer: ["team:view", "items:read"],
};

export const TEAM_ROLE_RANK: Record<TeamRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

export const hasSystemPermission = (
  role: SystemRole | null | undefined,
  permission: SystemPermission,
) => !!role && SYSTEM_ROLE_PERMISSIONS[role].includes(permission);

export const hasTeamPermission = (
  role: TeamRole | null | undefined,
  permission: TeamPermission,
) => !!role && TEAM_ROLE_PERMISSIONS[role].includes(permission);

/**
 * Whether someone acting as `actor` may move a member from `from` to `to`.
 * `from` is null when adding someone; `to` is null when removing them.
 * Owners manage everyone. Team admins manage members and viewers only and
 * cannot grant admin or owner.
 */
export function canChangeTeamMember(
  actor: TeamRole | null | undefined,
  from: TeamRole | null,
  to: TeamRole | null,
) {
  if (actor === "owner") return true;
  if (actor !== "admin") return false;
  const below = (role: TeamRole | null) =>
    role === null || TEAM_ROLE_RANK[role] < TEAM_ROLE_RANK.admin;
  return below(from) && below(to);
}

/** Roles `actor` is allowed to hand out, for building role pickers. */
export const assignableTeamRoles = (actor: TeamRole | null | undefined) =>
  TEAM_ROLES.filter((role) => canChangeTeamMember(actor, null, role));
