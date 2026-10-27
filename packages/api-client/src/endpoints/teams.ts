import {
  type AttentionCheck,
  type MemberPresence,
  type MemberWorkload,
  type Team,
  type TeamAnalytics,
  type TeamAttention,
  type TeamCapacity,
  type TeamDetail,
  type TeamMember,
  type TeamPolicies,
  type TeamRole,
  teamsChannelConnection,
  teamsChannelDisconnect,
  teamsChannelPermission,
  teamsConversationChallenge,
  teamsInstallationConfirm,
  teamsInstallationId,
  teamsInstallationRequest,
  teamsInstallationStart,
} from "@orbyn/core";
import type { OrbynClient } from "../client.js";

export async function callStartTeamsInstallation(
  this: OrbynClient,
  signal?: AbortSignal,
) {
  return teamsInstallationStart.parse(
    await this.request("/agent-channels/teams/installations", {
      method: "POST",
      body: {},
      signal,
    }),
  );
}

export async function callTeamsInstallation(
  this: OrbynClient,
  id: string,
  signal?: AbortSignal,
) {
  const requestId = teamsInstallationId.parse(id);
  return teamsInstallationRequest.parse(
    await this.request(`/agent-channels/teams/installations/${requestId}`, {
      fresh: true,
      signal,
    }),
  );
}

export async function callConfirmTeamsInstallation(
  this: OrbynClient,
  id: string,
  input: unknown,
  signal?: AbortSignal,
) {
  const requestId = teamsInstallationId.parse(id);
  return teamsConversationChallenge.parse(
    await this.request(
      `/agent-channels/teams/installations/${requestId}/confirm`,
      { method: "POST", body: teamsInstallationConfirm.parse(input), signal },
    ),
  );
}

export async function callRestartTeamsConversationLink(
  this: OrbynClient,
  input: unknown,
  signal?: AbortSignal,
) {
  return teamsConversationChallenge.parse(
    await this.request("/agent-channels/teams/conversation-link", {
      method: "POST",
      body: teamsChannelDisconnect.parse(input),
      signal,
    }),
  );
}

export async function callSetTeamsDmPermission(
  this: OrbynClient,
  input: unknown,
  signal?: AbortSignal,
) {
  return teamsChannelConnection.parse(
    await this.request("/agent-channels/teams/permission", {
      method: "PUT",
      body: teamsChannelPermission.parse(input),
      signal,
    }),
  );
}

export async function callDisconnectTeams(
  this: OrbynClient,
  input: unknown,
  signal?: AbortSignal,
) {
  return teamsChannelConnection.parse(
    await this.request("/agent-channels/teams/disconnect", {
      method: "POST",
      body: teamsChannelDisconnect.parse(input),
      signal,
    }),
  );
}

/** A team's switches for publishing, the assistant and booking (OTH-04). */

export function callGetTeamPolicies(this: OrbynClient, teamId: string) {
  return this.request<TeamPolicies>(`/teams/${teamId}/policies`);
}

export function callSetTeamPolicies(
  this: OrbynClient,
  teamId: string,
  input: Partial<Pick<TeamPolicies, "publishing" | "assistant" | "booking">>,
) {
  return this.request<TeamPolicies>(`/teams/${teamId}/policies`, {
    method: "PUT",
    body: input,
  });
}

export function callTeamWorkload(
  this: OrbynClient,
  teamId: string,
  from: string,
  to: string,
) {
  const q = new URLSearchParams({ from, to });
  return this.request<MemberWorkload[]>(`/teams/${teamId}/workload?${q}`);
}

/** Team owners' analytics: set-aside time per member, over `days`. */

export function callTeamAnalytics(
  this: OrbynClient,
  teamId: string,
  days = 30,
) {
  return this.request<TeamAnalytics>(`/teams/${teamId}/analytics?days=${days}`);
}

// ---- teams ----

export function callListTeams(this: OrbynClient) {
  return this.request<Team[]>("/teams");
}

export function callCreateTeam(this: OrbynClient, input: { name: string }) {
  return this.request<Team>("/teams", { method: "POST", body: input });
}

export function callGetTeam(this: OrbynClient, id: string) {
  return this.request<TeamDetail>(`/teams/${id}`);
}

export function callUpdateTeam(
  this: OrbynClient,
  id: string,
  input: { name: string },
) {
  return this.request<Team>(`/teams/${id}`, { method: "PUT", body: input });
}

export function callDeleteTeam(this: OrbynClient, id: string) {
  return this.request<void>(`/teams/${id}`, { method: "DELETE" });
}

export function callAddTeamMember(
  this: OrbynClient,
  teamId: string,
  input: { email: string; role?: TeamRole },
) {
  return this.request<TeamMember>(`/teams/${teamId}/members`, {
    method: "POST",
    body: input,
  });
}

export function callUpdateTeamMember(
  this: OrbynClient,
  teamId: string,
  userId: string,
  input: { role: TeamRole },
) {
  return this.request<TeamMember>(`/teams/${teamId}/members/${userId}`, {
    method: "PUT",
    body: input,
  });
}

/** Remove a member, or leave the team when `userId` is your own id. */

export function callRemoveTeamMember(
  this: OrbynClient,
  teamId: string,
  userId: string,
) {
  return this.request<void>(`/teams/${teamId}/members/${userId}`, {
    method: "DELETE",
  });
}

export function callAdminListTeams(this: OrbynClient) {
  return this.request<Team[]>("/admin/teams");
}

export function callTeamPresence(this: OrbynClient, teamId: string) {
  return this.request<MemberPresence[]>(`/teams/${teamId}/presence`);
}

// ---- team capacity -------------------------------------------------------

/** Free working time per person per day (a month at most). */

export function callTeamCapacity(
  this: OrbynClient,
  teamId: string,
  from: Date,
  to: Date,
) {
  const q = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
  });
  return this.request<TeamCapacity>(`/teams/${teamId}/capacity?${q}`);
}

export function callTeamAttention(
  this: OrbynClient,
  teamId: string,
  week?: string,
) {
  return this.request<TeamAttention>(
    `/teams/${teamId}/attention${week ? `?week=${week}` : ""}`,
  );
}

export function callCheckAttention(
  this: OrbynClient,
  teamId: string,
  input: {
    start_at: string;
    end_at: string;
    user_ids?: string[];
    item_id?: string;
  },
) {
  return this.request<AttentionCheck>(`/teams/${teamId}/attention/check`, {
    method: "POST",
    body: input,
  });
}
