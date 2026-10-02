import { useEffect, useState } from "react";
import { CHARACTER_PRESETS, type PersonalAgentSettings } from "@orbyn/core";
import { client } from "../../lib/api";
import { Character } from "../../components/Character";

/** A quiet Home entry point; browsing presets never changes account settings. */
export function HomeCompanions() {
  const [identity, setIdentity] = useState<PersonalAgentSettings | null>(null);
  const [expanded, setExpanded] = useState(false);
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
          <p>
            A familiar face for your space. Customize it in assistant settings.
          </p>
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
