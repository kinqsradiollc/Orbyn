import {
  HttpError,
  NIGHT_SHIFT_KINDS,
  nightShiftInput,
  type NightShiftSettings,
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
  useConfirm,
} from "../../ui/kit";
import { useOwned, useAgentEditorState, type AgentEditorState } from "./hooks";
import { Check } from "./parts";

const KINDS: Record<(typeof NIGHT_SHIFT_KINDS)[number], string> = {
  plan: "Plan tomorrow",
  deadlines: "Deadlines",
  study: "Study",
  meetings: "Meetings",
  tidy: "Tidy up",
  handed: "Tasks handed to me",
  follow_through: "Follow through",
  reflection: "Reflect on recent work",
};

/** Overnight is opt-in: its window, what it may work on, and morning review. */
export function ScheduleDialog({
  onClose,
  onSaved,
  onStateChange,
}: {
  onStateChange?: (state: AgentEditorState) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const owned = useOwned();
  const confirm = useConfirm();
  const pending = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [baseline, setBaseline] = useState<NightShiftSettings | null>(null);
  const [value, setValue] = useState<NightShiftSettings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false),
    [fresh, setFresh] = useState(true),
    [observed, setObserved] = useState<NightShiftSettings | null>(null);
  const uncertainRef = useRef(false);
  const submitted = useRef<NightShiftSettings | null>(null);
  const matches = (saved: NightShiftSettings, input: NightShiftSettings) => {
    const checked = nightShiftInput.safeParse(saved);
    return (
      checked.success && JSON.stringify(checked.data) === JSON.stringify(input)
    );
  };

  useEffect(() => {
    let live = true;
    if (!owned()) return;
    setValue(null);
    setBaseline(null);
    setError("");
    setLoadFailed(false);
    void client.nightShiftSettings().then(
      (next) => {
        if (!live || !owned()) return;
        setFresh(true);
        setObserved(null);
        setValue(next);
        setBaseline(next);
      },
      () => {
        if (live && owned()) setLoadFailed(true);
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  const dirty =
    !!value && !!baseline && JSON.stringify(value) !== JSON.stringify(baseline);
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
          title: reload ? "Reload the schedule?" : "Discard schedule changes?",
          body: "Your unsaved schedule will be lost.",
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
      !value ||
      !dirty ||
      pending.current ||
      uncertainRef.current ||
      !fresh
    )
      return;
    const parsed = nightShiftInput.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the schedule values.");
      return;
    }
    const input = structuredClone(parsed.data);
    submitted.current = input;
    setObserved(null);
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      const saved = await client.updateNightShiftSettings(input);
      if (!owned()) return;
      if (submitted.current !== input || !matches(saved, input))
        throw new Error(
          "The saved schedule receipt does not match this change. Check saved state.",
        );
      onSaved();
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
          messageOf(failure, "Couldn't save the schedule. Your draft is kept."),
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
      const saved = await client.nightShiftSettings();
      if (owned() && submitted.current === input) {
        setObserved(saved);
        if (!matches(saved, input))
          setError(
            "The saved schedule does not match this request. Its outcome is still unconfirmed; keep checking before leaving.",
          );
        else setError("");
      }
    } catch (failure) {
      if (owned())
        setError(messageOf(failure, "Couldn't check the saved schedule."));
    } finally {
      pending.current = false;
      if (owned()) setSaving(false);
    }
  };
  const canAdopt =
    !!observed && !!submitted.current && matches(observed, submitted.current);
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
          title: "Use saved schedule?",
          body: "Discard this local draft and keep the current saved version. This does not prove which request saved it.",
          action: "Use saved schedule",
          danger: true,
        }))
      )
        return;
      if (
        !owned() ||
        observed !== saved ||
        submitted.current !== input ||
        !matches(saved, input)
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
      title="Overnight schedule"
      onClose={() => void leave()}
      actions={
        value && (
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
              disabled={confirming || uncertain || !fresh || !dirty}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save schedule"}
            </Button>
          </>
        )
      }
    >
      {loadFailed && (
        <ErrorNotice
          message="Couldn't load the schedule."
          onRetry={() => void leave(true)}
        />
      )}
      {!value && !loadFailed && <Loading label="Loading schedule" />}
      {value && (
        <>
          {error && (
            <>
              <ErrorNotice message={error} />
              <Button disabled={locked} onClick={() => void leave(true)}>
                Reload latest schedule
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
                Check saved schedule
              </Button>
              {observed && (
                <>
                  <details>
                    <summary>Current saved schedule</summary>
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
                    Use saved schedule
                  </Button>
                </>
              )}
            </div>
          )}
          <Check
            label="Work overnight"
            checked={value.enabled}
            disabled={locked}
            onChange={(event) =>
              setValue({ ...value, enabled: event.target.checked })
            }
          />
          <div className="agents-pair">
            <Field label="Start">
              <Input
                type="time"
                value={value.start}
                disabled={locked}
                onChange={(event) =>
                  setValue({ ...value, start: event.target.value })
                }
              />
            </Field>
            <Field label="End">
              <Input
                type="time"
                value={value.end}
                disabled={locked}
                onChange={(event) =>
                  setValue({ ...value, end: event.target.value })
                }
              />
            </Field>
          </div>
          <Field label="Time zone">
            <Input
              required
              maxLength={100}
              value={value.timezone}
              disabled={locked}
              placeholder="Australia/Melbourne"
              onChange={(event) =>
                setValue({ ...value, timezone: event.target.value })
              }
            />
          </Field>
          <fieldset className="agents-fieldset" disabled={locked}>
            <legend>What to work on</legend>
            {NIGHT_SHIFT_KINDS.map((kind) => (
              <Check
                key={kind}
                label={KINDS[kind]}
                checked={value.kinds[kind]}
                onChange={(event) =>
                  setValue({
                    ...value,
                    kinds: { ...value.kinds, [kind]: event.target.checked },
                  })
                }
              />
            ))}
          </fieldset>
          <Check
            label="Wait for my OK in the morning"
            checked={value.wait_for_ok}
            disabled={locked}
            onChange={(event) =>
              setValue({ ...value, wait_for_ok: event.target.checked })
            }
          />
          <p className="muted small">
            Deletes, publishing, messages and permission requests always wait in
            Review.
          </p>
        </>
      )}
    </Dialog>
  );
}
