/** Independent provider capacity; background work cannot consume chat's slots. */
export const ASSISTANT_RUNTIME_CAPACITY = {
  interactive: 4,
  background: 2,
  overnight: 2,
} as const;

export type AssistantRuntimeLane = keyof typeof ASSISTANT_RUNTIME_CAPACITY;

let processLane: AssistantRuntimeLane | null = null;
let runners = 0;

/** A process can host replicas of one runtime, never different runtime lanes. */
export function acquireAssistantRuntime(
  lane: AssistantRuntimeLane,
): () => void {
  if (!Object.hasOwn(ASSISTANT_RUNTIME_CAPACITY, lane))
    throw new Error("Unknown assistant runtime lane.");
  if (processLane && processLane !== lane)
    throw new Error(
      `This process already runs the ${processLane} assistant runtime.`,
    );
  processLane = lane;
  runners++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--runners === 0) processLane = null;
  };
}
