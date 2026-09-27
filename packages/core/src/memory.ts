import { z } from "zod";

export const MEMORY_SOURCE_TYPES = [
  "chat",
  "doc",
  "task",
  "project",
  "person",
] as const;
export type MemorySourceType = (typeof MEMORY_SOURCE_TYPES)[number];

export const memorySourceId = z
  .string()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    "Use a UUID source id.",
  );

/** Where a memory fact was learned, kept beside the visible source marker. */
export const memorySourceInput = z
  .object({
    type: z.enum(MEMORY_SOURCE_TYPES),
    id: memorySourceId.nullable().default(null),
    label: z.string().trim().min(1).max(300),
    quote: z.string().trim().max(1000).nullable().default(null),
  })
  .strict();
export type MemorySourceInput = z.output<typeof memorySourceInput>;

export const memoryFactInput = z.string().trim().min(1).max(500);
