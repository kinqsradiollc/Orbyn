import { docContent } from "./schemas.js";
import type { DocBlock } from "./docs.js";

/** Read projections can expand short private references; these are not storage limits. */
export const DOC_PROJECTED_TEXT_MAX = 480_000;
export const DOC_PROJECTED_TOTAL_MAX = 32_000_000;
export type DocContentValidationOptions = { projected?: boolean };

/** Validate all stored fields, with a separately bounded text budget for authorized projections. */
export function parseDocContentLeaves(
  value: unknown,
  options: DocContentValidationOptions = {},
): DocBlock[] {
  if (!Array.isArray(value) || value.length > 2000)
    throw new Error("Invalid document blocks.");
  let total = 0;
  const probe = value.map((raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("Invalid document block.");
    const block = raw as Record<string, unknown>;
    if (options.projected && typeof block.text === "string") {
      total += block.text.length;
      if (
        block.text.length > DOC_PROJECTED_TEXT_MAX ||
        total > DOC_PROJECTED_TOTAL_MAX
      )
        throw new Error("Document projection is too large.");
      return { ...block, text: "" };
    }
    return block;
  });
  const parsed = docContent.safeParse(probe);
  if (!parsed.success) throw new Error("Invalid document blocks.");
  return parsed.data.map((block, index) => {
    const raw = value[index] as Record<string, unknown>;
    if (Object.keys(raw).some((key) => !Object.hasOwn(block, key)))
      throw new Error("Unknown document block field.");
    return options.projected && "text" in block && typeof raw.text === "string"
      ? ({ ...block, text: raw.text } as DocBlock)
      : (block as DocBlock);
  });
}
