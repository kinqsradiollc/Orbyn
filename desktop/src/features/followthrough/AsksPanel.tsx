import { useCallback, useEffect, useState } from "react";
import type { TaskAsk } from "@orbyn/core";
import { client } from "../../lib/api";
import { onLive } from "../../lib/live";
import { AskCard } from "./AskBox";

/**
 * Asks waiting for your answer, and the ones you're waiting on, at the top
 * of Notifications. Hidden when there are none.
 */
export function AsksPanel({
  onOpenItem,
}: {
  onOpenItem: (itemId: string) => void;
}) {
  const [lists, setLists] = useState<{
    to_me: TaskAsk[];
    from_me: TaskAsk[];
  } | null>(null);
  const load = useCallback(() => {
    client.listAsks().then(setLists, () => setLists(null));
  }, []);
  useEffect(() => {
    load();
    return onLive((news) => news.kind === "changed" && load());
  }, [load]);
  if (!lists || (!lists.to_me.length && !lists.from_me.length)) return null;
  const group = (title: string, asks: TaskAsk[], turn: "mine" | "theirs") =>
    asks.length > 0 && (
      <div className="asks-group">
        <h3>
          {title} <span className="muted">{asks.length}</span>
        </h3>
        {asks.map((a) => (
          <div key={a.id} className="asks-item">
            <button
              className="asks-title"
              onClick={() => onOpenItem(a.item_id)}
            >
              {a.item_title}
            </button>
            <AskCard ask={a} turn={turn} onChanged={load} />
          </div>
        ))}
      </div>
    );
  return (
    <section className="card asks-panel" aria-label="Asks">
      {group("Waiting for your answer", lists.to_me, "mine")}
      {group("Waiting on others", lists.from_me, "theirs")}
    </section>
  );
}
