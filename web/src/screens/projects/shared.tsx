import { hasTeamPermission, type Team, type Project } from "@orbyn/core";

export const canWriteProject = (
  project: Pick<Project, "team_id">,
  teams: Team[],
) =>
  !project.team_id ||
  hasTeamPermission(
    teams.find((t) => t.id === project.team_id)?.role,
    "items:write",
  );

export const canManageAi = (
  project: Pick<Project, "team_id" | "user_id">,
  teams: Team[],
  userId: string,
) =>
  project.team_id
    ? ["owner", "admin"].includes(
        teams.find((t) => t.id === project.team_id)?.role ?? "",
      )
    : project.user_id === userId;

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

/** "Fri 16 Oct", or "Fri 16 Oct, 5 pm" with the time. */
export function dayLabel(iso: string, withTime = false) {
  const at = new Date(iso);
  const day = at.toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  if (!withTime) return day;
  const time = at
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    .toLowerCase();
  return `${day}, ${time}`;
}

export const ask = (id: string, question: string) =>
  `/app/assistant?project=${encodeURIComponent(id)}&ask=${encodeURIComponent(question)}`;
