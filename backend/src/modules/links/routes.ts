import type { FastifyInstance } from "fastify";
import {
  linkPickQuery,
  linkResolveQuery,
  linksHereQuery,
  type LinkedHereList,
  type LinkOption,
  type LinkPill,
} from "@orbyn/core";
import { reader } from "../../db/pool.js";
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

  /** What the link picker offers for the words typed after [[. */
  app.get("/links/pick", async (r): Promise<LinkOption[]> => {
    const u = await authenticate(r);
    const q = linkPickQuery.parse(r.query ?? {});
    return pickOptions(reader(r.headers), u.id, q.q, q.limit);
  });
}
