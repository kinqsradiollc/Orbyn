import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { AssistantHandoff } from "@orbyn/core";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { colors, fonts, radii, themed } from "../../theme";
import { shared } from "../../styles";

/** A short task goes to the other agent only after its source is checked. */
export function AssistantHandoffAction({
  jobId,
  title,
  lane,
  existing,
  onOpenChat,
}: {
  jobId: string;
  title: string;
  lane: "background" | "overnight";
  existing?: {
    id: string;
    status: AssistantHandoff["status"];
    recipient_chat_id: string | null;
  } | null;
  onOpenChat?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [receipt, setReceipt] = useState<AssistantHandoff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = receipt ?? existing;
  const recipient = lane === "background" ? "Overnight" : "Background";
  useEffect(() => {
    if (
      !current ||
      ["completed", "failed", "cancelled"].includes(current.status)
    )
      return;
    const timer = setInterval(() => {
      void client
        .assistantHandoff(current.id)
        .then(setReceipt)
        .catch(() => setError("Couldn't refresh handoff."));
    }, 10_000);
    return () => clearInterval(timer);
  }, [current?.id, current?.status]);
  const send = async () => {
    if (!instruction.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const source = await client.assistantHandoffSource(jobId);
      if (source.lane !== lane) throw new Error("Source lane changed");
      const next = await client.requestAssistantHandoff({
        producer_job_id: jobId,
        expected_producer_revision: source.source.revision,
        recipient_lane: lane === "background" ? "overnight" : "background",
        title: title.slice(0, 120) || "Follow-up",
        instruction: instruction.trim(),
      });
      setReceipt(next);
      setOpen(false);
    } catch {
      setError("Couldn't send this result. Refresh and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={s.wrap}>
      {!open && current ? (
        <View style={s.wrap}>
          <Text accessibilityLiveRegion="polite" style={shared.small}>
            {recipient}:{" "}
            {
              {
                proposed: "Queued",
                accepted: "Working",
                completed: "Done",
                failed: "Needs review",
                cancelled: "Cancelled",
              }[current.status]
            }
          </Text>
          {current.recipient_chat_id && onOpenChat && (
            <SmallAction
              label="Open follow-up"
              disabled={false}
              onPress={() => onOpenChat(current.recipient_chat_id!)}
            />
          )}
          {current.status === "failed" && (
            <SmallAction
              label="Try again"
              disabled={false}
              onPress={() => {
                setReceipt(null);
                setOpen(true);
              }}
            />
          )}
        </View>
      ) : open ? (
        <>
          <TextInput
            accessibilityLabel={`Task for ${recipient}`}
            placeholder={`Task for ${recipient}`}
            value={instruction}
            onChangeText={setInstruction}
            multiline
            maxLength={4000}
            style={s.input}
            editable={!busy}
          />
          <View style={s.actions}>
            <SmallAction
              label={busy ? "Sending…" : `Send to ${recipient}`}
              disabled={busy || !instruction.trim()}
              onPress={() => void send()}
            />
            <SmallAction
              label="Cancel"
              disabled={busy}
              onPress={() => setOpen(false)}
            />
          </View>
        </>
      ) : (
        <SmallAction
          label={`Hand off to ${recipient}`}
          disabled={false}
          onPress={() => setOpen(true)}
        />
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    wrap: { gap: 8, minWidth: 0 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    input: {
      minHeight: 64,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      padding: 10,
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: 14,
      textAlignVertical: "top",
    },
    error: { color: colors.danger, fontSize: 13 },
  }),
);
