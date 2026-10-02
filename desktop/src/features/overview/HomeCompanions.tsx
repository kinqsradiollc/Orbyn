import { useEffect, useState } from "react";
import {
  CHARACTER_PRESETS,
  HOME_AGENT_GUIDE,
  HOME_AGENT_IDLE_NOTE,
  type PersonalAgentSettings,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { Character } from "../../components/Character";
import { AssistantAgents } from "../assistant/AssistantAgents";

/** A quiet Home entry point; browsing presets never changes account settings. */
export function HomeCompanions({
  canOpen = false,
  onOpenChat = () => {},
}: { canOpen?: boolean; onOpenChat?: (id: string) => void } = {}) {
  const [identity, setIdentity] = useState<PersonalAgentSettings | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  useEffect(() => {
    let live = true;
    let updated = false;
    const unsubscribe = client.onAgentSettings((value) => {
      updated = true;
      if (live) setIdentity(value);
    });
    void client.agentSettings({ fresh: true }).then(
      (value) => live && !updated && setIdentity(value),
      () => undefined,
    );
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  return (
    <section className="home-companions-card" aria-label="Your companion">
      {agentsOpen && (
        <AssistantAgents
          identity={identity}
          canOpen={canOpen}
          onClose={() => setAgentsOpen(false)}
          onOpenChat={onOpenChat}
        />
      )}
      <div className="home-companions-heading">
        {identity && (
          <Character
            appearance={identity.character}
            name={identity.name}
            size={56}
          />
        )}
        <div>
          <h2>{identity?.name ?? "Your companion"}</h2>
          <p>Choose its name and appearance in assistant settings.</p>
        </div>
        <button
          className="text-button"
          aria-expanded={expanded}
          aria-controls="home-companion-presets"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Hide companions" : "Browse companions"}
        </button>
      </div>
      <div className="home-companions-work">
        <div className="home-companions-lanes">
          {HOME_AGENT_GUIDE.map((agent) => (
            <p key={agent.name}>
              <strong>{agent.name}</strong>
              <small>{agent.timing}</small>
              {agent.summary}
              <small>{agent.result}</small>
              <small>{agent.pause}</small>
            </p>
          ))}
          <p>{HOME_AGENT_IDLE_NOTE}</p>
        </div>
        <button className="secondary" onClick={() => setAgentsOpen(true)}>
          View agent activity
        </button>
      </div>
      {expanded && (
        <ul
          id="home-companion-presets"
          className="home-companions-presets"
          aria-label="Character presets"
        >
          {CHARACTER_PRESETS.map(({ name, appearance }) => (
            <li key={name}>
              <Character
                appearance={appearance}
                name={name}
                size={72}
                preview
              />
              <span>{name}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
