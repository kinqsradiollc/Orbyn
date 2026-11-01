import { navigate, useTitle } from "../../lib/router";
import { Button, ErrorNotice, Loading } from "../../ui/kit";
import { LaneHead } from "../agents-shared/LaneHead";
import { Band, Check, More } from "../agents-shared/parts";
import {
  useControls,
  useOwned,
  useOwner,
  useProfiles,
} from "../agents-shared/hooks";
import {
  ActivityLog,
  CurrentWork,
  PageWork,
  ResultRow,
} from "../agents-shared/work";
import "./background.css";

export default function BackgroundScreen() {
  const owner = useOwner();
  useTitle("Background");
  return <Background key={owner} />;
}

function Background() {
  const owned = useOwned();
  const profiles = useProfiles();
  const controls = useControls(true);
  const profile = profiles.data?.profiles.find(
    (one) => one.lane === "background",
  );
  const openChat = (id: string) => {
    if (owned()) navigate(`/app/assistant?chat=${encodeURIComponent(id)}`);
  };
  const openPage = (id: string) => {
    if (owned()) navigate(`/app/doc/${encodeURIComponent(id)}`);
  };
  const review =
    profile?.outputs.filter(
      (one) =>
        one.review_pending ||
        one.state === "failed" ||
        (one.execution_outcome &&
          ["partial", "waiting", "failed", "interrupted", "uncertain"].includes(
            one.execution_outcome.outcome,
          )),
    ) ?? [];
  const finished =
    profile?.outputs.filter((one) => !review.includes(one)) ?? [];
  return (
    <div className="background-screen">
      <LaneHead
        lane="background"
        profiles={profiles.data}
        title="Background"
        sub={
          <p className="muted">Current work, saved outcomes and follow-ups</p>
        }
        onChanged={() => void profiles.refresh()}
        actions={
          <Button
            disabled={profiles.loading}
            onClick={() => void profiles.refresh()}
          >
            Refresh Background
          </Button>
        }
      />
      {profiles.error && (
        <ErrorNotice
          message="Background couldn't be loaded. No previous work snapshot is being used for decisions."
          onRetry={() => void profiles.refresh()}
        />
      )}
      {!profiles.data && !profiles.error && (
        <Loading label="Loading Background" />
      )}
      <Band title="Work controls">
        {controls.deliveryError && (
          <ErrorNotice
            message={controls.deliveryError}
            onRetry={() => void controls.refreshDelivery()}
          />
        )}
        {controls.deliveryAvailable === false && (
          <p className="small muted">
            Conversation notifications are unavailable on this server.
          </p>
        )}
        {controls.state.error ? (
          <ErrorNotice
            message="Couldn't confirm saved work controls. Refresh before changing them."
            onRetry={() => void controls.refresh()}
          />
        ) : !controls.state.data ? (
          <Loading label="Loading work controls" />
        ) : (
          <>
            <Check
              label="Pause new Background work"
              checked={controls.state.data.background_paused}
              disabled={controls.state.busy}
              onChange={(event) => {
                if (owned())
                  void controls.set("background_paused", event.target.checked);
              }}
            />
            {controls.deliveryAvailable === true && (
              <Check
                label="Mute assistant conversation notifications"
                checked={controls.state.data.muted}
                disabled={controls.state.busy}
                onChange={(event) => {
                  if (owned()) void controls.set("muted", event.target.checked);
                }}
              />
            )}
            <p className="small muted">
              Pausing prevents new admissions. Running work continues until you
              stop it. Muting changes notifications only.
            </p>
          </>
        )}
      </Band>
      {profile && (
        <>
          <CurrentWork
            work={profile.work ?? []}
            truncated={profile.work_truncated}
            onOpenChat={openChat}
            onRefresh={profiles.refresh}
          />
          <PageWork
            runs={profile.page_runs ?? []}
            truncated={profile.page_runs_truncated}
            onOpenPage={openPage}
            onRefresh={profiles.refresh}
          />
          <Band
            title="Review outcomes"
            aside={
              <Button
                variant="ghost"
                onClick={() => owned() && navigate("/app/review")}
              >
                Open Review inbox
              </Button>
            }
          >
            {review.length ? (
              <div className="agents-rows">
                {review.map((output) => (
                  <ResultRow
                    key={output.job_id}
                    output={output}
                    lane="background"
                    onOpenChat={openChat}
                  />
                ))}
              </div>
            ) : (
              <p className="muted">
                No outcomes need review in the latest saved results.
              </p>
            )}
            {!profile.outputs.length && (
              <p>
                No saved results yet. Background results appear here after
                admitted work finishes.
              </p>
            )}
            {finished.length > 0 && (
              <More summary={`Finished results (${finished.length})`}>
                <div className="agents-rows">
                  {finished.map((output) => (
                    <ResultRow
                      key={output.job_id}
                      output={output}
                      lane="background"
                      onOpenChat={openChat}
                    />
                  ))}
                </div>
              </More>
            )}
            {profile.outputs_truncated && (
              <p className="small muted">
                This is the latest output window. Open Assistant for the
                retained work history.
              </p>
            )}
          </Band>
          <Band title="Worker observations">
            <p>
              {profile.runtime.reporting
                ? "The worker is reporting."
                : "Worker heartbeat unavailable. Queued work is not proof of an active worker."}
            </p>
            <dl className="background-observations">
              <div>
                <dt>Last heartbeat</dt>
                <dd>
                  {profile.runtime.last_seen_at
                    ? new Date(profile.runtime.last_seen_at).toLocaleString()
                    : "Not observed"}
                </dd>
              </div>
              <div>
                <dt>Last activity</dt>
                <dd>
                  {profile.last_activity_at
                    ? new Date(profile.last_activity_at).toLocaleString()
                    : "Not observed"}
                </dd>
              </div>
            </dl>
          </Band>
          {profiles.data && (
            <ActivityLog
              profile={profile}
              observedAt={profiles.data.observed_at}
            />
          )}
        </>
      )}
    </div>
  );
}
