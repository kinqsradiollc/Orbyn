import { useEffect, useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { startRegistration } from "@simplewebauthn/browser";
import type { Passkey } from "@orbyn/core";
import { client } from "../../lib/api";
import { OutcomeNote, useAction } from "../../components/Outcome";

const ago = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString() : "never used";

/** Passkeys: add a device credential, list them, remove one. */
export function PasskeysSettings({ report }: { report: (e: unknown) => void }) {
  const [keys, setKeys] = useState<Passkey[] | null>(null);
  const action = useAction(report);

  const load = () => client.listPasskeys().then(setKeys, () => setKeys([]));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = () =>
    void action.run(async () => {
      const options = await client.passkeyRegisterOptions();
      // The browser prompts for the device/biometric here.
      const response = await startRegistration({
        optionsJSON: options as Parameters<
          typeof startRegistration
        >[0]["optionsJSON"],
      });
      const name =
        window.prompt("Name this passkey (e.g. “MacBook”, “iPhone”):", "") ||
        "";
      await client.registerPasskey(response, name);
      await load();
      return "Passkey added.";
    });

  const remove = (k: Passkey) =>
    void action.run(async () => {
      await client.deletePasskey(k.id);
      await load();
      return "Passkey removed.";
    });

  return (
    <>
      <hr />
      <h2>Passkeys</h2>
      <p className="muted">
        Sign in with your device — Touch ID, Windows Hello, a phone or a
        security key — instead of your password. Your password still works.
      </p>
      {keys === null ? (
        <p className="muted">Loading…</p>
      ) : keys.length === 0 ? (
        <p className="muted">No passkeys yet.</p>
      ) : (
        <ul className="settings-list">
          {keys.map((k) => (
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
                disabled={action.pending}
                onClick={() => remove(k)}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="secondary" disabled={action.pending} onClick={add}>
        <KeyRound size={14} /> Add a passkey
      </button>
      <OutcomeNote outcome={action.outcome} />
    </>
  );
}
