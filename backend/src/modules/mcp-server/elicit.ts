import { createHmac, timingSafeEqual } from "node:crypto";
import {
  inputRequired,
  inputResponse,
  type InputRequiredResult,
} from "@modelcontextprotocol/server";
import type { ToolResult } from "../../capabilities/execute.js";
import type { Principal } from "../../capabilities/policy.js";
import type { ChatAnswer, ChatQuestion } from "../../capabilities/registry.js";
import { derivedKey } from "../../lib/secrets.js";

/**
 * Asking the person in the chat (form-mode elicitation, H1). When a change
 * needs the person's yes first (the connection asks for everything, or the
 * change is on its ask-first list) and the app declared it can show a form
 * (clientCapabilities.elicitation.form, or a bare `elicitation: {}`, on the
 * 2026-07-28 revision), the call changes nothing and answers "input
 * required" with one embedded elicitation/create: a flat form with a single
 * yes/no, and a message naming what would change and why it asks.
 *
 * The app shows it and calls the tool again with the answer and the sealed
 * requestState. Yes: the same call is made directly. No, or dismissed:
 * nothing changes and the answer says so. The state is bound to the
 * person, connection, tool and exact arguments, and lasts 15 minutes, so a
 * yes can't be reused for anything else.
 *
 * Apps that can't show a form fall back to the Review inbox: URL mode
 * (review-link.ts) for apps that open links, and otherwise the proposal's
 * push with Approve and Decline.
 */

/** A yes lasts this long. */
const STATE_MS = 15 * 60_000;

/** The form's one field. */
export const CONFIRM_KEY = "confirm";

let stateKey: Promise<Buffer> | null = null;
const key = () => (stateKey ??= derivedKey("mcp-elicit-state"));
const mac = async (body: string) =>
  createHmac("sha256", await key())
    .update(body)
    .digest("base64url");

/** The app can show a form for the person (form-mode elicitation). */
export function asksInChat(capabilities: unknown): boolean {
  const e = (
    capabilities as
      { elicitation?: { form?: unknown; url?: unknown } } | undefined
  )?.elicitation;
  if (!e || typeof e !== "object") return false;
  // A bare declaration is the pre-mode meaning: forms.
  if (e.form === undefined && e.url === undefined) return true;
  return e.form !== undefined && e.form !== null;
}

async function seal(
  p: Principal,
  tool: string,
  digest: string,
  now: Date,
): Promise<string> {
  const body = [
    "ea1",
    p.grant_id ?? "-",
    tool,
    digest,
    String(now.getTime() + STATE_MS),
  ].join(".");
  return `${body}.${await mac(`${p.user.id}|${body}`)}`;
}

/** Whether a request state is an ask made here (not a review link's). */
export const isAskState = (state: unknown) =>
  typeof state === "string" && state.startsWith("ea1.");

/**
 * Whether a request state was minted for this person, connection, tool and
 * arguments, and hasn't expired.
 */
export async function openAsk(
  p: Principal,
  tool: string,
  digest: string,
  state: unknown,
  now = new Date(),
): Promise<boolean> {
  if (typeof state !== "string") return false;
  const m =
    /^(ea1\.([0-9a-f-]{36}|-)\.([a-z_]{1,64})\.([\w-]{22})\.(\d{10,15}))\.([\w-]{43})$/.exec(
      state,
    );
  if (!m) return false;
  const want = Buffer.from(await mac(`${p.user.id}|${m[1]}`));
  const got = Buffer.from(m[6]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return false;
  if (m[2] !== (p.grant_id ?? "-") || m[3] !== tool || m[4] !== digest)
    return false;
  return Number(m[5]) > now.getTime();
}

/** The message: who wants to do what, and why it asks. */
export function askMessage(
  p: Principal,
  what: string[],
  why: string[],
): string {
  const who = p.client.name.trim() || "Your agent";
  const lines = what.map((w) => `• ${w}`).join("\n");
  const because = why.length
    ? `\n\nIt asks first because ${why.join("; ")}.`
    : "";
  return `${who} wants to make ${what.length === 1 ? "this change" : "these changes"} in Orbyn:\n${lines}${because}\n\nAllow it?`.slice(
    0,
    2000,
  );
}

/** "Input required": the one yes/no form for the person. */
export async function askInChat(
  p: Principal,
  tool: string,
  digest: string,
  ask: { what: string[]; why: string[] },
  now = new Date(),
): Promise<InputRequiredResult> {
  return inputRequired({
    inputRequests: {
      [CONFIRM_KEY]: inputRequired.elicit({
        mode: "form",
        message: askMessage(p, ask.what, ask.why),
        requestedSchema: {
          type: "object",
          properties: {
            [CONFIRM_KEY]: {
              type: "boolean",
              title: "Allow",
              description:
                "Yes makes the change now; no leaves everything as it is.",
              default: false,
            },
          },
          required: [CONFIRM_KEY],
        },
      }),
    },
    requestState: await seal(p, tool, digest, now),
  });
}

/** The question form's one field (ask_person). */
export const ANSWER_KEY = "answer";

/**
 * "Input required" for an agent's question (ask_person, H0): a flat form
 * with one field, yes/no or one of up to five choices, with the default
 * already chosen when there is one. Sealed like a change's ask, to this
 * person, connection, tool and exact arguments.
 */
export async function askQuestionInChat(
  p: Principal,
  tool: string,
  digest: string,
  q: ChatQuestion,
  now = new Date(),
): Promise<InputRequiredResult> {
  const who = p.client.name.trim() || "Your agent";
  const message =
    `${who} asks: ${q.question}${q.detail ? `\n\n${q.detail}` : ""}`.slice(
      0,
      2000,
    );
  const field = q.yes_no
    ? {
        type: "boolean" as const,
        title: q.question.slice(0, 100),
        ...(q.default_choice
          ? { default: q.default_choice === q.choices[0] }
          : {}),
      }
    : {
        type: "string" as const,
        title: "Answer",
        enum: q.choices,
        ...(q.default_choice ? { default: q.default_choice } : {}),
      };
  return inputRequired({
    inputRequests: {
      [ANSWER_KEY]: inputRequired.elicit({
        mode: "form",
        message,
        requestedSchema: {
          type: "object",
          properties: { [ANSWER_KEY]: field },
          required: [ANSWER_KEY],
        },
      }),
    },
    requestState: await seal(p, tool, digest, now),
  });
}

/** What the person answered to a question: a choice, yes/no, or none. */
export function questionAnswerOf(responses: unknown): ChatAnswer | null {
  const view = inputResponse(responses as never, ANSWER_KEY);
  if (view.kind !== "elicit") return null;
  if (view.action === "cancel") return { outcome: "cancelled", answer: null };
  if (view.action === "decline") return { outcome: "declined", answer: null };
  const value = (view.content as Record<string, unknown> | undefined)?.[
    ANSWER_KEY
  ];
  if (typeof value !== "string" && typeof value !== "boolean") return null;
  return { outcome: "answered", answer: value };
}

/** What the person answered: yes, no, dismissed, or nothing yet. */
export function answerOf(
  responses: unknown,
): "yes" | "declined" | "cancelled" | "missing" {
  const view = inputResponse(responses as never, CONFIRM_KEY);
  if (view.kind !== "elicit") return "missing";
  if (view.action === "cancel") return "cancelled";
  if (view.action === "decline") return "declined";
  return view.content?.[CONFIRM_KEY] === true ? "yes" : "declined";
}

/** The answer when the person said no (or dismissed the question). */
export function notAllowed(answer: "declined" | "cancelled"): ToolResult {
  const code = answer === "declined" ? "DECLINED" : "CANCELLED";
  const text =
    answer === "declined"
      ? "DECLINED: The person said no in the chat, so nothing changed. Fix: Don't make this change unless they ask for it again."
      : "CANCELLED: The person dismissed the question without answering, so nothing changed. Fix: Ask them in your own words whether to go ahead before trying again.";
  return {
    content: [{ type: "text", text }],
    isError: true,
    _meta: { "orbyn/error": { code } },
  };
}
