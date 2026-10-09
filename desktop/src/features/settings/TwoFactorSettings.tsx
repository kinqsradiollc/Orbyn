import { useEffect, useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import type { TwoFactorSetup } from "@orbyn/core";
import { client } from "../../lib/api";
import { OutcomeNote, useAction } from "../../components/Outcome";

type Stage =
  | { step: "idle" }
  | { step: "setup"; data: TwoFactorSetup }
  | { step: "codes"; codes: string[] };

/** Two-step verification: set up with an authenticator app, or turn it off. */
export function TwoFactorSettings({
  report,
}: {
  report: (e: unknown) => void;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [stage, setStage] = useState<Stage>({ step: "idle" });
  const action = useAction(report);

  useEffect(() => {
    client.getTwoFactor().then(
      (s) => setEnabled(s.enabled),
      () => setEnabled(false),
    );
  }, []);

  const begin = () =>
    void action.run(async () => {
      setStage({ step: "setup", data: await client.setupTwoFactor() });
    });
  const enable = (code: string) =>
    void action.run(async () => {
      const { recovery_codes } = await client.enableTwoFactor(code);
      setEnabled(true);
      setStage({ step: "codes", codes: recovery_codes });
      return "Two-step verification is on.";
    });
  const disable = () => {
    const password = window.prompt(
      "Enter your password to turn off two-step verification:",
    );
    if (!password) return;
    void action.run(async () => {
      await client.disableTwoFactor(password);
      setEnabled(false);
      setStage({ step: "idle" });
      return "Two-step verification is off.";
    });
  };

  return (
    <>
      <hr />
      <h2>Two-step verification</h2>
      <p className="muted">
        Add a code from an authenticator app to password sign-in.
      </p>

      {enabled === null ? (
        <p className="muted">Loading…</p>
      ) : enabled && stage.step !== "codes" ? (
        <div className="two-factor-on">
          <span className="status-pill active">
            <ShieldCheck size={13} /> On
          </span>
          <button
            className="secondary"
            disabled={action.pending}
            onClick={disable}
          >
            Turn off
          </button>
        </div>
      ) : stage.step === "idle" ? (
        <button className="secondary" disabled={action.pending} onClick={begin}>
          <KeyRound size={14} /> Set up two-step
        </button>
      ) : stage.step === "setup" ? (
        <form
          className="two-factor-setup"
          onSubmit={(e) => {
            e.preventDefault();
            const code = new FormData(e.currentTarget).get("code") as string;
            enable(code);
          }}
        >
          <p>
            1. Add this key to your authenticator app, or paste the setup link.
          </p>
          <code className="two-factor-secret">
            {stage.data.secret.replace(/(.{4})/g, "$1 ").trim()}
          </code>
          <details>
            <summary>Setup link</summary>
            <code className="two-factor-uri">{stage.data.otpauth_uri}</code>
          </details>
          <label>
            2. Enter the 6-digit code it shows
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={10}
              required
              placeholder="123456"
            />
          </label>
          <div className="two-factor-actions">
            <button className="primary" disabled={action.pending}>
              Turn on
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setStage({ step: "idle" })}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div
          className="two-factor-codes"
          data-settings-close-guard="Save your recovery codes before leaving Settings."
        >
          <p>
            <strong>Save your recovery codes.</strong> Each works once if you
            lose your authenticator. They won’t be shown again.
          </p>
          <ul>
            {stage.codes.map((c) => (
              <li key={c} className="mono">
                {c}
              </li>
            ))}
          </ul>
          <button
            className="secondary"
            onClick={() => setStage({ step: "idle" })}
          >
            I’ve saved them
          </button>
        </div>
      )}
      <OutcomeNote outcome={action.outcome} />
    </>
  );
}
