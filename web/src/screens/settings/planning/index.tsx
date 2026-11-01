import { useCallback, useState } from "react";
import { client } from "../../../lib/session";
import { ErrorNotice, Loading } from "../../../ui/kit";
import {
  FramesPanel,
  HabitsPanel,
  type RoutineEditorState,
} from "../../calendar/ManageRoutines";
import { refreshPlanner } from "../../shared-task";
import {
  SettingsSection,
  useSettingsExit,
  useSettingsOwner,
  useSettingsRead,
} from "../shared";
import { PlanningPreferences } from "./Preferences";
import { PlanningPlaces } from "./Places";
import { PlanningInsights } from "./Insights";
import "../../calendar/calendar.css";
import "./planning.css";

const clear: RoutineEditorState = {
  dirty: false,
  pending: false,
  uncertain: false,
};
export function PlanningSettings() {
  const owned = useSettingsOwner();
  const catalog = useSettingsRead(async () => {
    const [lists, tags, teams] = await Promise.all([
      client.listLists(),
      client.listTags(),
      client.listTeams(),
    ]);
    return { lists, tags, teams };
  });
  const [frames, setFrames] = useState(clear),
    [habits, setHabits] = useState(clear),
    [refreshError, setRefreshError] = useState("");
  const reportFrames = useCallback(
    (next: RoutineEditorState) =>
      setFrames((old) =>
        old.dirty === next.dirty &&
        old.pending === next.pending &&
        old.uncertain === next.uncertain
          ? old
          : next,
      ),
    [],
  );
  const reportHabits = useCallback(
    (next: RoutineEditorState) =>
      setHabits((old) =>
        old.dirty === next.dirty &&
        old.pending === next.pending &&
        old.uncertain === next.uncertain
          ? old
          : next,
      ),
    [],
  );
  useSettingsExit({
    dirty: frames.dirty || habits.dirty,
    pending: frames.pending || habits.pending,
    sensitive: frames.uncertain || habits.uncertain,
    message:
      frames.uncertain || habits.uncertain
        ? "Resolve the unconfirmed frame or habit change before leaving."
        : undefined,
  });
  const changed = useCallback(() => {
    if (!owned()) return;
    void refreshPlanner(true).then(
      () => {
        if (owned()) setRefreshError("");
      },
      () => {
        if (owned())
          setRefreshError(
            "The change is saved. Calendar could not be refreshed.",
          );
      },
    );
  }, [owned]);
  return (
    <div className="settings-planning">
      <PlanningPreferences />
      <SettingsSection
        title="Frames"
        description="Recurring windows reserved for a kind of work."
      >
        {catalog.loading && !catalog.data && (
          <Loading label="Loading frame choices" />
        )}
        {catalog.error && (
          <ErrorNotice
            message={catalog.error}
            onRetry={() => void catalog.reload()}
          />
        )}
        {catalog.data && catalog.fresh && (
          <FramesPanel
            workspace={catalog.data}
            onChanged={changed}
            onStateChange={reportFrames}
          />
        )}
      </SettingsSection>
      <PlanningPlaces />
      <SettingsSection
        title="Habits"
        description="Flexible routines fitted around your calendar."
      >
        <HabitsPanel onChanged={changed} onStateChange={reportHabits} />
      </SettingsSection>
      {refreshError && <ErrorNotice message={refreshError} onRetry={changed} />}
      <PlanningInsights />
    </div>
  );
}
