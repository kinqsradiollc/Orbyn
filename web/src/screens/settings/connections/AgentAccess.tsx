import {
  AGENT_NEVER,
  AGENT_TRUST,
  AGENT_TRUST_LABELS,
  AGENT_ASK_FIRST,
  AGENT_ASK_FIRST_LABELS,
  AGENT_TOOLSETS,
  AGENT_TOOLSET_LABELS,
  agentTrustInput,
  type AgentGrant,
  type AgentTrust,
  type AgentAskFirst,
  type AgentToolset,
} from "@orbyn/core";
import { useState } from "react";
import { client } from "../../../lib/session";
import { Button, Field, SelectBox } from "../../../ui/kit";
import { useSettingsExit } from "../shared";
import { ActionError, useConnectionAction } from "./common";
export function AgentAccess({
  grant,
  onSaved,
}: {
  grant: AgentGrant;
  onSaved: (g: AgentGrant) => void;
}) {
  const action = useConnectionAction();
  const [trust, setTrust] = useState(grant.trust),
    [spaces, setSpaces] = useState<Record<string, AgentTrust>>({
      ...grant.space_trust,
    }),
    [alone, setAlone] = useState<AgentAskFirst[]>([...grant.acts_alone]),
    [tools, setTools] = useState<AgentToolset[]>([...grant.toolsets]),
    [savedTrust, setSavedTrust] = useState(
      JSON.stringify({ trust, spaces, alone }),
    ),
    [savedTools, setSavedTools] = useState(JSON.stringify(tools));
  const trustDirty = JSON.stringify({ trust, spaces, alone }) !== savedTrust,
    toolsDirty = JSON.stringify(tools) !== savedTools;
  const dirty = trustDirty || toolsDirty;
  useSettingsExit({ dirty });
  const reach = [
    ...(grant.personal ? [{ id: "personal", name: "Personal" }] : []),
    ...grant.teams,
  ];
  return (
    <div className="settings-form">
      <Field label="Default trust">
        <SelectBox
          disabled={action.blocked || grant.access !== "write"}
          value={trust}
          onChange={(e) => setTrust(e.target.value as AgentTrust)}
        >
          {AGENT_TRUST.map((t) => (
            <option key={t} value={t}>
              {AGENT_TRUST_LABELS[t].name}
            </option>
          ))}
        </SelectBox>
      </Field>
      {reach.map((s) => (
        <Field label={s.name} key={s.id}>
          <SelectBox
            disabled={action.blocked || grant.access !== "write"}
            value={spaces[s.id] ?? ""}
            onChange={(e) =>
              setSpaces((old) => {
                const next = { ...old };
                if (e.target.value) next[s.id] = e.target.value as AgentTrust;
                else delete next[s.id];
                return next;
              })
            }
          >
            <option value="">Use default</option>
            {AGENT_TRUST.map((t) => (
              <option key={t} value={t}>
                {AGENT_TRUST_LABELS[t].name}
              </option>
            ))}
          </SelectBox>
        </Field>
      ))}
      <fieldset disabled={action.blocked || grant.access !== "write"}>
        <legend>May do these without asking</legend>
        {AGENT_ASK_FIRST.map((a) => (
          <label className="check" key={a}>
            <input
              type="checkbox"
              checked={alone.includes(a)}
              onChange={(e) =>
                setAlone((old) =>
                  e.target.checked ? [...old, a] : old.filter((x) => x !== a),
                )
              }
            />
            {AGENT_ASK_FIRST_LABELS[a].name}
          </label>
        ))}
      </fieldset>
      <Button
        disabled={action.blocked || grant.access !== "write" || !trustDirty}
        onClick={() => {
          const input = agentTrustInput.parse({
            trust,
            spaces: Object.fromEntries(
              reach.map((s) => [s.id, spaces[s.id] ?? null]),
            ),
            acts_alone: alone,
          });
          void action.run(
            () => client.setAgentTrust(grant.id, input),
            (next) => {
              onSaved(next);
              setSavedTrust(JSON.stringify({ trust, spaces, alone }));
            },
          );
        }}
      >
        Save trust
      </Button>
      <fieldset
        disabled={
          action.blocked ||
          grant.kind === "assistant" ||
          grant.kind === "legacy"
        }
      >
        <legend>Toolsets</legend>
        {AGENT_TOOLSETS.filter(
          (t) =>
            t !== "booking" ||
            grant.kind !== "oauth" ||
            grant.toolsets.includes("booking"),
        ).map((t) => (
          <label className="check" key={t}>
            <input
              type="checkbox"
              disabled={t === "core"}
              checked={tools.includes(t)}
              onChange={(e) =>
                setTools((old) =>
                  e.target.checked ? [...old, t] : old.filter((x) => x !== t),
                )
              }
            />
            {AGENT_TOOLSET_LABELS[t].name}
          </label>
        ))}
      </fieldset>
      <Button
        disabled={
          action.blocked ||
          grant.kind === "assistant" ||
          grant.kind === "legacy" ||
          !toolsDirty
        }
        onClick={() =>
          void action.run(
            () => client.setAgentToolsets(grant.id, tools),
            (next) => {
              onSaved(next);
              setSavedTools(JSON.stringify(tools));
            },
          )
        }
      >
        Save toolsets
      </Button>
      <p className="small muted">
        Agents can take up to five minutes to refresh their tools.
      </p>
      <Button
        disabled={action.blocked || !dirty}
        onClick={() => {
          setTrust(grant.trust);
          setSpaces({ ...grant.space_trust });
          setAlone([...grant.acts_alone]);
          setTools([...grant.toolsets]);
          setSavedTrust(
            JSON.stringify({
              trust: grant.trust,
              spaces: { ...grant.space_trust },
              alone: [...grant.acts_alone],
            }),
          );
          setSavedTools(JSON.stringify(grant.toolsets));
        }}
      >
        Discard unsaved permission changes
      </Button>
      <details>
        <summary>Always managed in Orbyn</summary>
        <p className="small">{AGENT_NEVER}</p>
      </details>
      <ActionError action={action} />
    </div>
  );
}
