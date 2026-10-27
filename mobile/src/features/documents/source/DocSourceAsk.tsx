import React, { useEffect, useRef, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { Sheet } from "../../../components/Sheet";
import { InlineDetails } from "../../../components/InlineDetails";
import { Button } from "../../../components/Button";
import { shared } from "../../../styles";
import { fonts } from "../../../theme";

export function DocSourceAsk({
  text,
  onAsk,
  onClose,
}: {
  text: string;
  onAsk: (instruction: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const close = () => {
    if (!pending.current) onClose();
  };
  const submit = async () => {
    if (pending.current || !instruction.trim()) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await onAsk(instruction.trim());
      if (mounted.current) onClose();
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Couldn’t ask the assistant. Try again.",
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <Sheet visible title="Ask assistant" onClose={close} closeDisabled={busy}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12 }}
        keyboardShouldPersistTaps="handled"
      >
        <InlineDetails title="Selected source">
          <ScrollView style={{ maxHeight: 160 }}>
            <Text selectable style={[shared.small, { fontFamily: fonts.mono }]}>
              {text}
            </Text>
          </ScrollView>
        </InlineDetails>
        <Text style={shared.label}>What should change?</Text>
        <TextInput
          accessibilityLabel="What should change?"
          multiline
          scrollEnabled
          editable={!busy}
          value={instruction}
          onChangeText={setInstruction}
          maxLength={500}
          style={[
            shared.input,
            { minHeight: 90, maxHeight: 140, textAlignVertical: "top" },
          ]}
        />
        {!!error && (
          <Text accessibilityRole="alert" style={shared.small}>
            {error}
          </Text>
        )}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Button title="Cancel" secondary disabled={busy} onPress={close} />
          <Button
            title={busy ? "Asking…" : "Ask assistant"}
            disabled={busy || !instruction.trim()}
            onPress={() => void submit()}
          />
        </View>
      </ScrollView>
    </Sheet>
  );
}
