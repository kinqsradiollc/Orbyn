import { z } from "zod";
import type { HttpError } from "@orbyn/core";
import type { ProviderError } from "../providers/adapters.js";

const terminalCause = z.enum([
  "finished",
  "stopped",
  "deadline",
  "waiting_expired",
  "worker_interrupted",
  "recovery_exhausted",
  "provider_transient",
  "provider_configuration",
  "provider_dispatch_uncertain",
  "authority_changed",
  "runtime_failure",
]);
export type TerminalCause = z.output<typeof terminalCause>;

type Effects = "none" | "applied" | "pending" | "uncertain";
type Retry = "eligible" | "never" | "reconcile";

function retryFor(cause: TerminalCause, effects: Effects): Retry {
  if (effects === "uncertain" || cause === "provider_dispatch_uncertain")
    return "reconcile";
  return cause === "provider_transient" && effects === "none"
    ? "eligible"
    : "never";
}

/** Server-owned qualification only; this is neither an API nor a retry command. */
export const terminalEvidence = z
  .object({
    version: z.literal(1),
    job_id: z.uuid(),
    cause: terminalCause,
    effects: z.enum(["none", "applied", "pending", "uncertain"]),
    retry: z.enum(["eligible", "never", "reconcile"]),
    observed_at: z.iso.datetime(),
  })
  .strict()
  .refine(
    (value) =>
      value.retry === "reconcile" ||
      value.retry === retryFor(value.cause, value.effects),
    {
      message:
        "Retry qualification must match terminal cause and effect evidence.",
    },
  );
export type TerminalEvidence = z.output<typeof terminalEvidence>;

/** Normalize actual typed errors at the caller's catch boundary, never from prose. */
export type TerminalErrorContext =
  | { kind: "provider"; reason: ProviderError["reason"] }
  | { kind: "paused" }
  | { kind: "http"; statusCode: HttpError["statusCode"] }
  | { kind: "runtime" };

export type TerminalEffectContext = {
  mode: "live" | "reconcile";
  apply_result?: unknown;
  /** Trusted SQL proof for this exact attempt: acknowledged rollback before COMMIT,
   * current tracking version, matching marker and no stored apply receipt.
   * Never derive this from model output, an exception or mere receipt absence. */
  confirmedRollback?: boolean;
  /** Live attempt knowledge, not an inference from missing persisted receipts. */
  applyStarted?: boolean;
  /** Caller has observed the original execution and can prove no write occurred. */
  originalKnownNoWrite?: boolean;
};

export type TerminalEvidenceInput = {
  job_id: string;
  cause?: TerminalCause;
  error?: TerminalErrorContext;
  effects: TerminalEffectContext;
  observed_at: string;
};

// Mirrors the existing apply_plan output and ai_jobs.apply_result wrapper without
// importing the capability registry, pool, environment or a provider transport.
const step = z
  .object({
    id: z.string(),
    tool: z.string(),
    done: z.array(
      z
        .object({
          id: z.string(),
          title: z.string(),
          url: z.string(),
          app_url: z.string(),
          change: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
const pending = z
  .object({
    status: z.literal("pending_review"),
    proposal_id: z.string().min(1),
    review_url: z.string(),
    expires_at: z.string(),
    changes: z.number().int().nonnegative(),
  })
  .strict();
export const storedAssistantApplyResult = z
  .object({
    applied: z.boolean(),
    structured: z
      .object({
        status: z.enum(["done", "pending_review"]),
        job: z.string().min(1).nullable(),
        steps: z.array(step),
        pending: pending.nullable(),
      })
      .strict()
      .nullable(),
    why: z.array(z.string()),
  })
  .strict();

export function classifyAssistantEffects(
  context: TerminalEffectContext,
): Effects {
  // A malformed receipt is evidence of an unknown state, even during a live run.
  if (context.apply_result !== null && context.apply_result !== undefined) {
    const parsed = storedAssistantApplyResult.safeParse(context.apply_result);
    if (!parsed.success) return "uncertain";
    const receipt = parsed.data;
    const result = receipt.structured;
    if (receipt.applied)
      return result?.status === "done" && result.pending === null && result.job
        ? "applied"
        : "uncertain";
    if (
      result?.status === "pending_review" &&
      result.job &&
      result.pending &&
      result.steps.every((item) => item.done.length === 0)
    )
      return "pending";
    // No durable writer currently emits a conclusive negative receipt. In
    // particular applied=false alone cannot establish absence of a prior effect.
    return "uncertain";
  }
  if (context.confirmedRollback === true) return "none";
  if (
    context.mode === "live" &&
    context.applyStarted === false &&
    context.originalKnownNoWrite === true
  )
    return "none";
  return "uncertain";
}

/** Durable receipts alone cannot prove no effects; legacy/missing stays uncertain. */
export function readStoredAssistantApplyEffect(
  value: unknown,
): "applied" | "pending" | "uncertain" {
  const effects = classifyAssistantEffects({
    mode: "reconcile",
    apply_result: value,
  });
  return effects === "none" ? "uncertain" : effects;
}

const transientReasons = new Set([
  "http_429",
  "http_500",
  "http_502",
  "http_503",
  "http_504",
]);
const configurationReasons = new Set([
  "configuration",
  "unsupported",
  "unsupported_model_controls",
  "invalid_limit",
  "redirect",
  "http_400",
  "http_401",
  "http_403",
  "http_404",
  "http_422",
  "chatgpt_unavailable",
  "chatgpt_model_unavailable",
  "fallback_unavailable",
  "chatgpt_eligibility",
  "chatgpt_usage_limit",
  "chatgpt_permission",
]);
const uncertainReasons = new Set([
  "network",
  "timeout",
  "chatgpt_timeout",
  "chatgpt_unknown",
  "chatgpt_interrupted",
  "chatgpt_device_offline",
]);

function errorCause(error?: TerminalErrorContext): TerminalCause {
  if (error?.kind === "paused") return "authority_changed";
  if (error?.kind === "http")
    return [401, 403].includes(error.statusCode)
      ? "authority_changed"
      : "runtime_failure";
  if (error?.kind !== "provider") return "runtime_failure";
  if (
    error.reason === "provider_changed" ||
    error.reason === "managed_authority_unverified"
  )
    return "authority_changed";
  if (uncertainReasons.has(error.reason)) return "provider_dispatch_uncertain";
  if (transientReasons.has(error.reason)) return "provider_transient";
  if (configurationReasons.has(error.reason)) return "provider_configuration";
  // New/unknown provider reasons cannot silently acquire retry authority.
  return "runtime_failure";
}

export function classifyTerminalEvidence(
  input: TerminalEvidenceInput,
): TerminalEvidence {
  const inferred = errorCause(input.error);
  let cause = input.cause ?? inferred;
  // Even an explicitly supplied transient cause needs a known typed provider reason.
  if (cause === "provider_transient" && inferred !== "provider_transient")
    cause = inferred;
  // Unknown dispatch cannot be erased by a concurrent stop/deadline observation.
  const effects = classifyAssistantEffects(input.effects);
  const retry =
    inferred === "provider_dispatch_uncertain"
      ? "reconcile"
      : retryFor(cause, effects);
  return terminalEvidence.parse({
    version: 1,
    job_id: input.job_id,
    cause,
    effects,
    retry,
    observed_at: input.observed_at,
  });
}

/** Legacy, malformed, inconsistent or foreign-job evidence remains unqualified. */
export function readTerminalEvidence(
  value: unknown,
  jobId: string,
): TerminalEvidence | undefined {
  const parsed = terminalEvidence.safeParse(value);
  return parsed.success && parsed.data.job_id === jobId
    ? parsed.data
    : undefined;
}
