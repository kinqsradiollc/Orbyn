import { useCallback, useEffect, useState } from "react";
import { viewersLabel, type DocViewer } from "@orbyn/core";
import { client } from "../../lib/api";
import { onLive, setOpenDoc } from "../../lib/live";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/**
 * Who else has this page open right now, as small initials beside the save
 * state. Opening the page also tells the server this device is on it.
 */
export function DocViewers({ docId }: { docId: string }) {
  const [viewers, setViewers] = useState<DocViewer[]>([]);
  const load = useCallback(() => {
    client.docViewers(docId).then(setViewers, () => setViewers([]));
  }, [docId]);
  useEffect(() => {
    setOpenDoc(docId);
    load();
    const stop = onLive((news) =>
      (news.kind === "doc_presence" && news.doc === docId) ||
      news.kind === "presence"
        ? load()
        : undefined,
    );
    // Someone whose app closed without saying so fades out on its own.
    const id = setInterval(load, 90_000);
    return () => {
      stop();
      clearInterval(id);
      setOpenDoc(null);
    };
  }, [docId, load]);

  if (!viewers.length) return null;
  const names = viewers.map((v) => v.name);
  return (
    <span
      className="doc-viewers"
      role="status"
      title={`${viewersLabel(names)} ${names.length === 1 ? "is" : "are"} here`}
    >
      <span className="doc-viewer-faces" aria-hidden="true">
        {viewers.slice(0, 3).map((v) => (
          <i key={v.user_id}>{initials(v.name)}</i>
        ))}
      </span>
      <span className="sr-only">
        {viewersLabel(names)} {names.length === 1 ? "is" : "are"} here
      </span>
      {viewers.length > 3 && <small>+{viewers.length - 3}</small>}
    </span>
  );
}
