import { z } from "zod";
import type {
  AssistantProfiles,
  AssistantProfile,
} from "./assistant-profiles.js";
import {
  ASSISTANT_OUTCOME_LABELS,
  type AssistantOutcomeReceipt,
} from "./assistant-outcomes.js";

/** Current source identity, projected by the server; never inferred from a summary. */
export const assistantReviewOrigin = z
  .object({
    kind: z.enum(["goal", "routine", "project", "task", "chat"]),
    id: z.uuid(),
    title: z.string().min(1).max(200),
  })
  .strict();
export type AssistantReviewOrigin = z.output<typeof assistantReviewOrigin>;
export type AssistantMorningReviewItem = {
  id: string;
  jobId?: string;
  lane: AssistantProfile["lane"];
  title: string;
  detail: string;
  action: string;
  target?: "review";
  priority: number;
  at?: string;
  chatId?: string;
  summary?: string;
  execution_outcome?: AssistantOutcomeReceipt;
};
export type AssistantMorningReviewGroup = {
  id: string;
  title: string;
  kind: AssistantReviewOrigin["kind"] | "activity";
  priority: number;
  items: AssistantMorningReviewItem[];
};
const order = (a: AssistantMorningReviewItem, b: AssistantMorningReviewItem) =>
  a.priority - b.priority ||
  (b.at ?? "").localeCompare(a.at ?? "") ||
  a.id.localeCompare(b.id);
/** A bounded current-access morning snapshot. Every selected job remains actionable:
 * an older decision is never replaced by a later successful run in the same origin. */
export function groupAssistantReview(
  data: AssistantProfiles,
): AssistantMorningReviewGroup[] {
  const groups = new Map<string, AssistantMorningReviewGroup>(),
    seenJobs = new Set<string>();
  const put = (
    item: AssistantMorningReviewItem,
    origin?: AssistantReviewOrigin | null,
  ) => {
    const restricted = origin === null;
    const kind = restricted
      ? "activity"
      : (origin?.kind ?? (item.chatId ? "chat" : "activity"));
    const id = restricted
      ? `unavailable:${item.jobId ?? item.id}`
      : origin
        ? `${origin.kind}:${origin.id}`
        : item.chatId
          ? `chat:${item.chatId}`
          : `activity:${item.lane}`;
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        kind,
        title: restricted
          ? "Work source unavailable"
          : (origin?.title ??
            (item.chatId
              ? item.title
              : `${item.lane === "background" ? "Background" : "Overnight"} activity`)),
        priority: item.priority,
        items: [],
      };
      groups.set(id, group);
    }
    group.items.push(item);
    group.priority = Math.min(group.priority, item.priority);
  };
  for (const profile of data.profiles) {
    const name = profile.lane === "background" ? "Background" : "Overnight";
    for (const work of profile.work ?? []) {
      if (seenJobs.has(work.job_id)) continue;
      seenJobs.add(work.job_id);
      const label = work.cancel_requested
        ? "Stopping"
        : work.state === "waiting"
          ? "Waiting for you"
          : work.recovering
            ? "Recovery pending"
            : work.state === "running"
              ? "In progress"
              : "Queued";
      put(
        {
          id: `job:${work.job_id}`,
          jobId: work.job_id,
          lane: profile.lane,
          title: work.title || `${name} work`,
          detail: `${name} · ${label}`,
          action: work.state === "waiting" ? "Review decision" : "Open work",
          priority:
            work.state === "waiting"
              ? 0
              : work.recovering
                ? 3
                : work.state === "running"
                  ? 4
                  : 6,
          at: work.updated_at,
          chatId: work.chat_id,
        },
        work.origin,
      );
    }
    for (const output of profile.outputs) {
      if (seenJobs.has(output.job_id)) continue;
      seenJobs.add(output.job_id);
      const receipt = output.execution_outcome;
      const priority =
        output.review_pending ||
        receipt?.outcome === "waiting" ||
        !!receipt?.open_questions.length
          ? 0
          : output.state === "failed" || receipt?.outcome === "failed"
            ? 1
            : !receipt ||
                ["partial", "uncertain", "interrupted", "unverified"].includes(
                  receipt.outcome,
                )
              ? 2
              : 5;
      const label = output.review_pending
        ? "Changes waiting for review"
        : receipt
          ? ASSISTANT_OUTCOME_LABELS[receipt.outcome]
          : output.state === "failed"
            ? "Run failed"
            : "Outcome not verified";
      put(
        {
          id: `job:${output.job_id}`,
          jobId: output.job_id,
          lane: profile.lane,
          title: output.title || `${name} result`,
          detail: `${name} · ${label}`,
          action: output.review_pending ? "Review changes" : "Review result",
          ...(output.review_pending ? { target: "review" as const } : {}),
          priority,
          at: output.completed_at,
          chatId: output.chat_id,
          ...(output.summary ? { summary: output.summary } : {}),
          ...(receipt ? { execution_outcome: receipt } : {}),
        },
        output.origin,
      );
    }
    // Older/limited snapshots still disclose work omitted by the bounded rows.
    const represented = { waiting: 0, working: 0, queued: 0, recovering: 0 };
    for (const work of profile.work ?? []) {
      if (work.state === "waiting") represented.waiting++;
      else if (work.state === "queued") represented.queued++;
      else if (work.recovering) represented.recovering++;
      else represented.working++;
    }
    for (const [key, label, priority] of [
      ["waiting", "need a decision", 0],
      ["recovering", "await recovery", 3],
      ["working", "are in progress", 4],
      ["queued", "are queued", 6],
    ] as const) {
      const remaining = Math.max(0, profile.counts[key] - represented[key]);
      const wording =
        remaining === 1
          ? (
              {
                waiting: "needs a decision",
                recovering: "awaits recovery",
                working: "is in progress",
                queued: "is queued",
              } as const
            )[key]
          : label;
      if (remaining)
        put({
          id: `${profile.lane}:${key}`,
          lane: profile.lane,
          title: `${name} · ${key === "waiting" ? "More decisions" : "More work"}`,
          detail: `${remaining} additional ${remaining === 1 ? "run" : "runs"} ${wording}.`,
          action: key === "waiting" ? "Review decisions" : "View activity",
          priority,
        });
    }
    const latest = new Map<string, (typeof profile.recent_activity)[number]>();
    for (const event of profile.recent_activity) {
      const key = event.job_id ?? `event:${event.sequence}`;
      const old = latest.get(key);
      if (!old || BigInt(event.sequence) > BigInt(old.sequence))
        latest.set(key, event);
    }
    for (const event of latest.values())
      if (
        event.kind === "failed" &&
        (!event.job_id || !seenJobs.has(event.job_id))
      )
        put({
          id: `${profile.lane}:failure:${event.job_id ?? event.sequence}`,
          jobId: event.job_id ?? undefined,
          lane: profile.lane,
          title: `${name} · Failure reported`,
          detail: "Open activity to check the result and recovery.",
          action: "Review activity",
          priority: 1,
          at: event.created_at,
        });
  }
  for (const group of groups.values()) group.items.sort(order);
  return [...groups.values()].sort(
    (a, b) =>
      a.priority - b.priority ||
      order(a.items[0], b.items[0]) ||
      a.id.localeCompare(b.id),
  );
}

/** Compact, factual group summary; source grouping does not imply goal acceptance. */
export function assistantReviewGroupSummary(
  group: AssistantMorningReviewGroup,
): string {
  const counts = new Map<number, number>();
  for (const item of group.items)
    counts.set(item.priority, (counts.get(item.priority) ?? 0) + 1);
  return (
    [
      [0, "decision", "decisions"],
      [1, "failure", "failures"],
      [2, "result to review", "results to review"],
      [3, "recovering", "recovering"],
      [4, "in progress", "in progress"],
      [5, "result", "results"],
      [6, "queued", "queued"],
    ] as const
  )
    .flatMap(([priority, one, many]) => {
      const n = counts.get(priority) ?? 0;
      return n ? [`${n} ${n === 1 ? one : many}`] : [];
    })
    .join(" · ");
}
