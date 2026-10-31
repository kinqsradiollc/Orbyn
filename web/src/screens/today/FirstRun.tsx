import {
  FIRST_RUN_PURPOSES,
  PURPOSE_LABELS,
  WORKSPACE_PRESETS,
  defaultStarter,
  startersFor,
  workspacePresets,
  type FirstRunPurpose,
  type FirstRunResult,
  type StarterId,
  type User,
  type WorkspacePresetChoice,
} from "@orbyn/core";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { messageOf } from "../../lib/resource";
import { client, getToken } from "../../lib/session";
import { Button, ErrorNotice, Field, Input } from "../../ui/kit";

/**
 * The guided start for a new account: what Orbyn is for, a calendar to show
 * alongside, and a starter. Escape must never dismiss it for good; only
 * "Not now" does, so this is a modal with no close control.
 */
export function FirstRun({
  user,
  onDone,
}: {
  user: User;
  onDone: (made: FirstRunResult | null) => void;
}) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [purpose, setPurpose] = useState<FirstRunPurpose>("study");
  const [starter, setStarter] = useState<StarterId>("term");
  const [calendarUrl, setCalendarUrl] = useState("");
  const [calendarNote, setCalendarNote] = useState("");
  const [teamName, setTeamName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [presetOn, setPresetOn] = useState(false);
  const [presetChoice, setPresetChoice] =
    useState<WorkspacePresetChoice | null>(null);
  const box = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const account = useRef(getToken()).current;
  const pending = useRef(false);
  const connected = useRef("");
  useEffect(() => {
    if (box.current && !box.current.open) box.current.showModal();
  }, []);
  useEffect(() => heading.current?.focus(), [step]);
  const current = () => getToken() === account;
  const run = async (fn: () => Promise<void>) => {
    if (pending.current || !current()) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (failure) {
      if (current())
        setError(messageOf(failure, "That didn't work. Try again."));
    } finally {
      pending.current = false;
      if (current()) setBusy(false);
    }
  };
  const skip = () =>
    run(async () => {
      await client.skipFirstRun();
      if (current()) onDone(null);
    });
  const loadPresets = () =>
    run(async () => {
      const prefs = await client.getPrefs();
      if (current()) {
        const selected = workspacePresets(prefs.views.workspace);
        setPresetChoice({ selected, expected: selected });
      }
    });
  const connect = () =>
    run(async () => {
      const url = calendarUrl.trim();
      if (url && connected.current !== url) {
        await client.createCalendarSubscription({ url, name: "My calendar" });
        if (!current()) return;
        connected.current = url;
        setCalendarNote("Calendar connected.");
      }
      if (current()) setStep(2);
    });
  const finish = () =>
    run(async () => {
      if (presetOn && !presetChoice)
        throw new Error(
          "Reload workspace choices or leave presets unchanged before finishing.",
        );
      const made = await client.finishFirstRun({
        purpose,
        starter,
        ...(presetOn && presetChoice
          ? { workspace_presets: presetChoice }
          : {}),
        ...(starter === "sprint" && teamName.trim()
          ? { team_name: teamName.trim() }
          : {}),
      });
      if (current()) onDone(made);
    });
  const moveChoice = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
      ].includes(event.key)
    )
      return;
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        'button[role="radio"]:not(:disabled)',
      ),
    ];
    const at = buttons.indexOf(event.target as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (at +
              (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) +
              buttons.length) %
            buttons.length;
    buttons[next].click();
    buttons[next].focus();
  };
  const first = user.name.split(" ")[0];
  const choice = (
    selected: boolean,
    label: string,
    blurb: string,
    pick: () => void,
    key: string,
  ) => (
    <button
      key={key}
      type="button"
      role="radio"
      disabled={busy}
      aria-checked={selected}
      tabIndex={selected ? 0 : -1}
      className="today-choice"
      onClick={pick}
    >
      <span>{label}</span>
      <small>{blurb}</small>
    </button>
  );
  const presetsLine = presetChoice?.selected
    .map((v) => (v === "engineer" ? "Engineer" : "Student"))
    .join(", ");
  return (
    <dialog
      ref={box}
      className="dialog"
      aria-labelledby="first-run-title"
      onCancel={(event) => event.preventDefault()}
    >
      <div className="dialog-body">
        <p className="muted small" aria-live="polite">
          Step {step + 1} of 3
        </p>
        {step === 0 && (
          <>
            <h2 id="first-run-title" ref={heading} tabIndex={-1}>
              Choose a starting point
            </h2>
            <p className="muted">Start with a project, or skip setup.</p>
            <div
              className="today-choices"
              role="radiogroup"
              aria-label="What Orbyn is for"
              onKeyDown={moveChoice}
            >
              {FIRST_RUN_PURPOSES.map((p) =>
                choice(
                  purpose === p,
                  PURPOSE_LABELS[p].name,
                  PURPOSE_LABELS[p].blurb,
                  () => {
                    setPurpose(p);
                    setStarter(defaultStarter(p));
                  },
                  p,
                ),
              )}
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={presetOn}
                disabled={busy}
                onChange={(event) => {
                  setPresetOn(event.target.checked);
                  if (event.target.checked && !presetChoice) void loadPresets();
                }}
              />
              Choose workspace shortcuts
            </label>
            {presetOn && (
              <>
                <p className="muted small">
                  Choose either or both. This changes shortcuts, not your
                  projects, layout or permissions.
                </p>
                {WORKSPACE_PRESETS.map((preset) => (
                  <label className="check" key={preset}>
                    <input
                      type="checkbox"
                      disabled={busy || !presetChoice}
                      checked={presetChoice?.selected.includes(preset) ?? false}
                      onChange={(event) =>
                        setPresetChoice(
                          (c) =>
                            c && {
                              ...c,
                              selected: event.target.checked
                                ? [...c.selected, preset]
                                : c.selected.filter((v) => v !== preset),
                            },
                        )
                      }
                    />
                    {preset === "engineer" ? "Engineer" : "Student"}
                  </label>
                ))}
              </>
            )}
          </>
        )}
        {step === 1 && (
          <>
            <h2 id="first-run-title" ref={heading} tabIndex={-1}>
              Add a calendar
            </h2>
            <p className="muted">
              Add a private .ics link to show its events alongside your plans.
            </p>
            <Field label="Calendar address">
              <Input
                disabled={busy}
                type="url"
                inputMode="url"
                value={calendarUrl}
                placeholder="https://…/basic.ics"
                onChange={(event) => setCalendarUrl(event.target.value)}
              />
            </Field>
          </>
        )}
        {step === 2 && (
          <>
            <h2 id="first-run-title" ref={heading} tabIndex={-1}>
              Pick a starter
            </h2>
            {calendarNote && <p className="small">{calendarNote}</p>}
            <div
              className="today-choices is-list"
              role="radiogroup"
              aria-label="Starter"
              onKeyDown={moveChoice}
            >
              {startersFor(purpose).map((s) =>
                choice(
                  starter === s.id,
                  s.name,
                  s.blurb,
                  () => setStarter(s.id),
                  s.id,
                ),
              )}
            </div>
            {starter === "sprint" && (
              <Field label="The team's name">
                <Input
                  disabled={busy}
                  value={teamName}
                  maxLength={80}
                  placeholder={`${first || "My"}'s team`}
                  onChange={(event) => setTeamName(event.target.value)}
                />
              </Field>
            )}
          </>
        )}
        {error && <ErrorNotice message={error} />}
        {presetOn && step > 0 && (
          <div className="today-said">
            <span className="muted small">
              Workspace shortcuts: {presetsLine || "None"}. Other layout choices
              stay unchanged.
            </span>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void loadPresets()}
            >
              Reload workspace choices
            </Button>
          </div>
        )}
        {presetOn && step === 0 && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void loadPresets()}
          >
            Reload workspace choices
          </Button>
        )}
        <div className="today-run-foot">
          <Button variant="ghost" disabled={busy} onClick={() => void skip()}>
            Not now
          </Button>
          <span>
            {step > 0 && (
              <Button
                disabled={busy}
                onClick={() => setStep((s) => (s - 1) as 0 | 1)}
              >
                Back
              </Button>
            )}
            {step === 0 && (
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => setStep(1)}
              >
                Next
              </Button>
            )}
            {step === 1 && (
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => void connect()}
              >
                {calendarUrl.trim() ? "Connect" : "Skip this"}
              </Button>
            )}
            {step === 2 && (
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => void finish()}
              >
                {starter === "none" ? "Start" : "Create starter"}
              </Button>
            )}
          </span>
        </div>
      </div>
    </dialog>
  );
}
