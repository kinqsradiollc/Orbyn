import {
  ASSISTANT_ACTIVITY_LABELS,
  assistantPageReviewStateLabel,
  type AssistantPageReviewRun,
  type AssistantProfile,
} from "@orbyn/core";
import { useRef, useState } from "react";
import { client } from "../../lib/session";
import { Button, ErrorNotice, Pill, useConfirm } from "../../ui/kit";
import { Handoff } from "./Handoff";
import { useControls, useOwned, LANE_NAME, type Lane } from "./hooks";
import { Band, Check, Evidence, More, Time } from "./parts";
import { runWords } from "./words";

type Work = NonNullable<AssistantProfile["work"]>;
type Output = AssistantProfile["outputs"][number];

/** Admissions. Pausing is separate from stopping a run and from muting alerts. */
export function PauseLane({ lane }: { lane: Lane }) {
  const { state, set, refresh } = useControls(false);
  const key = lane === "background" ? "background_paused" : "overnight_paused";
  if (state.error)
    return (
      <ErrorNotice
        message="Couldn't load work controls."
        onRetry={() => void refresh()}
      />
    );
  if (!state.data)
    return (
      <p className="muted small" role="status">
        Loading work controls…
      </p>
    );
  return (
    <div className="agents-pause">
      <Check
        label={`Pause new ${LANE_NAME[lane]} work`}
        checked={state.data[key]}
        disabled={state.busy}
        onChange={(event) => void set(key, event.target.checked)}
      />
      <p className="muted small">
        Running work continues. Stop a run separately.
      </p>
    </div>
  );
}

/** What runs now, from the authorized job snapshot. A stop request is not a stop. */
export function CurrentWork({
  work,
  truncated,
  onOpenChat,
  onRefresh,
}: {
  work: Work;
  truncated?: boolean;
  onOpenChat: (id: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const confirm = useConfirm();
  const owned = useOwned();
  const lock = useRef(false);
  const latest = useRef(work);
  latest.current = work;
  const [stopping, setStopping] = useState<string | null>(null);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const stop = async (id: string) => {
    if (lock.current || !owned()) return;
    lock.current = true;
    setStopping(id);
    try {
      const yes = await confirm({
        title: "Stop this run?",
        body: "Requests cancellation of this run. Changes already applied remain available for review and undo.",
        action: "Stop run",
        danger: true,
      });
      if (!yes || !owned()) return;
      const live = latest.current.find((item) => item.job_id === id);
      if (!live || live.cancel_requested) return;
      setError("");
      await client.stopAssistantRun(id);
      if (!owned()) return;
      setRequested((now) => new Set(now).add(id));
      await onRefresh();
    } catch {
      if (owned())
        setError(
          "Couldn't confirm the stop request. Refresh current work before trying again.",
        );
    } finally {
      lock.current = false;
      if (owned()) setStopping(null);
    }
  };
  const ordered = [...work].sort(
    (a, b) => Number(b.state === "waiting") - Number(a.state === "waiting"),
  );
  return (
    <Band title="Current work">
      {error && <ErrorNotice message={error} />}
      {!work.length && <p className="muted">No admitted runs.</p>}
      <div className="agents-rows">
        {ordered.map((item) => {
          const stopped = item.cancel_requested || requested.has(item.job_id);
          const status = runWords({
            state: item.state,
            stopping: stopped,
            recovering: item.recovering,
          });
          return (
            <article key={item.job_id}>
              <div className="agents-row-main">
                <h3 dir="auto">{item.title || "Untitled work"}</h3>
                <div className="agents-row-meta">
                  <Pill tone={status.tone}>{status.text}</Pill>
                  <Time at={item.updated_at} />
                </div>
              </div>
              <div className="agents-buttons">
                <Button onClick={() => owned() && onOpenChat(item.chat_id)}>
                  {item.state === "waiting" ? "Review decision" : "Open work"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={!!stopping || stopped}
                  onClick={() => void stop(item.job_id)}
                >
                  {stopping === item.job_id
                    ? "Requesting stop…"
                    : "Stop this run"}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
      {truncated && <p className="muted small">Showing 20 current runs.</p>}
    </Band>
  );
}

/** Scoped page updates are reviewed in their page, never through a chat decision. */
export function PageWork({
  runs,
  truncated,
  onOpenPage,
  onRefresh,
}: {
  runs: NonNullable<AssistantProfile["page_runs"]>;
  truncated?: boolean;
  onOpenPage: (id: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const confirm = useConfirm();
  const owned = useOwned();
  const lock = useRef(false);
  const latest = useRef(runs);
  latest.current = runs;
  const [stopping, setStopping] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const stop = async (id: string) => {
    if (lock.current || !owned()) return;
    lock.current = true;
    setStopping(id);
    try {
      const yes = await confirm({
        title: "Stop this page run?",
        body: "Stops this run and discards its unapplied proposal. The routine schedule and changes already saved are kept.",
        action: "Stop run",
        danger: true,
      });
      if (!yes || !owned()) return;
      const run = latest.current.find(
        (one) =>
          one.id === id && ["queued", "running", "waiting"].includes(one.state),
      );
      if (!run) return;
      setError("");
      const result = await client.stopPageMaintenanceRun(run.doc_id, run.id);
      if (!owned()) return;
      setNotice(
        result.stopped
          ? "This run was stopped. Its schedule is unchanged."
          : "The run already ended. Its saved result is unchanged.",
      );
      await onRefresh();
    } catch {
      if (owned())
        setError(
          "Couldn't confirm the stop. Refresh page work before trying again.",
        );
    } finally {
      lock.current = false;
      if (owned()) setStopping(null);
    }
  };
  if (!runs.length) return null;
  const active = runs.filter(
    (run) => !["done", "cancelled"].includes(run.state),
  );
  const finished = runs.filter((run) => !active.includes(run));
  const row = (run: AssistantPageReviewRun) => (
    <article key={run.id}>
      <div className="agents-row-main">
        <h3 dir="auto">{run.title}</h3>
        <div className="agents-row-meta">
          <Pill>
            {run.work_kind === "comment_reply"
              ? "Comment reply"
              : "Page update"}
          </Pill>
          <span className="small">{assistantPageReviewStateLabel(run)}</span>
          <Time at={run.updated_at} />
        </div>
      </div>
      <div className="agents-buttons">
        <Button onClick={() => owned() && onOpenPage(run.doc_id)}>
          {run.state === "waiting" ? "Review in page" : "Open page"}
        </Button>
        {["queued", "running", "waiting"].includes(run.state) && (
          <Button
            variant="ghost"
            disabled={!!stopping}
            onClick={() => void stop(run.id)}
          >
            {stopping === run.id ? "Stopping…" : "Stop this page run"}
          </Button>
        )}
      </div>
    </article>
  );
  return (
    <Band title="Page work">
      {error && <ErrorNotice message={error} />}
      {notice && (
        <p className="small" role="status">
          {notice}
        </p>
      )}
      <div className="agents-rows">{active.map(row)}</div>
      {finished.length > 0 && (
        <More summary={`Finished page work · latest ${finished.length}`}>
          <div className="agents-rows">{finished.map(row)}</div>
        </More>
      )}
      {truncated && (
        <p className="muted small">
          More page runs are available in each page's update history.
        </p>
      )}
    </Band>
  );
}

/** Evidence first; the transcript and a follow-up are optional. */
export function ResultRow({
  output,
  lane,
  onOpenChat,
}: {
  output: Output;
  lane: Lane;
  onOpenChat: (id: string) => void;
}) {
  const receipt = output.execution_outcome;
  const status = runWords({ state: output.state ?? "done", outcome: receipt });
  return (
    <article>
      <div className="agents-row-main">
        <h3 dir="auto">{output.title || "Untitled result"}</h3>
        <div className="agents-row-meta">
          <Pill tone={status.tone}>{status.text}</Pill>
          <Time at={output.completed_at} />
        </div>
        {output.summary && (
          <p className="agents-clip" dir="auto">
            {output.summary}
          </p>
        )}
        {receipt && <Evidence receipt={receipt} />}
        <More summary="Continue this work">
          <Handoff
            jobId={output.job_id}
            title={output.title}
            lane={lane}
            existing={output.handoff}
            onOpenChat={onOpenChat}
          />
        </More>
      </div>
      <div className="agents-buttons">
        <Button onClick={() => onOpenChat(output.chat_id)}>
          {receipt?.outcome === "waiting" ? "Review decision" : "Open result"}
        </Button>
      </div>
    </article>
  );
}

export function ActivityLog({
  profile,
  observedAt,
}: {
  profile: AssistantProfile;
  observedAt: string;
}) {
  return (
    <Band
      title="Runtime activity"
      aside={
        <span className="muted small">
          Observed {new Date(observedAt).toLocaleString()}
        </span>
      }
    >
      {profile.recent_activity.length === 0 ? (
        <p className="muted">No recent activity</p>
      ) : (
        <ul className="agents-log">
          {profile.recent_activity.map((event) => (
            <li key={event.sequence}>
              <span>{ASSISTANT_ACTIVITY_LABELS[event.kind]}</span>
              <Time at={event.created_at} />
            </li>
          ))}
        </ul>
      )}
    </Band>
  );
}
