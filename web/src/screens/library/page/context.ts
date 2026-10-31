import type { DocReferences, LinkPill, ObjectRef } from "@orbyn/core";
import { createContext } from "react";

export type PageLinks = {
  docId: string;
  pills: Map<string, LinkPill>;
  onFragment: (fragment: string) => void;
  onOpen: (url: string) => void;
  onToggleTask?: (id: string, done: boolean) => void;
  onSummarise?: (fileId: string, name: string) => void;
  onRestoreDoc?: (id: string) => void;
  projectId: string | null;
};

export const PageContext = createContext<PageLinks | null>(null);

export const FootnoteContext = createContext<{
  references?: DocReferences;
  numbers: Map<string, number>;
  texts: Map<string, string>;
}>({ numbers: new Map(), texts: new Map() });

export const pillKey = (
  ref: Pick<ObjectRef, "kind" | "id"> & { block?: string },
) => `${ref.kind}:${ref.id}${ref.block ? `#${ref.block}` : ""}`;
