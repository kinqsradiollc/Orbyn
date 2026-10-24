import React, { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { copyText } from "../lib/share";
import { MoreMenu } from "./MoreMenu";
import { BottomSheet } from "./BottomSheet";
import { SmallAction } from "./SmallAction";
import { shared } from "../styles";
import { colors } from "../theme";

export function CopyMessage({ text }: { text: string }) {
  return (
    <SmallAction
      quiet
      label="Copy"
      disabled={false}
      onPress={() => {
        void copyText(text);
      }}
    />
  );
}

export function UserMessage({
  text,
  textStyle,
}: {
  text: string;
  textStyle?: React.ComponentProps<typeof Text>["style"];
}) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 700 || text.split("\n").length > 10;
  return (
    <>
      <Text
        selectable
        style={textStyle ?? shared.body}
        numberOfLines={long && !expanded ? 10 : undefined}
      >
        {text}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {long && (
          <SmallAction
            quiet
            label={expanded ? "Show less" : "Show more"}
            disabled={false}
            onPress={() => setExpanded((value) => !value)}
          />
        )}
      </View>
    </>
  );
}

/** Native text selection uses an explicit sheet so dragging never opens a menu. */
export function AskAboutMessage({
  text,
  onSelect,
}: {
  text: string;
  onSelect: (excerpt: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState({ start: 0, end: 0 });
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    setRange({ start: 0, end: 0 });
    setPending(null);
  }, [text]);
  const excerpt = text.slice(range.start, range.end).trim();
  return (
    <>
      <MoreMenu
        label="Message options"
        actions={[
          {
            label: "Ask about text",
            onPress: () => {
              setRange({ start: 0, end: 0 });
              setOpen(true);
            },
          },
        ]}
      />
      <BottomSheet
        visible={open}
        title="Select text"
        onClose={() => {
          setPending(null);
          setOpen(false);
        }}
        afterClose={() => {
          if (pending) {
            onSelect(pending);
            setPending(null);
          }
        }}
      >
        <TextInput
          multiline
          editable={false}
          value={text}
          accessibilityLabel="Select an excerpt from this message"
          style={[shared.input, { minHeight: 160 }]}
          onSelectionChange={(event) => setRange(event.nativeEvent.selection)}
        />
        {excerpt.length > 2000 && (
          <Text
            accessibilityRole="alert"
            style={[shared.small, { color: colors.danger }]}
          >
            Select up to 2,000 characters.
          </Text>
        )}
        <SmallAction
          quiet
          label="Ask Orbyn"
          disabled={!excerpt || excerpt.length > 2000}
          onPress={() => {
            setPending(excerpt);
            setOpen(false);
          }}
        />
      </BottomSheet>
    </>
  );
}
