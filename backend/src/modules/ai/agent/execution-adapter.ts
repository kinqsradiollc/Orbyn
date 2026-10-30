/**
 * External execution protocol. No transport or scheduler is registered here.
 * Open Duet stays disabled until an isolated worker passes every qualification gate.
 */
export const OPEN_DUET_ADMISSION = {
  enabled: false,
  reason:
    "Worker isolation, reconciliation, cancellation and effect qualification are required.",
} as const;

export type ExternalAttempt = {
  jobId: string;
  attemptId: string;
  ownerId: string;
  generation: number;
  phase:
    | "intent"
    | "dispatching"
    | "uncertain"
    | "running"
    | "cancel_requested"
    | "stopped"
    | "finished"
    | "failed"
    | "not_started";
  externalId: string | null;
  cursor: number;
  eventIds: string[];
  effectIds: string[];
};
export type ExternalEvent = {
  id: string;
  generation: number;
  sequence: number;
} & (
  | { kind: "dispatch" }
  | { kind: "accepted"; externalId: string }
  | { kind: "response_lost" }
  | { kind: "reconciled"; externalId: string }
  | { kind: "confirmed_not_started" }
  | { kind: "cancel_requested" }
  | { kind: "stopped" }
  | { kind: "finished" }
  | { kind: "failed" }
);

/** Caller persists the returned intent before dispatch; an HTTP 202 is admission only. */
export function executionIntent(
  input: Pick<
    ExternalAttempt,
    "jobId" | "attemptId" | "ownerId" | "generation"
  >,
): ExternalAttempt {
  if (
    !input.jobId ||
    !input.attemptId ||
    !input.ownerId ||
    !Number.isSafeInteger(input.generation) ||
    input.generation < 1
  )
    throw new Error(
      "A scoped job, attempt, owner and generation are required.",
    );
  return {
    ...input,
    phase: "intent",
    externalId: null,
    cursor: 0,
    eventIds: [],
    effectIds: [],
  };
}

/** Generation fencing and event identity never grant an effect permission. */
export function reconcileExecution(
  state: ExternalAttempt,
  event: ExternalEvent,
): ExternalAttempt {
  if (
    event.generation !== state.generation ||
    state.eventIds.includes(event.id) ||
    event.sequence <= state.cursor
  )
    return state;
  if (!event.id || !Number.isSafeInteger(event.sequence) || event.sequence < 1)
    throw new Error("Invalid event identity.");
  const terminal = ["stopped", "finished", "failed", "not_started"].includes(
    state.phase,
  );
  if (terminal) return state;
  let phase = state.phase,
    externalId = state.externalId;
  switch (event.kind) {
    case "dispatch":
      if (state.phase !== "intent")
        throw new Error(
          "An uncertain or admitted execution cannot be redispatched.",
        );
      phase = "dispatching";
      break;
    case "response_lost":
      if (state.phase !== "dispatching")
        throw new Error("Only a pending dispatch can become uncertain.");
      phase = "uncertain";
      break;
    case "accepted":
    case "reconciled":
      if (!event.externalId || (externalId && externalId !== event.externalId))
        throw new Error("Conflicting external execution identity.");
      if (
        !["dispatching", "uncertain", "cancel_requested", "running"].includes(
          state.phase,
        )
      )
        throw new Error("No dispatched intent to reconcile.");
      externalId = event.externalId;
      phase =
        state.phase === "cancel_requested" ? "cancel_requested" : "running";
      break;
    case "confirmed_not_started":
      if (!["dispatching", "uncertain"].includes(state.phase) || externalId)
        throw new Error(
          "An admitted execution cannot be treated as not started.",
        );
      phase = "not_started";
      break;
    case "cancel_requested":
      phase = "cancel_requested";
      break;
    case "stopped":
      if (state.phase !== "cancel_requested")
        throw new Error("Stop confirmation needs a cancellation request.");
      phase = "stopped";
      break;
    case "finished":
      // A late finish cannot turn a requested cancellation into an applicable result.
      if (state.phase === "cancel_requested") return state;
      if (state.phase !== "running" || !externalId)
        throw new Error("Completion needs reconciled admission.");
      phase = "finished";
      break;
    case "failed":
      phase = "failed";
      break;
  }
  return {
    ...state,
    phase,
    externalId,
    cursor: event.sequence,
    eventIds: [...state.eventIds, event.id],
  };
}
export type AdapterQualification = {
  isolation: boolean;
  reconciliation: boolean;
  cancellation: boolean;
  outcomes: boolean;
};

/** This only admits an effect to the existing authorization/version gateway; it does not apply one. */
export function canAdmitExternalEffect(
  state: ExternalAttempt,
  input: {
    effectId: string;
    ownerId: string;
    generation: number;
    qualified: AdapterQualification;
    currentAccess: boolean;
    currentSources: boolean;
    preauthorized: boolean;
  },
): boolean {
  return (
    Object.values(input.qualified).every(Boolean) &&
    state.phase === "finished" &&
    !!state.externalId &&
    state.ownerId === input.ownerId &&
    state.generation === input.generation &&
    input.currentAccess &&
    input.currentSources &&
    input.preauthorized &&
    !!input.effectId &&
    !state.effectIds.includes(input.effectId)
  );
}
