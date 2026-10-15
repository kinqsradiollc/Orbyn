import { useEffect, useRef, useState } from "react";
import { SettingsEditor } from "./SettingsEditor";
import { KeyRound, ShieldCheck } from "lucide-react";
import type { TwoFactorSetup } from "@orbyn/core";
import { client } from "../../lib/api";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { useConfirm } from "../../components/Confirm";

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
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [stage, setStage] = useState<Stage>({ step: "idle" });
  const action = useAction(report);
  const { prompt } = useConfirm();

  useEffect(() => {
    let live = true;
    setLoadError(false);
    setEnabled(null);
    client.getTwoFactor().then(
      (s) => live && setEnabled(s.enabled),
      () => live && setLoadError(true),
    );
    return () => {
      live = false;
    };
  }, [retry]);

  const begin = () => {
    if (enabled === null || loadError || enabled) return;
    void action.run(async () => {
      const data = await client.setupTwoFactor();
      if (alive.current) setStage({ step: "setup", data });
    });
  };
  const enable = (code: string) =>
    void action.run(async () => {
      const { recovery_codes } = await client.enableTwoFactor(code);
      if (!alive.current) return;
      setEnabled(true);
      setStage({ step: "codes", codes: recovery_codes });
      return "Two-step verification is on.";
    });
  const disable = async () => {
    const password = await prompt({
      title: "Turn off two-step verification?",
      body: "Your account will use password sign-in without an authenticator code.",
      label: "Password",
      type: "password",
      required: true,
      confirmLabel: "Turn off",
      destructive: true,
    });
    if (!password || !alive.current) return;
    void action.run(async () => {
      await client.disableTwoFactor(password);
      if (!alive.current) return;
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

      {loadError ? (
        <div>
          <p role="alert">Couldn’t load verification settings.</p>
          <button
            className="secondary"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry
          </button>
        </div>
      ) : enabled === null ? (
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
      ) : null}
      {stage.step !== "idle" && (
        <SettingsEditor
          title={
            stage.step === "setup"
              ? "Set up two-step verification"
              : "Recovery codes"
          }
          pending={action.pending}
          closeDisabled={stage.step === "codes"}
          onClose={() => setStage({ step: "idle" })}
        >
          {stage.step === "setup" ? (
            <form
              className="two-factor-setup"
              onSubmit={(e) => {
                e.preventDefault();
                const code = new FormData(e.currentTarget).get(
                  "code",
                ) as string;
                enable(code);
              }}
            >
              <p>Add this key to your authenticator app.</p>
              <code className="two-factor-secret">
                {stage.data.secret.replace(/(.{4})/g, "$1 ").trim()}
              </code>
              <details>
                <summary>Setup link</summary>
                <code className="two-factor-uri">{stage.data.otpauth_uri}</code>
              </details>
              <label>
                Authenticator code
                <input
                  disabled={action.pending}
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={6}
                  pattern="[0-9]{6}"
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
                  disabled={action.pending}
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
                <strong>Save your recovery codes.</strong> Each works once if
                you lose your authenticator. They won’t be shown again.
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
        </SettingsEditor>
      )}

      <OutcomeNote outcome={action.outcome} />
    </>
  );
}
