import { NIGHT_SHIFT_KINDS, type NightShiftSettings } from "@orbyn/core";
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
} from "../../ui/kit";
import { useOwned } from "./hooks";
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
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const owned = useOwned();
  const [value, setValue] = useState<NightShiftSettings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setLoadFailed(false);
    void client.nightShiftSettings().then(
      (next) => {
        if (live && owned()) setValue(next);
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
  const save = async () => {
    if (!value || saving) return;
    setSaving(true);
    setError("");
    try {
      await client.updateNightShiftSettings(value);
      if (!owned()) return;
      onSaved();
      onClose();
    } catch (failure) {
      if (owned())
        setError(messageOf(failure, "Couldn't save the schedule. Try again."));
    } finally {
      if (owned()) setSaving(false);
    }
  };
  return (
    <Dialog
      title="Overnight schedule"
      onClose={() => {
        if (!saving) onClose();
      }}
      actions={
        value && (
          <>
            <Button variant="ghost" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" busy={saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save schedule"}
            </Button>
          </>
        )
      }
    >
      {loadFailed && (
        <ErrorNotice
          message="Couldn't load the schedule."
          onRetry={() => setAttempt((n) => n + 1)}
        />
      )}
      {!value && !loadFailed && <Loading label="Loading schedule" />}
      {value && (
        <>
          {error && <ErrorNotice message={error} />}
          <Check
            label="Work overnight"
            checked={value.enabled}
            disabled={saving}
            onChange={(event) =>
              setValue({ ...value, enabled: event.target.checked })
            }
          />
          <div className="agents-pair">
            <Field label="Start">
              <Input
                type="time"
                value={value.start}
                disabled={saving}
                onChange={(event) =>
                  setValue({ ...value, start: event.target.value })
                }
              />
            </Field>
            <Field label="End">
              <Input
                type="time"
                value={value.end}
                disabled={saving}
                onChange={(event) =>
                  setValue({ ...value, end: event.target.value })
                }
              />
            </Field>
          </div>
          <Field label="Time zone">
            <Input
              required
              value={value.timezone}
              disabled={saving}
              placeholder="Australia/Melbourne"
              onChange={(event) =>
                setValue({ ...value, timezone: event.target.value })
              }
            />
          </Field>
          <fieldset className="agents-fieldset" disabled={saving}>
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
            disabled={saving}
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
