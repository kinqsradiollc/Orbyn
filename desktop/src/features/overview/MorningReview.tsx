import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AssistantProfileStore } from "@orbyn/api-client";
import {
  groupAssistantReview,
  assistantReviewGroupSummary,
  assistantOutcomeDetails,
  type AssistantMorningReviewItem,
} from "@orbyn/core";
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
  onOpenReview,
  onOpenPage,
}: {
  onOpenActivity: (lane: Lane) => void;
  onOpenChat?: (id: string) => void;
  onOpenReview?: () => void;
  onOpenPage?: (id: string) => void;
}) {
  const owner = useSyncExternalStore(onSessionChange, sessionKey);
  const store = useMemo(
    () => new AssistantProfileStore(client, sessionKey),
    [owner],
  );
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setShowAll(false), [owner]);
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
  const groups = snapshot.data ? groupAssistantReview(snapshot.data) : [];
  if (snapshot.data && !snapshot.error && !groups.length) return null;
  const open = (row: AssistantMorningReviewItem) => {
    if (sessionKey() !== owner) return;
    if (row.docId && onOpenPage) onOpenPage(row.docId);
    else if (row.target === "review" && onOpenReview) onOpenReview();
    else if (row.chatId && onOpenChat) onOpenChat(row.chatId);
    else onOpenActivity(row.lane);
  };
  const renderRow = (row: AssistantMorningReviewItem) => (
    <li key={row.id}>
      <div className="morning-review-main">
        <strong>{row.title}</strong>
        <span>{row.detail}</span>
        {row.at && (
          <time dateTime={row.at}>{new Date(row.at).toLocaleString()}</time>
        )}
        {row.summary && (
          <p className="morning-review-summary">
            {row.summary.length > 240
              ? `${row.summary.slice(0, 240)}…`
              : row.summary}
          </p>
        )}
        {row.summary && row.summary.length > 240 && (
          <details>
            <summary>Full result summary</summary>
            <p>{row.summary}</p>
          </details>
        )}
        {row.execution_outcome && (
          <details>
            <summary>Evidence &amp; open questions</summary>
            <ul>
              {assistantOutcomeDetails(row.execution_outcome).map(
                (line, index) => (
                  <li key={index}>{line}</li>
                ),
              )}
            </ul>
          </details>
        )}
      </div>
      <button className="text-button" onClick={() => open(row)}>
        {row.action}
      </button>
    </li>
  );
  const kinds = {
    goal: "Goal",
    routine: "Routine",
    project: "Project",
    task: "Task",
    chat: "Conversation",
    activity: "Activity",
    page: "Page",
  };
  return (
    <section className="morning-review" aria-label="Since you were away">
      <header>
        <div>
          <h2>Since you were away</h2>
          <p className="muted">
            Latest results and active work, grouped by source.
          </p>
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
          {(showAll ? groups : groups.slice(0, 4)).map((group) => (
            <section
              key={group.id}
              className="morning-review-group"
              aria-label={`${kinds[group.kind]}: ${group.title}`}
            >
              <header>
                <span>{kinds[group.kind]}</span>
                <h3>{group.title}</h3>
              </header>
              <p className="muted">{assistantReviewGroupSummary(group)}</p>
              <details className="morning-review-runs">
                <summary>{`Review ${group.items.length} ${group.items.length === 1 ? "run" : "runs"} for ${group.title}`}</summary>
                <ul>{group.items.map(renderRow)}</ul>
              </details>
            </section>
          ))}
          {groups.length > 4 && (
            <button
              className="text-button"
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll
                ? "Show fewer groups"
                : `Show all recent work (${groups.length} groups)`}
            </button>
          )}
          {snapshot.data.profiles.some(
            (profile) =>
              profile.work_truncated ||
              profile.outputs_truncated ||
              profile.page_runs_truncated,
          ) && (
            <p className="muted">
              More runs are available in agent activity and Review. This review
              shows the latest results and a bounded list of active work.
            </p>
          )}
          <footer>
            {onOpenReview && (
              <button
                className="text-button"
                onClick={() => {
                  if (sessionKey() === owner) onOpenReview();
                }}
              >
                All decisions &amp; changes
              </button>
            )}
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
