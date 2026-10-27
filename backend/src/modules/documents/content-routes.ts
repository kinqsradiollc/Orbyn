import type { FastifyInstance } from "fastify";
import { fail, versionedDocSave, type DocContentFormat } from "@orbyn/core";
import { z } from "zod";
import { authenticate } from "../../lib/auth.js";
import { pool, transaction } from "../../db/pool.js";
import { readVersionedDoc, saveVersionedDoc } from "./content-format.js";
import { announceDocChange } from "./live.js";
import { syncSavedPages } from "../study/service.js";

/** Missing capability is legacy format1; malformed or unknown declarations never imply support. */
export function docContentFormatsHeader(value: unknown): DocContentFormat[] {
  if (value === undefined) return [1];
  if (
    typeof value !== "string" ||
    value.length > 32 ||
    !/^[12](?:\s*,\s*[12])*$/.test(value)
  )
    fail(400, "Invalid document content capability.");
  return [
    ...new Set(
      value.split(",").map((item) => Number(item.trim()) as DocContentFormat),
    ),
  ];
}

/** Explicit versioned content endpoint; legacy editors continue to use the existing API. */
export async function docContentRoutes(app: FastifyInstance) {
  const id = (params: unknown) => z.object({ id: z.uuid() }).parse(params).id;
  app.get("/docs/:id/content", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const user = await authenticate(request);
    const supported = docContentFormatsHeader(
      request.headers["x-orbyn-doc-formats"],
    );
    // Editing and visibility reads use the primary rather than stale replica state.
    return readVersionedDoc(pool, user, id(request.params), supported);
  });
  app.put(
    "/docs/:id/content",
    {
      bodyLimit: 32_000_000,
      onRequest: async (request) => {
        await authenticate(request);
      },
    },
    async (request) => {
      const user = await authenticate(request);
      const docId = id(request.params);
      const supported = docContentFormatsHeader(
        request.headers["x-orbyn-doc-formats"],
      );
      const body = versionedDocSave.parse(request.body);
      const raw = request.headers["x-orbyn-ticks-from"];
      const tickVersion =
        typeof raw === "string" && /^\d{1,9}$/.test(raw) ? Number(raw) : 0;
      const ticksFrom =
        tickVersion > 0 ? Math.min(tickVersion, body.version) : null;
      const saved = await transaction((db) =>
        saveVersionedDoc(
          db,
          user,
          docId,
          body.version,
          body.document,
          supported,
          ticksFrom,
        ),
      );
      const editor =
        typeof request.headers["x-orbyn-editor"] === "string"
          ? request.headers["x-orbyn-editor"].slice(0, 64)
          : "";
      await announceDocChange(pool, docId, saved.version, editor);
      await syncSavedPages(docId);
      return saved;
    },
  );
}
