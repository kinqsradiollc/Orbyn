import type { ReactNode } from "react";
import { PlanningContext, type Planning } from "./planning";
import { PlannedContext, type PlannedData } from "./planned";

/** Lists, tags, preferences and planned time, for every signed-in view. */
export function PlanningProviders({
  planning,
  planned,
  children,
}: {
  planning: Planning;
  planned: PlannedData;
  children: ReactNode;
}) {
  return (
    <PlanningContext.Provider value={planning}>
      <PlannedContext.Provider value={planned}>
        {children}
      </PlannedContext.Provider>
    </PlanningContext.Provider>
  );
}
