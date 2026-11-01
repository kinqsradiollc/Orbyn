import { useState } from "react";
import type { ScreenProps } from "../../app/routes";
import { useNavigate, useTitle } from "../../lib/router";
import { client } from "../../lib/session";
import { Button, Empty, ErrorNotice, Loading } from "../../ui/kit";
import { LaneHead } from "../agents-shared/LaneHead";
import { ScheduleDialog } from "../agents-shared/ScheduleDialog";
import { useOwned, useOwner, useProfiles } from "../agents-shared/hooks";
import { Band, More } from "../agents-shared/parts";
import {
  ActivityLog,
  CurrentWork,
  PageWork,
  PauseLane,
} from "../agents-shared/work";
import { NightRun, hasChanges } from "./NightRun";
import { bulkRuns, useNight } from "./useNight";
import "./overnight.css";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default function OvernightScreen({ params }: ScreenProps) {
  const navigate = useNavigate();
  const owner = useOwner();
  useTitle("Overnight");
  let id = params.id;
  try {
    if (id) id = decodeURIComponent(id);
  } catch {
    return (
      <Empty title="This night address isn't valid">
        <Button onClick={() => navigate("/app/overnight")}>
          Open latest night
        </Button>
      </Empty>
    );
  }
  if (id && !uuid.test(id))
    return (
      <Empty title="This night address isn't valid">
        <Button onClick={() => navigate("/app/overnight")}>
          Open latest night
        </Button>
      </Empty>
    );
  return <Overnight key={`${owner}:${id ?? "latest"}`} nightId={id} />;
}
function Overnight({ nightId }: { nightId?: string }) {
  const navigate = useNavigate();
  const owned = useOwned(),
    profiles = useProfiles(),
    state = useNight(nightId);
  const [schedule, setSchedule] = useState(false),
    [historyLimit, setHistoryLimit] = useState(10);
  const profile = profiles.data?.profiles.find(
    (one) => one.lane === "overnight",
  );
  const night = state.night;
  const openChat = (id: string) => {
    if (owned()) navigate(`/app/assistant?chat=${encodeURIComponent(id)}`);
  };
  const openPage = (id: string) => {
    if (owned()) navigate(`/app/doc/${encodeURIComponent(id)}`);
  };
  const refreshAll = async () => {
    await state.refresh();
    if (owned()) await profiles.refresh();
  };
  const bulk = async (action: "keep" | "undo") => {
    if (!owned() || state.locked || !night) return;
    const reviewed = bulkRuns(night, action);
    if (!reviewed.length) return;
    await state.act({
      label: action === "keep" ? "Keep finished runs" : "Undo finished runs",
      destination: `/app/overnight/${encodeURIComponent(night.id)}`,
      matches: (current) =>
        current.id === night.id &&
        JSON.stringify(bulkRuns(current, action)) === JSON.stringify(reviewed),
      perform: () => client.reviewAssistantNight(night.id, action, reviewed),
      receipt: (value) =>
        !!value &&
        typeof value === "object" &&
        "id" in value &&
        value.id === night.id,
      confirm: {
        title:
          action === "keep" ? "Keep finished runs?" : "Undo finished runs?",
        body:
          action === "keep"
            ? "Keeps finished results and applies their held changes. Active work stays open."
            : "Declines held changes and restores applied changes where possible. Active work stays open.",
        action: action === "keep" ? "Keep all" : "Undo all",
        danger: action === "undo",
      },
    });
  };
  const needsReview =
    night?.runs.filter(
      (run) =>
        run.status !== "undone" &&
        (run.state === "waiting" ||
          run.state === "failed" ||
          run.question ||
          run.approval ||
          run.proposal?.status === "pending" ||
          (run.execution_outcome &&
            [
              "partial",
              "waiting",
              "failed",
              "interrupted",
              "uncertain",
            ].includes(run.execution_outcome.outcome))),
    ) ?? [];
  const working =
    night?.runs.filter(
      (run) =>
        !needsReview.includes(run) && ["queued", "running"].includes(run.state),
    ) ?? [];
  const history =
    night?.runs.filter(
      (run) => !needsReview.includes(run) && !working.includes(run),
    ) ?? [];
  const pageActive =
    night?.page_runs?.filter(
      (run) => !["done", "cancelled"].includes(run.state),
    ) ?? [];
  const pageHistory =
    night?.page_runs?.filter((run) =>
      ["done", "cancelled"].includes(run.state),
    ) ?? [];
  const renderPage = (
    run: NonNullable<NonNullable<typeof night>["page_runs"]>[number],
  ) => (
    <article className="night-page" key={run.id}>
      <div>
        <h3>Page update</h3>
        <p className="small muted">
          {run.state} · {run.estimated_tokens.toLocaleString()} estimated tokens
        </p>
      </div>
      <div className="agents-buttons">
        <Button onClick={() => openPage(run.doc_id)}>
          {run.state === "waiting" ? "Review in page" : "Open page"}
        </Button>
        {["queued", "running", "waiting"].includes(run.state) && (
          <Button
            disabled={state.locked}
            onClick={() => {
              if (!night || !owned()) return;
              void state.act({
                label: "Stop page run",
                destination: `/app/doc/${encodeURIComponent(run.doc_id)}`,
                matches: (current) =>
                  current.id === night.id &&
                  !!current.page_runs?.some(
                    (one) =>
                      one.id === run.id &&
                      one.doc_id === run.doc_id &&
                      ["queued", "running", "waiting"].includes(one.state),
                  ),
                perform: () =>
                  client.stopPageMaintenanceRun(run.doc_id, run.id),
                receipt: (value) =>
                  !!value &&
                  typeof value === "object" &&
                  "stopped" in value &&
                  typeof value.stopped === "boolean",
                reconcile: (current) =>
                  current.id === night.id &&
                  current.page_runs?.some(
                    (one) =>
                      one.id === run.id &&
                      one.doc_id === run.doc_id &&
                      one.binding_id === run.binding_id &&
                      one.state === "cancelled",
                  )
                    ? "This exact page occurrence is confirmed cancelled. Its routine schedule is unchanged."
                    : null,
                confirm: {
                  title: "Stop this page run?",
                  body: "Discards this run's unapplied proposal. Its schedule and changes already saved are kept.",
                  action: "Stop run",
                  danger: true,
                },
              });
            }}
          >
            Stop page run
          </Button>
        )}
      </div>
    </article>
  );
  const row = (run: NonNullable<typeof night>["runs"][number]) => (
    <NightRun
      key={run.id}
      run={run}
      nightId={night!.id}
      locked={state.locked}
      act={state.act}
    />
  );
  return (
    <div className="overnight-screen">
      <LaneHead
        lane="overnight"
        profiles={profiles.data}
        title="Overnight"
        sub={<p className="muted">Review night work and decide what to keep</p>}
        onChanged={() => void profiles.refresh()}
        actions={
          <Button
            disabled={state.busy || state.loading}
            onClick={() => void refreshAll()}
          >
            Refresh Overnight
          </Button>
        }
      />
      <div className="agents-buttons">
        {nightId && (
          <Button onClick={() => owned() && navigate("/app/overnight")}>
            Latest night
          </Button>
        )}
        {!nightId && night && (
          <Button
            variant="ghost"
            onClick={() =>
              owned() &&
              navigate(`/app/overnight/${encodeURIComponent(night.id)}`)
            }
          >
            Open saved night
          </Button>
        )}
        <Button variant="ghost" onClick={() => owned() && setSchedule(true)}>
          Overnight schedule
        </Button>
        <Button
          variant="ghost"
          onClick={() => owned() && navigate("/app/assistant?panel=upcoming")}
        >
          Upcoming tasks and routines
        </Button>
      </div>
      {profiles.error && (
        <ErrorNotice
          message="Couldn't load the worker profile. The saved night is loaded independently."
          onRetry={() => void profiles.refresh()}
        />
      )}
      <fieldset disabled={state.locked} className="night-fieldset">
        <PauseLane lane="overnight" />
      </fieldset>
      {state.loadError && (
        <ErrorNotice
          message={state.loadError}
          onRetry={() => void state.refresh()}
        />
      )}
      {state.actionError && <ErrorNotice message={state.actionError} />}
      {state.unknown && (
        <div className="night-uncertain">
          <p>
            This decision is kept here while its outcome is unknown. Checking
            reads the saved state and does not send the decision again.
          </p>
          <Button disabled={state.busy} onClick={() => void state.check()}>
            Check saved state
          </Button>
          {state.unknownDestination && (
            <a
              href={state.unknownDestination}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open saved work in another tab
            </a>
          )}
        </div>
      )}
      {state.notice && (
        <p className="small" role="status">
          {state.notice}
        </p>
      )}
      {!state.loaded && <Loading label="Loading saved night" />}
      {state.loaded && !night && !state.loadError && (
        <Empty
          title={
            nightId ? "This saved night isn't available" : "No night work yet"
          }
        >
          <p>
            {nightId
              ? "Open the latest night or check current access."
              : "Overnight is opt-in. Choose its schedule, or send a task to Tonight from Assistant."}
          </p>
          <div className="agents-buttons">
            <Button onClick={() => owned() && setSchedule(true)}>
              Choose overnight schedule
            </Button>
            <Button
              onClick={() =>
                owned() &&
                navigate("/app/assistant?ask=Plan%20a%20task%20for%20tonight")
              }
            >
              Draft a task for Tonight
            </Button>
          </div>
        </Empty>
      )}
      {night && (
        <>
          <Band
            title={night.local_day}
            aside={
              <span className="small muted">
                {night.status === "running"
                  ? "Night in progress"
                  : "Saved night summary"}
              </span>
            }
          >
            <p>
              {night.budget_used.toLocaleString()} estimated tokens used ·{" "}
              {needsReview.length} results to review · {working.length} active
              runs
            </p>
            <p className="small muted">
              Changes are reviewed separately from whether a run finished.
            </p>
            {night.runs.some(
              (run) =>
                hasChanges(run) &&
                ["done", "failed"].includes(run.state) &&
                run.status !== "undone",
            ) && (
              <More summary="Decide finished runs together">
                <div className="agents-buttons">
                  <Button
                    disabled={state.locked || !bulkRuns(night, "keep").length}
                    onClick={() => void bulk("keep")}
                  >
                    Keep all finished runs
                  </Button>
                  <Button
                    variant="danger"
                    disabled={state.locked || !bulkRuns(night, "undo").length}
                    onClick={() => void bulk("undo")}
                  >
                    Undo all finished runs
                  </Button>
                </div>
              </More>
            )}
          </Band>
          <Band title="Needs your review">
            {needsReview.length ? (
              <div className="night-results">{needsReview.map(row)}</div>
            ) : (
              <p>No night results need your decision.</p>
            )}
            {pageActive
              .filter(
                (run) => run.state === "waiting" || run.state === "failed",
              )
              .map(renderPage)}
          </Band>
          {(working.length > 0 ||
            pageActive.some(
              (run) => run.state !== "waiting" && run.state !== "failed",
            )) && (
            <Band title="Night work in progress">
              <div className="night-results">
                {working.map(row)}
                {pageActive
                  .filter(
                    (run) => run.state !== "waiting" && run.state !== "failed",
                  )
                  .map(renderPage)}
              </div>
            </Band>
          )}
          <Band title="Finished night work">
            <div className="night-results">
              {history.slice(0, historyLimit).map(row)}
              {pageHistory
                .slice(0, Math.max(0, historyLimit - history.length))
                .map(renderPage)}
            </div>
            {!history.length && !pageHistory.length && (
              <p>No finished night results yet.</p>
            )}
            {historyLimit < history.length + pageHistory.length && (
              <Button onClick={() => setHistoryLimit((limit) => limit + 10)}>
                Show 10 more results
              </Button>
            )}
          </Band>
          {night.not_done.length > 0 && (
            <Band title="Work left for later">
              <ul className="night-unfinished">
                {night.not_done.map((item, index) => (
                  <li key={index}>
                    <strong dir="auto">{item.title}</strong>
                    <p dir="auto">{item.reason}</p>
                  </li>
                ))}
              </ul>
            </Band>
          )}
        </>
      )}
      {profile && (
        <More summary="Overnight runtime and other admitted work">
          <fieldset disabled={state.locked} className="night-fieldset">
            <CurrentWork
              work={profile.work ?? []}
              truncated={profile.work_truncated}
              onOpenChat={openChat}
              onRefresh={refreshAll}
            />
            <PageWork
              runs={profile.page_runs ?? []}
              truncated={profile.page_runs_truncated}
              onOpenPage={openPage}
              onRefresh={refreshAll}
            />
          </fieldset>
          {profile.runtime.last_seen_at && (
            <p className="small muted">
              Last heartbeat:{" "}
              {new Date(profile.runtime.last_seen_at).toLocaleString()}
            </p>
          )}
          {profiles.data && (
            <ActivityLog
              profile={profile}
              observedAt={profiles.data.observed_at}
            />
          )}
        </More>
      )}
      {schedule && (
        <ScheduleDialog
          onClose={() => {
            if (owned()) setSchedule(false);
          }}
          onSaved={() => {
            if (owned()) void profiles.refresh();
          }}
        />
      )}
    </div>
  );
}
