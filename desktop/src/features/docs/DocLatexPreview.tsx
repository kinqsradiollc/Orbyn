import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { LatexPreviewStore, type LatexPreviewState } from "@orbyn/api-client";
import { docLatexBlock, type DocBlock } from "@orbyn/core";
import { session } from "../../lib/session";
type Preview = LatexPreviewState & {
  url: string | null;
  canCompile: boolean;
  retry: () => void;
};
const Context = createContext<Preview | null>(null);
export const useDocLatexPreview = () => useContext(Context);
/** The Note and both source presentations share one account-owned PDF. */
export function DocLatexPreviewProvider({
  blocks,
  docId,
  ready,
  canCompile,
  compile,
  children,
}: {
  blocks: DocBlock[];
  docId: string;
  ready: boolean;
  canCompile: boolean;
  compile: (source: string, signal: AbortSignal) => Promise<Blob>;
  children: ReactNode;
}) {
  const account = session.get(),
    latest = useRef(compile);
  latest.current = compile;
  const store = useMemo(
    () =>
      new LatexPreviewStore((source, signal) => latest.current(source, signal)),
    [docId, account],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const source = docLatexBlock(blocks)?.text ?? null;
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  useEffect(() => store.update(source, ready), [store, source, ready]);
  const [shown, setShown] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!state.pdf) {
      setShown(null);
      return;
    }
    const url = URL.createObjectURL(state.pdf.blob);
    setShown({ blob: state.pdf.blob, url });
    return () => URL.revokeObjectURL(url);
  }, [state.pdf]);
  return (
    <Context.Provider
      value={{
        ...state,
        canCompile,
        url: shown?.blob === state.pdf?.blob ? (shown?.url ?? null) : null,
        retry: store.retry,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function DocLatexNote({ source }: { source: string }) {
  const preview = useDocLatexPreview();
  if (!preview) return <pre>{source}</pre>;
  return (
    <section className="doc-latex-note" aria-label="Rendered LaTeX note">
      {preview.url ? (
        <iframe title="LaTeX note" src={preview.url} />
      ) : (
        !preview.error && (
          <p role="status">
            {preview.canCompile
              ? "Preparing preview…"
              : "PDF preview requires editing access."}
          </p>
        )
      )}
      {preview.busy && <p role="status">Updating preview…</p>}
      {preview.pdf && preview.pdf.source !== source && (
        <p className="muted" role="status">
          Preview is updating.
        </p>
      )}
      {preview.error && (
        <div role="alert">
          <p>{preview.error}</p>
          <button className="secondary" onClick={preview.retry}>
            Retry preview
          </button>
        </div>
      )}
    </section>
  );
}
