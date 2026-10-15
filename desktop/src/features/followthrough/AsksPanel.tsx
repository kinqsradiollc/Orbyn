import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskAsk } from "@orbyn/core";
import { client } from "../../lib/api";
import { onLive } from "../../lib/live";
import { errorText } from "../../lib/errors";
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
  const [error, setError] = useState("");
  const request = useRef(0);
  const load = useCallback(async () => {
    const version = ++request.current;
    try {
      const rows = await client.listAsks();
      if (version === request.current) {
        setLists(rows);
        setError("");
      }
    } catch (reason) {
      if (version === request.current) setError(errorText(reason));
    }
  }, []);
  useEffect(() => {
    void load();
    const unsubscribe = onLive((news) => {
      if (news.kind === "changed") void load();
    });
    return () => {
      request.current += 1;
      unsubscribe();
    };
  }, [load]);
  if (error && !lists)
    return (
      <p className="error" role="alert">
        {error}
        <button
          className="text-button"
          onClick={() => {
            void load();
          }}
        >
          Retry
        </button>
      </p>
    );
  if (!lists || (!lists.to_me.length && !lists.from_me.length && !error))
    return null;
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
      {!!error && (
        <p className="error" role="alert">
          {error}
          <button
            className="text-button"
            onClick={() => {
              void load();
            }}
          >
            Retry
          </button>
        </p>
      )}
      {group("Waiting for your answer", lists.to_me, "mine")}
      {group("Waiting on others", lists.from_me, "theirs")}
    </section>
  );
}
