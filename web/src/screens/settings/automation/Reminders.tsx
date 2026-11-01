import {
  reminderNudgeSettingsInput,
  type ReminderNudgeSettings,
} from "@orbyn/core";
import { useEffect, useRef, useState } from "react";
import { messageOf } from "../../../lib/resource";
import { client } from "../../../lib/session";
import {
  Button,
  ErrorNotice,
  Field,
  Input,
  Loading,
  useConfirm,
} from "../../../ui/kit";
import {
  SettingsSection,
  useSettingsExit,
  useSettingsOwner,
  useSettingsRead,
} from "../shared";
import { equal, unknownOutcome } from "./model";
const matchesReminder = (
  saved: ReminderNudgeSettings,
  submitted: ReminderNudgeSettings,
) => {
  const parsed = reminderNudgeSettingsInput.safeParse(saved);
  return parsed.success && equal(parsed.data, submitted);
};
export function AutomationReminders() {
  const owned = useSettingsOwner(),
    confirm = useConfirm(),
    read = useSettingsRead(() => client.reminderNudgeSettings());
  const [base, setBase] = useState<ReminderNudgeSettings | null>(null),
    [draft, setDraft] = useState<ReminderNudgeSettings | null>(null),
    [busy, setBusy] = useState(false),
    [confirming, setConfirming] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [observed, setObserved] = useState<ReminderNudgeSettings | null>(null),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const lock = useRef(false),
    unknown = useRef(false),
    latest = useRef(draft);
  latest.current = draft;
  const attempt = useRef<Readonly<ReminderNudgeSettings> | null>(null);
  const observation = useRef(observed);
  observation.current = observed;
  useEffect(() => {
    if (owned() && read.data && !latest.current) {
      setDraft(read.data);
      setBase(read.data);
    }
  }, [read.data, owned]);
  const dirty = !!draft && !equal(draft, base),
    frozen = busy || confirming || uncertain;
  useSettingsExit({
    dirty,
    pending: busy || confirming,
    sensitive: uncertain,
    message: uncertain
      ? "Check the unconfirmed reminder save before leaving."
      : undefined,
  });
  const change = (patch: Partial<ReminderNudgeSettings>) => {
    if (!owned() || lock.current || unknown.current) return;
    setDraft((value) => value && { ...value, ...patch });
    setStatus("");
  };
  const save = async () => {
    if (
      !owned() ||
      lock.current ||
      unknown.current ||
      !draft ||
      !dirty ||
      !read.fresh
    )
      return;
    const checked = reminderNudgeSettingsInput.safeParse(draft);
    if (!checked.success) {
      setError(
        checked.error.issues[0]?.message ?? "Check the reminder settings.",
      );
      return;
    }
    const submitted = Object.freeze(structuredClone(checked.data));
    attempt.current = submitted;
    lock.current = true;
    setBusy(true);
    setError("");
    setObserved(null);
    read.invalidate();
    try {
      const saved = await client.updateReminderNudgeSettings(submitted);
      if (owned() && attempt.current === submitted) {
        if (!matchesReminder(saved, submitted))
          throw new Error(
            "The reminder receipt does not match these settings. Check saved reminders.",
          );
        read.commit(saved);
        setBase(saved);
        setDraft(saved);
        attempt.current = null;
        setStatus("Reminders saved.");
      }
    } catch (failure) {
      if (owned()) {
        unknown.current = unknownOutcome(failure);
        setUncertain(unknown.current);
        setError(
          messageOf(failure, "Couldn't save reminders. Your draft is kept."),
        );
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const check = async () => {
    const submitted = attempt.current;
    if (!owned() || lock.current || (unknown.current && !submitted)) return;
    lock.current = true;
    setBusy(true);
    try {
      const saved = reminderNudgeSettingsInput.parse(
        await client.reminderNudgeSettings(),
      );
      if (owned() && attempt.current === submitted) {
        setObserved(saved);
        if (!unknown.current) read.commit(saved);
        setError(
          unknown.current && submitted && !matchesReminder(saved, submitted)
            ? "Saved reminders do not match this request. The earlier save may still finish; keep checking before leaving."
            : "",
        );
      }
    } catch (failure) {
      if (owned())
        setError(messageOf(failure, "Couldn't check saved reminders."));
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const canAdoptObserved =
    !uncertain ||
    (!!observed &&
      !!attempt.current &&
      matchesReminder(observed, attempt.current));
  const useSaved = async () => {
    const submitted = attempt.current;
    const saved = unknown.current ? observed : (observed ?? read.data);
    if (
      !owned() ||
      lock.current ||
      !saved ||
      (!unknown.current && !read.fresh) ||
      (unknown.current && (!submitted || !matchesReminder(saved, submitted)))
    )
      return;
    const buffer = latest.current;
    lock.current = true;
    setConfirming(true);
    try {
      if (
        (dirty || unknown.current) &&
        !(await confirm({
          title: "Use saved reminders?",
          body: "Discard this local draft and keep the current saved settings.",
          action: "Use saved reminders",
          danger: true,
        }))
      )
        return;
      if (
        !owned() ||
        latest.current !== buffer ||
        attempt.current !== submitted ||
        (unknown.current &&
          (observation.current !== saved ||
            !submitted ||
            !matchesReminder(saved, submitted)))
      )
        return;
      read.commit(saved);
      setBase(saved);
      setDraft(saved);
      setObserved(null);
      unknown.current = false;
      setUncertain(false);
      attempt.current = null;
      setError("");
      setStatus("Using the saved reminders.");
    } finally {
      lock.current = false;
      if (owned()) setConfirming(false);
    }
  };
  return (
    <SettingsSection
      title="Reminders"
      description="Personal reminder channels and quiet hours. These reminders make no AI requests."
    >
      {read.loading && !draft && <Loading label="Loading reminder settings" />}
      {read.error && (
        <ErrorNotice
          message={read.error}
          onRetry={uncertain ? undefined : () => void read.reload()}
        />
      )}
      {error && <ErrorNotice message={error} />}{" "}
      {status && <p role="status">{status}</p>}
      {draft && (
        <form
          className="settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={frozen} className="settings-automation-fields">
            <legend>Delivery</legend>
            {(
              [
                { key: "enabled", name: "Reminders" },
                { key: "chat", name: "Private chat" },
                { key: "push", name: "Push notifications" },
                { key: "email", name: "Email" },
              ] as const
            ).map(({ key, name }) => (
              <label key={key} className="check">
                <input
                  type="checkbox"
                  checked={draft[key]}
                  onChange={(event) => change({ [key]: event.target.checked })}
                />
                {name}
              </label>
            ))}
            <div className="settings-automation-grid">
              <Field label="Quiet hours start">
                <Input
                  type="time"
                  value={draft.quiet_start}
                  onChange={(event) =>
                    change({ quiet_start: event.target.value })
                  }
                />
              </Field>
              <Field label="Quiet hours end">
                <Input
                  type="time"
                  value={draft.quiet_end}
                  onChange={(event) =>
                    change({ quiet_end: event.target.value })
                  }
                />
              </Field>
            </div>
          </fieldset>
          <p className="small muted">
            Quiet hours use your planning time zone. Equal start and end means
            no quiet window. At most three reminders a day, once per item in 24
            hours. Email covers overdue work and underbooked deadlines; stop an
            item's reminders from its chat card.
          </p>
          <div className="settings-automation-actions">
            <Button
              type="submit"
              variant="primary"
              busy={busy}
              disabled={confirming || uncertain || !dirty || !read.fresh}
            >
              Save reminders
            </Button>
            <Button disabled={busy || confirming} onClick={() => void check()}>
              {uncertain ? "Check saved reminders" : "Refresh saved reminders"}
            </Button>
            {!uncertain && (
              <Button
                disabled={busy || confirming || !dirty || !read.fresh}
                onClick={() => void useSaved()}
              >
                Discard changes
              </Button>
            )}
          </div>
        </form>
      )}
      {(uncertain || observed) && (
        <div className="settings-automation-recovery">
          <p>
            {uncertain
              ? "The save is unconfirmed. Your draft is frozen until you review saved reminders."
              : "Refreshing saved settings has kept your draft."}
          </p>
          {observed && (
            <>
              <details>
                <summary>Current saved reminders</summary>
                <p>
                  {observed.enabled ? "Reminders on" : "Reminders off"} ·{" "}
                  {observed.chat ? "Chat on" : "Chat off"} ·{" "}
                  {observed.push ? "Push on" : "Push off"} ·{" "}
                  {observed.email ? "Email on" : "Email off"} · Quiet{" "}
                  {observed.quiet_start}–{observed.quiet_end}
                </p>
              </details>
              <Button
                disabled={busy || confirming || !canAdoptObserved}
                onClick={() => void useSaved()}
              >
                Use saved reminders
              </Button>
            </>
          )}
        </div>
      )}
    </SettingsSection>
  );
}
