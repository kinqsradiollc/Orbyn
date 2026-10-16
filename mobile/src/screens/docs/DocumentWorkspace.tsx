import { createContext, useContext, useEffect, useRef } from "react";
export const DocumentLibraryContext = createContext<{
  setSourceOpen: (open: boolean) => void;
} | null>(null);
export function useDocumentLibrary(open: boolean) {
  const library = useContext(DocumentLibraryContext);
  const latest = useRef(library);
  latest.current = library;
  useEffect(() => {
    latest.current?.setSourceOpen(open);
    return () => latest.current?.setSourceOpen(false);
  }, [open]);
}
