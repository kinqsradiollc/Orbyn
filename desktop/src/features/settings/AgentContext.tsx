import { Character } from "../../components/Character";
import { CharacterEditor } from "../../components/CharacterEditor";
import { useEffect, useState, type FormEvent } from "react";
import { FileText, Pencil } from "lucide-react";
import {
  MAX_AGENT_INSTRUCTIONS,
  characterAppearance,
  CHARACTER_PERSONAS,
  type AgentContextSettings,
  type AutomationAgentIdentity,
  type AutomationAgentLane,
  type AgentInstructions,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
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
  const [identity, setIdentity] = useState<AutomationAgentIdentity | null>(
    null,
  );
  const [lane, setLane] = useState<AutomationAgentLane>("background");
  const [editingLook, setEditingLook] = useState(false);
  const [reload, setReload] = useState(0);
  const [identityName, setIdentityName] = useState("Orbyn");
  const [identityPersona, setIdentityPersona] = useState("");
  const [appearance, setAppearance] = useState(() => characterAppearance({}));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let live = true;
    const token = session.get();
    setIdentity(null);
    setEditingLook(false);
    void client.automationAgentIdentity(lane).then(
      (value) => {
        if (!live || token !== session.get()) return;
        setIdentity(value);
        setIdentityName(value.name);
        setIdentityPersona(value.persona);
        setAppearance(characterAppearance(value.character));
      },
      (error) => {
        if (live && token === session.get()) report(error);
      },
    );
    return () => {
      live = false;
    };
  }, [lane, reload]);

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
    if (!identity || identity.lane !== lane) return;
    const token = session.get();
    void action.run(async () => {
      const value = await client.updateAutomationAgentIdentity(lane, {
        expected_revision: identity.revision,
        name: identityName,
        persona: identityPersona,
        character: appearance,
      });
      if (token === session.get()) setIdentity(value);
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
      <h3>Agent identity</h3>
      <div
        className="button-row start agents-identity-tabs"
        aria-label="Agent identity profile"
      >
        {(["background", "overnight"] as const).map((value) => (
          <button
            key={value}
            type="button"
            className="secondary"
            aria-pressed={lane === value}
            disabled={action.pending}
            onClick={() => setLane(value)}
          >
            {value === "background" ? "Background" : "Overnight"}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="text-button"
        disabled={action.pending}
        onClick={() => setReload((value) => value + 1)}
      >
        Reload agent profile
      </button>
      {identity === null && (
        <p role="status">
          Agent profile is loading or unavailable. Reload to try again.
        </p>
      )}
      <p className="muted">
        {lane === "background" ? "Background" : "Overnight"} has its own name,
        character and communication style.
      </p>
      <form className="agents-identity-form" onSubmit={saveIdentity}>
        <div className="settings-field">
          <label htmlFor="agent-identity-name">Name</label>
          <input
            id="agent-identity-name"
            required
            disabled={action.pending || identity?.lane !== lane}
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
            disabled={action.pending || identity?.lane !== lane}
            rows={3}
            value={identityPersona}
            onChange={(e) => setIdentityPersona(e.target.value)}
            placeholder="Warm, direct, and concise"
          />
          <small className="field-hint">
            How it should come across. Optional.
          </small>
        </div>
        <div className="character-personas" aria-label="Communication presets">
          {CHARACTER_PERSONAS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="secondary"
              disabled={action.pending || identity?.lane !== lane}
              onClick={() => setIdentityPersona(preset.persona)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="button-row start">
          <Character appearance={appearance} name={identityName} size={48} />
          <button
            type="button"
            className="secondary"
            aria-expanded={editingLook}
            disabled={action.pending || identity?.lane !== lane}
            onClick={() => setEditingLook((value) => !value)}
          >
            {editingLook ? "Close character editor" : "Customize character"}
          </button>
        </div>
        {editingLook && (
          <CharacterEditor
            value={appearance}
            onChange={setAppearance}
            name={identityName}
            disabled={action.pending || identity?.lane !== lane}
          />
        )}
        <div className="button-row start">
          <button
            className="primary"
            disabled={
              action.pending || identity === null || identity.lane !== lane
            }
          >
            Save
          </button>
        </div>
      </form>

      <NightShift report={report} />
      <ReminderNudges report={report} />
      <h3>About me for agents</h3>
      <p className="muted">
        A page of context for your agents. Edit it like any other page.
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
        Space-specific rules for agents. Team rules apply to every member’s
        agents.
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
