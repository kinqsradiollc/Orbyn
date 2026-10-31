import {
  CHARACTER_PRESETS,
  HOME_AGENT_GUIDE,
  HOME_AGENT_IDLE_NOTE,
  type AutomationAgentIdentity,
} from "@orbyn/core";
import { ChevronRight, Clock, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { navigate } from "../../lib/router";
import { client, getToken } from "../../lib/session";
import { Button } from "../../ui/kit";

type Lane = "background" | "overnight";

/** Your two agent lanes. Browsing characters never changes a setting. */
export function Companions() {
  const [names, setNames] = useState<
    Partial<Record<Lane, AutomationAgentIdentity>>
  >({});
  const [guide, setGuide] = useState(false);
  const [characters, setCharacters] = useState(false);
  useEffect(() => {
    let live = true;
    const token = getToken();
    const updated = new Set<string>();
    const stop = client.onAutomationAgentIdentity((value) => {
      updated.add(value.lane);
      if (live && token === getToken())
        setNames((old) => ({ ...old, [value.lane]: value }));
    });
    for (const lane of ["background", "overnight"] as const)
      void client.automationAgentIdentity(lane).then(
        (value) => {
          if (live && token === getToken() && !updated.has(lane))
            setNames((old) => ({ ...old, [lane]: value }));
        },
        () => undefined,
      );
    return () => {
      live = false;
      stop();
    };
  }, []);
  return (
    <section className="today-section" aria-labelledby="today-agents">
      <header className="today-section-head">
        <h2 id="today-agents">Your agents</h2>
        <Button
          variant="ghost"
          aria-expanded={guide}
          onClick={() => setGuide(!guide)}
        >
          {guide ? "Hide guide" : "How agents work"}
        </Button>
      </header>
      <ul className="today-agents">
        {HOME_AGENT_GUIDE.map((agent) => {
          const lane: Lane =
            agent.name === "Background" ? "background" : "overnight";
          const name = names[lane]?.name ?? agent.name;
          const Icon = lane === "background" ? Sparkles : Clock;
          return (
            <li key={agent.name}>
              <button onClick={() => navigate(`/app/${lane}`)}>
                <Icon aria-hidden="true" />
                <span className="today-agent-name" dir="auto">
                  {name}
                  {name !== agent.name && <small>{agent.name}</small>}
                </span>
                <span className="today-agent-brief">{agent.brief}</span>
                <ChevronRight aria-hidden="true" />
              </button>
              {guide && (
                <p className="muted small">
                  {agent.timing}. {agent.result} {agent.pause}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {guide && (
        <>
          <p className="muted small">{HOME_AGENT_IDLE_NOTE}</p>
          <Button
            variant="ghost"
            aria-expanded={characters}
            onClick={() => setCharacters(!characters)}
          >
            {characters ? "Hide characters" : "Browse characters"}
          </Button>
          {characters && (
            <ul className="today-characters" aria-label="Character presets">
              {CHARACTER_PRESETS.map(({ name }) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
