import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { TEAM_POLICY_TEXT, type TeamPolicies as Policies } from "@orbyn/core";
import { client } from "../../lib/api";
import { errorText } from "../../lib/errors";
import "../publish/publish.css";

/**
 * A team's switches (OTH-04), together: publishing its pages to the web,
 * the assistant on its pages, and its booking pages for people outside.
 * Everyone in the team sees them; owners and admins change them.
 */
export function TeamPolicies({ teamId }: { teamId: string }) {
  const [state, setState] = useState<Policies | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    client.getTeamPolicies(teamId).then(setState, () => setState(null));
  }, [teamId]);
  if (!state) return null;
  const change = (key: "publishing" | "assistant" | "booking", on: boolean) => {
    setState({ ...state, [key]: on });
    client.setTeamPolicies(teamId, { [key]: on }).then(
      (next) => {
        setError("");
        setState(next);
      },
      (e) => {
        setError(errorText(e));
        setState(state);
      },
    );
  };
  return (
    <section
      className="card team-publishing team-policies"
      aria-labelledby="team-policies-title"
    >
      <h3 id="team-policies-title">
        <SlidersHorizontal size={15} aria-hidden="true" /> Team switches
      </h3>
      {(["publishing", "assistant", "booking"] as const).map((key) => (
        <label key={key} className="switch-line">
          <input
            type="checkbox"
            role="switch"
            className="ai-switch"
            checked={state[key]}
            disabled={!state.can_change}
            onChange={(e) => change(key, e.target.checked)}
          />
          <span>
            {TEAM_POLICY_TEXT[key].label}
            <small>{TEAM_POLICY_TEXT[key].hint}</small>
          </span>
        </label>
      ))}
      {!state.can_change && (
        <p className="muted">Owners and admins can change these.</p>
      )}
      {error && (
        <p role="alert" className="publish-error">
          {error}
        </p>
      )}
    </section>
  );
}
