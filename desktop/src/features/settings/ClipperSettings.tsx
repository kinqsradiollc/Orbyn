import { useEffect, useState } from "react";
import { Copy, Plus, Scissors, Trash2 } from "lucide-react";
import { savedAgo, type ClipKey } from "@orbyn/core";
import { client } from "../../lib/api";
import { useConfirm } from "../../components/Confirm";
import { SettingsSection } from "./SettingsSection";

/**
 * The Orbyn Clipper (CAP-02): the browser extension that saves articles,
 * papers, assignments and highlights into Orbyn. It signs in with a
 * Clipper key made here, which can only save clips and list where they can
 * go (folders, projects, teams and the titles of pages with a Cards
 * heading): it can't open what's in your pages, see your tasks or change
 * your account. A key is shown once.
 */
export function ClipperSettings({ report }: { report: (e: unknown) => void }) {
  const { ask } = useConfirm();
  const [keys, setKeys] = useState<ClipKey[] | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const load = () => client.listClipKeys().then(setKeys, report);
  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const make = () => {
    setBusy(true);
    client
      .createClipKey("Orbyn Clipper")
      .then((r) => {
        setMade(r.key);
        setCopied(false);
        void load();
      })
      .catch(report)
      .finally(() => setBusy(false));
  };
  const remove = async (k: ClipKey) => {
    if (
      !(await ask({
        title: "Remove this Clipper key?",
        body: "The browser using it stops saving clips until you connect it again.",
        confirmLabel: "Remove",
        destructive: true,
      }))
    )
      return;
    client.deleteClipKey(k.id).then(() => void load(), report);
  };
  return (
    <SettingsSection className="card settings-card">
      <h2>Orbyn Clipper</h2>
      <p className="muted">
        Save pages from your browser. A Clipper key cannot read your pages.
      </p>
      {made && (
        <div className="clip-key-made" role="status">
          <strong>Your new key. It's shown only once.</strong>
          <code>{made}</code>
          <button
            className="text-button"
            onClick={() =>
              void navigator.clipboard.writeText(made).then(
                () => setCopied(true),
                () => setCopied(false),
              )
            }
          >
            <Copy size={14} /> {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {keys && keys.length > 0 && (
        <ul className="clip-keys">
          {keys.map((k) => (
            <li key={k.id}>
              <Scissors size={14} aria-hidden="true" />
              <span>
                {k.name} ····{k.hint}
                <small>
                  {k.last_used_at
                    ? `Used ${savedAgo(k.last_used_at)}`
                    : "Not used yet"}
                </small>
              </span>
              <button
                className="icon-button"
                aria-label={`Remove ${k.name} ····${k.hint}`}
                title="Remove"
                onClick={() => void remove(k)}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="secondary" disabled={busy} onClick={make}>
        <Plus size={14} /> New Clipper key
      </button>
    </SettingsSection>
  );
}
