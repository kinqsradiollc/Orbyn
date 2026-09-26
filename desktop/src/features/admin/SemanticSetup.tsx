import { useEffect, useState } from "react";
import { Check, Circle } from "lucide-react";
import type { AiSettings } from "@orbyn/core";
import { client } from "../../lib/api";

/**
 * Search by meaning's own setup, apart from the assistant: off by default.
 * Turning it on needs the pgvector database image, the measuring service, a
 * model that measures text, and the admin's agreement that every page
 * (except those in projects kept out of the assistant) is sent to the
 * provider to be measured. Without it, word search works as always.
 */
export function SemanticSetup({
  settings,
  providerName,
  busy,
  act,
  onChanged,
}: {
  settings: AiSettings | undefined;
  providerName: string | null;
  busy: boolean;
  act: (fn: () => Promise<void>) => void;
  onChanged: () => Promise<void>;
}) {
  const [model, setModel] = useState(settings?.embedding_model ?? "");
  const [accept, setAccept] = useState(false);
  useEffect(() => {
    setModel(settings?.embedding_model ?? "");
  }, [settings?.embedding_model]);
  if (!settings) return null;
  const on = settings.semantic_search && !!settings.semantic_accepted_at;
  const steps: { done: boolean; text: string }[] = [
    {
      done: settings.semantic_possible,
      text: "The database can store measurements (the pgvector image, set with POSTGRES_IMAGE).",
    },
    {
      done: !!settings.measure_running,
      text: "The measuring service is running (the semantic profile).",
    },
    {
      done: settings.source === "database",
      text: "A provider is connected for the assistant.",
    },
  ];
  const ready = steps.every((s) => s.done);
  const change = (next: boolean) =>
    act(async () => {
      try {
        await client.setSemanticSearch(
          next
            ? { on: true, embedding_model: model.trim(), accept }
            : { on: false },
        );
      } finally {
        await onChanged();
        setAccept(false);
      }
    });
  return (
    <section className="card semantic-setup fade-up">
      <div className="section-heading">
        <h2>Search by meaning</h2>
        <span className={"plan-chip" + (on ? " is-ok" : "")}>
          {on ? "On" : "Off"}
        </span>
      </div>
      <p className="muted">
        Finds a page that says the same thing in other words, beside the word
        search. It stays off unless you set it up here: every page is sent to
        the provider to be measured, not just the pages a question needs.
      </p>
      <ul className="semantic-steps">
        {steps.map((s) => (
          <li key={s.text} className={s.done ? "is-done" : ""}>
            {s.done ? (
              <Check size={14} aria-label="Done" />
            ) : (
              <Circle size={14} aria-label="Not yet" />
            )}
            <span>{s.text}</span>
          </li>
        ))}
      </ul>
      {on ? (
        <div className="semantic-on">
          <p>
            Measuring with <strong>{settings.embedding_model}</strong>
            {providerName ? ` on ${providerName}` : ""}. Turned on{" "}
            {new Date(settings.semantic_accepted_at!).toLocaleDateString()}.
          </p>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => change(false)}
          >
            Turn off and forget the measurements
          </button>
        </div>
      ) : (
        <form
          className="semantic-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && accept && model.trim()) change(true);
          }}
        >
          <label>
            Model that measures text
            <input
              value={model}
              maxLength={200}
              placeholder="text-embedding-3-small"
              disabled={!ready}
              onChange={(e) => setModel(e.target.value)}
            />
          </label>
          <label className="check-line">
            <input
              type="checkbox"
              checked={accept}
              disabled={!ready}
              onChange={(e) => setAccept(e.target.checked)}
            />
            <span>
              I understand that the words of every page in this workspace
              (except projects kept out of the assistant) are sent to{" "}
              {providerName ?? "the provider"} to be measured, and that this is
              described in the Privacy Policy.
            </span>
          </label>
          <button
            className="primary"
            disabled={busy || !ready || !accept || !model.trim()}
          >
            Turn on search by meaning
          </button>
        </form>
      )}
    </section>
  );
}
