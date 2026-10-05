import { docUpdate } from "./schemas.js";
import { versionedDocSave } from "./doc-content-format.js";
import type { z } from "zod";

/** Complete editor ownership and ordinary metadata share one optimistic revision. */
export const docEditorUpdate = docUpdate
  .omit({ content: true })
  .extend({
    document: versionedDocSave.shape.document,
  })
  .strict();
export type DocEditorUpdate = z.output<typeof docEditorUpdate>;
