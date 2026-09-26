import { useState } from "react";
import { Hourglass } from "lucide-react";
import { ageLabel, pageFreshness, type Doc } from "@orbyn/core";
import { client } from "../../lib/api";
import { errorText } from "../../lib/planning";

/**
 * A page nobody has changed or confirmed in months may not be true any more.
 * Anyone who can edit it can say it still is, or that it needs updating —
 * which gives whoever wrote it a task.
 */
export function PageFreshness({
  doc,
  canWrite,
  always = false,
  onReviewed,
}: {
  doc: Pick<Doc, "id" | "updated_at" | "reviewed_at" | "team_id">;
  canWrite: boolean;
  /**
   * In the Info panel: say how fresh it is even when it's fresh, and let
   * anyone who can edit it confirm it at any time.
   */
  always?: boolean;
  onReviewed?: () => void;
}) {
  const [reviewed, setReviewed] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  const fresh = pageFreshness(doc.updated_at, reviewed ?? doc.reviewed_at);
  if (done)
    return (
      <p className="page-freshness is-done" role="status">
        {done}
      </p>
    );
  if (fresh.state === "fresh" && !always) return null;
  const review = async (
    input:
      { verdict: "still_true" } | { verdict: "needs_update"; note: string },
  ) => {
    setError("");
    try {
      const r = await client.reviewDoc(doc.id, input);
      setReviewed(r.reviewed_at);
      onReviewed?.();
      setDone(
        input.verdict === "still_true"
          ? "Thanks — marked as still true."
          : r.task?.assignee_name
            ? `A task to update it went to ${r.task.assignee_name}.`
            : "A task to update it is on the list.",
      );
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <div
      className={"page-freshness is-" + fresh.state}
      role="region"
      aria-label="Is this page still true?"
    >
      <Hourglass size={14} aria-hidden="true" />
      <span className="page-freshness-text">
        {fresh.state === "fresh" ? (
          <>
            Changed or confirmed{" "}
            {fresh.days < 1 ? "today" : `${ageLabel(fresh.days)} ago`}.
          </>
        ) : (
          <>
            Not changed or confirmed in {ageLabel(fresh.days)}.
            {canWrite ? " Is it still true?" : " It may be out of date."}
          </>
        )}
      </span>
      {canWrite && !asking && (
        <span className="page-freshness-actions">
          <button
            className="secondary"
            onClick={() => void review({ verdict: "still_true" })}
          >
            Still true
          </button>
          <button className="text-button" onClick={() => setAsking(true)}>
            Needs update
          </button>
        </span>
      )}
      {asking && (
        <form
          className="page-freshness-form"
          onSubmit={(e) => {
            e.preventDefault();
            void review({ verdict: "needs_update", note: note.trim() });
          }}
        >
          <input
            value={note}
            maxLength={1000}
            placeholder="What's changed? (optional)"
            aria-label="What's changed"
            onChange={(e) => setNote(e.target.value)}
            autoFocus
          />
          <button className="secondary" type="submit">
            Make a task
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() => setAsking(false)}
          >
            Cancel
          </button>
        </form>
      )}
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
