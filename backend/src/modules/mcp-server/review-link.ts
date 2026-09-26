import { createHmac, timingSafeEqual } from "node:crypto";
import {
  inputRequired,
  type InputRequiredResult,
} from "@modelcontextprotocol/server";
import {
  withReadContext,
  type ToolResult,
} from "../../capabilities/execute.js";
import type { Principal } from "../../capabilities/policy.js";
import { derivedKey } from "../../lib/secrets.js";
import { proposalOutcome } from "../proposals/service.js";

/**
 * Sending the person to the Review inbox from inside the agent's app
 * (URL-mode elicitation). When a change goes to review and the client said
 * it can open links for the person (clientCapabilities.elicitation.url, on
 * the 2026-07-28 revision), the tool call answers "input required" with a
 * link to /app/review/:id instead of a plain result. The client shows the
 * link; once the person has been there it calls the tool again with the
 * sealed requestState, and gets the proposal's outcome, whatever they
 * decided, without anything being proposed twice.
 *
 * Older clients (2025 revisions, and any that can't open links) simply get
 * the result with its review_url, which they show like any text.
 */

/** A request state lasts this long. */
const STATE_MS = 60 * 60_000;

let stateKey: Promise<Buffer> | null = null;
const key = () => (stateKey ??= derivedKey("mcp-review-state"));
const mac = async (body: string) =>
  createHmac("sha256", await key())
    .update(body)
    .digest("base64url");

/** The client can open a link for the person (URL-mode elicitation). */
export function opensLinks(capabilities: unknown): boolean {
  const e = (capabilities as { elicitation?: { url?: unknown } } | undefined)
    ?.elicitation;
  return !!e && typeof e === "object" && e.url !== undefined && e.url !== null;
}

/** The pending review a tool result points at, if any. */
export function pendingReview(
  result: ToolResult,
): { proposal: string; url: string } | null {
  const pending = (
    result.structuredContent as
      | { pending?: { proposal_id?: string; review_url?: string } | null }
      | undefined
  )?.pending;
  if (result.isError || !pending?.proposal_id || !pending.review_url)
    return null;
  const id = /^proposal:([0-9a-f-]{36})$/.exec(pending.proposal_id)?.[1];
  return id ? { proposal: id, url: pending.review_url } : null;
}

async function seal(p: Principal, tool: string, proposal: string, now: Date) {
  const body = [
    "rv1",
    proposal,
    p.grant_id ?? "-",
    tool,
    String(now.getTime() + STATE_MS),
  ].join(".");
  return `${body}.${await mac(`${p.user.id}|${body}`)}`;
}

/**
 * The proposal a request state names, when it was minted for this person,
 * connection and tool and hasn't expired; null otherwise.
 */
export async function openState(
  p: Principal,
  tool: string,
  state: unknown,
  now = new Date(),
): Promise<string | null> {
  if (typeof state !== "string") return null;
  const m =
    /^(rv1\.([0-9a-f-]{36})\.([0-9a-f-]{36}|-)\.([a-z_]{1,64})\.(\d{10,15}))\.([\w-]{43})$/.exec(
      state,
    );
  if (!m) return null;
  const want = Buffer.from(await mac(`${p.user.id}|${m[1]}`));
  const got = Buffer.from(m[6]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  if (m[3] !== (p.grant_id ?? "-") || m[4] !== tool) return null;
  if (Number(m[5]) <= now.getTime()) return null;
  return m[2];
}

/** "Input required": open the review page for the person. */
export async function askToReview(
  p: Principal,
  tool: string,
  review: { proposal: string; url: string },
  now = new Date(),
): Promise<InputRequiredResult> {
  return inputRequired({
    inputRequests: {
      review: inputRequired.elicitUrl({
        message:
          "This change waits for your approval in Orbyn. Open the Review inbox to approve or decline it.",
        url: review.url,
      }),
    },
    requestState: await seal(p, tool, review.proposal, now),
  });
}

const WORDS: Record<string, string> = {
  pending: "It still waits for the person's approval in Orbyn's Review inbox.",
  applied: "The person approved it: the changes were made.",
  declined: "The person declined it: nothing changed.",
  cancelled: "It was cancelled: nothing changed.",
  expired: "It expired before anyone decided: nothing changed.",
};

/** The tool result once the person has been to the review page. */
export async function reviewedResult(
  p: Principal,
  proposal: string,
  options: { primary?: boolean } = {},
): Promise<ToolResult> {
  const found = await withReadContext(
    p,
    "review",
    { proposal },
    (ctx) => proposalOutcome(ctx.db, p.user.id, p.grant_id, proposal),
    { primary: options.primary ?? true },
  );
  if (!found)
    return {
      content: [
        {
          type: "text",
          text: "NOT_FOUND: That proposal isn't here any more.",
        },
      ],
      isError: true,
      _meta: { "orbyn/error": { code: "NOT_FOUND" } },
    };
  const text = `${WORDS[found.status] ?? found.status}\nproposal: proposal:${found.id} · review: ${found.review_url}`;
  return {
    content: [{ type: "text", text }],
    structuredContent: {
      status: found.status === "applied" ? "done" : "pending_review",
      done: [],
      pending: {
        status: "pending_review",
        proposal_id: `proposal:${found.id}`,
        review_url: found.review_url,
        expires_at: found.expires_at,
        changes: found.changes,
      },
      skipped: [],
    },
    _meta: { "orbyn/proposal_status": found.status },
  };
}
