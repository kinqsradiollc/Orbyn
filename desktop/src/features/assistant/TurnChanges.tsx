import { useEffect, useState } from "react";
import type { AgentActivity } from "@orbyn/core";
import { errorText } from "../../lib/errors";
import { openObject } from "../docs/DocLinks";

const SHOWN = 8;

/**
 * What one assistant reply changed directly, with Undo for all of it. The
 * list is the assistant's own activity for the reply's job.
 */
export function TurnChanges({
  job,
  load,
  undo,
}: {
  job: string;
  load: (job: string) => Promise<AgentActivity[]>;
  undo: (job: string) => Promise<number>;
}) {
  const [changes, setChanges] = useState<AgentActivity[] | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    load(job).then(
      (list) => live && setChanges(list),
      () => live && setChanges([]),
    );
    return () => {
      live = false;
    };
  }, [job]);
  if (!changes?.length) return null;
  const wasUndone = undone || changes.every((c) => c.undone_at);
  const canUndo = !wasUndone && changes.some((c) => c.undoable);
  const run = async () => {
    setUndoing(true);
    setError("");
    try {
      await undo(job);
      setUndone(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setUndoing(false);
    }
  };
  return (
    <section className="ai-changes" aria-label="What this reply changed">
      <div className="ai-changes-head">
        <strong>Changed</strong>
        {wasUndone ? (
          <span role="status">Undone</span>
        ) : (
          canUndo && (
            <button
              type="button"
              className="ai-ghost"
              disabled={undoing}
              onClick={() => void run()}
            >
              {undoing ? "Undoing…" : "Undo"}
            </button>
          )
        )}
      </div>
      <ul>
        {changes.slice(0, SHOWN).map((change) => (
          <li key={change.id}>
            {change.summary}
            {!!change.links?.length && (
              <span className="ai-changes-links">
                {change.links.map((l) => (
                  <button
                    key={`${l.kind}:${l.id}`}
                    type="button"
                    className="link-button"
                    title={`Open this ${l.kind === "doc" ? "page" : l.kind}`}
                    onClick={() => openObject({ kind: l.kind, id: l.id })}
                  >
                    {l.title || "Untitled"}
                  </button>
                ))}
              </span>
            )}
          </li>
        ))}
        {changes.length > SHOWN && <li>and {changes.length - SHOWN} more</li>}
      </ul>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
