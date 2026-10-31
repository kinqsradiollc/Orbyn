import {
  CHARACTER_LABELS,
  CHARACTER_PRESETS,
  CHARACTER_SECTIONS,
  CHARACTER_STATE_LABELS,
  DEFAULT_CHARACTER,
  randomCharacterAppearance,
  type CharacterAppearance,
  type CharacterState,
} from "@orbyn/core";
import { useState } from "react";
import { Button, Field, Segmented, SelectBox } from "../../ui/kit";
import { Character } from "./Character";

/** The shared wardrobe with a live preview. Unsaved changes belong to the form. */
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
  const [greeting, setGreeting] = useState(0);
  const [state, setState] = useState<CharacterState>("ready");
  const [section, setSection] = useState("presets");
  const fields = CHARACTER_SECTIONS.find((item) => item.id === section);
  return (
    <div className="agents-editor">
      <div className="agents-editor-stage">
        <Character
          appearance={value}
          state={state}
          size={136}
          greeting={greeting}
          name={name || "Orbyn"}
          preview
        />
        <strong dir="auto">{name.trim() || "Orbyn"}</strong>
        {value.presence === "hidden" && (
          <p className="muted small">Hidden outside this preview.</p>
        )}
        <Button
          variant="ghost"
          disabled={disabled || value.presence !== "animated"}
          onClick={() => setGreeting((count) => count + 1)}
        >
          Say hello
        </Button>
      </div>
      <div className="agents-editor-controls">
        <div className="agents-editor-tabs">
          <Segmented
            label="Customization category"
            value={section}
            options={[
              { value: "presets", label: "Looks" },
              ...CHARACTER_SECTIONS.map((item) => ({
                value: item.id as string,
                label: item.label,
              })),
            ]}
            onChange={setSection}
          />
        </div>
        {section === "presets" && (
          <div className="agents-presets" aria-label="Character looks">
            {CHARACTER_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                aria-label={`Use ${preset.name} look`}
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
                  size={52}
                  preview
                />
                <span>{preset.name}</span>
              </button>
            ))}
          </div>
        )}
        {fields && (
          <div
            className="agents-editor-fields"
            aria-label={`${fields.label} options`}
          >
            {fields.fields.map(({ key, label, options }) => (
              <Field key={key} label={label}>
                <SelectBox
                  value={value[key]}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange({ ...value, [key]: event.target.value })
                  }
                >
                  {options.map((option) => (
                    <option key={option} value={option}>
                      {CHARACTER_LABELS[option]}
                    </option>
                  ))}
                </SelectBox>
              </Field>
            ))}
            {section === "motion" && (
              <Field label="Preview expression">
                <SelectBox
                  value={state}
                  onChange={(event) =>
                    setState(event.target.value as CharacterState)
                  }
                >
                  {Object.entries(CHARACTER_STATE_LABELS).map(
                    ([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ),
                  )}
                </SelectBox>
              </Field>
            )}
          </div>
        )}
        <div className="agents-buttons">
          <Button
            disabled={disabled}
            onClick={() => onChange(randomCharacterAppearance(value))}
          >
            Surprise me
          </Button>
          <Button
            variant="ghost"
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
          </Button>
        </div>
      </div>
    </div>
  );
}
