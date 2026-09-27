import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  fail,
  reviewApproveInput,
  type ProposalStatus,
  type ReviewApplied,
  type ReviewInbox,
  type ReviewItem,
} from "@orbyn/core";
import { reader, transaction } from "../../db/pool.js";
import { authenticate, isApiKeyRequest } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { undoActivity, undoJob } from "../../capabilities/undo.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import {
  applyProposal,
  declineProposal,
  proposalOutcome,
  pendingCount,
  reviewInbox,
  reviewItem,
} from "./service.js";

/**
 * The Review inbox: what the assistant and outside agents propose, waiting
 * for the person to approve or decline, and Undo for what an agent changed
 * directly.
 *
 * Only a person signed in to Orbyn's own apps (web, desktop, phone) decides.
 * Agent credentials (oat_, ort_, oak_) never authenticate on the API at all
 * (authenticate() answers 401), and personal API keys are refused here with
 * 403 (KEY_BLOCKED, and again below), so nothing an agent holds can approve
 * its own proposal.
 */

/** A signed-in person using one of Orbyn's own apps, or 401/403. */
export async function firstParty(r: FastifyRequest) {
  const u = await authenticate(r);
  if (isApiKeyRequest(r))
    fail(
      403,
      "Only you, signed in to Orbyn, can approve, decline or undo changes. Keys can't.",
    );
  return u;
}

export async function proposalRoutes(app: FastifyInstance) {
  app.get("/proposals", async (r): Promise<ReviewInbox> => {
    const u = await firstParty(r);
    return reviewInbox(reader(r.headers), u.id);
  });

  /** How many wait, for the badge beside Review. */
  app.get("/proposals/count", async (r): Promise<{ pending: number }> => {
    const u = await firstParty(r);
    return { pending: await pendingCount(reader(r.headers), u.id) };
  });

  // Each change is checked against what is there now: one whose task, page
  // or session changed since reads as stale, and approving it is refused.
  app.get("/proposals/:id", async (r): Promise<ReviewItem> => {
    const u = await firstParty(r);
    // Read on the primary: an approval a moment ago must show as decided.
    return transaction((db) => reviewItem(db, u.id, idParam(r)));
  });

  app.post("/proposals/:id/apply", async (r): Promise<ReviewApplied> => {
    const u = await firstParty(r);
    const choice = reviewApproveInput.parse(r.body ?? {});
    return transaction((db) => applyProposal(db, u, idParam(r), choice));
  });

  app.post("/proposals/:id/decline", async (r, reply) => {
    const u = await firstParty(r);
    await transaction((db) => declineProposal(db, u, idParam(r)));
    return reply.code(204).send();
  });

  // Approve or Decline straight from the phone's notification (its
  // buttons), signed in as the person. Answering one already decided says
  // how it ended instead of failing, so a second tap is harmless.
  app.post(
    "/proposals/:id/respond",
    async (r): Promise<{ status: ProposalStatus }> => {
      const u = await firstParty(r);
      const { decision } = z
        .object({ decision: z.enum(["approve", "decline"]) })
        .strict()
        .parse(r.body ?? {});
      const id = idParam(r);
      return transaction(async (db) => {
        const now = await proposalOutcome(db, u.id, null, id);
        if (!now) fail(404, "That suggestion isn't here any more.");
        if (now.status !== "pending") return { status: now.status };
        if (decision === "approve") await applyProposal(db, u, id);
        else await declineProposal(db, u, id);
        return { status: decision === "approve" ? "applied" : "declined" };
      });
    },
  );

  // Undo one change an outside agent made directly (Settings → Connected
  // agents → Activity): once, within 30 days, and only while it is as the
  // agent left it.
  app.post("/me/agents/activity/:id/undo", async (r) => {
    const u = await firstParty(r);
    const id = (r.params as { id: string }).id;
    if (!/^\d{1,18}$/.test(id))
      fail(404, "That change isn't in your agents' activity.");
    const done = await transaction((db) => undoActivity(db, u, id));
    for (const after of done.after) await after().catch(() => {});
    return { undone: true, summary: done.summary };
  });

  // Undo a whole job of one agent (every step of a plan, or one call's
  // changes; H7), from the same list: a person only, all or nothing.
  app.post("/me/agents/:id/jobs/:job/undo", async (r) => {
    const u = await firstParty(r);
    const { id, job } = r.params as { id: string; job: string };
    if (!UUID.test(id) || !/^[\w.:@-]{1,64}$/.test(job))
      fail(404, "That job isn't in this agent's activity.");
    const done = await transaction((db) =>
      undoJob(db, u, id.toLowerCase(), job),
    );
    for (const after of done.after) await after().catch(() => {});
    return { undone: done.undone };
  });
}
