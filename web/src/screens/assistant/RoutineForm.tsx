import {
  agentRoutineInput,
  dayTime,
  localDateKey,
  nextOccurrence,
  weekdayOf,
  zonedParts,
  type AgentRoutine,
  type AgentRoutineInput,
  type ApprovalScopes,
  type AssistantChangeKind,
} from "@orbyn/core";
import { useRef, useState } from "react";
import { client } from "../../lib/session";
import { messageOf } from "../../lib/resource";
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  SelectBox,
  TextArea,
  useConfirm,
} from "../../ui/kit";
import { useOwned } from "../agents-shared/hooks";
import { unclear, useRead } from "./state";
import { RoutineSetup } from "../agents-shared/routines/RoutineSetup";

export function RoutineForm({
  routine,
  timezone,
  onClose,
  onSaved,
  ruleLabel,
}: {
  routine?: AgentRoutine;
  timezone: string;
  onClose: () => void;
  onSaved: () => void;
  ruleLabel: (rule: ApprovalScopes[AssistantChangeKind]) => string;
}) {
  const owned = useOwned(),
    confirm = useConfirm(),
    lock = useRef(false);
  const zone = routine?.timezone ?? timezone,
    at = new Date(routine?.next_run_at ?? Date.now() + 3600000),
    parts = zonedParts(at, zone);
  const initial = useRef({
    instruction: routine?.instruction ?? "",
    day: localDateKey(at, zone),
    time: `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`,
    timezone: zone,
    repeat: routine?.rrule.includes("BYDAY=MO,TU,WE,TH,FR")
      ? "weekdays"
      : routine?.rrule.includes("FREQ=WEEKLY")
        ? "weekly"
        : "daily",
    paused: routine?.paused ?? false,
  }).current;
  const [draft, setDraft] = useState(initial),
    [setup, setSetup] = useState<AgentRoutineInput | null>(null),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const request = useRef<AgentRoutineInput | null>(null);
  const frozen = useRef(false);
  frozen.current = busy || uncertain;
  const close = async () => {
    if (!owned() || lock.current || frozen.current) return;
    lock.current = true;
    try {
      if (
        (setup || JSON.stringify(draft) !== JSON.stringify(initial)) &&
        !(await confirm({
          title: "Discard routine changes?",
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
  const prepare = async () => {
    if (!owned() || lock.current || busy || uncertain) return;
    let input: AgentRoutineInput;
    try {
      new Intl.DateTimeFormat("en", { timeZone: draft.timezone });
      const [hours, minutes] = draft.time.split(":").map(Number),
        start = dayTime(draft.day, hours * 60 + minutes, draft.timezone);
      const rule =
        draft.repeat === "daily"
          ? "FREQ=DAILY"
          : draft.repeat === "weekdays"
            ? "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
            : `FREQ=WEEKLY;BYDAY=${["SU", "MO", "TU", "WE", "TH", "FR", "SA"][weekdayOf(draft.day)]}`;
      const next =
        start > new Date()
          ? start
          : nextOccurrence(start, rule, draft.timezone, new Date());
      const sameSchedule =
        !!routine &&
        draft.day === initial.day &&
        draft.time === initial.time &&
        draft.timezone === initial.timezone &&
        draft.repeat === initial.repeat;
      let savedNext = sameSchedule ? new Date(routine.next_run_at) : next;
      if (
        sameSchedule &&
        routine.paused &&
        !draft.paused &&
        savedNext &&
        savedNext <= new Date()
      ) {
        savedNext = nextOccurrence(
          savedNext,
          routine.rrule,
          routine.timezone,
          new Date(),
        );
      }
      if (!savedNext)
        throw new Error("Choose a schedule with a future occurrence.");
      input = agentRoutineInput.parse({
        instruction: draft.instruction,
        rrule: sameSchedule ? routine.rrule : rule,
        timezone: draft.timezone,
        next_run_at: savedNext.toISOString(),
        paused: draft.paused,
      });
    } catch (failure) {
      setError(
        messageOf(failure, "Check the routine date, time and time zone."),
      );
      return;
    }
    if (!routine) {
      setSetup(input);
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    request.current = input;
    try {
      await client.updateAgentRoutine(routine.id, {
        ...input,
        ...(routine.revision ? { expected_revision: routine.revision } : {}),
      });
      if (!owned()) return;
      onSaved();
      if (owned()) onClose();
    } catch (failure) {
      if (owned()) setUncertain(unclear(failure));
      if (owned())
        setError(
          messageOf(failure, "Couldn't save the routine. Your draft is kept."),
        );
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const checkSaved = async () => {
    if (!owned() || lock.current || !routine || !request.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const rows = await client.listAgentRoutines();
      if (!owned()) return;
      const row = rows.find((one) => one.id === routine.id),
        input = request.current;
      if (
        row &&
        row.instruction === input.instruction &&
        row.rrule === input.rrule &&
        row.timezone === input.timezone &&
        row.next_run_at === input.next_run_at &&
        row.paused === input.paused
      ) {
        onSaved();
        if (owned()) onClose();
      } else
        setError(
          "Current routine settings differ from this draft. Keep this form and check again, or review the latest schedule before another save.",
        );
    } catch (failure) {
      if (owned())
        setError(messageOf(failure, "Couldn't check the current routine."));
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  return (
    <Dialog
      title={
        routine ? "Edit routine" : setup ? "Review routine" : "New routine"
      }
      onClose={() => void close()}
      actions={
        !setup && (
          <>
            <Button disabled={busy || uncertain} onClick={() => void close()}>
              Cancel
            </Button>
            <Button
              variant="primary"
              busy={busy}
              disabled={uncertain || !draft.instruction.trim()}
              onClick={() => void prepare()}
            >
              {routine ? "Save routine" : "Review setup"}
            </Button>
          </>
        )
      }
    >
      {error && <ErrorNotice message={error} />}
      {checking && <SetupCheck />}
      {uncertain && routine && (
        <Button disabled={busy} onClick={() => void checkSaved()}>
          Check current routine
        </Button>
      )}
      {setup ? (
        <RoutineSetup
          input={setup}
          ruleLabel={ruleLabel}
          onBack={() => {
            if (owned() && !frozen.current) setSetup(null);
          }}
          onSaved={() => {
            if (owned()) {
              onSaved();
              if (owned()) onClose();
            }
          }}
          onBusy={(value) => {
            frozen.current = value || uncertain;
            if (owned()) setBusy(value);
          }}
          onUncertain={(value) => {
            frozen.current = value || busy;
            if (owned()) setUncertain(value);
          }}
          onCheck={() => {
            if (owned()) setChecking(true);
          }}
        />
      ) : (
        <>
          <Field label="Instruction">
            <TextArea
              rows={4}
              maxLength={4000}
              value={draft.instruction}
              disabled={busy || uncertain}
              onChange={(e) =>
                setDraft({ ...draft, instruction: e.target.value })
              }
            />
          </Field>
          <Field label="Date">
            <Input
              type="date"
              value={draft.day}
              disabled={busy || uncertain}
              onChange={(e) => setDraft({ ...draft, day: e.target.value })}
            />
          </Field>
          <Field label="Local time">
            <Input
              type="time"
              value={draft.time}
              disabled={busy || uncertain}
              onChange={(e) => setDraft({ ...draft, time: e.target.value })}
            />
          </Field>
          <Field label="Time zone">
            <Input
              maxLength={64}
              value={draft.timezone}
              disabled={busy || uncertain}
              onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
            />
          </Field>
          <Field label="Repeat">
            <SelectBox
              value={draft.repeat}
              disabled={busy || uncertain}
              onChange={(e) => setDraft({ ...draft, repeat: e.target.value })}
            >
              <option value="daily">Daily</option>
              <option value="weekdays">Weekdays</option>
              <option value="weekly">Weekly</option>
            </SelectBox>
          </Field>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.paused}
              disabled={busy || uncertain}
              onChange={(e) => setDraft({ ...draft, paused: e.target.checked })}
            />
            Pause new occurrences
          </label>
        </>
      )}
    </Dialog>
  );
}

function SetupCheck() {
  const read = useRead(() => client.listAgentRoutines());
  return (
    <section aria-label="Current Upcoming routines">
      <h3>Current routines</h3>
      {read.error && (
        <ErrorNotice message={read.error} onRetry={() => void read.reload()} />
      )}
      <p className="muted">
        Check the exact instruction and schedule. Keep this setup open until its
        save receipt is recovered.
      </p>
      {read.loading ? (
        <p role="status">Checking Upcoming…</p>
      ) : (
        <ul>
          {read.data?.map((row) => (
            <li key={row.id}>
              {row.instruction} · {row.timezone} ·{" "}
              {new Date(row.next_run_at).toLocaleString()}
            </li>
          ))}
        </ul>
      )}
      <Button disabled={read.loading} onClick={() => void read.reload()}>
        Refresh Upcoming
      </Button>
    </section>
  );
}
