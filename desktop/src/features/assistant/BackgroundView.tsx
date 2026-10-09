import { useEffect, useMemo, useSyncExternalStore } from "react";
import { AssistantProfileStore } from "@orbyn/api-client";
import { ASSISTANT_ACTIVITY_LABELS } from "@orbyn/core";
import { client } from "../../lib/api";
import { onSessionChange, session } from "../../lib/session";
import { Character } from "../../components/Character";
import { AssistantHandoffAction } from "./AssistantHandoffAction";
import "./assistant-agents.css";

/** The background agent has its own work surface, independent of chat and night review. */
export function BackgroundView({
  onOpenChat,
}: {
  onOpenChat: (id: string) => void;
}) {
  const store = useMemo(
    () => new AssistantProfileStore(client, session.get),
    [],
  );
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    void store.refresh();
    const stopSession = onSessionChange(() => store.reset());
    const refresh = () => {
      if (!document.hidden) void store.refresh();
    };
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 15_000);
    return () => {
      stopSession();
      store.reset();
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  }, [store]);
  const profile = snapshot.data?.profiles[0];
  return (
    <section
      className="assistant-background-workspace"
      aria-label="Background agent"
    >
      <header className="assistant-background-head">
        <button
          type="button"
          className="secondary"
          disabled={snapshot.loading}
          onClick={() => void store.refresh()}
        >
          Refresh
        </button>
      </header>
      {snapshot.error && (
        <p role="alert">Couldn't load Background. Try again.</p>
      )}
      {!profile && !snapshot.error && <p role="status">Loading Background…</p>}
      {profile && (
        <>
          <div className="assistant-agent-card">
            <header>
              <Character
                appearance={profile.identity?.character}
                name={profile.identity?.name ?? "Background"}
                state={
                  profile.state === "working"
                    ? "working"
                    : profile.state === "waiting"
                      ? "waiting"
                      : "ready"
                }
                size={48}
              />
              <div>
                <h3>{profile.identity?.name ?? "Background"}</h3>
                <p>
                  {
                    {
                      idle: "Idle",
                      queued: "Queued",
                      working: "Working",
                      waiting: "Waiting for you",
                      scheduled: "Scheduled",
                    }[profile.state]
                  }
                </p>
              </div>
            </header>
            {!profile.runtime.reporting && (
              <p role="status">Worker not responding</p>
            )}
            {(profile.counts.working > 0 ||
              profile.counts.waiting > 0 ||
              profile.counts.queued > 0 ||
              profile.counts.recovering > 0) && (
              <p>
                {[
                  profile.counts.working > 0 &&
                    `${profile.counts.working} working`,
                  profile.counts.waiting > 0 &&
                    `${profile.counts.waiting} waiting`,
                  profile.counts.queued > 0 &&
                    `${profile.counts.queued} queued`,
                  profile.counts.recovering > 0 &&
                    `${profile.counts.recovering} recovering`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>
          <div className="assistant-background-columns">
            <section aria-labelledby="background-results-title">
              <h3 id="background-results-title">Results</h3>
              {profile.outputs.length === 0 ? (
                <p className="muted">No results yet</p>
              ) : (
                <ul className="assistant-agent-outputs">
                  {profile.outputs.map((output) => (
                    <li key={output.job_id}>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => onOpenChat(output.chat_id)}
                      >
                        {output.title || "Completed work"}
                      </button>
                      <time dateTime={output.completed_at}>
                        {new Date(output.completed_at).toLocaleString()}
                      </time>
                      <AssistantHandoffAction
                        jobId={output.job_id}
                        title={output.title}
                        lane="background"
                        existing={output.handoff}
                        onOpenChat={onOpenChat}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="background-activity-title">
              <h3 id="background-activity-title">Activity</h3>
              {profile.recent_activity.length === 0 ? (
                <p className="muted">No recent activity</p>
              ) : (
                <ul className="assistant-agent-activity">
                  {profile.recent_activity.map((event) => (
                    <li key={event.sequence}>
                      <span>{ASSISTANT_ACTIVITY_LABELS[event.kind]}</span>
                      <time dateTime={event.created_at}>
                        {new Date(event.created_at).toLocaleString()}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
}
