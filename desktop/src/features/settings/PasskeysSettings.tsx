import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { startRegistration } from "@simplewebauthn/browser";
import type { Passkey } from "@orbyn/core";
import { client } from "../../lib/api";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { useConfirm } from "../../components/Confirm";

const ago = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString() : "never used";

/** Passkeys: add a device credential, list them, remove one. */
export function PasskeysSettings({ report }: { report: (e: unknown) => void }) {
  const [keys, setKeys] = useState<Passkey[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const mounted = useRef(false);
  const request = useRef(0);
  const action = useAction(report);
  const { prompt } = useConfirm();

  const load = useCallback(async () => {
    const epoch = ++request.current;
    setLoading(true);
    try {
      const value = await client.listPasskeys();
      if (mounted.current && epoch === request.current) {
        setKeys(value);
        setFailed(false);
      }
    } catch {
      if (mounted.current && epoch === request.current) setFailed(true);
    } finally {
      if (mounted.current && epoch === request.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, [load]);

  const add = () =>
    void action.run(async () => {
      const options = await client.passkeyRegisterOptions();
      if (!mounted.current) return;
      // The browser prompts for the device/biometric here.
      const response = await startRegistration({
        optionsJSON: options as Parameters<
          typeof startRegistration
        >[0]["optionsJSON"],
      });
      if (!mounted.current) return;
      const name = await prompt({
        title: "Name your passkey",
        label: "Device name",
        confirmLabel: "Save passkey",
      });
      if (name === null || !mounted.current) return;
      await client.registerPasskey(response, name);
      if (mounted.current) await load();
      return "Passkey added.";
    });

  const remove = (k: Passkey) =>
    void action.run(async () => {
      await client.deletePasskey(k.id);
      if (mounted.current) await load();
      return "Passkey removed.";
    });

  return (
    <>
      <hr />
      <h2>Passkeys</h2>
      <p className="muted">
        Sign in with your device or security key. Your password still works.
      </p>
      {failed && (
        <div>
          <p className="error" role="alert">
            Couldn't refresh passkeys.
          </p>
          <button
            type="button"
            className="secondary"
            disabled={loading || action.pending}
            onClick={() => void load()}
          >
            Retry
          </button>
        </div>
      )}
      {keys === null && !failed ? (
        <p className="muted" role="status">
          Loading…
        </p>
      ) : keys?.length === 0 ? (
        <p className="muted">No passkeys yet.</p>
      ) : (
        <ul className="settings-list">
          {keys?.map((k) => (
            <li key={k.id}>
              <KeyRound size={16} aria-hidden="true" />
              <span className="settings-list-main">
                <strong>{k.name || "Passkey"}</strong>
                <small>
                  Added {new Date(k.created_at).toLocaleDateString()} · last
                  used {ago(k.last_used_at)}
                </small>
              </span>
              <button
                className="icon-button"
                aria-label={`Remove ${k.name || "passkey"}`}
                disabled={action.pending || loading || failed}
                onClick={() => remove(k)}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        className="secondary"
        disabled={action.pending || loading || failed}
        onClick={add}
      >
        <KeyRound size={14} /> Add a passkey
      </button>
      <OutcomeNote outcome={action.outcome} />
    </>
  );
}
