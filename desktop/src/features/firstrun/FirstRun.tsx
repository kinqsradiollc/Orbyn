import { useEffect, useRef, useState } from "react";
import { BookOpen, CalendarPlus, Sprout, User, Users } from "lucide-react";
import {
  defaultStarter,
  FIRST_RUN_PURPOSES,
  PURPOSE_LABELS,
  startersFor,
  type FirstRunPurpose,
  type FirstRunResult,
  type StarterId,
  type User as Person,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { errorText } from "../../lib/errors";
import "./firstrun.css";

const PURPOSE_ICONS = { study: BookOpen, team: Users, personal: User } as const;

/**
 * The guided first run (DSN-02), for a new account: what Orbyn is for
 * (Study, Team or Personal), a calendar to show alongside if you like, and a
 * starter. The starter is a small project with a brief page that links to
 * its other pages, so links and "Linked here" are there from the first day.
 * "Not now" skips it for good.
 */
export function FirstRun({
  user,
  onDone,
}: {
  user: Person;
  /** Finished or skipped; the result opens the brief when there is one. */
  onDone: (user: Person, made: FirstRunResult | null) => void;
}) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [purpose, setPurpose] = useState<FirstRunPurpose>("study");
  const [starter, setStarter] = useState<StarterId>("term");
  const [calendarUrl, setCalendarUrl] = useState("");
  const [calendarNote, setCalendarNote] = useState("");
  const [teamName, setTeamName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const skip = async () => {
    setBusy(true);
    try {
      onDone(await client.skipFirstRun(), null);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  const connect = async () => {
    const url = calendarUrl.trim();
    if (!url) return setStep(2);
    setBusy(true);
    setError("");
    try {
      await client.createCalendarSubscription({ url, name: "My calendar" });
      setCalendarNote("Connected. Its events show on your calendar.");
      setStep(2);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const finish = async () => {
    setBusy(true);
    setError("");
    try {
      const made = await client.finishFirstRun({
        purpose,
        starter,
        ...(starter === "sprint" && teamName.trim()
          ? { team_name: teamName.trim() }
          : {}),
      });
      onDone(made.user, made);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const first = user.name.split(" ")[0];
  return (
    <div className="modal-backdrop first-run-backdrop">
      <section
        className="modal first-run scale-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-run-title"
      >
        <p className="first-run-step" aria-live="polite">
          Step {step + 1} of 3
        </p>
        {step === 0 && (
          <>
            <h2 id="first-run-title" ref={heading} tabIndex={-1}>
              Welcome{first ? `, ${first}` : ""}. What's Orbyn for?
            </h2>
            <p className="muted">
              Orbyn sets up a first project to match. Everything stays open to
              you, whichever you pick.
            </p>
            <div
              className="first-run-choices"
              role="radiogroup"
              aria-label="What Orbyn is for"
            >
              {FIRST_RUN_PURPOSES.map((p) => {
                const Icon = PURPOSE_ICONS[p];
                return (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={purpose === p}
                    className={
                      "first-run-choice" + (purpose === p ? " is-on" : "")
                    }
                    onClick={() => {
                      setPurpose(p);
                      setStarter(defaultStarter(p));
                    }}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <strong>{PURPOSE_LABELS[p].name}</strong>
                    <small>{PURPOSE_LABELS[p].blurb}</small>
                  </button>
                );
              })}
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <h2 id="first-run-title" ref={heading} tabIndex={-1}>
              Connect a calendar (optional)
            </h2>
            <p className="muted">
              Paste a private .ics calendar link. Its events appear beside your
              plans. Add more later in Settings.
            </p>
            <label className="first-run-field">
              Calendar address
              <input
                type="url"
                inputMode="url"
                value={calendarUrl}
                placeholder="https://…/basic.ics"
                onChange={(e) => setCalendarUrl(e.target.value)}
              />
            </label>
          </>
        )}
        {step === 2 && (
          <>
            <h2 id="first-run-title" ref={heading} tabIndex={-1}>
              Pick a starter
            </h2>
            {calendarNote && <p className="first-run-ok">{calendarNote}</p>}
            <div
              className="first-run-choices is-list"
              role="radiogroup"
              aria-label="Starter"
            >
              {startersFor(purpose).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={starter === s.id}
                  className={
                    "first-run-choice" + (starter === s.id ? " is-on" : "")
                  }
                  onClick={() => setStarter(s.id)}
                >
                  <Sprout size={16} aria-hidden="true" />
                  <strong>{s.name}</strong>
                  <small>{s.blurb}</small>
                </button>
              ))}
            </div>
            {starter === "sprint" && (
              <label className="first-run-field">
                The team's name
                <input
                  value={teamName}
                  maxLength={80}
                  placeholder={`${first || "My"}'s team`}
                  onChange={(e) => setTeamName(e.target.value)}
                />
              </label>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="first-run-error">
            {error}
          </p>
        )}
        <div className="first-run-foot">
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void skip()}
          >
            Not now
          </button>
          <span className="first-run-nav">
            {step > 0 && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setStep((s) => (s - 1) as 0 | 1)}
              >
                Back
              </button>
            )}
            {step === 0 && (
              <button className="primary" onClick={() => setStep(1)}>
                Next
              </button>
            )}
            {step === 1 && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => void connect()}
              >
                <CalendarPlus size={15} />{" "}
                {calendarUrl.trim() ? "Connect" : "Skip this"}
              </button>
            )}
            {step === 2 && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => void finish()}
              >
                {starter === "none" ? "Start" : "Make it"}
              </button>
            )}
          </span>
        </div>
      </section>
    </div>
  );
}
