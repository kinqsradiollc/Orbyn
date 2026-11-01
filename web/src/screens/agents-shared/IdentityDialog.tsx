import {
  characterAppearance,
  CHARACTER_PERSONAS,
  type AutomationAgentIdentity,
} from "@orbyn/core";
import { useEffect, useRef, useState } from "react";
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
  onSaved,
}: {
  lane: Lane;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const owned = useOwned();
  const confirm = useConfirm();
  const pending = useRef(false);
  const [confirming, setConfirming] = useState(false);
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
    if (!owned()) return;
    setIdentity(null);
    setEditing(false);
    setError("");
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
  const locked = saving || confirming;
  const leave = async (reload = false) => {
    if (!owned() || pending.current) return;
    pending.current = true;
    setConfirming(true);
    try {
      if (
        dirty &&
        !(await confirm({
          title: reload ? "Reload this agent?" : "Discard changes?",
          body: "Your unsaved name, style and character will be lost.",
          action: reload ? "Reload" : "Discard",
          danger: true,
        }))
      )
        return;
      if (!owned()) return;
      if (reload) setAttempt((n) => n + 1);
      else onClose();
    } finally {
      pending.current = false;
      if (owned()) setConfirming(false);
    }
  };
  const save = async () => {
    if (!owned() || !identity || !dirty || !name.trim() || pending.current)
      return;
    pending.current = true;
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
      onSaved?.();
      if (owned()) onClose();
    } catch (failure) {
      if (owned())
        setError(
          messageOf(failure, "Couldn't save this agent. Your draft is kept."),
        );
    } finally {
      pending.current = false;
      if (owned()) setSaving(false);
    }
  };

  return (
    <Dialog
      title={`${LANE_NAME[lane]} agent`}
      wide
      onClose={() => void leave()}
      actions={
        identity && (
          <>
            <Button
              variant="ghost"
              disabled={locked}
              onClick={() => void leave()}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              busy={saving}
              disabled={confirming || !dirty || !name.trim()}
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
          onRetry={() => void leave(true)}
        />
      )}
      {!identity && !loadFailed && <Loading label="Loading agent" />}
      {identity && (
        <>
          {error && (
            <>
              <ErrorNotice message={error} />
              <Button disabled={locked} onClick={() => void leave(true)}>
                Reload latest agent
              </Button>
            </>
          )}
          <Field label="Name">
            <Input
              required
              maxLength={40}
              value={name}
              disabled={locked}
              dir="auto"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Communication style" hint="Optional.">
            <TextArea
              rows={2}
              maxLength={1000}
              value={persona}
              disabled={locked}
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
                disabled={locked}
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
              disabled={locked}
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
              disabled={locked}
            />
          )}
        </>
      )}
    </Dialog>
  );
}
