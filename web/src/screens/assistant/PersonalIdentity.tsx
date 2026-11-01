import {
  CHARACTER_PERSONAS,
  characterAppearance,
  personalAgentSettingsInput,
} from "@orbyn/core";
import { useEffect, useRef, useState } from "react";
import { client } from "../../lib/session";
import { messageOf } from "../../lib/resource";
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
import { CharacterEditor } from "../agents-shared/CharacterEditor";
import { useOwned } from "../agents-shared/hooks";
import { useRead } from "./state";
export function PersonalIdentity({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const owned = useOwned(),
    confirm = useConfirm(),
    lock = useRef(false),
    read = useRead(() => client.agentSettings({ fresh: true }));
  const [name, setName] = useState(""),
    [persona, setPersona] = useState(""),
    [look, setLook] = useState(() => characterAppearance({})),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (read.data) {
      setName(read.data.name);
      setPersona(read.data.persona);
      setLook(characterAppearance(read.data.character));
    }
  }, [read.data]);
  const dirty =
    !!read.data &&
    (name !== read.data.name ||
      persona !== read.data.persona ||
      JSON.stringify(look) !==
        JSON.stringify(characterAppearance(read.data.character)));
  const close = async () => {
    if (!owned() || lock.current) return;
    lock.current = true;
    try {
      if (
        dirty &&
        !(await confirm({
          title: "Discard assistant changes?",
          action: "Discard",
          danger: true,
        }))
      )
        return;
      if (owned()) onClose();
    } finally {
      lock.current = false;
    }
  };
  const save = async () => {
    if (!owned() || lock.current || !dirty) return;
    const parsed = personalAgentSettingsInput.safeParse({
      name,
      persona,
      character: look,
    });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? "Check the assistant identity.",
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      await client.updateAgentSettings(parsed.data);
      if (!owned()) return;
      onSaved();
      if (owned()) onClose();
    } catch (failure) {
      if (owned())
        setError(messageOf(failure, "Couldn't save. Your draft is kept."));
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  return (
    <Dialog
      title="Your assistant"
      wide
      onClose={() => void close()}
      actions={
        read.data && (
          <>
            <Button disabled={busy} onClick={() => void close()}>
              Cancel
            </Button>
            <Button
              variant="primary"
              busy={busy}
              disabled={!dirty || !name.trim()}
              onClick={() => void save()}
            >
              Save assistant
            </Button>
          </>
        )
      }
    >
      {read.loading && <Loading label="Loading assistant" />}
      {read.error && (
        <ErrorNotice message={read.error} onRetry={() => void read.reload()} />
      )}{" "}
      {error && <ErrorNotice message={error} />}
      {read.data && (
        <>
          <Field label="Name">
            <Input
              maxLength={40}
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Communication style">
            <TextArea
              maxLength={1000}
              value={persona}
              disabled={busy}
              onChange={(e) => setPersona(e.target.value)}
            />
          </Field>
          <div className="agents-chips">
            {CHARACTER_PERSONAS.map((preset) => (
              <Button
                key={preset.label}
                disabled={busy}
                onClick={() => setPersona(preset.persona)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <CharacterEditor
            value={look}
            onChange={setLook}
            name={name}
            disabled={busy}
          />
        </>
      )}
    </Dialog>
  );
}
