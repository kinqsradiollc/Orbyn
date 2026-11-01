import { useCallback, useState } from "react";
import { client } from "../../../lib/session";
import { Button, ErrorNotice, Loading } from "../../../ui/kit";
import { IdentityDialog } from "../../agents-shared/IdentityDialog";
import { LimitsDialog } from "../../agents-shared/LimitsDialog";
import { ScheduleDialog } from "../../agents-shared/ScheduleDialog";
import { type AgentEditorState, type Lane } from "../../agents-shared/hooks";
import {
  SettingsSection,
  useSettingsExit,
  useSettingsOwner,
  useSettingsRead,
} from "../shared";
import { AutomationOverview } from "./Overview";
import { AutomationContext } from "./Context";
import { AutomationRules } from "./Rules";
import { AutomationReminders } from "./Reminders";
import "./automation.css";
const clear: AgentEditorState = {
  dirty: false,
  pending: false,
  uncertain: false,
};
type Editor =
  { kind: "identity" | "limits"; lane: Lane } | { kind: "schedule" };
export function AutomationSettings() {
  const owned = useSettingsOwner(),
    background = useSettingsRead(() =>
      client.automationAgentIdentity("background"),
    ),
    overnight = useSettingsRead(() =>
      client.automationAgentIdentity("overnight"),
    ),
    budgets = useSettingsRead(() => client.assistantBudgets()),
    schedule = useSettingsRead(() => client.nightShiftSettings());
  const [editor, setEditor] = useState<Editor | null>(null),
    [state, setState] = useState(clear);
  const report = useCallback(
    (next: AgentEditorState) =>
      setState((before) =>
        before.dirty === next.dirty &&
        before.pending === next.pending &&
        before.uncertain === next.uncertain
          ? before
          : next,
      ),
    [],
  );
  useSettingsExit({
    dirty: state.dirty,
    pending: state.pending,
    sensitive: state.uncertain,
    message: state.uncertain
      ? "Check the unconfirmed agent settings before leaving."
      : undefined,
  });
  const open = (next: Editor) => {
    if (owned() && !editor && !state.pending && !state.uncertain) {
      setState(clear);
      setEditor(next);
    }
  };
  const close = () => {
    if (owned()) {
      setEditor(null);
      setState(clear);
    }
  };
  const saved = () => {
    if (!owned()) return;
    void background.reload();
    void overnight.reload();
    void budgets.reload();
    void schedule.reload();
  };
  return (
    <div className="settings-automation">
      <AutomationOverview />
      <SettingsSection
        title="Background & overnight"
        description="Each runtime has its own name, communication style and appearance."
      >
        <div className="settings-automation-overview">
          {(
            [
              { lane: "background", read: background },
              { lane: "overnight", read: overnight },
            ] as const
          ).map(({ lane, read }) => (
            <article key={lane}>
              <h4>{lane === "background" ? "Background" : "Overnight"}</h4>
              {read.loading && !read.data && (
                <Loading label={`Loading ${lane} profile`} />
              )}{" "}
              {read.error && (
                <ErrorNotice
                  message={read.error}
                  onRetry={() => void read.reload()}
                />
              )}
              {read.data && (
                <>
                  <strong dir="auto">{read.data.name}</strong>
                  <p className="settings-automation-verbatim" dir="auto">
                    {read.data.persona || "No communication style set"}
                  </p>
                </>
              )}
              <Button
                disabled={!!editor}
                onClick={() => open({ kind: "identity", lane })}
              >
                Edit {lane} identity
              </Button>
            </article>
          ))}
        </div>
      </SettingsSection>
      <SettingsSection
        title="Work limits"
        description="Estimated tokens and work starts for Orbyn's Background and Overnight agents; provider billing is separate."
      >
        {budgets.loading && !budgets.data && (
          <Loading label="Loading work limits" />
        )}
        {budgets.error && (
          <ErrorNotice
            message={budgets.error}
            onRetry={() => void budgets.reload()}
          />
        )}
        <div className="settings-automation-overview">
          {(["background", "overnight"] as const).map((lane) => (
            <article key={lane}>
              <h4>{lane === "background" ? "Background" : "Overnight"}</h4>
              {budgets.data && (
                <>
                  <p>
                    {budgets.data[lane].estimated_tokens.toLocaleString()} /{" "}
                    {budgets.data[lane].daily_token_limit.toLocaleString()}{" "}
                    estimated tokens today
                  </p>
                  <p>
                    {budgets.data[lane].starts_last_hour} /{" "}
                    {budgets.data[lane].hourly_start_limit} starts in the last
                    hour
                  </p>
                  <p className="small muted">
                    {budgets.data[lane].per_run_token_limit.toLocaleString()}{" "}
                    tokens per run ·{" "}
                    {budgets.data[lane].active_reserved_tokens.toLocaleString()}{" "}
                    currently reserved
                  </p>
                </>
              )}
              <Button
                disabled={!!editor}
                onClick={() => open({ kind: "limits", lane })}
              >
                Edit {lane} limits
              </Button>
            </article>
          ))}
        </div>
      </SettingsSection>
      <SettingsSection
        title="Overnight schedule"
        description="An optional overnight work window, allowed work and morning review."
      >
        {schedule.loading && !schedule.data && (
          <Loading label="Loading overnight schedule" />
        )}
        {schedule.error && (
          <ErrorNotice
            message={schedule.error}
            onRetry={() => void schedule.reload()}
          />
        )}{" "}
        {schedule.data && (
          <>
            <p>
              {schedule.data.enabled ? "On" : "Off"} · {schedule.data.start}–
              {schedule.data.end} · {schedule.data.timezone}
            </p>
            <p className="small muted">
              {schedule.data.wait_for_ok
                ? "Waits for your OK in the morning"
                : "Ordinary permitted changes may run automatically"}
              . Deletes, publishing, messages and permission requests still wait
              in Review.
            </p>
          </>
        )}
        <Button disabled={!!editor} onClick={() => open({ kind: "schedule" })}>
          Edit overnight schedule
        </Button>
      </SettingsSection>
      <AutomationReminders />
      <AutomationContext />
      <AutomationRules />
      {editor?.kind === "identity" && (
        <IdentityDialog
          key={`identity:${editor.lane}`}
          lane={editor.lane}
          onClose={close}
          onSaved={saved}
          onStateChange={report}
        />
      )}
      {editor?.kind === "limits" && (
        <LimitsDialog
          key={`limits:${editor.lane}`}
          lane={editor.lane}
          onClose={close}
          onSaved={saved}
          onStateChange={report}
        />
      )}
      {editor?.kind === "schedule" && (
        <ScheduleDialog
          onClose={close}
          onSaved={saved}
          onStateChange={report}
        />
      )}
    </div>
  );
}
