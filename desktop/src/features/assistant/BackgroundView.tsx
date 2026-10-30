import { CurrentAgentWork } from "./CurrentAgentWork";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { AssistantProfileStore } from "@orbyn/api-client";
import { ASSISTANT_ACTIVITY_LABELS } from "@orbyn/core";
import { client } from "../../lib/api";
import { onSessionChange, session } from "../../lib/session";
import { Character } from "../../components/Character";
import { AgentResult } from "./AgentResult";
import { LaneWorkControls } from "./LaneWorkControls";
import "./assistant-agents.css";

/** The background agent has its own work surface, independent of chat and night review. */
export function BackgroundView({
  onOpenChat,
}: {
  onOpenChat: (id: string) => void;
}) {
  const binding = () => {
    const value = session.binding();
    return `${value.generation}:${value.token}`;
  };
  const owner = useSyncExternalStore(onSessionChange, binding);
  const store = useMemo(
    () => new AssistantProfileStore(client, binding),
    [owner],
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
  const profile = snapshot.data?.profiles.find(
    (item) => item.lane === "background",
  );
  const needsReview =
    profile?.outputs.filter(
      (output) =>
        output.state === "failed" ||
        (output.execution_outcome &&
          ["partial", "waiting", "failed", "interrupted", "uncertain"].includes(
            output.execution_outcome.outcome,
          )),
    ) ?? [];
  const history =
    profile?.outputs.filter((output) => !needsReview.includes(output)) ?? [];
  return (
    <section
      className="assistant-background-workspace"
      aria-label="Background agent"
    >
      <header className="assistant-background-head">
        <div>
          <h2>Background work</h2>
          <p className="muted">Results, decisions and current activity</p>
        </div>
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
                size={32}
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
              <p role="status">Worker heartbeat unavailable</p>
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
          <LaneWorkControls lane="background" />
          <div className="assistant-background-columns">
            <section aria-labelledby="background-results-title">
              <h3 id="background-results-title">Review outcomes</h3>
              {needsReview.length ? (
                needsReview.map((output) => (
                  <AgentResult
                    key={output.job_id}
                    output={output}
                    lane="background"
                    onOpenChat={onOpenChat}
                  />
                ))
              ) : profile.outputs.length ? (
                <p className="muted">
                  No result decisions in the latest output window.
                </p>
              ) : null}
              {profile.work && (
                <CurrentAgentWork
                  work={profile.work}
                  truncated={profile.work_truncated}
                  onOpenChat={onOpenChat}
                  onRefresh={store.refresh}
                />
              )}
              {history.length > 0 && (
                <details className="agent-result-history">
                  <summary>
                    Finished run history · latest {history.length}
                  </summary>
                  {history.map((output) => (
                    <AgentResult
                      key={output.job_id}
                      output={output}
                      lane="background"
                      onOpenChat={onOpenChat}
                    />
                  ))}
                </details>
              )}
              {!profile.outputs.length && (
                <p className="muted">No saved results yet.</p>
              )}
            </section>
            <section aria-labelledby="background-activity-title">
              <h3 id="background-activity-title">Runtime activity</h3>
              <p className="muted">
                Observed {new Date(snapshot.data!.observed_at).toLocaleString()}
              </p>
              <details>
                <summary>Latest activity events</summary>
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
              </details>
            </section>
          </div>
        </>
      )}
    </section>
  );
}
