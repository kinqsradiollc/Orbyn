import type { ReactNode } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { colors, inputFontSize, themed } from "../../theme";

/** Ordinary note text is edited in place; code opens the document source workspace. */
export function DocWritingBody({
  children,
  text,
  editing,
  index,
  onChange,
}: {
  children: ReactNode;
  text: string | null;
  editing: boolean;
  index: number;
  onChange: (text: string) => void;
}) {
  const showEditor = editing && text !== null;
  return (
    <View>
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
      {!showEditor && (
        <View
          pointerEvents="auto"
          accessibilityElementsHidden={false}
          importantForAccessibility="auto"
        >
          {children}
        </View>
      )}
    </View>
  );
}
const styles = themed(() =>
  StyleSheet.create({
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
