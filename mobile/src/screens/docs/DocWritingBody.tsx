import type { ReactNode } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { colors, inputFontSize, themed } from "../../theme";

/** A hidden code renderer keeps its PDF/diagram state while source is edited. */
export function DocWritingBody({
  children,
  text,
  editing,
  keepRendered,
  index,
  onChange,
}: {
  children: ReactNode;
  text: string | null;
  editing: boolean;
  keepRendered: boolean;
  index: number;
  onChange: (text: string) => void;
}) {
  const showEditor = editing && text !== null;
  return (
    <>
      {showEditor && (
        <TextInput
          autoFocus
          accessibilityLabel={`Edit block ${index + 1}`}
          style={styles.input}
          multiline
          value={text}
          onChangeText={onChange}
        />
      )}
      {(!showEditor || keepRendered) && (
        <View
          style={showEditor ? styles.hidden : undefined}
          pointerEvents={showEditor ? "none" : "auto"}
          accessibilityElementsHidden={showEditor}
          importantForAccessibility={
            showEditor ? "no-hide-descendants" : "auto"
          }
        >
          {children}
        </View>
      )}
    </>
  );
}
const styles = themed(() =>
  StyleSheet.create({
    hidden: { display: "none" },
    input: {
      minHeight: 44,
      maxHeight: 240,
      color: colors.text,
      padding: 0,
      fontSize: inputFontSize,
      lineHeight: 26,
    },
  }),
);
