import type { FastifyInstance } from "fastify";
import {
  docAskRequest,
  docAssistRequest,
  DOC_AI_LABELS,
  blockText,
  fail,
  type DocAnswer,
  type DocBlock,
} from "@orbyn/core";
import { reader, transaction } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam, strictRateLimit } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";
import { complete } from "./providers/adapters.js";
import { resolveAi } from "./providers/resolve.js";
import { readableDocs } from "../../lib/visibility.js";
import { proposeChanges } from "../docs/service.js";

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
        content: DocBlock[];
        team_id: string | null;
      }>(
        `SELECT d.id, d.title, d.content, d.team_id FROM docs d
          WHERE d.id = $2 AND d.deleted_at IS NULL
            AND ${readableDocs("d")}`,
        [userId, id],
      )
    ).rows[0];
    if (!doc) fail(404, "Document not found");
    return doc;
  }

  /** The provider, or a message saying who can turn one on. */
  async function provider() {
    const ai = await resolveAi();
    if (!ai)
      fail(
        503,
        "The AI assistant is not set up yet. An admin can connect a provider in Admin → AI.",
      );
    return ai;
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

    const ai = await provider();
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
        await complete(
          ai,
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
    } catch {
      r.log.error({ event: "ai_doc_assist_failed", provider: ai.kind });
      fail(502, "The AI provider could not answer. Please try again.");
    }
    if (answer === quote)
      fail(409, "The assistant had nothing to change there.");

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
            range_start: d.range_start,
            range_end: d.range_end,
            text: answer,
            quote,
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
    return made;
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
    const ai = await provider();
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
      content = await complete(
        ai,
        [
          { role: "system", content: system },
          {
            role: "user",
            content: `Document: ${doc.title}\n\n${numbered}\n\nQuestion: ${question}`,
          },
        ],
        { timeoutMs: 60_000 },
      );
    } catch {
      r.log.error({ event: "ai_doc_ask_failed", provider: ai.kind });
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
