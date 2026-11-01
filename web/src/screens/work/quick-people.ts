import { useEffect, useState } from "react";
import type { QuickAddMember, Team } from "@orbyn/core";
import { client, getSessionVersion } from "../../lib/session";

/** Parse @people only from the current account's complete team-member read. */
export function useQuickPeople(teams: Team[], ready: boolean) {
  const generation = getSessionVersion();
  const identity = `${generation}:${ready}:${teams
    .map((team) => team.id)
    .sort()
    .join(",")}`;
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{
    identity: string;
    members: QuickAddMember[];
    loading: boolean;
    error: string;
  }>({ identity: "", members: [], loading: true, error: "" });
  useEffect(() => {
    let mounted = true;
    setState({ identity, members: [], loading: true, error: "" });
    if (!ready)
      return () => {
        mounted = false;
      };
    void Promise.allSettled(teams.map((team) => client.getTeam(team.id))).then(
      (results) => {
        if (!mounted || generation !== getSessionVersion()) return;
        const members = new Map<string, QuickAddMember>();
        for (const result of results) {
          if (result.status !== "fulfilled") continue;
          for (const member of result.value.members) {
            const existing = members.get(member.user_id);
            if (existing) existing.team_ids.push(result.value.id);
            else
              members.set(member.user_id, {
                user_id: member.user_id,
                name: member.name,
                email: member.email,
                team_ids: [result.value.id],
              });
          }
        }
        setState({
          identity,
          members: [...members.values()],
          loading: false,
          error: results.some((result) => result.status === "rejected")
            ? "Some teammates could not be loaded. Retry before assigning with @name."
            : "",
        });
      },
    );
    return () => {
      mounted = false;
    };
  }, [identity, retry]); // Team identities, rather than array recreation, own this read.
  const current = state.identity === identity;
  return {
    members: current ? state.members : [],
    loading: !current || state.loading,
    error: current ? state.error : "",
    retry: () => setRetry((value) => value + 1),
  };
}
