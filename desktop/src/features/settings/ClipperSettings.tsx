import { useState } from "react";
import { Copy, Plus, Scissors, Trash2 } from "lucide-react";
import { savedAgo, type ClipKey } from "@orbyn/core";
import { client } from "../../lib/api";
import { useConfirm } from "../../components/Confirm";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { useSettingsRead } from "./useSettingsRead";
import { copyText } from "../../lib/planning";
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
  const reading = useSettingsRead(() => client.listClipKeys(), report);
  const keys = reading.data;
  const [query, setQuery] = useState("");
  const visibleKeys = keys?.filter((key) =>
    key.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const [made, setMade] = useState<string | null>(null);
  const action = useAction(report);
  const busy = action.pending;
  const [copied, setCopied] = useState(false);
  const load = reading.reload;
  const make = () =>
    void action.run(async () => {
      const result = await client.createClipKey("Orbyn Clipper");
      if (!reading.current()) return;
      setMade(result.key);
      setCopied(false);
      await load();
    });
  const remove = (key: ClipKey) =>
    void action.run(async () => {
      if (
        !(await ask({
          title: "Remove Clipper key?",
          body: `${key.name}\nThe browser using it stops saving clips.`,
          confirmLabel: "Remove",
          destructive: true,
        })) ||
        !reading.current()
      )
        return;
      await client.deleteClipKey(key.id);
      await load();
      return "Clipper key removed.";
    });
  return (
    <SettingsSection className="card settings-card">
      <h2>Orbyn Clipper</h2>
      <p className="muted">
        Save browser pages with a key that cannot read your pages.
      </p>
      {made && (
        <div className="clip-key-made" role="status">
          <strong>Your new key. It's shown only once.</strong>
          <code>{made}</code>
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              void action.run(async () => {
                const ok = await copyText(made);
                if (!reading.current()) return;
                setCopied(ok);
                if (!ok)
                  throw new Error("Couldn't copy. Select the key to copy it.");
              })
            }
          >
            <Copy size={14} /> {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {reading.failed && (
        <p className="connection-recovery" role="alert">
          Couldn't load Clipper keys.{" "}
          <button
            className="text-button"
            disabled={reading.loading}
            onClick={() => void load()}
          >
            Retry keys
          </button>
        </p>
      )}
      {keys === null && !reading.failed && (
        <p className="muted">Loading keys…</p>
      )}
      {keys?.length === 0 && <p className="muted">No Clipper keys yet.</p>}
      {keys && keys.length > 0 && (
        <input
          type="search"
          aria-label="Search Clipper keys"
          placeholder="Search keys"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      {keys && keys.length > 0 && (
        <ul className="clip-keys connection-collection">
          {visibleKeys?.map((k) => (
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
                disabled={busy}
                onClick={() => void remove(k)}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {keys?.length && visibleKeys?.length === 0 ? (
        <p className="muted">No matching keys.</p>
      ) : null}
      <button className="secondary" disabled={busy} onClick={make}>
        <Plus size={14} /> {busy ? "Updating…" : "New Clipper key"}
      </button>
      <OutcomeNote outcome={action.outcome} />
    </SettingsSection>
  );
}
