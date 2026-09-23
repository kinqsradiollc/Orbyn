import { useEffect, useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import type { Doc } from "@orbyn/core";
import { client } from "../../lib/api";
import { deviceTimeZone } from "../../lib/planning";
import { useConfirm } from "../../components/Confirm";
import { DocEditor } from "./DocEditor";
import "./docs.css";

/**
 * Today's agenda. Orbyn writes it each morning (or the first time you open
 * it) from your calendar — your events, the calendars you subscribe to, time
 * set aside, what's due — with the assistant's summary of the day when one
 * is connected. After that it's an ordinary document, so anything you add
 * stays; "Rewrite" writes it again from the calendar as it is now.
 */
export function AgendaView({
  report,
  onItemsChanged,
  userId,
}: {
  report: (e: unknown) => void;
  onItemsChanged: () => void;
  userId?: string;
}) {
  const { ask } = useConfirm();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [failed, setFailed] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [note, setNote] = useState("");
  /** Bumped on a rewrite, so the editor starts again from the new page. */
  const [edition, setEdition] = useState(0);

  useEffect(() => {
    client.agendaToday(deviceTimeZone()).then(setDoc, (e) => {
      setFailed(true);
      report(e);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const rewrite = async () => {
    if (
      !(await ask({
        title: "Rewrite today's agenda?",
        body: "It's written again from your calendar as it is now. Anything you've typed on the page is replaced.",
        confirmLabel: "Rewrite",
      }))
    )
      return;
    setRewriting(true);
    setNote("");
    try {
      const next = await client.rewriteAgenda(deviceTimeZone());
      setDoc(next);
      setEdition((n) => n + 1);
      setNote(
        next.brief
          ? "Rewritten from your calendar, with the assistant's summary."
          : "Rewritten from your calendar.",
      );
    } catch (e) {
      report(e);
    } finally {
      setRewriting(false);
    }
  };

  if (failed)
    return (
      <p className="muted">
        Today's agenda couldn't be loaded. Try again in a moment.
      </p>
    );
  if (!doc) return <p className="muted">Writing today's agenda…</p>;

  return (
    <>
      <div className="agenda-bar">
        <span className="muted">
          <Sparkles size={14} aria-hidden="true" /> Written from your calendar,
          including the calendars you subscribe to.
          {note && <strong role="status"> {note}</strong>}
        </span>
        <button
          type="button"
          className="secondary"
          disabled={rewriting}
          onClick={() => void rewrite()}
        >
          <RefreshCw size={14} />{" "}
          {rewriting ? "Rewriting…" : "Rewrite from my calendar"}
        </button>
      </div>
      <DocEditor
        key={`${doc.id}-${edition}`}
        doc={doc}
        report={report}
        userId={userId}
        onChanged={setDoc}
        onItemsChanged={onItemsChanged}
        // The agenda is always today's page; there is no list to go back to.
        onDeleted={() => setDoc(null)}
      />
    </>
  );
}
