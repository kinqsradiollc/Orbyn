import { useEffect, useState } from "react";
import type { Doc } from "@orbyn/core";
import { client } from "../../lib/api";
import { DocEditor } from "./DocEditor";
import "./docs.css";

/**
 * Today's agenda. Orbyn writes it the first time you open it each day, from
 * what's actually in your planner; after that it's an ordinary document, so
 * anything you add to it stays.
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
  const [doc, setDoc] = useState<Doc | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    client.agendaToday().then(setDoc, (e) => {
      setFailed(true);
      report(e);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed)
    return (
      <p className="muted">
        Today's agenda couldn't be loaded. Try again in a moment.
      </p>
    );
  if (!doc) return <p className="muted">Writing today's agenda…</p>;

  return (
    <DocEditor
      doc={doc}
      report={report}
      userId={userId}
      onChanged={setDoc}
      onItemsChanged={onItemsChanged}
      // The agenda is always today's page; there is no list to go back to.
      onDeleted={() => setDoc(null)}
    />
  );
}
