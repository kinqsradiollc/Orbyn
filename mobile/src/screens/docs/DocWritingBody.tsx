import type { ReactNode } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { colors, inputFontSize, themed } from "../../theme";

/** Code source and its live result share the writing surface without remounting. */
export function DocWritingBody({
  children,
  text,
  editing,
  keepRendered,
  index,
  onChange,
  splitEditing = false,
}: {
  children: ReactNode;
  text: string | null;
  editing: boolean;
  keepRendered: boolean;
  index: number;
  onChange: (text: string) => void;
  splitEditing?: boolean;
}) {
  const showEditor = editing && text !== null;
  const paired = showEditor && keepRendered;
  return (
    <View style={paired && splitEditing ? styles.pair : undefined}>
      {showEditor && (
        <TextInput
          autoFocus
          accessibilityLabel={`Edit block ${index + 1}`}
          style={[
            styles.input,
            paired && styles.pairedInput,
            paired && splitEditing && styles.pane,
          ]}
          multiline
          value={text}
          onChangeText={onChange}
        />
      )}
      {(!showEditor || keepRendered) && (
        <View
          style={paired && splitEditing ? styles.pane : undefined}
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
    pairedInput: { height: 240 },
    pair: { flexDirection: "row", alignItems: "flex-start", gap: 16 },
    pane: { flex: 1, minWidth: 0 },
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
