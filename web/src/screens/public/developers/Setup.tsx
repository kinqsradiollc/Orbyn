import { useState } from "react";
import {
  AGENT_ACCESS,
  AGENT_ACCESS_LABELS,
  AGENT_SETUP_CLIENTS,
  AGENT_SETUP_LABELS,
  agentSetup,
  isSignInClient,
  type AgentSetupClient,
  type McpCatalog,
} from "@orbyn/core";
import { Field, SelectBox } from "../../../ui/kit";
import { go } from "../PublicFrame";
import { CopyText } from "./CopyText";

export function Setup({ catalog }: { catalog: McpCatalog }) {
  const [chosen, setChosen] = useState<AgentSetupClient>("claude");
  const setup = agentSetup(chosen, catalog.server.address);
  return (
    <section id="connect" aria-labelledby="developers-connect">
      <h2 id="developers-connect">Connect your client</h2>
      <div className="developers-endpoint">
        <code dir="ltr">{catalog.server.address}</code>
        <CopyText text={catalog.server.address} label="Copy server address" />
      </div>
      <p>Streamable HTTP · stateless JSON-RPC · one message per POST</p>
      <p className="small">
        Protocol revisions:{" "}
        {catalog.server.protocol_versions.length
          ? catalog.server.protocol_versions.join(", ")
          : "None published"}
        .
      </p>
      <Field label="Your client">
        <SelectBox
          value={chosen}
          onChange={(e) => setChosen(e.target.value as AgentSetupClient)}
        >
          {AGENT_SETUP_CLIENTS.map((name) => (
            <option value={name} key={name}>
              {AGENT_SETUP_LABELS[name]}
            </option>
          ))}
        </SelectBox>
      </Field>
      <p>{setup.where}</p>
      <pre
        className="developers-code"
        tabIndex={0}
        aria-label={`${AGENT_SETUP_LABELS[chosen]} setup`}
        dir="ltr"
      >
        <code>{setup.snippet}</code>
      </pre>
      <CopyText text={setup.snippet} label="Copy setup" />
      {isSignInClient(chosen) ? (
        <p>
          Choose OAuth. Orbyn asks you to review the app, spaces, tools and
          expiry before connecting. Change access requires recent password or
          passkey verification.
        </p>
      ) : (
        <p>
          Create an agent key in{" "}
          <a
            href="/app/settings/connections"
            onClick={go("/app/settings/connections")}
          >
            Settings → Connections → Connected agents
          </a>
          . Keep the key private; the setup above contains a placeholder, not a
          credential.
        </p>
      )}
      <p>
        Agents use their own models. Workspace AI is a separate permission to
        use Orbyn’s configured provider.
      </p>
      <details>
        <summary>Access and spaces</summary>
        <dl className="developers-definitions">
          {AGENT_ACCESS.map((access) => (
            <div key={access}>
              <dt>{AGENT_ACCESS_LABELS[access].name}</dt>
              <dd>{AGENT_ACCESS_LABELS[access].blurb}</dd>
            </div>
          ))}
        </dl>
        <p>
          A connection’s grant and team policies narrow these permissions. It
          sees only the Personal or team spaces you allow. Manage or revoke
          access in Connected agents.
        </p>
        <p>
          Personal API keys are for the REST API and CalDAV. They do not replace
          an MCP agent grant or authorize sign-in administration.
        </p>
      </details>
      <details>
        <summary>Server instructions</summary>
        <p className="developers-verbatim" dir="auto">
          {catalog.server.instructions || "No instructions published."}
        </p>
      </details>
    </section>
  );
}
