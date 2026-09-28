import { useState } from "react";
import type { ReminderNudgeCard } from "@orbyn/core";
import { client } from "../../lib/api";
import { errorText } from "../../lib/errors";

/** Stop future reminders for the source behind a saved chat card. */
export function ReminderNudge({
  card,
  busy,
}: {
  card: ReminderNudgeCard;
  busy: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState("");
  return (
    <div>
      <div className="button-row start">
        <button
          disabled={busy || pending || stopped}
          onClick={() => {
            setPending(true);
            setError("");
            void client
              .stopReminderNudge(card.id)
              .then(
                () => setStopped(true),
                (e) => setError(errorText(e)),
              )
              .finally(() => setPending(false));
          }}
        >
          {stopped
            ? "Reminders stopped for this thing"
            : "Stop reminders for this thing"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
