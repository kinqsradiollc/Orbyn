import type { FastifyInstance } from "fastify";
import {
  docAskRequest,
  docAssistRequest,
  DOC_AI_LABELS,
  blockText,
  fail,
  HttpError,
  keepLinkLabels,
  type DocAnswer,
  type DocBlock,
} from "@orbyn/core";
import { pool, reader, transaction } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam, strictRateLimit } from "../../lib/params.js";
import { requireAssistantAllowed, requireTeam } from "../../lib/teams.js";
import { completePageFeature } from "./providers/feature-call.js";
import { docKeptOut, PAGE_KEPT_OUT } from "../../lib/assistant-off.js";
import { readableDocs } from "../../lib/visibility.js";
import { proposeChanges } from "../docs/service.js";
import { linkPrivacy, readableLinks } from "../links/privacy.js";
import { carryRanges } from "../docs/ranges.js";

/**
 * The assistant, inside a page.
 *
 * This is deliberately not the Assistant tab. That one is about your
 * schedule and can create and change tasks; this one only ever offers words
 * for a stretch of one page, and it offers them the same way a colleague
 * would — as a proposal somebody has to take. Nothing here can change a
 * page on its own, which is what makes it safe to point at a shared one.
 */

/** How many lines either side of the words are sent along for context. */
const AROUND = 20;

const clean = (text: string) =>
  text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```[a-z]*\s*|```\s*$/gim, "")
    .trim();

export async function aiDocRoutes(app: FastifyInstance) {
  /** A page this reader may see, or a 404 that says no more than that. */
  async function readable(headers: unknown, id: string, userId: string) {
    const db = reader(headers as Record<string, string>);
    const doc = (
      await db.query<{
        id: string;
        title: string;
        version: number;
        content: DocBlock[];
        team_id: string | null;
      }>(
        `SELECT d.id, d.title, d.version, d.content, d.team_id FROM docs d
          WHERE d.id = $2 AND d.deleted_at IS NULL
            AND ${readableDocs("d")}`,
        [userId, id],
      )
    ).rows[0];
    if (!doc) fail(404, "Document not found");
    if (await docKeptOut(db, id)) fail(422, PAGE_KEPT_OUT);
    // A team can keep its pages out of the assistant (OTH-04).
    await requireAssistantAllowed(doc.team_id);
    // The words of links to what this reader can't open are not theirs to
    // send anywhere (D3aF); `links` carries places back to the stored lines.
    const links = await linkPrivacy(db, userId, doc.content);
    return {
      ...doc,
      stored: doc.content,
      content: links.value(doc.content),
      links,
    };
  }

  /**
   * Offer words for a stretch of a page. The answer is written down as a
   * proposal attributed to whoever asked, so it goes through exactly the
   * same Take or Leave as one a person wrote.
   */
  app.post("/docs/:id/assist", strictRateLimit, async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const d = docAssistRequest.parse(r.body);
    const doc = await readable(r.headers, id, u.id);
    const at = doc.content.findIndex((b) => b.id === d.block_id);
    if (at === -1) fail(404, "That line is not on this page");
    const source = blockText(doc.content[at]);
    const quote = source.slice(d.range_start, d.range_end);
    if (!quote.trim()) fail(422, "There are no words there to work on");

    const context = doc.content
      .slice(Math.max(0, at - AROUND), at + AROUND + 1)
      .map((b) => blockText(b))
      .filter(Boolean)
      .join("\n");
    const asks =
      d.action === "custom"
        ? d.instruction || "Rewrite it."
        : DOC_AI_LABELS[d.action].asks;

    const system = `You are editing one passage of a document.
Reply with the replacement passage and NOTHING else: no preamble, no
quotation marks around it, no explanation, no Markdown fences. Keep the
author's voice and any Markdown formatting the passage already uses. If the
passage should be removed entirely, reply with an empty line.`;
    let answer: string;
    try {
      answer = clean(
        await completePageFeature(
          u.id,
          "doc_assist",
          [{ id, version: doc.version }],
          [
            { role: "system", content: system },
            {
              role: "user",
              content: `Document: ${doc.title}\n\nSurrounding text for context only:\n${context}\n\nThe passage to work on:\n${quote}\n\nWhat to do: ${asks}`,
            },
          ],
          { timeoutMs: 60_000 },
        ),
      );
    } catch (error) {
      if (error instanceof HttpError) throw error;
      r.log.error({ event: "ai_doc_assist_failed", provider: "selected" });
      fail(502, "The AI provider could not answer. Please try again.");
    }
    if (answer === quote)
      fail(409, "The assistant had nothing to change there.");

    // Places and words as the page keeps them, not as they were shown.
    const kept = blockText(doc.stored[at]);
    const line = doc.links.line(kept);
    const stored = line.changed
      ? (() => {
          const start = line.toStored(d.range_start);
          const end = Math.max(start, line.toStored(d.range_end, true));
          return { start, end, quote: kept.slice(start, end) };
        })()
      : { start: d.range_start, end: d.range_end, quote };
    const made = await transaction(async (db) => {
      if (doc.team_id) await requireTeam(doc.team_id, u, "items:read");
      const [made] = await proposeChanges(
        db,
        id,
        u.id,
        [
          {
            block_id: d.block_id,
            kind: answer ? "replace" : "delete",
            range_start: stored.start,
            range_end: stored.end,
            text: keepLinkLabels(answer, doc.stored, doc.links.hidden),
            quote: stored.quote,
          },
        ],
        `Assistant · ${
          d.action === "custom"
            ? d.instruction.slice(0, 120)
            : DOC_AI_LABELS[d.action].name
        }`,
      );
      return made;
    });
    reply.code(201);
    // Places, quoted words and the offered words as this reader is shown
    // them (D3aF): the stored text keeps hidden titles, the reply must not.
    const [shown] = await carryRanges(pool, u.id, id, [made], "shown");
    return readableLinks(pool, u.id, shown);
  });

  /**
   * Answer a question about this page, from this page. Nothing else is read
   * — not other pages, not the schedule — so an answer can be checked
   * against the lines it names.
   */
  app.post("/docs/:id/ask", strictRateLimit, async (r): Promise<DocAnswer> => {
    const u = await authenticate(r);
    const id = idParam(r);
    const { question } = docAskRequest.parse(r.body);
    const doc = await readable(r.headers, id, u.id);
    const numbered = doc.content
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => blockText(b).trim())
      .map(({ b, i }) => `[${i}] ${blockText(b)}`)
      .join("\n");

    const system = `Answer using ONLY the document below. Reply with one JSON
object and nothing else: {"answer": string, "sources": [number]}
- "sources" are the [n] line numbers your answer rests on, at most four.
- If the document does not say, answer exactly "The page doesn't say." with
  no sources. Never use knowledge from outside the document.`;
    let content: string;
    try {
      content = await completePageFeature(
        u.id,
        "doc_ask",
        [{ id, version: doc.version }],
        [
          { role: "system", content: system },
          {
            role: "user",
            content: `Document: ${doc.title}\n\n${numbered}\n\nQuestion: ${question}`,
          },
        ],
        { timeoutMs: 60_000 },
      );
    } catch (error) {
      if (error instanceof HttpError) throw error;
      r.log.error({ event: "ai_doc_ask_failed", provider: "selected" });
      fail(502, "The AI provider could not answer. Please try again.");
    }
    let parsed: { answer?: unknown; sources?: unknown };
    try {
      const body = clean(content);
      parsed = JSON.parse(
        body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1),
      );
    } catch {
      // A provider that would not give JSON still said something useful.
      return { answer: clean(content).slice(0, 4000), sources: [] };
    }
    const lines = Array.isArray(parsed.sources) ? parsed.sources : [];
    return {
      answer: String(parsed.answer ?? "").slice(0, 4000),
      sources: lines.slice(0, 4).flatMap((n) => {
        const block = doc.content[Number(n)];
        return block?.id
          ? [{ block_id: block.id, quote: blockText(block).slice(0, 300) }]
          : [];
      }),
    };
  });
}
