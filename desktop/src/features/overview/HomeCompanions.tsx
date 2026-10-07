import { useEffect, useState } from "react";
import {
  CHARACTER_PRESETS,
  HOME_AGENT_GUIDE,
  HOME_AGENT_IDLE_NOTE,
  type AutomationAgentIdentity,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { Character } from "../../components/Character";
import { AssistantAgents } from "../assistant/AssistantAgents";

/** A quiet Home entry point; browsing presets never changes account settings. */
export function HomeCompanions({
  canOpen = false,
  onOpenChat = () => {},
}: { canOpen?: boolean; onOpenChat?: (id: string) => void } = {}) {
  const accountBinding = session.get();
  const [identityState, setIdentityState] = useState<{
    binding: string;
    values: Partial<
      Record<"background" | "overnight", AutomationAgentIdentity>
    >;
  }>({ binding: accountBinding, values: {} });
  const identities =
    identityState.binding === accountBinding ? identityState.values : {};
  const [expanded, setExpanded] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  useEffect(() => {
    let live = true;
    const token = session.get();
    const updated = new Set<string>();
    const unsubscribe = client.onAutomationAgentIdentity((value) => {
      updated.add(value.lane);
      if (live && token === session.get())
        setIdentityState((old) => ({
          binding: token,
          values: {
            ...(old.binding === token ? old.values : {}),
            [value.lane]: value,
          },
        }));
    });
    for (const lane of ["background", "overnight"] as const) {
      void client.automationAgentIdentity(lane).then(
        (value) => {
          if (live && token === session.get() && !updated.has(lane))
            setIdentityState((old) => ({
              binding: token,
              values: {
                ...(old.binding === token ? old.values : {}),
                [lane]: value,
              },
            }));
        },
        () => undefined,
      );
    }
    return () => {
      live = false;
      unsubscribe();
    };
  }, [accountBinding]);
  return (
    <section className="home-companions-card" aria-label="Your agents">
      {agentsOpen && (
        <AssistantAgents
          canOpen={canOpen}
          onClose={() => setAgentsOpen(false)}
          onOpenChat={onOpenChat}
        />
      )}
      <div className="home-companions-heading">
        <div>
          <h2>Your agents</h2>
        </div>
        <button
          className="text-button"
          aria-expanded={expanded}
          aria-controls="home-companion-presets"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Hide companions" : "Companions"}
        </button>
      </div>
      <div className="home-companions-actions">
        <button className="text-button" onClick={() => setAgentsOpen(true)}>
          Activity
        </button>
        <button
          className="text-button"
          aria-expanded={guideOpen}
          onClick={() => setGuideOpen(!guideOpen)}
        >
          {guideOpen ? "Hide guide" : "How agents work"}
        </button>
      </div>
      <div className="home-companions-work">
        <div className="home-companions-lanes">
          {HOME_AGENT_GUIDE.map((agent) => (
            <article key={agent.name}>
              <div className="home-agent-identity">
                <Character
                  appearance={
                    identities[
                      agent.name === "Background" ? "background" : "overnight"
                    ]?.character
                  }
                  name={
                    identities[
                      agent.name === "Background" ? "background" : "overnight"
                    ]?.name ?? agent.name
                  }
                  size={40}
                />
                <div>
                  <strong>
                    {identities[
                      agent.name === "Background" ? "background" : "overnight"
                    ]?.name ?? agent.name}
                  </strong>
                  {(identities[
                    agent.name === "Background" ? "background" : "overnight"
                  ]?.name ?? agent.name) !== agent.name && (
                    <small>{agent.name}</small>
                  )}
                </div>
              </div>
              <p>{agent.brief}</p>
              {guideOpen && (
                <div className="home-companions-guide">
                  <p>
                    {agent.timing}. {agent.summary}
                  </p>
                  <p>
                    {agent.result} {agent.pause}
                  </p>
                  <p>Example request: “{agent.request}”</p>
                  <ol className="home-companions-steps">
                    {agent.steps.map((step) => (
                      <li key={step.title}>
                        <strong>{step.title}</strong>
                        <p>{step.body}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
      {guideOpen && (
        <p className="home-companions-idle">{HOME_AGENT_IDLE_NOTE}</p>
      )}
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
