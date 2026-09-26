import type { FastifyInstance } from "fastify";
import {
  headingsQuery,
  linkCardQuery,
  linkMentionInput,
  mentionsQuery,
  linkPickQuery,
  linkResolveQuery,
  linksHereQuery,
  type HeadingOption,
  type LinkCard,
  type LinkedHereList,
  type RelatedPage,
  type UnlinkedMention,
  type LinkOption,
  type LinkPill,
} from "@orbyn/core";
import { reader } from "../../db/pool.js";
import {
  linkCard,
  linkUnlinkedMention,
  pageHeadings,
  relatedPages,
  unlinkedMentions,
} from "./more.js";
import { authenticate } from "../../lib/auth.js";
import { linksHere, pickOptions, resolveLinks } from "./service.js";

/**
 * Links between things (LNK-01, LNK-02, LNK-05): what the link picker
 * offers, each link's pill as it stands now, and "Linked here". Reads only;
 * links are made by saving a page (see migration 111's triggers).
 */
export async function linkRoutes(app: FastifyInstance) {
  /** "Linked here" for a page, task, event, project or person. */
  app.get("/links/here", async (r): Promise<LinkedHereList> => {
    const u = await authenticate(r);
    const q = linksHereQuery.parse(r.query ?? {});
    return linksHere(reader(r.headers), u.id, q);
  });

  /** Pills as they stand now: live titles, ticks, deadlines, deletions. */
  app.get("/links/resolve", async (r): Promise<LinkPill[]> => {
    const u = await authenticate(r);
    const { refs } = linkResolveQuery.parse(r.query ?? {});
    return resolveLinks(reader(r.headers), u.id, refs);
  });

  /** A link's hover card: enough to tick, reschedule or open it (LNK-07). */
  app.get("/links/card", async (r): Promise<LinkCard> => {
    const u = await authenticate(r);
    const q = linkCardQuery.parse(r.query ?? {});
    return linkCard(reader(r.headers), u.id, q);
  });

  /** Pages that say this page's or project's name without linking to it. */
  app.get("/links/mentions", async (r): Promise<UnlinkedMention[]> => {
    const u = await authenticate(r);
    const q = mentionsQuery.parse(r.query ?? {});
    return unlinkedMentions(reader(r.headers), u.id, q);
  });

  /** Make one of those mentions a link (a new version of that page). */
  app.post("/links/mentions/link", async (r) => {
    const u = await authenticate(r);
    const input = linkMentionInput.parse(r.body ?? {});
    return linkUnlinkedMention(u, input);
  });

  /** Pages that read like this one, not linked either way yet. */
  app.get("/links/related", async (r): Promise<RelatedPage[]> => {
    const u = await authenticate(r);
    const q = mentionsQuery.parse(r.query ?? {});
    if (q.kind !== "doc") return [];
    return relatedPages(reader(r.headers), u.id, q.id);
  });

  /** A page's headings (and lines, with words), for [[Page#. */
  app.get("/links/headings", async (r): Promise<HeadingOption[]> => {
    const u = await authenticate(r);
    const q = headingsQuery.parse(r.query ?? {});
    return pageHeadings(reader(r.headers), u.id, q.doc, q.q);
  });

  /** What the link picker offers for the words typed after [[. */
  app.get("/links/pick", async (r): Promise<LinkOption[]> => {
    const u = await authenticate(r);
    const q = linkPickQuery.parse(r.query ?? {});
    return pickOptions(reader(r.headers), u.id, q.q, q.limit);
  });
}
