import { useId, useState } from "react";
import {
  CHARACTER_SECTIONS,
  CHARACTER_PRESETS,
  CHARACTER_LABELS,
  CHARACTER_STATE_LABELS,
  DEFAULT_CHARACTER,
  randomCharacterAppearance,
  type CharacterAppearance,
  type CharacterState,
} from "@orbyn/core";
import { Select } from "./Select";
import { Character } from "./Character";

/** A shared wardrobe catalog, with a live preview and unsaved changes owned by the form. */
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
  const [section, setSection] = useState<string>("shape");
  const current = CHARACTER_SECTIONS.find((item) => item.id === section)!;
  return (
    <div className="character-editor">
      <div className="character-preview">
        <Character
          appearance={value}
          state={state}
          size={164}
          greeting={greeting}
          name={name || "Orbyn"}
          preview
        />
        <div className="character-preview-caption">
          <strong>{name.trim() || "Orbyn"}</strong>
          <p>
            {value.presence === "hidden"
              ? "Hidden in chat. Preview only."
              : "Make a little companion that's yours."}
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
      <div className="character-starters" aria-label="Character presets">
        {CHARACTER_PRESETS.map((preset) => (
          <button
            type="button"
            className="character-preset"
            key={preset.name}
            disabled={disabled}
            onClick={() =>
              onChange({
                ...preset.appearance,
                presence: value.presence,
                movement: value.movement,
              })
            }
          >
            <Character
              appearance={{ ...preset.appearance, presence: "static" }}
              name={preset.name}
              size={56}
              preview
            />
            <span>{preset.name}</span>
          </button>
        ))}
      </div>
      <div className="character-editor-actions">
        <button
          type="button"
          className="secondary"
          disabled={disabled}
          onClick={() => onChange(randomCharacterAppearance(value))}
        >
          Surprise me
        </button>
        <button
          type="button"
          className="secondary"
          disabled={disabled}
          onClick={() =>
            onChange({
              ...DEFAULT_CHARACTER,
              presence: value.presence,
              movement: value.movement,
            })
          }
        >
          Reset look
        </button>
      </div>
      <div
        className="character-tabs"
        role="group"
        aria-label="Customization category"
      >
        {CHARACTER_SECTIONS.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={section === item.id}
            onClick={() => setSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="character-fields" aria-label={`${current.label} options`}>
        {current.fields.map(({ key, label, options }) => (
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
        {section === "motion" && (
          <label htmlFor={`${id}-expression`}>
            Preview expression
            <Select
              id={`${id}-expression`}
              value={state}
              onChange={(e) => setState(e.target.value as CharacterState)}
            >
              {Object.entries(CHARACTER_STATE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
        )}
      </div>
      <p className="character-editor-note">
        Mix hats, eyewear, outfits and more. Save to use your look across
        devices.
      </p>
    </div>
  );
}
