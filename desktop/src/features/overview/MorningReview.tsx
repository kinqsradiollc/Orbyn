import { useEffect, useMemo, useSyncExternalStore } from "react";
import { AssistantProfileStore } from "@orbyn/api-client";
import { recentAssistantWork, type AssistantReviewRow } from "@orbyn/core";
import { client } from "../../lib/api";
import { onSessionChange, session } from "../../lib/session";
import "./morning-review.css";

const sessionKey = () => {
  const { token, generation } = session.binding();
  return token ? `${generation}:${token}` : "";
};

type Lane = "background" | "overnight";

/** Read-only review using current-access profiles, independent of conversation rollout. */
export function MorningReview({
  onOpenActivity,
  onOpenChat,
}: {
  onOpenActivity: (lane: Lane) => void;
  onOpenChat?: (id: string) => void;
}) {
  const owner = useSyncExternalStore(onSessionChange, sessionKey);
  const store = useMemo(
    () => new AssistantProfileStore(client, sessionKey),
    [owner],
  );
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    const refresh = () => {
      if (owner && sessionKey() === owner && !document.hidden)
        void store.refresh();
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
      store.reset();
    };
  }, [store, owner]);
  if (!owner) return null;
  const rows = snapshot.data ? recentAssistantWork(snapshot.data) : [];
  const active = rows.filter((row) => row.priority !== 4);
  const finished = rows.filter((row) => row.priority === 4);
  const finishedLabel = `Finished run history · latest ${finished.length}${finished[0]?.at ? ` · ${new Date(finished[0].at).toLocaleDateString()}` : ""}`;
  if (snapshot.data && !snapshot.error && !rows.length) return null;
  const open = (row: AssistantReviewRow) => {
    if (sessionKey() !== owner) return;
    if (row.chatId && onOpenChat) onOpenChat(row.chatId);
    else onOpenActivity(row.lane);
  };
  const renderRow = (row: AssistantReviewRow) => (
    <li key={row.id}>
      <div className="morning-review-main">
        <strong>{row.title}</strong>
        <span>{row.detail}</span>
        {row.at && (
          <time dateTime={row.at}>{new Date(row.at).toLocaleString()}</time>
        )}
      </div>
      <button className="text-button" onClick={() => open(row)}>
        {row.action}
      </button>
    </li>
  );
  return (
    <section className="morning-review" aria-label="Recent agent work">
      <header>
        <div>
          <h2>Recent agent work</h2>
          {snapshot.data && (
            <p className="muted">
              Observed {new Date(snapshot.data.observed_at).toLocaleString()}
            </p>
          )}
        </div>
        <button
          className="text-button"
          disabled={snapshot.loading}
          onClick={() => {
            if (sessionKey() === owner) void store.refresh();
          }}
        >
          {snapshot.loading
            ? "Refreshing…"
            : snapshot.error
              ? "Retry"
              : "Refresh"}
        </button>
      </header>
      {snapshot.error ? (
        <p role="alert">Couldn’t load recent agent work. Try again.</p>
      ) : !snapshot.data ? (
        <p role="status">Loading recent agent work…</p>
      ) : (
        <>
          <ul>{active.slice(0, 6).map(renderRow)}</ul>
          {active.length > 6 && (
            <p className="muted">
              Showing 6 of {active.length} activity entries.
            </p>
          )}
          {finished.length > 0 && (
            <details className="morning-review-history">
              <summary>{finishedLabel}</summary>
              <ul>{finished.map(renderRow)}</ul>
            </details>
          )}
          <footer>
            {(["background", "overnight"] as const).map((lane) => (
              <button
                key={lane}
                className="text-button"
                onClick={() => {
                  if (sessionKey() === owner) onOpenActivity(lane);
                }}
              >
                {lane === "background"
                  ? "Background activity"
                  : "Overnight activity"}
              </button>
            ))}
          </footer>
        </>
      )}
    </section>
  );
}
