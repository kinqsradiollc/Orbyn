import React, { useState } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import type { Frame, Team } from "@orbyn/core";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { client } from "../../lib/api";
import { useRun } from "../../hooks/useRun";
import { colors, radii, themed } from "../../theme";
import { FrameForm } from "../PlanningSheet";

/** The frame editor, opened from a frame's band on the calendar. */
export function FrameSheet({
  frame,
  teams,
  onClose,
  onSaved,
}: {
  /** The frame to edit; the sheet shows while this is set. */
  frame: Frame | null;
  teams: Team[];
  onClose: () => void;
  /** After a change, so the calendar reloads. */
  onSaved: () => void;
}) {
  return (
    <Sheet visible={!!frame} title="Frame" onClose={onClose}>
      {frame && (
        <Body
          key={frame.id}
          frame={frame}
          teams={teams}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </Sheet>
  );
}

function Body({
  frame,
  teams,
  onClose,
  onSaved,
}: {
  frame: Frame;
  teams: Team[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, error, setError, run } = useRun();
  const [current, setCurrent] = useState(frame);
  return (
    <ScrollView
      contentContainerStyle={sheetStyles.body}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      <View style={sheetStyles.column}>
        <ErrorBanner error={error} onDismiss={() => setError("")} />
        <View style={s.card}>
          <FrameForm
            first
            frame={current}
            teams={teams}
            busy={busy}
            onCancel={onClose}
            onSave={(input) =>
              void run(async () => {
                await client.updateFrame(frame.id, input);
                onSaved();
                onClose();
              })
            }
            onUnskip={(date) =>
              void run(async () => {
                setCurrent(await client.unskipFrame(frame.id, date));
                onSaved();
              })
            }
            onDelete={() =>
              Alert.alert(`Delete ${frame.name}?`, "Tasks aren’t affected.", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () =>
                    void run(async () => {
                      await client.deleteFrame(frame.id);
                      onSaved();
                      onClose();
                    }),
                },
              ])
            }
          />
        </View>
      </View>
    </ScrollView>
  );
}

const s = themed(() =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      overflow: "hidden",
    },
  }),
);
