import { isTimeZone } from "@orbyn/core";
import { refreshPlanner, usePlanning } from "../../screens/shared-task";

/** Calendar uses this same account planner preference, including its retained last confirmed value. */
export function useCalendarZone() {
  const planning = usePlanning();
  const value = planning.prefs?.timezone;
  const zone = typeof value === "string" && isTimeZone(value) ? value : null;
  return {
    zone,
    loading: !zone && planning.phase === "loading",
    error:
      !zone && planning.phase !== "loading"
        ? "Couldn't read your calendar time zone. Reload calendar preferences to use date commands."
        : "",
    reload: () => {
      void refreshPlanner(true).catch(() => undefined);
    },
  };
}
