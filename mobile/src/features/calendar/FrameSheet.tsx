import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Alert } from "../../lib/alert";
import type { Frame, Team } from "@orbyn/core";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { client } from "../../lib/api";
import { useRun } from "../../hooks/useRun";
import { colors, radii, themed } from "../../theme";
import { FrameForm } from "../planner/PlanningSheet";

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
  const [pending, setPending] = useState(false);
  return (
    <Sheet
      visible={!!frame}
      title="Edit frame"
      onClose={onClose}
      closeDisabled={pending}
    >
      {frame && (
        <Body
          key={frame.id}
          frame={frame}
          teams={teams}
          onClose={onClose}
          onSaved={onSaved}
          onBusyChange={setPending}
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
  onBusyChange,
}: {
  frame: Frame;
  teams: Team[];
  onClose: () => void;
  onSaved: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { busy, error, setError, run: execute } = useRun();
  const [current, setCurrent] = useState(frame);
  const alive = useRef(true);
  const saving = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      onBusyChange(false);
    };
  }, [onBusyChange]);
  const run = async (fn: () => Promise<void>) => {
    if (saving.current || !alive.current) return;
    saving.current = true;
    onBusyChange(true);
    try {
      await execute(fn);
    } finally {
      saving.current = false;
      if (alive.current) onBusyChange(false);
    }
  };
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
            onCancel={() => {
              if (!saving.current) onClose();
            }}
            onSave={(input) =>
              void run(async () => {
                await client.updateFrame(frame.id, input);
                if (!alive.current) return;
                onSaved();
                onClose();
              })
            }
            onUnskip={(date) =>
              void run(async () => {
                const next = await client.unskipFrame(frame.id, date);
                if (!alive.current) return;
                setCurrent(next);
                onSaved();
              })
            }
            onDelete={() =>
              Alert.alert(
                `Delete ${frame.name}?`,
                "All occurrences of this frame are removed. Tasks are unchanged.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: () =>
                      void run(async () => {
                        await client.deleteFrame(frame.id);
                        if (!alive.current) return;
                        onSaved();
                        onClose();
                      }),
                  },
                ],
              )
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
