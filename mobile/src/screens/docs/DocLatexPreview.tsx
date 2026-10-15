import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Text, View } from "react-native";
import { LatexPreviewStore, type LatexPreviewState } from "@orbyn/api-client";
import { docLatexBlock, type DocBlock } from "@orbyn/core";
import { session } from "../../lib/session";
import { DocumentPdfPreview } from "../../components/DocumentPdfPreview";
import { Button } from "../../components/Button";
import { shared } from "../../styles";
type Preview = LatexPreviewState & { canCompile: boolean; retry: () => void };
const Context = createContext<Preview | null>(null);
export const useDocLatexPreview = () => useContext(Context);
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
  children: React.ReactNode;
}) {
  const account = session.token,
    latest = useRef(compile);
  latest.current = compile;
  const store = useMemo(
    () =>
      new LatexPreviewStore((source, signal) => latest.current(source, signal)),
    [docId, account],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot),
    source = docLatexBlock(blocks)?.text ?? null;
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  useEffect(() => store.update(source, ready), [store, source, ready]);
  return (
    <Context.Provider value={{ ...state, canCompile, retry: store.retry }}>
      {children}
    </Context.Provider>
  );
}
export function DocLatexNote({ source }: { source: string }) {
  const preview = useDocLatexPreview();
  const [openError, setOpenError] = useState("");
  if (!preview) return <Text>{source}</Text>;
  return (
    <View
      accessibilityLabel="Rendered LaTeX note"
      style={{ minHeight: 320, height: 560, gap: 8 }}
    >
      {preview.pdf ? (
        <DocumentPdfPreview
          pdf={preview.pdf.blob}
          report={(error) =>
            setOpenError(
              error instanceof Error
                ? error.message
                : "Couldn’t open the PDF. Try again.",
            )
          }
        />
      ) : (
        !preview.error && (
          <Text accessibilityLiveRegion="polite" style={shared.small}>
            {preview.canCompile
              ? "Preparing preview…"
              : "PDF preview requires editing access."}
          </Text>
        )
      )}
      {openError && (
        <Text accessibilityRole="alert" style={shared.small}>
          {openError}
        </Text>
      )}
      {preview.busy && (
        <Text accessibilityLiveRegion="polite" style={shared.small}>
          Updating preview…
        </Text>
      )}
      {preview.pdf && preview.pdf.source !== source && (
        <Text style={shared.small}>Preview is updating.</Text>
      )}
      {preview.error && (
        <>
          <Text accessibilityRole="alert" style={shared.small}>
            {preview.error}
          </Text>
          <Button title="Retry preview" secondary onPress={preview.retry} />
        </>
      )}
    </View>
  );
}
