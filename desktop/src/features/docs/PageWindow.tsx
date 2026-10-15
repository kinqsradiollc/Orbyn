import { useEffect, useState } from "react";
import type { Doc } from "@orbyn/core";
import { client } from "../../lib/api";
import { EmptyState } from "../../components/EmptyState";
import { FileText } from "lucide-react";
import { DocEditor } from "./DocEditor";
import "./docs.css";

/**
 * One page in a window of its own (NAV-06), for a second screen: the page
 * and its tools, without the sidebar or the library. Opened from a page's
 * ⋯ menu or ⌘K; in a browser it's a tab at /app/doc/<id>?window=page.
 */
export function PageWindow({
  docId,
  userId,
  canWriteIn,
  teamNameFor,
  onItemsChanged,
  report,
}: {
  docId: string;
  userId?: string;
  canWriteIn: (teamId: string | null) => boolean;
  teamNameFor: (teamId: string | null) => string | null;
  onItemsChanged: () => void;
  report: (e: unknown) => void;
}) {
  const [retry, setRetry] = useState(0);
  const [failed, setFailed] = useState(false);
  const [doc, setDoc] = useState<Doc | null | "gone">(null);
  useEffect(() => {
    let live = true;
    setDoc(null);
    setFailed(false);
    client.getDocForEditor(docId).then(
      (d) => {
        if (!live) return;
        setDoc(d);
        document.title = `${d.title || "Untitled"} · Orbyn`;
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [docId, retry]);
  return (
    <main className="page-window">
      {failed ? (
        <div role="alert">
          <p>Couldn't open this page.</p>
          <button
            className="secondary"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry
          </button>
        </div>
      ) : doc === null ? (
        <p className="muted" role="status">
          Opening page…
        </p>
      ) : doc === "gone" ? (
        <EmptyState
          icon={FileText}
          title="This page isn't here"
          body="It may have moved to Trash, or it isn't yours to open."
        />
      ) : (
        <DocEditor
          key={doc.id}
          doc={doc}
          report={report}
          userId={userId}
          canWrite={canWriteIn(doc.team_id)}
          teamName={doc.team_name ?? teamNameFor(doc.team_id)}
          onItemsChanged={onItemsChanged}
          onChanged={(saved) => {
            setDoc(saved);
            document.title = `${saved.title || "Untitled"} · Orbyn`;
          }}
          onDeleted={() => setDoc("gone")}
          onUndoDelete={setDoc}
        />
      )}
    </main>
  );
}
