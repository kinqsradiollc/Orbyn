import { z } from "zod";

/** Bound host-supplied JSON before capability dispatch; it grants no authority. */
export const pluginToolInput = z
  .object({
    name: z.string().min(1).max(128),
    arguments: z.record(z.string(), z.unknown()),
  })
  .strict()
  .superRefine((input, context) => {
    const pending: { value: unknown; depth: number }[] = [
      { value: input.arguments, depth: 0 },
    ];
    const seen = new WeakSet<object>();
    let nodes = 0;
    while (pending.length) {
      const { value, depth } = pending.pop()!;
      if (++nodes > 4096 || depth > 16) {
        context.addIssue({
          code: "custom",
          message: "Tool arguments exceed the structural limit.",
        });
        return;
      }
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean"
      )
        continue;
      if (typeof value === "number" && Number.isFinite(value)) continue;
      if (typeof value !== "object" || seen.has(value)) {
        context.addIssue({
          code: "custom",
          message: "Tool arguments must contain JSON values.",
        });
        return;
      }
      seen.add(value);
      if (
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
      ) {
        context.addIssue({
          code: "custom",
          message: "Tool arguments must contain JSON objects.",
        });
        return;
      }
      const children = Object.values(value);
      if (nodes + pending.length + children.length > 4096) {
        context.addIssue({
          code: "custom",
          message: "Tool arguments exceed the structural limit.",
        });
        return;
      }
      for (const child of children)
        pending.push({ value: child, depth: depth + 1 });
    }
  });
