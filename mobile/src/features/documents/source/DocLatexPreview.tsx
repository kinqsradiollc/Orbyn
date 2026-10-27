import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  docLatexBlock,
  docWholeLatex,
  EMPTY_LATEX_DOCUMENT,
  type DocBlock,
} from "@orbyn/core";
import { LatexHtmlPreview } from "../../../components/LatexHtmlPreview";
import { session } from "../../../lib/session";
let nextOwner = 0;
const Context = createContext<{
  owner: number;
  source: string;
  sourceOwner: string;
  setDraftSource: (source: string | null, sourceNumber?: number) => void;
} | null>(null);
export const useDocLatexPreview = () => useContext(Context);
/** Draft HTML belongs to this account/document; PDF compilation is explicit export. */
export function DocLatexPreviewProvider({
  blocks,
  docId,
  children,
}: {
  blocks: DocBlock[];
  docId: string;
  children: ReactNode;
  ready: boolean;
  canCompile: boolean;
  compile: (source: string, signal: AbortSignal) => Promise<Blob>;
}) {
  const account = session.token;
  const owner = useMemo(() => ++nextOwner, [docId, account]);
  const [draft, setDraft] = useState<{
    docId: string;
    account: typeof account;
    text: string | null;
    sourceNumber: number;
  } | null>(null);
  const setDraftSource = useCallback(
    (text: string | null, sourceNumber = -1) =>
      setDraft({ docId, account, text, sourceNumber }),
    [docId, account],
  );
  const currentDraft =
    draft?.docId === docId && draft.account === account && draft.text !== null;
  const selectedNumber = currentDraft ? draft.sourceNumber : -1;
  const selected = docLatexBlock(blocks, selectedNumber);
  const sourceOwner =
    selectedNumber < 0
      ? "whole-document"
      : (selected?.id ?? `source-${selectedNumber}`);
  const source =
    draft?.docId === docId && draft.account === account && draft.text !== null
      ? draft.text
      : docWholeLatex(blocks);
  return (
    <Context.Provider value={{ owner, source, sourceOwner, setDraftSource }}>
      {children}
    </Context.Provider>
  );
}
export function DocLatexDocumentPreview() {
  const preview = useDocLatexPreview();
  return (
    <LatexHtmlPreview
      key={`${preview?.owner}:${preview?.sourceOwner}`}
      source={preview?.source ?? EMPTY_LATEX_DOCUMENT}
      fill
    />
  );
}
export function DocLatexNote({
  block,
}: {
  block: Extract<DocBlock, { type: "code" }>;
}) {
  const preview = useDocLatexPreview();
  if (block.text.trim() === EMPTY_LATEX_DOCUMENT.trim()) return null;
  return <LatexHtmlPreview key={preview?.owner} source={block.text} />;
}
