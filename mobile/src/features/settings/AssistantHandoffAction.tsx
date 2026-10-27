import React, { useEffect, useRef, useState } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
} from "react-native";
import type { AssistantHandoff } from "@orbyn/core";
import { Sheet } from "../../components/Sheet";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { inputFontSize, colors, fonts, radii, themed } from "../../theme";
import { shared } from "../../styles";
import { session } from "../../lib/session";

/** A short task goes to the other agent only after its source is checked. */
function HandoffBody({
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
  const pending = useRef(false);
  const mounted = useRef(true);
  const owner = session.token;
  const owned = () => mounted.current && session.token === owner;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = receipt ?? existing;
  const recipient = lane === "background" ? "Overnight" : "Background";
  useEffect(() => {
    if (
      !current ||
      ["completed", "failed", "cancelled"].includes(current.status)
    )
      return;
    let active = true;
    let reading = false;
    const timer = setInterval(() => {
      if (reading || !owned()) return;
      reading = true;
      void client
        .assistantHandoff(current.id)
        .then((next) => {
          if (active && owned()) {
            setReceipt(next);
            setError("");
          }
        })
        .catch(() => {
          if (active && owned()) setError("Couldn't refresh handoff.");
        })
        .finally(() => {
          reading = false;
        });
    }, 10_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [current?.id, current?.status]);
  const send = async () => {
    if (!instruction.trim() || pending.current || !owned()) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const source = await client.assistantHandoffSource(jobId);
      if (!owned()) return;
      if (source.lane !== lane) throw new Error("Source lane changed");
      const next = await client.requestAssistantHandoff({
        producer_job_id: jobId,
        expected_producer_revision: source.source.revision,
        recipient_lane: lane === "background" ? "overnight" : "background",
        title: title.slice(0, 120) || "Follow-up",
        instruction: instruction.trim(),
      });
      if (owned()) {
        setReceipt(next);
        setOpen(false);
      }
    } catch {
      if (owned())
        setError("Couldn't send this result. Refresh and try again.");
    } finally {
      pending.current = false;
      if (owned()) setBusy(false);
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
        <Sheet
          visible
          title={`Task for ${recipient}`}
          closeDisabled={busy}
          onClose={() => {
            if (!pending.current) setOpen(false);
          }}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 16, gap: 12 }}
          >
            <Text style={shared.label}>Task</Text>
            <TextInput
              accessibilityLabel={`Task for ${recipient}`}
              placeholder={`Task for ${recipient}`}
              value={instruction}
              onChangeText={setInstruction}
              multiline
              scrollEnabled
              maxLength={4000}
              style={[
                s.input,
                Platform.OS === "web" &&
                  ({
                    resize: "none",
                    overflowY: "auto",
                  } as unknown as TextStyle),
              ]}
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
            {!!error && (
              <Text accessibilityRole="alert" style={s.error}>
                {error}
              </Text>
            )}
          </ScrollView>
        </Sheet>
      ) : (
        <SmallAction
          label={`Hand off to ${recipient}`}
          disabled={false}
          onPress={() => setOpen(true)}
        />
      )}
      {!!error && !open && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
    </View>
  );
}

export function AssistantHandoffAction(
  props: React.ComponentProps<typeof HandoffBody>,
) {
  return (
    <HandoffBody
      key={`${session.token}:${props.jobId}:${props.lane}`}
      {...props}
    />
  );
}

const s = themed(() =>
  StyleSheet.create({
    wrap: { gap: 8, minWidth: 0 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    input: {
      minHeight: 64,
      maxHeight: 140,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      padding: 10,
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: inputFontSize,
      textAlignVertical: "top",
    },
    error: { color: colors.danger, fontSize: 13 },
  }),
);
