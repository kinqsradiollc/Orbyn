import { useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { TEAM_POLICY_TEXT, type TeamPolicies as Policies } from "@orbyn/core";
import { client } from "../../lib/api";
import { errorText } from "../../lib/errors";
import "../public-pages/publish.css";
import { useSettingsRead } from "../settings/useSettingsRead";
import { usePaneLeaveGuard } from "../../app/page-commands";

/**
 * A team's switches (OTH-04), together: publishing its pages to the web,
 * the assistant on its pages, and its booking pages for people outside.
 * Everyone in the team sees them; owners and admins change them.
 */
export function TeamPolicies({ teamId }: { teamId: string }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const mutation = useRef(false);
  const read = useSettingsRead<Policies>(
    () => client.getTeamPolicies(teamId),
    (e) => setError(errorText(e)),
  );
  const state = read.data;
  usePaneLeaveGuard(async () => !mutation.current);
  const change = async (
    key: "publishing" | "assistant" | "booking",
    on: boolean,
  ) => {
    if (!read.current() || !state?.can_change || mutation.current) return;
    mutation.current = true;
    setSaving(true);
    setError("");
    try {
      const next = await client.setTeamPolicies(teamId, { [key]: on });
      if (read.current()) read.commit(next);
    } catch (e) {
      if (read.current()) setError(errorText(e));
    } finally {
      mutation.current = false;
      if (read.current()) setSaving(false);
    }
  };
  if (!state)
    return read.failed ? (
      <p role="alert">
        Team permissions couldn’t be loaded.{" "}
        <button className="text-button" onClick={() => void read.reload()}>
          Retry
        </button>
      </p>
    ) : (
      <p className="muted" role="status">
        Loading team permissions…
      </p>
    );
  return (
    <section
      className="card team-publishing team-policies"
      aria-labelledby="team-policies-title"
    >
      <h3 id="team-policies-title">
        <SlidersHorizontal size={15} aria-hidden="true" /> Team permissions
      </h3>
      {(["publishing", "assistant", "booking"] as const).map((key) => (
        <label key={key} className="switch-line">
          <input
            type="checkbox"
            role="switch"
            className="ai-switch"
            checked={state[key]}
            disabled={
              !state.can_change || saving || read.loading || read.failed
            }
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
      {saving && (
        <p className="muted" role="status">
          Saving…
        </p>
      )}
      {error && (
        <p role="alert" className="publish-error">
          {error}
        </p>
      )}
    </section>
  );
}
