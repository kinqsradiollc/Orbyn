import {
  BREAK_LEVELS,
  SESSION_REMINDER_MINUTES,
  plannerPrefsInput,
  type BufferScope,
  type DigestPrefs,
  type PlannerPrefs,
  type PlannerPrefsInput,
} from "@orbyn/core";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { client } from "../../../lib/session";
import { messageOf } from "../../../lib/resource";
import {
  Button,
  ErrorNotice,
  Field,
  Input,
  Loading,
  SelectBox,
  useConfirm,
} from "../../../ui/kit";
import { refreshPlanner } from "../../shared-task";
import {
  SettingsSection,
  useSettingsExit,
  useSettingsOwner,
  useSettingsRead,
} from "../shared";
import {
  editable,
  equal,
  matchesSaved,
  preferencePatch,
  unknownOutcome,
  zoneNames,
  type EditablePrefs,
} from "./model";

const NUMBERS = [
  {
    key: "pad_percent",
    label: "Estimate padding (%)",
    min: 0,
    max: 100,
    group: "work",
  },
  {
    key: "split_after_minutes",
    label: "Split tasks longer than (minutes)",
    min: 15,
    max: 480,
    group: "work",
  },
  {
    key: "min_block_minutes",
    label: "Minimum session (minutes)",
    min: 5,
    max: 240,
    group: "work",
  },
  {
    key: "horizon_days",
    label: "Planning horizon (days)",
    min: 1,
    max: 7,
    group: "work",
  },
  {
    key: "buffer_before_minutes",
    label: "Before events (minutes)",
    min: 0,
    max: 120,
    group: "buffers",
  },
  {
    key: "buffer_after_minutes",
    label: "After events (minutes)",
    min: 0,
    max: 120,
    group: "buffers",
  },
  {
    key: "default_travel_minutes",
    label: "Default travel (minutes)",
    min: 0,
    max: 240,
    group: "buffers",
  },
  {
    key: "travel_padding_minutes",
    label: "Extra time per travel leg (minutes)",
    min: 0,
    max: 30,
    group: "buffers",
  },
  {
    key: "deadline_notice_days",
    label: "Warn before unplanned deadlines (days; 0 is off)",
    min: 0,
    max: 14,
    group: "notices",
  },
] as const;
type NumberKey = (typeof NUMBERS)[number]["key"];
type Draft = {
  prefs: EditablePrefs;
  numbers: Record<NumberKey, string>;
  scopeMinutes: string;
  reminder: string;
  alerts: { event: string; task: string; all_day: string };
};
const scopeOf = (prefs: EditablePrefs): BufferScope =>
  prefs.buffer_scope ?? {
    personal: true,
    team_ids: null,
    list_ids: [],
    min_minutes: 0,
    only_with_others: false,
  };
const digestOf = (prefs: EditablePrefs): DigestPrefs =>
  prefs.digest ?? {
    morning: false,
    evening: false,
    morning_time: "07:00",
    evening_time: "17:00",
    agents: true,
    agent_push: true,
  };
function fromPrefs(value: PlannerPrefs): Draft {
  const prefs = editable(value);
  return {
    prefs,
    numbers: Object.fromEntries(
      NUMBERS.map(({ key }) => [key, String(prefs[key] ?? 0)]),
    ) as Record<NumberKey, string>,
    scopeMinutes: String(scopeOf(prefs).min_minutes),
    reminder:
      prefs.session_reminder_minutes == null
        ? "off"
        : String(prefs.session_reminder_minutes),
    alerts: {
      event: (prefs.default_alerts?.event ?? []).join(", "),
      task: (prefs.default_alerts?.task ?? []).join(", "),
      all_day: (prefs.default_alerts?.all_day ?? []).join(", "),
    },
  };
}
function inputOf(draft: Draft): PlannerPrefsInput {
  const alerts = (value: string) =>
    value.trim() ? value.split(",").map((part) => Number(part.trim())) : [];
  return {
    ...draft.prefs,
    ...Object.fromEntries(
      NUMBERS.map(({ key }) => [key, Number(draft.numbers[key])]),
    ),
    buffer_scope: {
      ...scopeOf(draft.prefs),
      min_minutes: Number(draft.scopeMinutes),
    },
    session_reminder_minutes:
      draft.reminder === "off" ? null : Number(draft.reminder),
    default_alerts: {
      event: alerts(draft.alerts.event),
      task: alerts(draft.alerts.task),
      all_day: alerts(draft.alerts.all_day),
    },
  };
}
const DAYS = [1, 2, 3, 4, 5, 6, 0],
  DAY_NAMES = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
export function PlanningPreferences() {
  const owned = useSettingsOwner(),
    confirm = useConfirm();
  const read = useSettingsRead(() => client.getPlannerPrefs()),
    teams = useSettingsRead(() => client.listTeams()),
    lists = useSettingsRead(() => client.listLists());
  const [draft, setDraft] = useState<Draft | null>(null),
    [base, setBase] = useState<Draft | null>(null),
    [zone, setZone] = useState(""),
    [busy, setBusy] = useState(false),
    [confirming, setConfirming] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const lock = useRef(false),
    uncertainRef = useRef(false),
    latest = useRef(draft);
  latest.current = draft;
  const attempt = useRef<{ input: PlannerPrefsInput; draft: Draft } | null>(
    null,
  );
  const [observed, setObserved] = useState<PlannerPrefs | null>(null),
    [mailUnknown, setMailUnknown] = useState(false);
  useEffect(() => {
    if (owned() && read.data && !latest.current) {
      const value = fromPrefs(read.data);
      setDraft(value);
      setBase(value);
    }
  }, [read.data, owned]);
  const dirty = !!draft && (!equal(draft, base) || !!zone.trim());
  useSettingsExit({
    dirty,
    pending: busy || confirming,
    sensitive: uncertain || mailUnknown,
    message: uncertain
      ? "Resolve the planning save before leaving."
      : mailUnknown
        ? "Acknowledge the unconfirmed digest delivery before leaving."
        : undefined,
  });
  const locked = busy || confirming || uncertain;
  const update = (patch: Partial<EditablePrefs>) => {
    if (!owned() || lock.current || uncertainRef.current) return;
    setDraft((old) => old && { ...old, prefs: { ...old.prefs, ...patch } });
    setStatus("");
  };
  const change = (fn: (value: Draft) => Draft) => {
    if (!owned() || lock.current || uncertainRef.current) return;
    setDraft((old) => old && fn(old));
    setStatus("");
  };
  const adopt = (value: PlannerPrefs) => {
    const next = fromPrefs(value);
    read.commit(value);
    setBase(next);
    setDraft(next);
    setZone("");
    setObserved(null);
  };
  const discard = async () => {
    if (!owned() || lock.current || uncertainRef.current || !read.data) return;
    const current = latest.current,
      saved = read.data;
    lock.current = true;
    setConfirming(true);
    try {
      if (
        dirty &&
        !(await confirm({
          title: "Discard planning changes?",
          body: "Restore the last confirmed settings. Nothing will be saved.",
          action: "Discard changes",
          danger: true,
        }))
      )
        return;
      if (!owned() || latest.current !== current || uncertainRef.current)
        return;
      adopt(saved);
      setStatus("");
      if (read.fresh) setError("");
    } finally {
      lock.current = false;
      if (owned()) setConfirming(false);
    }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (
      !owned() ||
      lock.current ||
      uncertainRef.current ||
      !draft ||
      !base ||
      !read.fresh
    )
      return;
    if (zone.trim()) {
      setError("Add or clear the extra time zone before saving.");
      return;
    }
    if (
      NUMBERS.some(({ key }) => !draft.numbers[key].trim()) ||
      !draft.scopeMinutes.trim()
    ) {
      setError("Complete the planning numbers before saving.");
      return;
    }
    if (
      Object.values(draft.alerts).some(
        (value) =>
          value.trim() && value.split(",").some((part) => !part.trim()),
      )
    ) {
      setError("Separate alert minutes with commas; remove any empty entry.");
      return;
    }
    const parsed = plannerPrefsInput.safeParse(inputOf(draft));
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? "Check the planning settings.",
      );
      return;
    }
    if (draft.prefs.work_end <= draft.prefs.work_start) {
      setError("Working hours must end after they start.");
      return;
    }
    const input = preferencePatch(
      plannerPrefsInput.parse(inputOf(base)),
      parsed.data,
    );
    if (!Object.keys(input).length) {
      setDraft(base);
      setStatus("No saved values changed.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    setStatus("");
    read.invalidate();
    setObserved(null);
    attempt.current = {
      input: structuredClone(input),
      draft: structuredClone(draft),
    };
    try {
      const value = await client.updatePlannerPrefs(input);
      if (!owned()) return;
      adopt(value);
      attempt.current = null;
      setStatus("Planning settings saved.");
      try {
        if (owned()) await refreshPlanner(true);
      } catch {
        if (owned())
          setStatus(
            "Planning settings saved. Calendar refresh is unavailable; reopen Calendar to refresh it.",
          );
      }
    } catch (failure) {
      if (owned()) {
        const unknown = unknownOutcome(failure);
        uncertainRef.current = unknown;
        setUncertain(unknown);
        setError(
          messageOf(
            failure,
            unknown
              ? "The save outcome is unconfirmed. Check saved settings before another change."
              : "Couldn't save. Your draft is kept; refresh the saved settings before retrying.",
          ),
        );
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const checkSaved = async () => {
    if (!owned() || lock.current || !attempt.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const submitted = attempt.current;
    try {
      const value = await client.getPlannerPrefs();
      if (!owned() || attempt.current !== submitted) return;
      read.commit(value);
      if (matchesSaved(value, submitted.input)) {
        adopt(value);
        uncertainRef.current = false;
        setUncertain(false);
        attempt.current = null;
        setStatus("Current saved settings match your submitted changes.");
      } else {
        setObserved(value);
        setError(
          uncertainRef.current
            ? "Saved settings do not match this request. The earlier save may still finish; keep checking. Your draft remains blocked."
            : "Saved settings differ from this draft. Review them or use the saved version before another change.",
        );
      }
    } catch (failure) {
      if (owned())
        setError(
          messageOf(
            failure,
            "Couldn't check the saved settings. Your draft is kept.",
          ),
        );
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const useObserved = async () => {
    const submitted = attempt.current;
    if (
      !owned() ||
      lock.current ||
      !observed ||
      (uncertainRef.current &&
        (!submitted || !matchesSaved(observed, submitted.input)))
    )
      return;
    const value = observed;
    lock.current = true;
    setConfirming(true);
    try {
      if (
        !(await confirm({
          title: "Use saved planning settings?",
          body: "Discard this local draft and keep the settings read from the server.",
          action: "Use saved settings",
          danger: true,
        }))
      )
        return;
      if (
        !owned() ||
        observed !== value ||
        attempt.current !== submitted ||
        (uncertainRef.current &&
          (!submitted || !matchesSaved(value, submitted.input)))
      )
        return;
      adopt(value);
      uncertainRef.current = false;
      setUncertain(false);
      attempt.current = null;
      setError("");
    } finally {
      lock.current = false;
      if (owned()) setConfirming(false);
    }
  };
  const addZone = () => {
    if (!owned() || locked || !draft) return;
    try {
      new Intl.DateTimeFormat("en", { timeZone: zone.trim() });
      if (!zone.trim()) throw Error("Choose a time zone.");
      if (draft.prefs.extra_timezones.includes(zone.trim()))
        throw Error("That time zone is already included.");
      if (draft.prefs.extra_timezones.length >= 3)
        throw Error("Choose up to three extra time zones.");
      update({
        extra_timezones: [...draft.prefs.extra_timezones, zone.trim()],
      });
      setZone("");
      setError("");
    } catch (failure) {
      setError(messageOf(failure, "Choose a valid time zone."));
    }
  };
  const preview = async () => {
    if (
      !owned() ||
      lock.current ||
      dirty ||
      uncertainRef.current ||
      mailUnknown
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await client.sendTestDigest("morning");
      if (owned()) setStatus("Morning digest preview sent to your email.");
    } catch (failure) {
      if (owned()) {
        setMailUnknown(unknownOutcome(failure));
        setError(
          messageOf(
            failure,
            "Digest delivery could not be confirmed. Check your inbox before sending another.",
          ),
        );
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  if (!draft)
    return (
      <SettingsSection title="How you work">
        {read.loading ? (
          <Loading label="Loading planning settings" />
        ) : (
          <ErrorNotice
            message={read.error || "Planning settings are unavailable."}
            onRetry={() => void read.reload()}
          />
        )}
      </SettingsSection>
    );
  const scope = scopeOf(draft.prefs),
    digest = digestOf(draft.prefs),
    notices = draft.prefs.planner_notices ?? { push: true, email: true };
  const numberFields = (group: string) =>
    NUMBERS.filter((field) => field.group === group).map(
      ({ key, label, min, max }) => (
        <Field key={key} label={label}>
          <Input
            type="number"
            min={min}
            max={max}
            value={draft.numbers[key]}
            disabled={locked}
            onChange={(e) =>
              change((value) => ({
                ...value,
                numbers: { ...value.numbers, [key]: e.target.value },
              }))
            }
          />
        </Field>
      ),
    );
  const checkbox = (
    label: string,
    value: boolean,
    onChange: (checked: boolean) => void,
    key?: string,
  ) => (
    <label key={key} className="check">
      <input
        type="checkbox"
        checked={value}
        disabled={locked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
  return (
    <SettingsSection title="How you work">
      <form
        onSubmit={(event) => void save(event)}
        className="settings-planning-form"
        aria-busy={busy}
      >
        {read.error && (
          <ErrorNotice
            message={read.error}
            onRetry={uncertain ? undefined : () => void read.reload()}
          />
        )}{" "}
        {error && <ErrorNotice message={error} />}{" "}
        {status && (
          <p role="status" className="settings-planning-saved">
            {status}
          </p>
        )}
        {uncertain && (
          <div className="settings-planning-recovery">
            <p>The save outcome is unconfirmed. Your draft is kept.</p>
            <Button
              disabled={busy || confirming}
              onClick={() => void checkSaved()}
            >
              Check saved settings
            </Button>
            {observed && (
              <>
                <details>
                  <summary>Current saved settings</summary>
                  <dl>
                    {Object.entries(attempt.current?.input ?? {}).map(
                      ([key]) => (
                        <div key={key}>
                          <dt>{key.replaceAll("_", " ")}</dt>
                          <dd>
                            {JSON.stringify(
                              observed[key as keyof PlannerPrefs],
                            )}
                          </dd>
                        </div>
                      ),
                    )}
                  </dl>
                </details>
                <Button
                  disabled={
                    busy ||
                    confirming ||
                    (uncertain &&
                      (!attempt.current ||
                        !matchesSaved(observed, attempt.current.input)))
                  }
                  onClick={() => void useObserved()}
                >
                  Use saved settings
                </Button>
              </>
            )}
          </div>
        )}
        <fieldset disabled={locked} className="settings-planning-fields">
          <legend>Working time</legend>
          <Field label="Time zone">
            <Input
              list="settings-planning-zones"
              value={draft.prefs.timezone}
              onChange={(e) => update({ timezone: e.target.value })}
            />
          </Field>
          <datalist id="settings-planning-zones">
            {zoneNames().map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
          <fieldset className="settings-planning-days">
            <legend>Working days</legend>
            {DAYS.map((day) => (
              <label className="check" key={day}>
                <input
                  type="checkbox"
                  checked={draft.prefs.work_days.includes(day)}
                  onChange={(e) =>
                    update({
                      work_days: e.target.checked
                        ? [...draft.prefs.work_days, day]
                        : draft.prefs.work_days.filter((d) => d !== day),
                    })
                  }
                />
                {DAY_NAMES[day]}
              </label>
            ))}
          </fieldset>
          <div className="settings-planning-grid">
            <Field label="Work starts">
              <Input
                type="time"
                value={draft.prefs.work_start}
                onChange={(e) => update({ work_start: e.target.value })}
              />
            </Field>
            <Field label="Work ends">
              <Input
                type="time"
                value={draft.prefs.work_end}
                onChange={(e) => update({ work_end: e.target.value })}
              />
            </Field>
            {numberFields("work")}
            <Field label="Break level">
              <SelectBox
                value={draft.prefs.break_level}
                onChange={(e) => {
                  const level = BREAK_LEVELS.find(
                    (level) => level === e.target.value,
                  );
                  if (level) update({ break_level: level });
                }}
              >
                {BREAK_LEVELS.map((level) => (
                  <option key={level}>{level}</option>
                ))}
              </SelectBox>
            </Field>
          </div>
        </fieldset>
        <fieldset disabled={locked} className="settings-planning-fields">
          <legend>Event buffers and travel</legend>
          <div className="settings-planning-grid">
            {numberFields("buffers")}
            <Field label="Minimum buffered event (minutes)">
              <Input
                type="number"
                min={0}
                max={1440}
                value={draft.scopeMinutes}
                onChange={(e) =>
                  change((value) => ({
                    ...value,
                    scopeMinutes: e.target.value,
                  }))
                }
              />
            </Field>
          </div>
          {checkbox(
            "Adapt buffers to the event",
            draft.prefs.adaptive_buffers,
            (adaptive_buffers) => update({ adaptive_buffers }),
          )}
          {checkbox("Buffer personal events", scope.personal, (personal) =>
            update({ buffer_scope: { ...scope, personal } }),
          )}
          {checkbox(
            "Only buffer meetings with others",
            scope.only_with_others,
            (only_with_others) =>
              update({ buffer_scope: { ...scope, only_with_others } }),
          )}
          {checkbox(
            "Include all my teams, including future teams",
            scope.team_ids === null,
            (all) =>
              update({ buffer_scope: { ...scope, team_ids: all ? null : [] } }),
          )}
          {scope.team_ids !== null && (
            <fieldset>
              <legend>Teams whose events get buffers</legend>
              {teams.error && (
                <ErrorNotice
                  message={teams.error}
                  onRetry={() => void teams.reload()}
                />
              )}{" "}
              {[
                ...new Set([
                  ...(teams.data ?? []).map((t) => t.id),
                  ...scope.team_ids,
                ]),
              ].map((id) =>
                checkbox(
                  teams.data?.find((t) => t.id === id)?.name ??
                    "Unavailable team",
                  scope.team_ids!.includes(id),
                  (checked) =>
                    update({
                      buffer_scope: {
                        ...scope,
                        team_ids: checked
                          ? [...scope.team_ids!, id]
                          : scope.team_ids!.filter((value) => value !== id),
                      },
                    }),
                  id,
                ),
              )}
            </fieldset>
          )}
          <fieldset>
            <legend>Lists to buffer (none selected means any list)</legend>
            {lists.error && (
              <ErrorNotice
                message={lists.error}
                onRetry={() => void lists.reload()}
              />
            )}{" "}
            {[
              ...new Set([
                ...(lists.data ?? []).map((l) => l.id),
                ...scope.list_ids,
              ]),
            ].map((id) =>
              checkbox(
                lists.data?.find((l) => l.id === id)?.name ??
                  "Unavailable list",
                scope.list_ids.includes(id),
                (checked) =>
                  update({
                    buffer_scope: {
                      ...scope,
                      list_ids: checked
                        ? [...scope.list_ids, id]
                        : scope.list_ids.filter((value) => value !== id),
                    },
                  }),
                id,
              ),
            )}
          </fieldset>
        </fieldset>
        <fieldset disabled={locked} className="settings-planning-fields">
          <legend>Extra time zones</legend>
          <ul className="settings-planning-zones">
            {draft.prefs.extra_timezones.map((zone) => (
              <li key={zone}>
                {zone}
                <Button
                  onClick={() =>
                    update({
                      extra_timezones: draft.prefs.extra_timezones.filter(
                        (value) => value !== zone,
                      ),
                    })
                  }
                >
                  Remove {zone}
                </Button>
              </li>
            ))}
          </ul>
          <Field label="Add time zone">
            <Input
              list="settings-planning-zones"
              value={zone}
              onChange={(e) => setZone(e.target.value)}
            />
          </Field>
          <Button
            disabled={!zone.trim() || draft.prefs.extra_timezones.length >= 3}
            onClick={addZone}
          >
            Add time zone
          </Button>
        </fieldset>
        <fieldset disabled={locked} className="settings-planning-fields">
          <legend>Reminders and notices</legend>
          {numberFields("notices")}
          {checkbox("Send planner notices by push", notices.push, (push) =>
            update({ planner_notices: { ...notices, push } }),
          )}
          {checkbox("Send planner notices by email", notices.email, (email) =>
            update({ planner_notices: { ...notices, email } }),
          )}
          {checkbox(
            "Count past sessions as time spent when completing a task",
            draft.prefs.count_blocks_as_spent ?? false,
            (count_blocks_as_spent) => update({ count_blocks_as_spent }),
          )}
          <Field label="Session reminder">
            <SelectBox
              value={draft.reminder}
              onChange={(e) =>
                change((value) => ({ ...value, reminder: e.target.value }))
              }
            >
              <option value="off">Off</option>
              {SESSION_REMINDER_MINUTES.map((value) => (
                <option key={value} value={value}>
                  {value === 0
                    ? "As the session starts"
                    : `${value} minutes before`}
                </option>
              ))}
            </SelectBox>
          </Field>
          {(["event", "task", "all_day"] as const).map((key) => (
            <Field
              key={key}
              label={`Default ${key === "all_day" ? "all-day" : key} alerts`}
              hint="Minutes before, separated by commas. Up to five; blank means none."
            >
              <Input
                value={draft.alerts[key]}
                onChange={(e) =>
                  change((value) => ({
                    ...value,
                    alerts: { ...value.alerts, [key]: e.target.value },
                  }))
                }
              />
            </Field>
          ))}
        </fieldset>
        <fieldset disabled={locked} className="settings-planning-fields">
          <legend>Learning</legend>
          {checkbox(
            "Use learned estimates",
            draft.prefs.learn_estimates ?? true,
            (learn_estimates) => update({ learn_estimates }),
          )}
          {checkbox(
            "Use learned work rhythm",
            draft.prefs.learn_rhythm ?? true,
            (learn_rhythm) => update({ learn_rhythm }),
          )}
          {checkbox(
            "Balance work across days",
            draft.prefs.balance_load ?? true,
            (balance_load) => update({ balance_load }),
          )}
        </fieldset>
        <fieldset disabled={locked} className="settings-planning-fields">
          <legend>Digests</legend>
          {checkbox("Morning agenda email", digest.morning, (morning) =>
            update({ digest: { ...digest, morning } }),
          )}
          <Field label="Morning time">
            <Input
              type="time"
              value={digest.morning_time}
              onChange={(e) =>
                update({ digest: { ...digest, morning_time: e.target.value } })
              }
            />
          </Field>
          {checkbox("Evening review email", digest.evening, (evening) =>
            update({ digest: { ...digest, evening } }),
          )}
          <Field label="Evening time">
            <Input
              type="time"
              value={digest.evening_time}
              onChange={(e) =>
                update({ digest: { ...digest, evening_time: e.target.value } })
              }
            />
          </Field>
          {checkbox(
            "Include what my agents did",
            digest.agents !== false,
            (agents) => update({ digest: { ...digest, agents } }),
          )}
          {checkbox(
            "Push when an agent finishes a large job",
            digest.agent_push !== false,
            (agent_push) => update({ digest: { ...digest, agent_push } }),
          )}
        </fieldset>
        <div className="settings-planning-actions">
          <Button disabled={locked || !dirty} onClick={() => void discard()}>
            Discard changes
          </Button>
          <Button
            type="submit"
            variant="primary"
            busy={busy}
            disabled={confirming || uncertain || !dirty || !read.fresh}
          >
            Save planning settings
          </Button>
          {!read.fresh && !uncertain && (
            <Button
              disabled={busy || confirming}
              onClick={() => void read.reload()}
            >
              Refresh saved settings
            </Button>
          )}
        </div>
        <div className="settings-planning-preview">
          <p className="muted small">
            Email previews use saved settings and send a real email.
          </p>
          <Button
            disabled={locked || dirty || mailUnknown || !read.fresh}
            onClick={() => void preview()}
          >
            Email me a morning preview
          </Button>
          {mailUnknown && (
            <>
              <p role="status">
                Delivery is unconfirmed. Check your inbox before sending another
                preview.
              </p>
              <Button
                disabled={busy}
                onClick={() => {
                  if (owned()) setMailUnknown(false);
                }}
              >
                I've checked delivery
              </Button>
            </>
          )}
        </div>
      </form>
    </SettingsSection>
  );
}
