import {
  browserSupportsWebAuthn,
  startRegistration,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
import { HttpError } from "@orbyn/core";
import { useEffect, useRef, useState } from "react";
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

type Response = Awaited<ReturnType<typeof startRegistration>>;
const unclear = (failure: unknown) =>
  !(failure instanceof HttpError) ||
  failure.statusCode >= 500 ||
  [408, 429].includes(failure.statusCode);
export function Passkeys() {
  const owner = useSettingsOwner(),
    confirm = useConfirm(),
    read = useSettingsRead(() => client.listPasskeys());
  const lock = useRef(false),
    [busy, setBusy] = useState(false),
    [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [unknown, setUnknown] = useState<
    | { kind: "register"; credential: Response; name: string }
    | { kind: "remove"; id: string }
    | null
  >(null);
  const ceremony = useRef(false);
  const ipHost =
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(location.hostname) ||
    location.hostname.includes(":");
  const supported =
    !ipHost && window.isSecureContext && browserSupportsWebAuthn();
  useSettingsExit({
    pending: busy || !!unknown,
    dirty: (open && !!name) || !!unknown,
    message: unknown
      ? "Check the saved passkey outcome before leaving Settings."
      : "Finish or cancel passkey registration.",
  });
  useEffect(
    () => () => {
      if (ceremony.current) WebAuthnAbortService.cancelCeremony();
    },
    [],
  );
  const close = async () => {
    if (!owner() || lock.current || unknown) return;
    lock.current = true;
    setBusy(true);
    try {
      if (
        name &&
        !(await confirm({
          title: "Discard this passkey draft?",
          body: "The name and any unfinished registration will be discarded.",
          action: "Discard",
          danger: true,
        }))
      )
        return;
      if (owner()) {
        setOpen(false);
        setName("");
        setError("");
      }
    } finally {
      lock.current = false;
      if (owner()) setBusy(false);
    }
  };
  const add = async () => {
    if (!owner() || lock.current || unknown || !read.fresh || !supported)
      return;
    if (name.trim().length > 60) {
      setError("Use a passkey name of 60 characters or fewer.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    let response: Response | null = null,
      submitted = false;
    const label = name.trim() || "Passkey";
    try {
      const options = await client.passkeyRegisterOptions();
      if (!owner()) return;
      if (
        !options ||
        typeof options !== "object" ||
        !("challenge" in options) ||
        typeof options.challenge !== "string" ||
        !("rp" in options) ||
        !("user" in options) ||
        !("pubKeyCredParams" in options) ||
        !Array.isArray(options.pubKeyCredParams)
      )
        throw Error("The server didn't return valid passkey options.");
      // The endpoint returns unknown; validate the required envelope before the
      // installed WebAuthn adapter validates/converts the full browser options.
      const optionsJSON = options as Parameters<
        typeof startRegistration
      >[0]["optionsJSON"];
      ceremony.current = true;
      response = await startRegistration({ optionsJSON });
      ceremony.current = false;
      if (!owner()) return;
      submitted = true;
      const receipt = await client.registerPasskey(response, label);
      if (!owner()) return;
      if (receipt.ok !== true)
        throw Error("The passkey registration receipt wasn't confirmed.");
      read.invalidate();
      await read.reload();
      if (owner()) {
        setOpen(false);
        setName("");
        setNotice("Passkey registered. Check its name in the saved list.");
      }
    } catch (failure) {
      if (owner()) {
        if (submitted && response && unclear(failure)) {
          setUnknown({ kind: "register", credential: response, name: label });
          read.invalidate();
          setError(
            "Registration status is unknown. Check for this exact credential before adding another passkey.",
          );
        } else
          setError(
            !submitted &&
              failure instanceof Error &&
              ["NotAllowedError", "AbortError"].includes(failure.name)
              ? "Passkey creation was cancelled. No registration was sent."
              : messageOf(
                  failure,
                  "Couldn't add this passkey. Your name is kept.",
                ),
          );
      }
    } finally {
      ceremony.current = false;
      lock.current = false;
      if (owner()) setBusy(false);
    }
  };
  const remove = async (id: string) => {
    if (!owner() || lock.current || unknown || !read.fresh) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const row = read.data?.find((value) => value.id === id);
      if (!row) return;
      if (
        !(await confirm({
          title: "Remove this passkey?",
          body: `${row.name || "This passkey"} will no longer sign in. Your password and other passkeys stay.`,
          action: "Remove passkey",
          danger: true,
        }))
      )
        return;
      if (!owner()) return;
      await client.deletePasskey(id);
      if (!owner()) return;
      read.invalidate();
      await read.reload();
      if (owner()) setNotice("Passkey removed.");
    } catch (failure) {
      if (owner()) {
        if (unclear(failure)) {
          setUnknown({ kind: "remove", id });
          read.invalidate();
        }
        setError(
          messageOf(
            failure,
            "Couldn't confirm passkey removal. Refresh its saved state.",
          ),
        );
      }
    } finally {
      lock.current = false;
      if (owner()) setBusy(false);
    }
  };
  const check = async () => {
    if (!owner() || lock.current || !unknown) return;
    const pending = unknown;
    lock.current = true;
    setBusy(true);
    try {
      const rows = await client.listPasskeys();
      if (!owner()) return;
      read.commit(rows);
      const matches =
        pending.kind === "register"
          ? rows.some(
              (row) =>
                row.id === pending.credential.id && row.name === pending.name,
            )
          : !rows.some((row) => row.id === pending.id);
      if (matches) {
        setUnknown(null);
        setError("");
        setOpen(false);
        setName("");
        setNotice(
          pending.kind === "register"
            ? "The exact passkey is confirmed in the saved list."
            : "The saved list confirms this passkey was removed.",
        );
      } else
        setError(
          "The saved list doesn't confirm the earlier request. It hasn't been sent again. Keep this view and check again before making another change.",
        );
    } catch (failure) {
      if (owner())
        setError(messageOf(failure, "Couldn't check the saved passkeys."));
    } finally {
      lock.current = false;
      if (owner()) setBusy(false);
    }
  };
  return (
    <SettingsSection
      title="Passkeys"
      description="Use your device or a security key to sign in. Your password still works."
    >
      {read.error && (
        <ErrorNotice message={read.error} onRetry={() => void read.reload()} />
      )}
      {!read.data && read.loading && <p role="status">Loading passkeys…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && !open && <ErrorNotice message={error} />}
      {read.data?.length === 0 && <p>No passkeys yet.</p>}
      <ul className="settings-account-list">
        {read.data?.map((key) => (
          <li key={key.id}>
            <div>
              <strong dir="auto">{key.name || "Passkey"}</strong>
              <p className="small muted">
                Added {new Date(key.created_at).toLocaleDateString()} ·{" "}
                {key.last_used_at
                  ? `Last used ${new Date(key.last_used_at).toLocaleDateString()}`
                  : "Not used yet"}
              </p>
            </div>
            <Button
              variant="ghost"
              disabled={busy || !read.fresh || !!unknown}
              onClick={() => void remove(key.id)}
            >
              Remove {key.name || "passkey"}
            </Button>
          </li>
        ))}
      </ul>
      {!supported && (
        <p className="muted">
          {ipHost
            ? "Open Orbyn using a domain name such as localhost to add a passkey."
            : "Passkey registration needs a supported browser and a secure connection."}{" "}
          Existing passkeys can still be managed here.
        </p>
      )}
      <div className="settings-account-actions">
        <Button
          disabled={busy || !read.fresh || !!unknown || !supported}
          onClick={() => {
            if (owner()) {
              setError("");
              setOpen(true);
            }
          }}
        >
          Add passkey
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => void read.reload()}
        >
          Refresh passkeys
        </Button>
        {unknown && (
          <Button disabled={busy} onClick={() => void check()}>
            Check saved passkey
          </Button>
        )}
      </div>
      {open && (
        <Dialog
          title="Add passkey"
          onClose={() => void close()}
          actions={
            <Button disabled={busy || !!unknown} onClick={() => void close()}>
              Cancel
            </Button>
          }
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void add();
            }}
          >
            <Field label="Passkey name">
              <Input
                autoFocus
                maxLength={60}
                value={name}
                disabled={busy || !!unknown}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              busy={busy}
              disabled={!!unknown || !supported}
            >
              Create passkey
            </Button>
          </form>
          {error && <ErrorNotice message={error} />}
          {unknown && (
            <Button disabled={busy} onClick={() => void check()}>
              Check saved passkey
            </Button>
          )}
        </Dialog>
      )}
    </SettingsSection>
  );
}
