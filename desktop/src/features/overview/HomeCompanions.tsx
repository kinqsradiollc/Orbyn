import { useEffect, useState } from "react";
import {
  CHARACTER_PRESETS,
  HOME_AGENT_GUIDE,
  HOME_AGENT_IDLE_NOTE,
  type AutomationAgentIdentity,
} from "@orbyn/core";
import { ChevronRight, Clock, Sparkles } from "lucide-react";
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
      </div>
      <div className="home-companions-work">
        <div className="home-companions-lanes">
          {HOME_AGENT_GUIDE.map((agent) => (
            <article key={agent.name}>
              <button
                type="button"
                className="home-agent-row"
                onClick={() => setAgentsOpen(true)}
                aria-haspopup="dialog"
              >
                <span className="home-agent-identity">
                  {agent.name === "Background" ? (
                    <Sparkles size={18} aria-hidden="true" />
                  ) : (
                    <Clock size={18} aria-hidden="true" />
                  )}
                  <span>
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
                  </span>
                </span>
                <span className="home-agent-brief">{agent.brief}</span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
              {guideOpen && (
                <div className="home-companions-guide">
                  <p>{agent.timing}</p>
                  <p>
                    {agent.result} {agent.pause}
                  </p>
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
      <div className="home-companions-actions">
        <button
          className="text-button"
          aria-expanded={guideOpen}
          onClick={() => setGuideOpen(!guideOpen)}
        >
          {guideOpen ? "Hide guide" : "How agents work"}
        </button>
      </div>
      {guideOpen && (
        <p className="home-companions-idle">{HOME_AGENT_IDLE_NOTE}</p>
      )}
      {guideOpen && (
        <button
          className="text-button"
          aria-expanded={expanded}
          aria-controls="home-companion-presets"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Hide characters" : "Browse characters"}
        </button>
      )}
      {guideOpen && expanded && (
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
