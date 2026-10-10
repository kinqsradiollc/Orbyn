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
  const [doc, setDoc] = useState<Doc | null | "gone">(null);
  useEffect(() => {
    let live = true;
    client.getDocForEditor(docId).then(
      (d) => {
        if (!live) return;
        setDoc(d);
        document.title = `${d.title || "Untitled"} · Orbyn`;
      },
      () => live && setDoc("gone"),
    );
    return () => {
      live = false;
    };
  }, [docId]);
  return (
    <main className="page-window">
      {doc === null ? (
        <p className="muted">Opening the page…</p>
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
