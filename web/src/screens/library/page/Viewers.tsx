import { viewersLabel, type DocViewer } from "@orbyn/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "../../../lib/session";
import { watchAccount } from "../streams";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");

/** Who else has this page open. Being here also tells the server so. */
export function useViewers(docId: string) {
  const [viewers, setViewers] = useState<DocViewer[]>([]);
  const request = useRef(0);
  const load = useCallback(() => {
    const id = ++request.current;
    client.docViewers(docId).then(
      (rows) => id === request.current && setViewers(rows),
      () => id === request.current && setViewers([]),
    );
  }, [docId]);
  useEffect(() => {
    const device = crypto.randomUUID();
    const beat = () =>
      client
        .heartbeat({
          device_id: device,
          platform: "web",
          active: true,
          doc_id: docId,
          pending_changes: 0,
          failed_changes: 0,
        })
        .catch(() => {});
    void beat();
    load();
    const stop = watchAccount((news) => {
      if (
        (news.kind === "doc_presence" && news.doc === docId) ||
        news.kind === "presence"
      )
        load();
    });
    const timer = setInterval(() => {
      void beat();
      load();
    }, 60_000);
    return () => {
      request.current++;
      stop();
      clearInterval(timer);
      client.leavePresence(device).catch(() => {});
    };
  }, [docId, load]);
  return viewers;
}

export function Viewers({ viewers }: { viewers: DocViewer[] }) {
  if (!viewers.length) return null;
  const names = viewers.map((viewer) => viewer.name);
  const label = `${viewersLabel(names)} ${names.length === 1 ? "is" : "are"} here`;
  return (
    <span className="page-viewers" role="status" title={label}>
      <span aria-hidden="true">
        {viewers.slice(0, 3).map((viewer) => (
          <i key={viewer.user_id}>{initials(viewer.name)}</i>
        ))}
      </span>
      {viewers.length > 3 && <small>+{viewers.length - 3}</small>}
      <span className="sr-only">{label}</span>
    </span>
  );
}
