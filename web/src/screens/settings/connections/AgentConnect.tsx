import {
  AGENT_ACCESS,
  AGENT_ACCESS_LABELS,
  AGENT_SETUP_CLIENTS,
  AGENT_SETUP_LABELS,
  AGENT_SIGN_IN_STEPS,
  AGENT_TOOLSETS,
  AGENT_TOOLSET_LABELS,
  agentSetup,
  agentInstallLinks,
  agentKeyInput,
  type AgentAccess,
  type AgentSetupClient,
  type AgentToolset,
} from "@orbyn/core";
import { useState } from "react";
import { client } from "../../../lib/session";
import { Button, Field, Input, SelectBox } from "../../../ui/kit";
import { useSettingsExit, useSettingsRead } from "../shared";
import {
  ActionError,
  checkedSecret,
  receiptId,
  CopyText,
  ReadState,
  Secret,
  useConnectionAction,
} from "./common";
export function AgentConnect({
  url,
  onCreated,
}: {
  url: string;
  onCreated: () => void;
}) {
  const teams = useSettingsRead(() => client.listTeams()),
    action = useConnectionAction();
  const [tab, setTab] = useState<AgentSetupClient>("claude"),
    [name, setName] = useState(""),
    [access, setAccess] = useState<AgentAccess>("write"),
    [personal, setPersonal] = useState(true),
    [ids, setIds] = useState<string[]>([]),
    [days, setDays] = useState(30),
    [hide, setHide] = useState(false),
    [tools, setTools] = useState<AgentToolset[]>(["core"]),
    [secret, setSecret] = useState(""),
    [validation, setValidation] = useState("");
  const currentDraft = JSON.stringify({
    name,
    access,
    personal,
    ids,
    days,
    hide,
    tools,
  });
  const [savedDraft, setSavedDraft] = useState(currentDraft);
  useSettingsExit({ dirty: currentDraft !== savedDraft });
  const setup = agentSetup(tab, url, secret || undefined);
  const links = agentInstallLinks(url);
  return (
    <div className="settings-connections-editor">
      <Field label="Connect with">
        <SelectBox
          disabled={action.blocked || !!secret}
          value={tab}
          onChange={(e) => setTab(e.target.value as AgentSetupClient)}
        >
          {AGENT_SETUP_CLIENTS.map((c) => (
            <option key={c} value={c}>
              {AGENT_SETUP_LABELS[c]}
            </option>
          ))}
        </SelectBox>
      </Field>
      {tab === "claude" || tab === "chatgpt" ? (
        <ol>
          {AGENT_SIGN_IN_STEPS[tab].map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      ) : (
        <>
          <form
            className="settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              const parsed = agentKeyInput.safeParse({
                name: name.trim() || `${AGENT_SETUP_LABELS[tab]} key`,
                access,
                personal,
                team_ids: ids,
                expires_in_days: days,
                hide_outside_content: hide,
                toolsets: tools,
              });
              if (!parsed.success) {
                setValidation(
                  parsed.error.issues.map((i) => i.message).join(" "),
                );
                return;
              }
              void action.run(
                () => client.createAgentKey(parsed.data),
                (next) => {
                  const key = checkedSecret(next.key, "oak_");
                  if (
                    !receiptId(next.grant?.id) ||
                    next.grant.name !== parsed.data.name
                  )
                    throw Error(
                      "The agent-key receipt does not match this connection. This attempt remains unconfirmed.",
                    );
                  setSecret(key);
                  setName("");
                  setSavedDraft(
                    JSON.stringify({
                      name: "",
                      access,
                      personal,
                      ids,
                      days,
                      hide,
                      tools,
                    }),
                  );
                  onCreated();
                },
              );
            }}
          >
            <fieldset disabled={action.blocked || !!secret}>
              <Field label="Connection name">
                <Input
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label="Access">
                <SelectBox
                  value={access}
                  onChange={(e) => setAccess(e.target.value as AgentAccess)}
                >
                  {AGENT_ACCESS.map((a) => (
                    <option key={a} value={a}>
                      {AGENT_ACCESS_LABELS[a].name}
                    </option>
                  ))}
                </SelectBox>
              </Field>
              <label className="check">
                <input
                  type="checkbox"
                  checked={personal}
                  onChange={(e) => setPersonal(e.target.checked)}
                />
                Personal
              </label>
              <ReadState {...teams}>
                {teams.data?.map((t) => (
                  <label className="check" key={t.id}>
                    <input
                      type="checkbox"
                      checked={ids.includes(t.id)}
                      onChange={(e) =>
                        setIds((old) =>
                          e.target.checked
                            ? [...old, t.id]
                            : old.filter((x) => x !== t.id),
                        )
                      }
                    />
                    <span dir="auto">{t.name}</span>
                  </label>
                ))}
              </ReadState>
              <Field label="Expires in days">
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                />
              </Field>
              <label className="check">
                <input
                  type="checkbox"
                  checked={hide}
                  onChange={(e) => setHide(e.target.checked)}
                />
                Leave text from outside Orbyn out of what this connection reads
              </label>
              <legend>Toolsets</legend>
              {AGENT_TOOLSETS.map((t) => (
                <label className="check" key={t}>
                  <input
                    type="checkbox"
                    disabled={t === "core"}
                    checked={tools.includes(t)}
                    onChange={(e) =>
                      setTools((old) =>
                        e.target.checked
                          ? [...old, t]
                          : old.filter((x) => x !== t),
                      )
                    }
                  />
                  {AGENT_TOOLSET_LABELS[t].name}
                </label>
              ))}
            </fieldset>
            <Button
              type="submit"
              disabled={
                !teams.fresh ||
                action.blocked ||
                !!secret ||
                (!personal && !ids.length)
              }
            >
              Create agent key
            </Button>
          </form>
          {secret && <Secret value={secret} onDone={() => setSecret("")} />}
        </>
      )}
      <details>
        <summary>Connection setup</summary>
        <p>{setup.where}</p>
        <pre tabIndex={0}>{setup.snippet}</pre>
        <CopyText
          key={setup.snippet}
          value={setup.snippet}
          label="Copy setup"
        />
        {links.map((link) => (
          <a
            key={link.app}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            Install in {link.label}
          </a>
        ))}
      </details>
      <Button
        disabled={action.blocked || !!secret || currentDraft === savedDraft}
        onClick={() => {
          setName("");
          setAccess("write");
          setPersonal(true);
          setIds([]);
          setDays(30);
          setHide(false);
          setTools(["core"]);
          setSavedDraft(
            JSON.stringify({
              name: "",
              access: "write",
              personal: true,
              ids: [],
              days: 30,
              hide: false,
              tools: ["core"],
            }),
          );
        }}
      >
        Discard unsaved connection setup
      </Button>
      {validation && <p role="alert">{validation}</p>}
      <ActionError action={action} />
    </div>
  );
}
