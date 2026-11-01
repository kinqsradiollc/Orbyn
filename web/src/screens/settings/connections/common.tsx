import { HttpError } from "@orbyn/core";
import { useRef, useState, type ReactNode } from "react";
import { messageOf } from "../../../lib/resource";
import { Button, ErrorNotice, Loading, useConfirm } from "../../../ui/kit";
import { useSettingsExit, useSettingsOwner } from "../shared";

/** Mutations have one synchronous owner, including the confirmation interval. */
export function useConnectionAction() {
  const owned = useSettingsOwner(),
    confirm = useConfirm();
  const lock = useRef(false),
    unconfirmed = useRef(false);
  const [pending, setPending] = useState(false),
    [unknown, setUnknown] = useState(false),
    [error, setError] = useState("");
  useSettingsExit({
    pending: pending || unknown,
    message: unknown
      ? "Check the unconfirmed connection change before leaving."
      : "Wait for the connection change to finish.",
  });
  async function run<T>(
    work: () => Promise<T>,
    accept: (value: T) => void,
    question?: Parameters<typeof confirm>[0],
  ) {
    if (lock.current || unconfirmed.current || !owned()) return;
    lock.current = true;
    setPending(true);
    setError("");
    let dispatched = false;
    try {
      if (question && !(await confirm(question))) return;
      if (!owned()) return;
      dispatched = true;
      const value = await work();
      if (owned()) accept(value);
    } catch (failure) {
      if (!owned()) return;
      const uncertain =
        dispatched &&
        !(
          failure instanceof HttpError &&
          failure.statusCode >= 400 &&
          failure.statusCode < 500 &&
          ![408, 425, 429].includes(failure.statusCode)
        );
      unconfirmed.current = uncertain;
      setUnknown(uncertain);
      setError(
        messageOf(
          failure,
          uncertain
            ? "The receipt was lost. This action will not be repeated."
            : "Could not save this change. Your draft is kept.",
        ),
      );
    } finally {
      lock.current = false;
      if (owned()) setPending(false);
    }
  }
  async function reconcile(proof: () => Promise<boolean>) {
    if (lock.current || !owned()) return;
    lock.current = true;
    setPending(true);
    try {
      const matched = await proof();
      if (owned()) {
        if (matched) {
          unconfirmed.current = false;
          setUnknown(false);
          setError("");
        } else
          setError(
            "The saved state does not confirm this attempt. It remains blocked to avoid repeating it.",
          );
      }
    } catch (failure) {
      if (owned()) setError(messageOf(failure, "Could not check saved state."));
    } finally {
      lock.current = false;
      if (owned()) setPending(false);
    }
  }
  return {
    run,
    reconcile,
    pending,
    unknown,
    error,
    owned,
    blocked: pending || unknown,
  };
}
export function ActionError({
  action,
  check,
}: {
  action: ReturnType<typeof useConnectionAction>;
  check?: () => Promise<boolean>;
}) {
  return (
    <>
      {action.error && <ErrorNotice message={action.error} />}
      {action.unknown && (
        <p className="small">
          Receipt unconfirmed. No automatic retry.
          {check && (
            <Button
              disabled={action.pending}
              onClick={() => void action.reconcile(check)}
            >
              Check saved state
            </Button>
          )}
        </p>
      )}
    </>
  );
}
export function Secret({
  value,
  label = "New key",
  onDone,
}: {
  value: string;
  label?: string;
  onDone: () => void;
}) {
  const owned = useSettingsOwner(),
    lock = useRef(false);
  const [copied, setCopied] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useSettingsExit({
    sensitive: true,
    pending: busy,
    message: "Save the one-time credential and acknowledge it before leaving.",
  });
  async function copy() {
    if (lock.current || !owned()) return;
    lock.current = true;
    setBusy(true);
    try {
      await navigator.clipboard.writeText(value);
      if (owned()) {
        setCopied(true);
        setError("");
      }
    } catch {
      if (owned())
        setError("Could not copy. Select the credential and copy it manually.");
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  }
  return (
    <div className="settings-secret">
      <strong>{label} · shown once</strong>
      <pre tabIndex={0}>{value}</pre>
      <Button disabled={busy} onClick={() => void copy()}>
        {copied ? "Copied" : "Copy"}
      </Button>
      {error && <ErrorNotice message={error} />}
      <Button
        disabled={busy}
        onClick={() => {
          if (!lock.current && owned()) onDone();
        }}
      >
        I saved it
      </Button>
    </div>
  );
}
/** These receipts have no reread endpoint for their plaintext credential. */
export function checkedSecret(
  value: unknown,
  prefix: "ok_" | "ocl_" | "oak_" | "whsec_",
): string {
  if (
    typeof value !== "string" ||
    !value.startsWith(prefix) ||
    value.length < prefix.length + 16 ||
    value.length > 512 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  )
    throw Error(
      "The one-time credential receipt is incomplete. The attempt remains unconfirmed and will not be repeated.",
    );
  return value;
}
export function receiptId(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
export function ReadState({
  loading,
  error,
  reload,
  children,
}: {
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
  children: ReactNode;
}) {
  return (
    <>
      {loading && <Loading label="Loading connection settings" />}
      {error && <ErrorNotice message={error} onRetry={() => void reload()} />}
      {children}
    </>
  );
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Open on demand, then retain drafts and their registered exit guards. */
export function RetainedDetails({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <details
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      <summary>{title}</summary>
      {opened && children}
    </details>
  );
}

export function CopyText({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  const owned = useSettingsOwner(),
    [copied, setCopied] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <Button
        onClick={() =>
          void Promise.resolve()
            .then(() => navigator.clipboard.writeText(value))
            .then(
              () => {
                if (owned()) {
                  setCopied(true);
                  setError("");
                }
              },
              () => {
                if (owned())
                  setError(
                    "Could not copy. Select the text and copy it manually.",
                  );
              },
            )
        }
      >
        {copied ? "Copied" : label}
      </Button>
      {error && (
        <p role="alert" className="small">
          {error}
        </p>
      )}
    </>
  );
}
