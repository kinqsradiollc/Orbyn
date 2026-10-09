import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { AssistantProfileStore } from "@orbyn/api-client";
import { ASSISTANT_ACTIVITY_LABELS } from "@orbyn/core";
import { X } from "lucide-react";
import { client } from "../../lib/api";
import { session, onSessionChange } from "../../lib/session";
import { Character } from "../../components/Character";
import { AssistantHandoffAction } from "./AssistantHandoffAction";
import "./assistant-agents.css";

/** Separate runtime profiles; an idle companion never implies an active worker. */
export function AssistantAgents({
  onClose,
  onOpenChat,
  canOpen,
}: {
  onClose: () => void;
  onOpenChat: (id: string) => void;
  canOpen: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const store = useMemo(
    () => new AssistantProfileStore(client, session.get),
    [],
  );
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    const stopSession = onSessionChange(() => store.reset());
    void store.refresh();
    const refresh = () => {
      if (!document.hidden) void store.refresh();
    };
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 15000);
    return () => {
      node.close();
      stopSession();
      store.reset();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [store]);
  return (
    <dialog
      ref={dialog}
      className="assistant-agents-dialog"
      aria-labelledby="assistant-agents-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="assistant-agents-head">
        <h2 id="assistant-agents-title">Your agents</h2>
        <button
          className="icon-button"
          aria-label="Close agent profiles"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="assistant-agents-body">
        {snapshot.error && (
          <p role="alert">Agent status could not be refreshed. Try again.</p>
        )}
        {!snapshot.data && !snapshot.error && (
          <p role="status">Loading agent profiles…</p>
        )}
        {snapshot.data?.profiles.map((profile) => (
          <section
            key={profile.lane}
            className="assistant-agent-card"
            aria-label={`${profile.lane} agent`}
          >
            <header>
              <Character
                appearance={profile.identity?.character}
                name={
                  profile.identity?.name ??
                  (profile.lane === "background" ? "Background" : "Overnight")
                }
                state={
                  profile.state === "working"
                    ? "working"
                    : profile.state === "waiting"
                      ? "waiting"
                      : "ready"
                }
                size={56}
              />
              <div>
                <h3>
                  {profile.identity?.name ??
                    (profile.lane === "background"
                      ? "Background"
                      : "Overnight")}
                </h3>
                <p>
                  {profile.identity?.name &&
                    profile.identity.name !==
                      (profile.lane === "background"
                        ? "Background"
                        : "Overnight") &&
                    `${profile.lane === "background" ? "Background" : "Overnight"} · `}
                  {profile.state === "queued" &&
                  profile.counts.recovering > 0 &&
                  profile.counts.queued === 0
                    ? "Recovery pending"
                    : {
                        idle: "Idle",
                        queued: "Queued",
                        working: "Working",
                        waiting: "Waiting for your decision",
                        scheduled: "Scheduled window",
                      }[profile.state]}
                </p>
              </div>
            </header>
            {profile.last_activity_at && (
              <p className="muted">
                Last work {new Date(profile.last_activity_at).toLocaleString()}
              </p>
            )}
            {!profile.runtime.reporting && (
              <p className="muted" role="status">
                Worker not responding
              </p>
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
            {profile.window && (
              <p className="muted">
                {profile.window.enabled
                  ? `Night shift ${profile.window.start}–${profile.window.end} · ${profile.window.timezone}`
                  : "Night shift is off"}
              </p>
            )}
            {profile.window?.next_start_at && (
              <p className="muted">
                Next window{" "}
                {new Date(profile.window.next_start_at).toLocaleString()}
              </p>
            )}
            {profile.budget && (
              <p className="muted">
                Night estimate{" "}
                {profile.budget.estimated_tokens.toLocaleString()}/
                {profile.budget.limit_tokens.toLocaleString()} tokens
              </p>
            )}
            {(profile.recent_activity.length > 0 ||
              profile.outputs.length > 0) && (
              <details>
                <summary>Activity and results</summary>
                {profile.recent_activity.length > 0 && (
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
                {profile.outputs.length > 0 && (
                  <ul className="assistant-agent-outputs">
                    {profile.outputs.map((output) => (
                      <li key={output.job_id}>
                        <button
                          type="button"
                          className="secondary"
                          disabled={!canOpen}
                          onClick={() => {
                            onClose();
                            onOpenChat(output.chat_id);
                          }}
                        >
                          {output.title || "Completed work"}
                        </button>
                        <time dateTime={output.completed_at}>
                          {new Date(output.completed_at).toLocaleString()}
                        </time>
                        <AssistantHandoffAction
                          jobId={output.job_id}
                          title={output.title}
                          lane={profile.lane}
                          existing={output.handoff}
                          onOpenChat={(id) => {
                            onClose();
                            onOpenChat(id);
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            )}
          </section>
        ))}
        {snapshot.data && (
          <p className="muted">
            Status as of{" "}
            {new Date(snapshot.data.observed_at).toLocaleTimeString()}
          </p>
        )}
        <button
          className="secondary"
          disabled={snapshot.loading}
          onClick={() => void store.refresh()}
        >
          {snapshot.loading ? "Refreshing…" : "Refresh status"}
        </button>
      </div>
    </dialog>
  );
}
