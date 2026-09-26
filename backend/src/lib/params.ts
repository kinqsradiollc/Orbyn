import type { FastifyRequest } from "fastify";
import { z } from "zod";

/** Read and validate a UUID route parameter. */
export const idParam = (r: FastifyRequest, key = "id") =>
  z.uuid().parse((r.params as Record<string, string>)[key]);

/** Rate-limit config for sensitive routes (auth, AI). */
/** Writes a person makes by hand, a few a second at most (D5). */
export const writeRateLimit = {
  config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
};

export const strictRateLimit = {
  config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
};
