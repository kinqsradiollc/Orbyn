import { assistantChatVisible } from "./assistant-visibility.js";
import { assistantJobSourcesVisible } from "./assistant-job-sources.js";
import type { Scope } from "./visibility.js";

/** Saved generated suggestions never outlive access to their producing evidence. */
export function assistantProposalSourcesVisible(
  proposal = "proposals",
  user = "$1",
  scope?: Scope,
): string {
  return `(${proposal}.user_id=${user} AND (
    ${proposal}.assistant_guard->>'job_id' IS NULL OR EXISTS(
      SELECT 1 FROM ai_jobs proposal_guard_job JOIN ai_chats proposal_guard_chat ON proposal_guard_chat.id=proposal_guard_job.chat_id
      WHERE proposal_guard_job.id::text=${proposal}.assistant_guard->>'job_id'
        AND proposal_guard_job.runtime_lane=${proposal}.assistant_guard->>'lane'
        AND ${assistantChatVisible("proposal_guard_chat", user, scope)}
        AND ${assistantJobSourcesVisible("proposal_guard_job", user, false, scope)})))`;
}
