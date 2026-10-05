import { z } from "zod";
import { aiFeatureProvider } from "./ai-feature.js";

/** Explicit permission for scheduled Agenda summaries, independent of digest settings. */
export const agendaPrivatePermissionInput = z
  .object({
    enabled: z.boolean(),
    expected_version: z.number().int().nonnegative(),
    expected_provider_choice_version: z.number().int().nonnegative(),
    expected_preference_version: z.number().int().nonnegative().optional(),
  })
  .strict();

export const agendaPrivatePermission = z
  .object({
    id: z.uuid().nullable(),
    enabled: z.boolean(),
    active: z.boolean(),
    version: z.number().int().nonnegative(),
    model: z.string().nullable(),
  })
  .strict();
export type AgendaPrivatePermission = z.output<typeof agendaPrivatePermission>;
export type AgendaPrivatePermissionInput = z.input<
  typeof agendaPrivatePermissionInput
>;

/** Owner-visible scheduling metadata; source snapshots and transport credentials stay private. */
export const agendaPrivateSummary = z
  .object({
    run: z
      .object({
        id: z.uuid(),
        doc_id: z.uuid(),
        local_day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        state: z.enum(["queued", "running", "waiting", "done", "failed"]),
        expires_at: z.iso.datetime(),
        updated_at: z.iso.datetime(),
        reason: z
          .enum([
            "device_required",
            "expired",
            "completion_unknown",
            "authority_changed",
            "provider_failed",
            "usage_limit",
          ])
          .nullable(),
        provider: aiFeatureProvider.nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type AgendaPrivateSummary = z.output<typeof agendaPrivateSummary>;

/** Concise status text shared by web and native Settings. */
export function agendaPrivateSummaryText(
  summary: AgendaPrivateSummary,
  now = Date.now(),
): string {
  const run = summary.run;
  if (!run) return "No scheduled summary yet.";
  if (run.state === "done")
    return `Summary ready · ${run.provider?.model ?? "model unavailable"}`;
  if (run.state !== "failed" && Date.parse(run.expires_at) <= now)
    return "The morning window ended.";
  if (run.state === "running") return "Writing your summary…";
  if (run.state === "queued") return "Queued for this morning.";
  if (run.state === "waiting")
    return "Waiting for your connected Orbyn desktop app.";
  if (run.reason === "completion_unknown")
    return "Completion could not be confirmed. It was not retried.";
  if (run.reason === "authority_changed")
    return "Your sources or AI settings changed. This summary was stopped.";
  if (run.reason === "expired") return "The morning window ended.";
  if (run.reason === "usage_limit")
    return "ChatGPT usage limit reached. Manage usage in ChatGPT.";
  return "The summary could not finish.";
}

/** Explain the first missing scheduling prerequisite without inferring device capabilities. */
export function agendaPrivateEnablementMessage(
  data: {
    choice: { primary: string };
    catalog: {
      status: string;
      capabilities?: string[];
      preference: { model: string | null };
      models: { slug: string }[];
    } | null;
  } | null,
): string | null {
  if (!data) return "Loading summary settings…";
  if (data.choice.primary !== "chatgpt")
    return "Choose ChatGPT as your provider.";
  const catalog = data.catalog;
  if (!catalog || catalog.status !== "ready")
    return "Reconnect your ChatGPT device.";
  if (
    !catalog.preference.model ||
    !catalog.models.some((m) => m.slug === catalog.preference.model)
  )
    return "Choose an available ChatGPT model.";
  if (
    !catalog.capabilities?.includes("plan_inference_v1") ||
    !catalog.capabilities.includes("plan_inference_limits_v1")
  )
    return "This connection cannot enforce scheduled-run limits.";
  return null;
}
