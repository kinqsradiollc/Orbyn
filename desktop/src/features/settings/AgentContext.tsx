import { SettingsSection } from "./SettingsSection";
import { Character } from "../../components/Character";
import { CharacterEditor } from "../../components/CharacterEditor";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
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
  const [identityError, setIdentityError] = useState(false);
  const [contextError, setContextError] = useState(false);
  const [contextLoading, setContextLoading] = useState(false);
  const mounted = useRef(false);
  const contextRequest = useRef(0);
  const reportRef = useRef(report);
  reportRef.current = report;
  const [identityName, setIdentityName] = useState("Orbyn");
  const [identityPersona, setIdentityPersona] = useState("");
  const [appearance, setAppearance] = useState(() => characterAppearance({}));
  const [editing, setEditing] = useState<{
    team_id: string | null;
    text: string;
  } | null>(null);
  const action = useAction(report);

  const load = useCallback(async () => {
    const request = ++contextRequest.current;
    setContextLoading(true);
    setContextError(false);
    try {
      const value = await client.agentContext();
      if (mounted.current && request === contextRequest.current) setData(value);
    } catch (error) {
      if (mounted.current && request === contextRequest.current) {
        setContextError(true);
        reportRef.current(error);
      }
    } finally {
      if (mounted.current && request === contextRequest.current)
        setContextLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      contextRequest.current++;
    };
  }, [load]);

  useEffect(() => {
    let live = true;
    const token = session.get();
    setIdentity(null);
    setIdentityError(false);
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
        if (live && token === session.get()) {
          setIdentityError(true);
          reportRef.current(error);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [lane, reload]);

  const openProfile = () =>
    void action.run(async () => {
      const made = await client.openAgentProfile();
      if (!mounted.current) return;
      openObject({ kind: "doc", id: made.doc_id });
      await load();
    });

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!editing || action.pending || contextLoading || contextError) return;
    const d = editing;
    void action.run(async () => {
      const value = await client.setAgentInstructions(d.team_id, d.text.trim());
      if (!mounted.current) return;
      setData(value);
      setEditing(null);
    });
  };

  const identityDirty =
    !!identity &&
    (identityName !== identity.name ||
      identityPersona !== identity.persona ||
      JSON.stringify(appearance) !==
        JSON.stringify(characterAppearance(identity.character)));
  const cancelIdentity = () => {
    if (!identity) return;
    setIdentityName(identity.name);
    setIdentityPersona(identity.persona);
    setAppearance(characterAppearance(identity.character));
    setEditingLook(false);
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
      if (mounted.current && token === session.get()) {
        setIdentity(value);
        setIdentityName(value.name);
        setIdentityPersona(value.persona);
        setAppearance(characterAppearance(value.character));
      }
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
            disabled={action.pending || contextLoading || contextError}
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
              disabled={action.pending}
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
            disabled={action.pending || contextLoading || contextError}
            onClick={() => setEditing({ team_id: i.team_id, text: i.text })}
          >
            <Pencil size={13} />
          </button>
        )}
      </li>
    );

  return (
    <>
      <SettingsSection
        className="card settings-card agents-rules"
        title="Background & overnight"
      >
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
              disabled={action.pending || identityDirty}
              onClick={() => setLane(value)}
            >
              {value === "background" ? "Background" : "Overnight"}
            </button>
          ))}
        </div>
        {identityDirty && (
          <p className="muted">
            Save or cancel changes before switching agents.
          </p>
        )}
        {identityError && (
          <button
            type="button"
            className="text-button"
            disabled={action.pending}
            onClick={() => setReload((value) => value + 1)}
          >
            Retry agent profile
          </button>
        )}
        {identity === null && !identityError && (
          <p role="status">Loading agent profile…</p>
        )}
        {identityError && (
          <p role="alert" className="error">
            Couldn't load agent profile.
          </p>
        )}
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
            <label htmlFor="agent-identity-persona">Communication style</label>
            <textarea
              id="agent-identity-persona"
              maxLength={1000}
              disabled={action.pending || identity?.lane !== lane}
              rows={3}
              value={identityPersona}
              onChange={(e) => setIdentityPersona(e.target.value)}
              placeholder="Warm, direct, and concise"
            />
            <small className="field-hint">Optional.</small>
          </div>
          <div
            className="character-personas"
            aria-label="Communication presets"
          >
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
                action.pending ||
                identity === null ||
                identity.lane !== lane ||
                !identityDirty ||
                !identityName.trim()
              }
            >
              Save
            </button>
            <button
              type="button"
              className="secondary"
              disabled={action.pending || !identityDirty}
              onClick={cancelIdentity}
            >
              Cancel
            </button>
          </div>
        </form>
        <OutcomeNote outcome={action.outcome} />
      </SettingsSection>
      <SettingsSection
        className="card settings-card"
        title="Overnight schedule"
      >
        <NightShift report={report} />
      </SettingsSection>
      <SettingsSection className="card settings-card" title="Reminders">
        <ReminderNudges report={report} />
      </SettingsSection>
      <SettingsSection
        className="card settings-card agents-rules"
        title="Agent context"
      >
        <h3>About me</h3>
        {contextError && (
          <div>
            <p role="alert" className="error">
              Couldn't load agent context.
            </p>
            <button
              type="button"
              className="secondary"
              disabled={action.pending || contextLoading}
              onClick={() => void load()}
            >
              Retry context
            </button>
          </div>
        )}
        <div className="agents-about">
          <button
            type="button"
            className="secondary"
            disabled={
              action.pending || data === null || contextLoading || contextError
            }
            onClick={openProfile}
          >
            <FileText size={13} />
            {data?.profile ? "Open context page" : "Create context page"}
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
        {data === null && !contextError ? (
          <p className="muted" role="status">
            Loading context…
          </p>
        ) : (
          <ul className="agents-rules-list">{data?.instructions.map(row)}</ul>
        )}
        <OutcomeNote outcome={action.outcome} />
      </SettingsSection>
    </>
  );
}
