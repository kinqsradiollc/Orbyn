import { z } from "zod";
import type { DocBlock } from "./docs.js";

/**
 * Assistant chips when sharing, importing or scanning (AI-01). They are
 * optional, run only through Orbyn's hosted assistant, and come back as
 * suggestions: nothing is added until the person takes it.
 */

export const ASSIST_CHIPS = [
  { id: "summarise", label: "Summarise" },
  { id: "deadlines", label: "Pull out deadlines as tasks" },
  { id: "cards", label: "Make 10 flashcards" },
] as const;
export type AssistChip = (typeof ASSIST_CHIPS)[number]["id"];

/** "Make 10 flashcards" asks Study's suggestion for this many. */
export const CHIP_CARDS = 10;

export const captureAssistInput = z
  .object({
    action: z.enum(["summarise", "deadlines"]),
    /** A page (just imported, scanned or shared into). */
    doc_id: z.uuid().optional(),
    /** Or words shared in, with no page. */
    text: z.string().max(50_000).optional(),
    title: z.string().max(200).optional(),
  })
  .strict()
  .refine((d) => !!d.doc_id || !!d.text?.trim(), {
    message: "Give a page or some words.",
  });
export type CaptureAssistInput = z.input<typeof captureAssistInput>;

export type SuggestedDeadline = {
  title: string;
  due_at: string | null;
  /** The line it was found on. */
  source: string;
};

export type CaptureAssistResult = {
  action: "summarise" | "deadlines";
  summary: string;
  tasks: SuggestedDeadline[];
};

/**
 * A summary taken onto a page: a Summary callout at the top, so it reads as
 * the assistant's, with its points as a list under it and a divider before
 * the page's own lines.
 */
export function withSummary(blocks: DocBlock[], summary: string): DocBlock[] {
  const points = summary
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 12);
  if (!points.length) return blocks;
  return [
    { type: "callout", kind: "summary", text: "Summary from the assistant" },
    ...points.map((text) => ({ type: "bullet", text }) as DocBlock),
    { type: "divider" } as DocBlock,
    ...blocks,
  ];
}
