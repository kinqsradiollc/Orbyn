import {
  HttpError,
  automationAgentIdentityInput,
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
import {
  useOwned,
  LANE_NAME,
  useAgentEditorState,
  type AgentEditorState,
  type Lane,
} from "./hooks";

/** Each worker's own name, style and character. Chat never waits on this. */
type IdentityProps = {
  lane: Lane;
  onClose: () => void;
  onSaved?: () => void;
  onStateChange?: (state: AgentEditorState) => void;
};
export function IdentityDialog(props: IdentityProps) {
  return <IdentityBody key={props.lane} {...props} />;
}
function IdentityBody({
  lane,
  onClose,
  onSaved,
  onStateChange,
}: IdentityProps) {
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
  const [uncertain, setUncertain] = useState(false),
    [fresh, setFresh] = useState(true),
    [observed, setObserved] = useState<AutomationAgentIdentity | null>(null);
  const uncertainRef = useRef(false);
  const submitted = useRef<ReturnType<
    typeof automationAgentIdentityInput.parse
  > | null>(null);

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
        if (live && owned()) {
          adopt(value);
          setFresh(true);
          setObserved(null);
        }
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
  useAgentEditorState(onStateChange, {
    dirty,
    pending: saving || confirming,
    uncertain,
  });
  const locked = saving || confirming || uncertain;
  const leave = async (reload = false) => {
    if (!owned() || pending.current || uncertainRef.current) return;
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
    if (
      !owned() ||
      !identity ||
      !dirty ||
      !name.trim() ||
      pending.current ||
      uncertainRef.current ||
      !fresh
    )
      return;
    const checked = automationAgentIdentityInput.safeParse({
      expected_revision: identity.revision,
      name,
      persona,
      character: look,
    });
    if (!checked.success) {
      setError(checked.error.issues[0]?.message ?? "Check the agent settings.");
      return;
    }
    const input = structuredClone(checked.data);
    submitted.current = input;
    setObserved(null);
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      const value = await client.updateAutomationAgentIdentity(lane, input);
      if (!owned()) return;
      if (
        submitted.current !== input ||
        value.lane !== lane ||
        value.revision !== input.expected_revision + 1 ||
        value.name !== input.name ||
        value.persona !== input.persona ||
        JSON.stringify(characterAppearance(value.character)) !==
          JSON.stringify(characterAppearance(input.character))
      )
        throw new Error(
          "The saved agent receipt does not match this change. Check saved state.",
        );
      adopt(value);
      onSaved?.();
      if (owned()) onClose();
    } catch (failure) {
      if (owned()) {
        const unknown =
          !(failure instanceof HttpError) ||
          failure.statusCode >= 500 ||
          [408, 429].includes(failure.statusCode);
        uncertainRef.current = unknown;
        setUncertain(unknown);
        setFresh(false);
        setError(
          messageOf(failure, "Couldn't save this agent. Your draft is kept."),
        );
      }
    } finally {
      pending.current = false;
      if (owned()) setSaving(false);
    }
  };

  const checkSaved = async () => {
    const input = submitted.current;
    if (!owned() || pending.current || !uncertainRef.current || !input) return;
    pending.current = true;
    setSaving(true);
    try {
      const saved = await client.automationAgentIdentity(lane);
      if (owned() && submitted.current === input) {
        if (saved.lane !== lane)
          throw new Error("This saved identity belongs to another runtime.");
        setObserved(saved);
        if (saved.revision <= input.expected_revision)
          setError(
            "The saved revision has not advanced. The earlier request may still commit; keep checking before leaving.",
          );
        else setError("");
      }
    } catch (failure) {
      if (owned())
        setError(messageOf(failure, "Couldn't check the saved agent."));
    } finally {
      pending.current = false;
      if (owned()) setSaving(false);
    }
  };
  const canAdopt =
    !!observed &&
    !!submitted.current &&
    observed.lane === lane &&
    observed.revision > submitted.current.expected_revision;
  const keepSaved = async () => {
    const input = submitted.current;
    if (
      !owned() ||
      pending.current ||
      !observed ||
      !uncertainRef.current ||
      !input ||
      !canAdopt
    )
      return;
    const saved = observed;
    pending.current = true;
    setConfirming(true);
    try {
      if (
        !(await confirm({
          title: "Use saved agent?",
          body: "Discard this local draft and keep the current saved version. This does not prove which request saved it.",
          action: "Use saved agent",
          danger: true,
        }))
      )
        return;
      if (
        !owned() ||
        observed !== saved ||
        submitted.current !== input ||
        saved.lane !== lane ||
        saved.revision <= input.expected_revision
      )
        return;
      uncertainRef.current = false;
      setUncertain(false);
      onSaved?.();
      if (owned()) onClose();
    } finally {
      pending.current = false;
      if (owned()) setConfirming(false);
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
              disabled={
                confirming || uncertain || !fresh || !dirty || !name.trim()
              }
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
          {uncertain && (
            <div>
              <p>
                The save is unconfirmed. Your draft is kept and cannot be sent
                again.
              </p>
              <Button
                disabled={saving || confirming}
                onClick={() => void checkSaved()}
              >
                Check saved agent
              </Button>
              {observed && (
                <>
                  <details>
                    <summary>Current saved agent</summary>
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {JSON.stringify(observed, null, 2)}
                    </pre>
                  </details>
                  <Button
                    disabled={saving || confirming || !canAdopt}
                    onClick={() => void keepSaved()}
                  >
                    Use saved agent
                  </Button>
                </>
              )}
            </div>
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
