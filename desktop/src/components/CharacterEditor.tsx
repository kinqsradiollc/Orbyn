import { useId, useState } from "react";
import {
  CHARACTER_BODIES,
  CHARACTER_PALETTES,
  CHARACTER_EYES,
  CHARACTER_RINGS,
  CHARACTER_ACCESSORIES,
  CHARACTER_PRESENCE,
  CHARACTER_LABELS,
  type CharacterAppearance,
  type CharacterState,
} from "@orbyn/core";
import { Select } from "./Select";
import { Character } from "./Character";

const fields = [
  ["body", "Body", CHARACTER_BODIES],
  ["palette", "Palette", CHARACTER_PALETTES],
  ["eyes", "Eyes", CHARACTER_EYES],
  ["ring", "Ring", CHARACTER_RINGS],
  ["accessory", "Accessory", CHARACTER_ACCESSORIES],
  ["presence", "Presence", CHARACTER_PRESENCE],
] as const;

/** Live appearance preview; preferences are saved by the surrounding identity form. */
export function CharacterEditor({
  value,
  onChange,
  name,
  disabled = false,
}: {
  value: CharacterAppearance;
  onChange: (value: CharacterAppearance) => void;
  name: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [greeting, setGreeting] = useState(0);
  const [state, setState] = useState<CharacterState>("ready");
  return (
    <div className="character-editor">
      <div className="character-preview">
        <Character
          appearance={value}
          state={state}
          size={144}
          greeting={greeting}
          name={name || "Orbyn"}
          preview
        />
        <div>
          <strong>{name.trim() || "Orbyn"}</strong>
          <p>
            {value.presence === "hidden"
              ? "Hidden in chat. Preview only."
              : "Your companion across Orbyn."}
          </p>
          <button
            type="button"
            className="secondary"
            disabled={disabled || value.presence !== "animated"}
            onClick={() => setGreeting((n) => n + 1)}
          >
            Say hello
          </button>
        </div>
      </div>
      <div className="character-fields">
        {fields.map(([key, label, options]) => (
          <label key={key} htmlFor={`${id}-${key}`}>
            {label}
            <Select
              id={`${id}-${key}`}
              value={value[key]}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, [key]: e.target.value })}
            >
              {options.map((option) => (
                <option key={option} value={option}>
                  {CHARACTER_LABELS[option]}
                </option>
              ))}
            </Select>
          </label>
        ))}
        <label htmlFor={`${id}-expression`}>
          Preview expression
          <Select
            id={`${id}-expression`}
            value={state}
            onChange={(e) => setState(e.target.value as CharacterState)}
          >
            <option value="ready">Ready</option>
            <option value="working">Working</option>
            <option value="waiting">Needs your decision</option>
            <option value="done">Finished</option>
            <option value="error">Error</option>
            <option value="interrupted">Stopped</option>
          </Select>
        </label>
      </div>
    </div>
  );
}
