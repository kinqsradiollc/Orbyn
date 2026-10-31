import type { AssistantProfile, AssistantProfiles } from "@orbyn/core";
import { MoreHorizontal } from "lucide-react";
import { useState, type ReactNode } from "react";
import { IconButton, Menu, Pill } from "../../ui/kit";
import { Character } from "./Character";
import { LANE_NAME, type Lane } from "./hooks";
import { IdentityDialog } from "./IdentityDialog";
import { LimitsDialog } from "./LimitsDialog";
import { ScheduleDialog } from "./ScheduleDialog";

const STATE: Record<AssistantProfile["state"], string> = {
  idle: "Idle",
  queued: "Queued",
  working: "Working",
  waiting: "Waiting for you",
  scheduled: "Scheduled",
};

const counts = (profile: AssistantProfile) =>
  [
    profile.counts.working > 0 && `${profile.counts.working} working`,
    profile.counts.waiting > 0 && `${profile.counts.waiting} waiting`,
    profile.counts.queued > 0 && `${profile.counts.queued} queued`,
    profile.counts.recovering > 0 && `${profile.counts.recovering} recovering`,
  ]
    .filter(Boolean)
    .join(" · ");

/** A worker's identity and factual state. An idle character never implies work. */
export function LaneHead({
  lane,
  profiles,
  title,
  sub,
  actions,
  onChanged,
}: {
  lane: Lane;
  profiles: AssistantProfiles | null;
  title: string;
  sub?: ReactNode;
  actions?: ReactNode;
  onChanged: () => void;
}) {
  const profile = profiles?.profiles.find((one) => one.lane === lane);
  const [dialog, setDialog] = useState<
    "identity" | "limits" | "schedule" | null
  >(null);
  const name = profile?.identity?.name ?? LANE_NAME[lane];
  const recovering =
    profile?.state === "queued" &&
    profile.counts.recovering > 0 &&
    profile.counts.queued === 0;
  const close = () => {
    setDialog(null);
    onChanged();
  };
  return (
    <header className="agents-head">
      {profile && (
        <Character
          appearance={profile.identity?.character}
          name={name}
          state={
            profile.state === "working"
              ? "working"
              : profile.state === "waiting"
                ? "waiting"
                : "ready"
          }
          size={56}
        />
      )}
      <div className="agents-head-text">
        <h1 dir="auto">{title}</h1>
        <div className="agents-row-meta">
          {name !== LANE_NAME[lane] && (
            <span className="small" dir="auto">
              {name}
            </span>
          )}
          {profile && (
            <Pill
              tone={
                profile.state === "working"
                  ? "blue"
                  : profile.state === "waiting"
                    ? "amber"
                    : undefined
              }
            >
              {recovering ? "Recovery pending" : STATE[profile.state]}
            </Pill>
          )}
          {profile && counts(profile) && (
            <span className="small muted">{counts(profile)}</span>
          )}
          {profile && !profile.runtime.reporting && (
            <span className="small muted" role="status">
              Worker heartbeat unavailable
            </span>
          )}
        </div>
        {sub}
        {profile?.window && (
          <p className="muted small">
            {profile.window.enabled
              ? `Night shift ${profile.window.start}–${profile.window.end} · ${profile.window.timezone}`
              : "Night shift is off"}
            {profile.window.next_start_at &&
              ` · Next window ${new Date(profile.window.next_start_at).toLocaleString()}`}
          </p>
        )}
        {profile?.budget && (
          <p className="muted small">
            Night estimate {profile.budget.estimated_tokens.toLocaleString()} /{" "}
            {profile.budget.limit_tokens.toLocaleString()} tokens
          </p>
        )}
      </div>
      <div className="agents-buttons">
        {actions}
        <Menu
          label={`${LANE_NAME[lane]} options`}
          trigger={(open, expanded) => (
            <IconButton
              label={`${LANE_NAME[lane]} options`}
              aria-expanded={expanded}
              onClick={open}
            >
              <MoreHorizontal />
            </IconButton>
          )}
        >
          {(done) => (
            <>
              <button
                onClick={() => {
                  done();
                  setDialog("identity");
                }}
              >
                Name and character
              </button>
              {lane === "overnight" && (
                <button
                  onClick={() => {
                    done();
                    setDialog("schedule");
                  }}
                >
                  Overnight schedule
                </button>
              )}
              <button
                onClick={() => {
                  done();
                  setDialog("limits");
                }}
              >
                Work limits
              </button>
            </>
          )}
        </Menu>
      </div>
      {dialog === "identity" && <IdentityDialog lane={lane} onClose={close} />}
      {dialog === "limits" && <LimitsDialog lane={lane} onClose={close} />}
      {dialog === "schedule" && (
        <ScheduleDialog onClose={() => setDialog(null)} onSaved={onChanged} />
      )}
    </header>
  );
}
