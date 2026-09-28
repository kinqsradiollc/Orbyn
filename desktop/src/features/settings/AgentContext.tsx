import { useEffect, useState, type FormEvent } from "react";
import { FileText, Pencil } from "lucide-react";
import {
  MAX_AGENT_INSTRUCTIONS,
  type AgentContextSettings,
  type PersonalAgentSettings,
  type AgentInstructions,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { timeAgo } from "../../lib/tasks";
import { openObject } from "../docs/DocLinks";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { NightShift } from "./NightShift";
import { ReminderNudges } from "./ReminderNudges";

/**
 * Connected agents → "About me for agents" and "Instructions" (H8): the
 * page every agent reads first (an ordinary page in Personal, made here on
 * first use), and a few lines for each space that agents follow there. A
 * team's instructions are the team's: its members' agents all follow them,
 * and viewers can read but not change them.
 */
export function AgentWarmStart({ report }: { report: (e: unknown) => void }) {
  const [data, setData] = useState<AgentContextSettings | null>(null);
  const [identity, setIdentity] = useState<PersonalAgentSettings | null>(null);
  const [identityName, setIdentityName] = useState("Orbyn");
  const [identityPersona, setIdentityPersona] = useState("");
  const [editing, setEditing] = useState<{
    team_id: string | null;
    text: string;
  } | null>(null);
  const action = useAction(report);

  const load = () =>
    client.agentContext().then(setData, (e) => {
      setData({ profile: null, instructions: [] });
      report(e);
    });
  useEffect(() => {
    void load();
    void client.agentSettings().then((value) => {
      setIdentity(value);
      setIdentityName(value.name);
      setIdentityPersona(value.persona);
    }, report);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openProfile = () =>
    void action.run(async () => {
      const made = await client.openAgentProfile();
      openObject({ kind: "doc", id: made.doc_id });
      await load();
    });

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const d = editing;
    void action.run(async () => {
      setData(await client.setAgentInstructions(d.team_id, d.text.trim()));
      setEditing(null);
    });
  };

  const saveIdentity = (e: FormEvent) => {
    e.preventDefault();
    void action.run(async () => {
      const value = await client.updateAgentSettings({
        name: identityName,
        persona: identityPersona,
      });
      setIdentity(value);
    });
  };

  const row = (i: AgentInstructions) =>
    editing && editing.team_id === i.team_id ? (
      <li key={i.team_id ?? "personal"}>
        <form className="agents-instructions-form" onSubmit={save}>
          <span className="agents-tag">{i.space}</span>
          <textarea
            aria-label={`Instructions for ${i.space}`}
            rows={3}
            maxLength={MAX_AGENT_INSTRUCTIONS}
            placeholder={
              i.team_id
                ? "In this team, cards are cloze and notes cite the slides."
                : "Keep answers short. Plan study in the evenings."
            }
            value={editing.text}
            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
          />
          <div className="agents-instructions-actions">
            <button className="primary" disabled={action.pending}>
              Save
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setEditing(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    ) : (
      <li key={i.team_id ?? "personal"}>
        <span className="agents-tag">{i.space}</span>
        <span
          className={i.text ? "agents-rule-text" : "agents-rule-text muted"}
        >
          {i.text || "None yet"}
          {i.text && i.updated_at && (
            <span className="agents-instructions-meta">
              {" "}
              · {i.updated_by ?? "Someone"}
              {i.updated_via ? ` via ${i.updated_via}` : ""},{" "}
              {timeAgo(i.updated_at)}
            </span>
          )}
        </span>
        {i.can_edit && (
          <button
            type="button"
            className="icon-button"
            aria-label={`Change the instructions for ${i.space}`}
            title="Change"
            onClick={() => setEditing({ team_id: i.team_id, text: i.text })}
          >
            <Pencil size={13} />
          </button>
        )}
      </li>
    );

  return (
    <div className="agents-rules">
      <h3>Your assistant</h3>
      <p className="muted">
        The name your built-in assistant goes by across Orbyn, and how it should
        come across.
      </p>
      <form className="agents-identity-form" onSubmit={saveIdentity}>
        <div className="settings-field">
          <label htmlFor="agent-identity-name">Name</label>
          <input
            id="agent-identity-name"
            required
            maxLength={40}
            value={identityName}
            onChange={(e) => setIdentityName(e.target.value)}
          />
        </div>
        <div className="settings-field">
          <label htmlFor="agent-identity-persona">Persona</label>
          <textarea
            id="agent-identity-persona"
            maxLength={1000}
            rows={3}
            value={identityPersona}
            onChange={(e) => setIdentityPersona(e.target.value)}
            placeholder="Warm, direct, and concise"
          />
          <small className="field-hint">
            How it should come across. Optional.
          </small>
        </div>
        <div className="button-row start">
          <button
            className="primary"
            disabled={action.pending || identity === null}
          >
            Save
          </button>
        </div>
      </form>

      <NightShift report={report} />
      <ReminderNudges report={report} />
      <h3>About me for agents</h3>
      <p className="muted">
        One page your agents read before they help: your courses and exams, how
        you like notes and cards, when you study and for how long. Change it
        like any page; your agents can fill it in too.
      </p>
      <div className="agents-about">
        <button
          type="button"
          className="secondary"
          disabled={action.pending || data === null}
          onClick={openProfile}
        >
          <FileText size={13} />
          {data?.profile ? "Open the page" : "Make the page"}
        </button>
        {data?.profile && (
          <span className="muted">
            Changed {timeAgo(data.profile.updated_at)}
          </span>
        )}
      </div>

      <h3>Instructions</h3>
      <p className="muted">
        A few lines agents follow in each space, like “In Biology, cards are
        cloze”. A team’s instructions are shared by every member’s agents.
      </p>
      {data === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <ul className="agents-rules-list">{data.instructions.map(row)}</ul>
      )}
      <OutcomeNote outcome={action.outcome} />
    </div>
  );
}
