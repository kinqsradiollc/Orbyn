import { HttpError, type TwoFactorSetup } from "@orbyn/core";
import { useRef, useState } from "react";
import { client } from "../../../lib/session";
import { messageOf } from "../../../lib/resource";
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  useConfirm,
} from "../../../ui/kit";
import {
  SettingsSection,
  useSettingsExit,
  useSettingsOwner,
  useSettingsRead,
} from "../shared";

type Stage =
  | { kind: "idle" }
  | { kind: "setup"; value: TwoFactorSetup }
  | { kind: "codes"; codes: string[] }
  | { kind: "disable" }
  | { kind: "unknown"; operation: "setup" | "enable" | "disable" };
const unclear = (failure: unknown) =>
  !(failure instanceof HttpError) ||
  failure.statusCode >= 500 ||
  [408, 429].includes(failure.statusCode);
export function TwoStep() {
  const confirm = useConfirm();
  const owner = useSettingsOwner(),
    read = useSettingsRead(() => client.getTwoFactor());
  const lock = useRef(false),
    [busy, setBusy] = useState(false),
    [stage, setStage] = useState<Stage>({ kind: "idle" }),
    [code, setCode] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [copyError, setCopyError] = useState(""),
    [copied, setCopied] = useState(false);
  useSettingsExit({
    pending: busy || stage.kind === "unknown",
    sensitive: stage.kind === "codes",
    dirty: stage.kind === "setup" || (stage.kind === "disable" && !!password),
    message:
      stage.kind === "codes"
        ? "Save and acknowledge your recovery codes before leaving Settings."
        : "Finish or cancel your two-step verification changes.",
  });
  const close = async () => {
    if (!owner() || lock.current) return;
    if (stage.kind === "unknown") {
      setError(
        "Check the saved verification outcome before closing. The earlier request has not been sent again.",
      );
      return;
    }
    if (stage.kind === "codes") {
      setCopyError(
        "Save your codes, then choose ‘I've saved my recovery codes’ before closing.",
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      if (
        (stage.kind === "setup" || !!password) &&
        !(await confirm({
          title: "Close verification changes?",
          body: "Any unsaved authenticator code or password will be discarded.",
          action: "Close changes",
        }))
      )
        return;
      if (owner()) {
        setStage({ kind: "idle" });
        setCode("");
        setPassword("");
        setError("");
      }
    } finally {
      lock.current = false;
      if (owner()) setBusy(false);
    }
  };
  const begin = async () => {
    if (!owner() || lock.current || !read.fresh || read.data?.enabled) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await client.setupTwoFactor();
      if (!owner()) return;
      if (!value.secret || !value.otpauth_uri)
        throw Error("The authenticator setup key wasn't received.");
      setStage({ kind: "setup", value });
      setCode("");
    } catch (failure) {
      if (owner()) {
        if (unclear(failure)) setStage({ kind: "unknown", operation: "setup" });
        setError(messageOf(failure, "Couldn't start two-step setup."));
      }
    } finally {
      lock.current = false;
      if (owner()) setBusy(false);
    }
  };
  const enable = async () => {
    if (
      !owner() ||
      lock.current ||
      stage.kind !== "setup" ||
      !/^\d{6}$/.test(code)
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await client.enableTwoFactor(code);
      if (!owner()) return;
      if (
        !Array.isArray(value.recovery_codes) ||
        !value.recovery_codes.length ||
        value.recovery_codes.some((c) => typeof c !== "string" || !c)
      )
        throw Error(
          "Recovery codes weren't received. Check the saved verification status.",
        );
      read.commit({ enabled: true });
      setStage({ kind: "codes", codes: value.recovery_codes });
      setCode("");
      setCopied(false);
    } catch (failure) {
      if (owner()) {
        if (unclear(failure)) {
          read.invalidate();
          setStage({ kind: "unknown", operation: "enable" });
        }
        setError(
          messageOf(
            failure,
            "Couldn't enable two-step verification. Your setup stays open.",
          ),
        );
      }
    } finally {
      lock.current = false;
      if (owner()) setBusy(false);
    }
  };
  const disable = async () => {
    if (!owner() || lock.current || stage.kind !== "disable" || !password)
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await client.disableTwoFactor(password);
      if (!owner()) return;
      read.commit({ enabled: false });
      setPassword("");
      setStage({ kind: "idle" });
    } catch (failure) {
      if (owner()) {
        if (unclear(failure)) {
          read.invalidate();
          setStage({ kind: "unknown", operation: "disable" });
          setPassword("");
        }
        setError(
          messageOf(failure, "Couldn't turn off two-step verification."),
        );
      }
    } finally {
      lock.current = false;
      if (owner()) setBusy(false);
    }
  };
  const check = async () => {
    if (!owner() || lock.current || stage.kind !== "unknown") return;
    const operation = stage.operation;
    lock.current = true;
    setBusy(true);
    try {
      const current = await client.getTwoFactor();
      if (!owner()) return;
      read.commit(current);
      if (operation === "enable" && current.enabled) {
        setStage({ kind: "idle" });
        setError(
          "Two-step verification is on, but its recovery codes weren't received. They can't be read again. Your authenticator still works; turn two-step off and set it up again if you need new recovery codes.",
        );
      } else if (operation === "disable" && !current.enabled) {
        setStage({ kind: "idle" });
        setError("");
      } else
        setError(
          "The saved status doesn't confirm the earlier request. It has not been sent again. Keep this view and check again before making another change.",
        );
    } catch (failure) {
      if (owner())
        setError(messageOf(failure, "Couldn't check verification status."));
    } finally {
      lock.current = false;
      if (owner()) setBusy(false);
    }
  };
  const copy = async (text: string) => {
    if (!owner() || lock.current) return;
    lock.current = true;
    setBusy(true);
    setCopyError("");
    try {
      await navigator.clipboard.writeText(text);
      if (owner()) setCopied(true);
    } catch {
      if (owner())
        setCopyError(
          "Couldn't copy. Select the codes and save them manually before acknowledging.",
        );
    } finally {
      lock.current = false;
      if (owner()) setBusy(false);
    }
  };
  const open = stage.kind !== "idle";
  return (
    <SettingsSection
      title="Two-step verification"
      description="Add an authenticator code to password sign-in."
    >
      {read.error && (
        <ErrorNotice message={read.error} onRetry={() => void read.reload()} />
      )}
      {!read.data && !read.error && (
        <p role="status">Loading verification status…</p>
      )}
      {read.data && (
        <div className="settings-account-row">
          <span>{read.data.enabled ? "On" : "Off"}</span>
          <Button
            disabled={busy || !read.fresh || open}
            onClick={() => {
              if (!owner()) return;
              if (read.data?.enabled) {
                setError("");
                setStage({ kind: "disable" });
              } else void begin();
            }}
          >
            {read.data.enabled ? "Turn off" : "Set up two-step"}
          </Button>
        </div>
      )}
      <Button
        variant="ghost"
        disabled={busy || stage.kind === "codes"}
        onClick={() => void read.reload()}
      >
        Refresh verification status
      </Button>
      {error && !open && <ErrorNotice message={error} />}
      {open && (
        <Dialog
          title={
            stage.kind === "codes"
              ? "Recovery codes"
              : stage.kind === "disable"
                ? "Turn off two-step verification"
                : stage.kind === "unknown"
                  ? "Check verification status"
                  : "Set up two-step verification"
          }
          onClose={() => void close()}
          actions={
            stage.kind === "codes" ? (
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => {
                  if (owner() && !lock.current) {
                    setStage({ kind: "idle" });
                    setCopyError("");
                  }
                }}
              >
                I've saved my recovery codes
              </Button>
            ) : (
              <Button
                disabled={busy || stage.kind === "unknown"}
                onClick={() => void close()}
              >
                Cancel
              </Button>
            )
          }
        >
          {error && <ErrorNotice message={error} />}
          {stage.kind === "setup" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void enable();
              }}
            >
              <p>Add this key to your authenticator app.</p>
              <code className="settings-account-secret" dir="ltr">
                {stage.value.secret}
              </code>
              <details>
                <summary>Authenticator setup link</summary>
                <code className="settings-account-secret">
                  {stage.value.otpauth_uri}
                </code>
              </details>
              <Field label="Authenticator code">
                <Input
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  pattern="[0-9]{6}"
                  maxLength={6}
                  disabled={busy}
                  onChange={(event) => setCode(event.target.value)}
                />
              </Field>
              <Button
                type="submit"
                variant="primary"
                busy={busy}
                disabled={!/^\d{6}$/.test(code)}
              >
                Turn on
              </Button>
            </form>
          )}
          {stage.kind === "codes" && (
            <div>
              <p>
                Save these recovery codes somewhere safe. Each works once, and
                they won't be shown again.
              </p>
              <ul className="settings-account-codes">
                {stage.codes.map((value) => (
                  <li key={value}>
                    <code>{value}</code>
                  </li>
                ))}
              </ul>
              <Button onClick={() => void copy(stage.codes.join("\n"))}>
                {copied ? "Copied" : "Copy recovery codes"}
              </Button>
              {copyError && <ErrorNotice message={copyError} />}
            </div>
          )}
          {stage.kind === "disable" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void disable();
              }}
            >
              <p>
                Password sign-in will no longer require an authenticator code.
              </p>
              <Field label="Password">
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  disabled={busy}
                  autoFocus
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <Button
                type="submit"
                variant="danger"
                busy={busy}
                disabled={!password}
              >
                Turn off two-step
              </Button>
            </form>
          )}
          {stage.kind === "unknown" && (
            <>
              <p>
                The earlier request has an unknown outcome. It will not be sent
                again automatically.
              </p>
              <Button disabled={busy} onClick={() => void check()}>
                Check saved verification status
              </Button>
            </>
          )}
        </Dialog>
      )}
    </SettingsSection>
  );
}
