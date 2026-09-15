import { useState, type KeyboardEvent } from "react";
import { Plus, X } from "lucide-react";
import "./event-fields.css";

/** A web link on an item, as edited. */
export type LinkDraft = { url: string; title: string };

const MAX_LINKS = 20;
const LINK_RE = /^https?:\/\/\S+$/i;

/** Enter in the add row adds instead of submitting the editor. */
const onEnter = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
    e.preventDefault();
    fn();
  }
};

/** Up to 20 web links (an address and an optional title), in order. */
export function LinksField({
  value,
  onChange,
  state,
}: {
  value: LinkDraft[];
  onChange: (next: LinkDraft[]) => void;
  /** Saved links load with the item; they can't be changed until then. */
  state: "loading" | "ready" | "failed";
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");

  const add = () => {
    const address = url.trim();
    if (!LINK_RE.test(address))
      return setError("Links start with http:// or https://.");
    if (value.length >= MAX_LINKS) return setError("Up to 20 links.");
    onChange([...value, { url: address, title: title.trim() }]);
    setUrl("");
    setTitle("");
    setError("");
  };

  return (
    <fieldset className="event-field" disabled={state !== "ready"}>
      <legend>Links</legend>
      {state === "loading" ? (
        <p className="field-hint">Loading links…</p>
      ) : state === "failed" ? (
        <p className="field-hint">
          Couldn&apos;t load the links. They stay as they are.
        </p>
      ) : (
        value.length > 0 && (
          <ul className="event-chips">
            {value.map((l, n) => (
              <li key={n} className="chip">
                <span>{l.title || l.url}</span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove the link ${l.title || l.url}`}
                  onClick={() => onChange(value.filter((_, i) => i !== n))}
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        )
      )}
      {value.length < MAX_LINKS && (
        <div className="event-add-row">
          <input
            type="url"
            placeholder="https://"
            aria-label="Link address"
            value={url}
            maxLength={2000}
            onKeyDown={onEnter(add)}
            onChange={(e) => setUrl(e.target.value)}
          />
          <input
            placeholder="Title (optional)"
            aria-label="Link title (optional)"
            value={title}
            maxLength={200}
            onKeyDown={onEnter(add)}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button type="button" className="secondary" onClick={add}>
            <Plus size={13} /> Add link
          </button>
        </div>
      )}
      {error && (
        <small className="field-hint" role="alert">
          {error}
        </small>
      )}
    </fieldset>
  );
}
