import { z } from "zod";

/**
 * Agent 2 (H0): everything routes to your agent. Each connection has an
 * inbox of what happened in Orbyn that it may see (booking requests,
 * mentions, invites, deadlines, finished imports, study, email-to-task,
 * review decisions, teammates' asks and answers to its own questions). The
 * person chooses which kinds go to each agent, may give it a wake-up
 * address, and writes standing rules the agent follows. Shared by the
 * backend and both apps.
 */

/** The kinds of things that reach an agent's inbox, in the order shown. */
export const AGENT_INBOX_KINDS = [
  "booking",
  "mention",
  "invite",
  "deadline",
  "import",
  "study",
  "email_task",
  "review",
  "ask",
  "answer",
] as const;
export type AgentInboxKind = (typeof AGENT_INBOX_KINDS)[number];

export const AGENT_INBOX_KIND_LABELS: Record<
  AgentInboxKind,
  { name: string; blurb: string }
> = {
  booking: {
    name: "Booking requests",
    blurb: "Someone booked, moved or cancelled time on your booking pages.",
  },
  mention: {
    name: "Mentions and comments",
    blurb: "Someone named you, or commented on a page of yours.",
  },
  invite: {
    name: "Invites",
    blurb: "You were added to a team, or someone answered your invite.",
  },
  deadline: {
    name: "Deadlines",
    blurb: "A deadline is at risk, or work isn't fully planned yet.",
  },
  import: {
    name: "Finished imports",
    blurb: "A file you imported is ready as a page, or couldn't be read.",
  },
  study: {
    name: "Study",
    blurb: "Cards are due for review, or an exam is close.",
  },
  email_task: {
    name: "Tasks from email",
    blurb: "A task arrived at your email-to-task address.",
  },
  review: {
    name: "Review decisions",
    blurb: "You approved or declined what this agent suggested.",
  },
  ask: {
    name: "Teammates' asks",
    blurb: "A teammate asked you to take something on, or offered a promise.",
  },
  answer: {
    name: "Your answers",
    blurb: "You answered a question this agent asked you.",
  },
};

/** The inbox as an MCP resource (resources/read, subscriptions/listen). */
export const AGENT_INBOX_URI = "orbyn://inbox";

/** An inbox item stays this many days, then it's cleared. */
export const AGENT_INBOX_DAYS = 14;

/** What an agent can do with an inbox item once it has read it. */
export const AGENT_INBOX_ACKS = ["done", "snooze", "dismiss"] as const;
export type AgentInboxAck = (typeof AGENT_INBOX_ACKS)[number];

/** A wake-up call goes out at most this often per connection. */
export const AGENT_WAKE_MINUTES = 5;

// --- Standing rules ---------------------------------------------------------

/** A person has at most this many standing rules. */
export const MAX_AGENT_RULES = 50;

/**
 * A standing rule the person wrote for their agents, in plain words
 * ("Always accept bookings from my team"). `kind` narrows it to one kind of
 * inbox item; null applies to everything.
 */
export type AgentRule = {
  id: string;
  kind: AgentInboxKind | null;
  text: string;
  created_at: string;
  updated_at: string;
};

export const agentRuleInput = z
  .object({
    kind: z.enum(AGENT_INBOX_KINDS).nullable().default(null),
    text: z.string().trim().min(1, "Write the rule.").max(500),
  })
  .strict();
export type AgentRuleInput = z.input<typeof agentRuleInput>;

// --- Per connection -----------------------------------------------------------

/** What a connection hears, as Connected agents shows it. */
export type AgentInboxSettings = {
  /** Kinds this connection is not sent. */
  muted: AgentInboxKind[];
  /** The wake-up address, when one is set (https). */
  wake_url: string | null;
  /** How the last wake-up went. */
  wake_last_status: number | null;
  wake_last_error: string | null;
  wake_last_sent_at: string | null;
  /** Items waiting that the agent hasn't acknowledged. */
  unread: number;
};

/** Changing which kinds a connection hears. */
export const agentInboxMutesInput = z
  .object({ muted: z.array(z.enum(AGENT_INBOX_KINDS)).max(20) })
  .strict();
export type AgentInboxMutesInput = z.input<typeof agentInboxMutesInput>;

/** Setting a connection's wake-up address. */
export const agentWakeInput = z
  .object({ url: z.string().trim().url("Use an https:// address.").max(500) })
  .strict();
export type AgentWakeInput = z.input<typeof agentWakeInput>;

/** A wake-up address just set: its signing secret is shown this once. */
export type NewAgentWake = { settings: AgentInboxSettings; secret: string };

// --- Questions from agents ---------------------------------------------------

/** An agent's question has at most this many choices. */
export const MAX_QUESTION_CHOICES = 5;
/** A question waits this long unless the agent says otherwise. */
export const QUESTION_DEFAULT_HOURS = 24;

export const QUESTION_STATUSES = ["open", "answered", "expired"] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

/** A question an agent asked the person (Notifications, and the phone). */
export type AgentQuestion = {
  id: string;
  /** The connection's name, as Connected agents shows it. */
  agent: string;
  question: string;
  detail: string | null;
  choices: string[];
  /** A yes/no question (answered with Approve and Decline on the phone). */
  yes_no: boolean;
  default_choice: string | null;
  status: QuestionStatus;
  answer: string | null;
  created_at: string;
  expires_at: string;
};

export const questionAnswerInput = z
  .object({
    answer: z.string().trim().min(1).max(200),
    /** Where it was answered: the card in the app, or the push's buttons. */
    via: z.enum(["app", "push"]).default("app"),
  })
  .strict();
export type QuestionAnswerInput = z.input<typeof questionAnswerInput>;
