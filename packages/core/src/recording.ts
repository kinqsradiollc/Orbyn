/**
 * Recording audio into a page (CAP-10), and the team switches beside
 * publishing (OTH-04).
 *
 * A recording is a file on its page, kept in Orbyn's own file store like any
 * picture or file (EDT-01). Asked to, the hosted assistant writes out what
 * was said, then offers a short summary and action items; the person adds
 * the summary to the page and turns action items into tasks with a tap.
 * Nothing is sent anywhere until they ask, and the sheet says so first.
 */
import { z } from "zod";
import type { AiFeatureProvider } from "./ai-feature.js";
import type { DocBlock } from "./docs.js";

/** Types a recording is kept as. */
export const AUDIO_TYPES: Record<string, string> = {
  "audio/webm": "Recording",
  "audio/mp4": "Recording",
  "audio/mpeg": "Recording",
  "audio/ogg": "Recording",
  "audio/wav": "Recording",
  "audio/aac": "Recording",
};

export const isAudio = (mime: string) =>
  Object.prototype.hasOwnProperty.call(AUDIO_TYPES, mime);

/** The longest recording a page takes, in minutes (and its size cap). */
export const RECORDING_MAX_MINUTES = 90;
export const RECORDING_MAX_BYTES = 100 * 1024 * 1024;

/** The words shown before anything is recorded or sent. */
export const RECORDING_CONSENT =
  "Recording keeps the audio on this page in Orbyn's own storage, like a file. Ask everyone you record first. Summaries are made only when you ask: the recording is then sent to the assistant's AI service to be written out and summarised.";

/** POST /docs/:id/recordings/:file/summary. */
export const recordingSummaryInput = z
  .object({
    /** What was said, when the device already wrote it out. */
    transcript: z.string().trim().max(200_000).optional(),
  })
  .strict();

/** A summary and action items from a recording. */
export type RecordingSummary = {
  provider?: AiFeatureProvider;
  transcript: string;
  summary: string;
  actions: { title: string; due: string | null }[];
};

/** The reply the assistant is asked for, checked before use. */
export const recordingSummaryReply = z.object({
  summary: z.string().max(4000),
  actions: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        due: z.string().max(40).nullable().optional(),
      }),
    )
    .max(30)
    .default([]),
});

/** What the assistant is told to do with a transcript. */
export const RECORDING_PROMPT = `You summarise a recording of a lecture or a meeting.
Reply with JSON only: {"summary": "...", "actions": [{"title": "...", "due": "YYYY-MM-DD or null"}]}.
The summary is at most six short sentences in plain words. Actions are things someone said they or others would do; leave the list empty if there are none. Never invent a due date: give one only when a date was said plainly.`;

/**
 * The lines a summary adds to a page, under the recording: a "Summary"
 * heading, the summary, and the action items as a checklist (each can
 * become a task from the page, as any checklist line can).
 */
export function summaryLines(
  s: Pick<RecordingSummary, "summary" | "actions">,
): DocBlock[] {
  const lines: DocBlock[] = [
    { type: "heading", level: 3, text: "Summary" },
    ...s.summary
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((text): DocBlock => ({ type: "paragraph", text })),
  ];
  if (s.actions.length)
    lines.push(
      { type: "heading", level: 3, text: "Action items" },
      ...s.actions.map((a): DocBlock => ({
        type: "todo",
        text: a.title,
        done: false,
      })),
    );
  return lines;
}

/** "12:05" for a recording's length. */
export function recordingClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}

// ------------------------------------------------------ team switches ---

/** A team's switches (OTH-04), shown together in its settings. */
export type TeamPolicies = {
  /** Pages and folders can be published to the web. */
  publishing: boolean;
  /** The assistant can be used on the team's pages. */
  assistant: boolean;
  /** The team's booking pages take bookings from outside. */
  booking: boolean;
  can_change: boolean;
};

export const teamPoliciesInput = z
  .object({
    publishing: z.boolean().optional(),
    assistant: z.boolean().optional(),
    booking: z.boolean().optional(),
  })
  .strict()
  .refine((p) => Object.values(p).some((v) => v !== undefined), {
    message: "Nothing to change.",
  });

/** One sentence for each switch. */
export const TEAM_POLICY_TEXT: Record<
  "publishing" | "assistant" | "booking",
  { label: string; hint: string }
> = {
  publishing: {
    label: "Publishing to the web",
    hint: "Members can put the team's pages and folders on the public web. Off takes every published page down at once.",
  },
  assistant: {
    label: "The assistant on team pages",
    hint: "Members can ask the assistant about the team's pages, and it can read them to answer. Off keeps them out of it.",
  },
  booking: {
    label: "Booking pages for people outside",
    hint: "The team's booking pages take bookings from anyone with the link. Off pauses them until it's on again.",
  },
};

/** What the assistant says when a team keeps its pages out of it. */
export const ASSISTANT_OFF_MESSAGE =
  "This team keeps its pages out of the assistant. Its owners or admins can change that in the team's settings.";
