import { createContext, useContext, useEffect, useRef } from "react";
import { Pressable } from "react-native";
import { colors } from "../../theme";
import { Icon } from "../../components/Icon";
export const DocumentLibraryContext = createContext<{
  hidden: boolean;
  toggle: () => void;
  hide: () => void;
} | null>(null);
export function DocumentLibraryButton() {
  const library = useContext(DocumentLibraryContext);
  if (!library) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Document library"
      onPress={library.toggle}
      style={{
        minHeight: 44,
        minWidth: 44,
        paddingHorizontal: 8,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
      }}
    >
      <Icon name="folder" size={16} color={colors.muted} />
    </Pressable>
  );
}
export function useDocumentLibrary(open: boolean) {
  const library = useContext(DocumentLibraryContext);
  const latest = useRef(library);
  latest.current = library;
  useEffect(() => {
    if (open) latest.current?.hide();
  }, [open]);
}
