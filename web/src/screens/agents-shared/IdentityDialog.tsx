import {
  characterAppearance,
  CHARACTER_PERSONAS,
  type AutomationAgentIdentity,
} from "@orbyn/core";
import { useEffect, useState } from "react";
import { messageOf } from "../../lib/resource";
import { client } from "../../lib/session";
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  Loading,
  TextArea,
  useConfirm,
} from "../../ui/kit";
import { Character } from "./Character";
import { CharacterEditor } from "./CharacterEditor";
import { useOwned, LANE_NAME, type Lane } from "./hooks";

/** Each worker's own name, style and character. Chat never waits on this. */
export function IdentityDialog({
  lane,
  onClose,
}: {
  lane: Lane;
  onClose: () => void;
}) {
  const owned = useOwned();
  const confirm = useConfirm();
  const [identity, setIdentity] = useState<AutomationAgentIdentity | null>(
    null,
  );
  const [name, setName] = useState("");
  const [persona, setPersona] = useState("");
  const [look, setLook] = useState(() => characterAppearance({}));
  const [editing, setEditing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const adopt = (value: AutomationAgentIdentity) => {
    setIdentity(value);
    setName(value.name);
    setPersona(value.persona);
    setLook(characterAppearance(value.character));
  };
  useEffect(() => {
    let live = true;
    setLoadFailed(false);
    void client.automationAgentIdentity(lane).then(
      (value) => {
        if (live && owned()) adopt(value);
      },
      () => {
        if (live && owned()) setLoadFailed(true);
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lane, attempt]);

  const dirty =
    !!identity &&
    (name !== identity.name ||
      persona !== identity.persona ||
      JSON.stringify(look) !==
        JSON.stringify(characterAppearance(identity.character)));
  const close = async () => {
    if (saving) return;
    if (
      dirty &&
      !(await confirm({
        title: "Discard changes?",
        body: "Your unsaved name, style and character will be lost.",
        action: "Discard",
        danger: true,
      }))
    )
      return;
    onClose();
  };
  const save = async () => {
    if (!identity || !dirty || !name.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const value = await client.updateAutomationAgentIdentity(lane, {
        expected_revision: identity.revision,
        name,
        persona,
        character: look,
      });
      if (!owned()) return;
      adopt(value);
      onClose();
    } catch (failure) {
      if (owned())
        setError(messageOf(failure, "Couldn't save this agent. Try again."));
    } finally {
      if (owned()) setSaving(false);
    }
  };

  return (
    <Dialog
      title={`${LANE_NAME[lane]} agent`}
      wide
      onClose={() => void close()}
      actions={
        identity && (
          <>
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => void close()}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              busy={saving}
              disabled={!dirty || !name.trim()}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </>
        )
      }
    >
      {loadFailed && (
        <ErrorNotice
          message="Couldn't load this agent."
          onRetry={() => setAttempt((n) => n + 1)}
        />
      )}
      {!identity && !loadFailed && <Loading label="Loading agent" />}
      {identity && (
        <>
          {error && <ErrorNotice message={error} />}
          <Field label="Name">
            <Input
              required
              maxLength={40}
              value={name}
              disabled={saving}
              dir="auto"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Communication style" hint="Optional.">
            <TextArea
              rows={2}
              maxLength={1000}
              value={persona}
              disabled={saving}
              dir="auto"
              placeholder="Warm, direct, and concise"
              onChange={(event) => setPersona(event.target.value)}
            />
          </Field>
          <div className="agents-chips" aria-label="Communication presets">
            {CHARACTER_PERSONAS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                disabled={saving}
                onClick={() => setPersona(preset.persona)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="agents-buttons">
            <Character appearance={look} name={name} size={44} preview />
            <Button
              aria-expanded={editing}
              disabled={saving}
              onClick={() => setEditing(!editing)}
            >
              {editing ? "Close character editor" : "Customize character"}
            </Button>
          </div>
          {editing && (
            <CharacterEditor
              value={look}
              onChange={setLook}
              name={name}
              disabled={saving}
            />
          )}
        </>
      )}
    </Dialog>
  );
}
