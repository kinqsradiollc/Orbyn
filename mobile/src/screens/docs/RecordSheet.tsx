import React, { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "../../motion";
import {
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type RecordingOptions,
} from "expo-audio";
import {
  RECORDING_CONSENT,
  RECORDING_MAX_MINUTES,
  recordingClock,
  summaryLines,
  aiFeatureProviderLabel,
  type DocBlock,
  type RecordingSummary,
} from "@orbyn/core";
import { BottomSheet } from "../../components/BottomSheet";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { client } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { tap } from "../../lib/haptics";
import { inputFontSize, colors, fonts, radii, themed } from "../../theme";

/**
 * Record audio into a page (CAP-10). The sheet says first what happens to
 * the recording; Record asks for the microphone, and Stop hands the audio
 * to the page, which keeps it in Orbyn's own file store like any file.
 * Speech needs little: mono AAC at 32 kbit/s keeps an hour near 15 MB.
 */
const SPEECH: RecordingOptions = {
  extension: ".m4a",
  sampleRate: 22050,
  numberOfChannels: 1,
  bitRate: 32000,
  android: { outputFormat: "mpeg4", audioEncoder: "aac" },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: "audio/webm", bitsPerSecond: 32000 },
};

export type Recording = {
  uri: string;
  name: string;
  mime: string;
  file?: File;
};

export function RecordSheet({
  visible,
  onDone,
  onClose,
}: {
  visible: boolean;
  onDone: (recording: Recording) => void;
  onClose: () => void;
}) {
  const recorder = useAudioRecorder(SPEECH);
  const [state, setState] = useState<"ready" | "asking" | "on" | "saving">(
    "ready",
  );
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const started = useRef(0);
  const mutation = useRef(false);
  const generation = useRef(0);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  useEffect(() => {
    generation.current++;
    return () => {
      generation.current++;
      if (recorder.isRecording)
        void recorder
          .stop()
          .then(() => setAudioModeAsync({ allowsRecording: false }))
          .catch(() => {});
    };
  }, [visible]);
  useEffect(() => {
    if (state !== "on") return;
    const t = setInterval(() => {
      const s = Math.floor((Date.now() - started.current) / 1000);
      setSeconds(s);
      if (s >= RECORDING_MAX_MINUTES * 60) void stop();
    }, 500);
    return () => clearInterval(t);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!visible) {
      setState("ready");
      setSeconds(0);
      setError("");
    }
  }, [visible]);

  const start = async () => {
    if (mutation.current || state !== "ready" || !visibleRef.current) return;
    mutation.current = true;
    const epoch = generation.current;
    setError("");
    setState("asking");
    const permission = await requestRecordingPermissionsAsync().catch(
      () => null,
    );
    if (epoch !== generation.current || !visibleRef.current) {
      mutation.current = false;
      return;
    }
    if (!permission?.granted) {
      mutation.current = false;
      setState("ready");
      setError("Allow microphone access in Settings, then retry.");
      return;
    }
    try {
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      if (epoch !== generation.current || !visibleRef.current) {
        await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
        return;
      }
      recorder.record();
      started.current = Date.now();
      setSeconds(0);
      setState("on");
      tap();
    } catch (e) {
      if (epoch === generation.current) {
        setState("ready");
        setError(errorText(e));
      }
    } finally {
      mutation.current = false;
    }
  };
  const stop = async () => {
    if (mutation.current || state !== "on") return;
    mutation.current = true;
    const epoch = generation.current;
    setState("saving");
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      if (epoch !== generation.current || !visibleRef.current) return;
      const uri = recorder.uri;
      if (!uri) throw new Error("Nothing was recorded. Try again.");
      const web = Platform.OS === "web";
      const at = new Date();
      const name = `Recording ${at.toLocaleDateString([], {
        day: "numeric",
        month: "short",
      })} ${at.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}${web ? ".weba" : ".m4a"}`.replace(/[/:]/g, ".");
      tap();
      onDone({ uri, name, mime: web ? "audio/webm" : "audio/mp4" });
    } catch (e) {
      if (epoch === generation.current) {
        setState("ready");
        setError(errorText(e));
      }
    } finally {
      mutation.current = false;
    }
  };

  return (
    <BottomSheet
      visible={visible}
      title="Record audio"
      onClose={() => {
        if (state === "ready" && !mutation.current) onClose();
      }}
      closeDisabled={state !== "ready"}
    >
      <View style={s.body}>
        <Text style={s.note}>{RECORDING_CONSENT}</Text>
        <View style={s.clock} accessibilityLiveRegion="polite">
          <View style={[s.dot, state === "on" && s.dotOn]} />
          <Text style={s.time}>{recordingClock(seconds)}</Text>
          <Text style={s.note}>of {RECORDING_MAX_MINUTES} min</Text>
        </View>
        {error ? (
          <Text style={s.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        {state === "on" ? (
          <Button
            title="Stop and add to page"
            icon="square"
            onPress={() => void stop()}
          />
        ) : (
          <Button
            title={
              state === "asking"
                ? "Waiting for the microphone…"
                : state === "saving"
                  ? "Adding…"
                  : "Record"
            }
            icon="mic"
            disabled={state !== "ready"}
            onPress={() => void start()}
          />
        )}
      </View>
    </BottomSheet>
  );
}

/**
 * A recording's summary and action items (CAP-10), asked of the hosted
 * assistant only when the person presses Summarise. Nothing changes until
 * they add the summary to the page or make an action item a task.
 */
export function RecordingSummarySheet({
  target,
  onAddToPage,
  onClose,
}: {
  target: { fileId: string; name: string } | null;
  onAddToPage?: (lines: DocBlock[]) => void;
  onClose: () => void;
}) {
  const [asked, setAsked] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [result, setResult] = useState<RecordingSummary | null>(null);
  const [error, setError] = useState("");
  const [made, setMade] = useState<Set<number>>(new Set());
  const summaryGeneration = useRef(0);
  const mutation = useRef(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    summaryGeneration.current++;
    setAsked(false);
    setTranscript("");
    setResult(null);
    setError("");
    setMade(new Set());
    setBusy(false);
    mutation.current = false;
    return () => {
      summaryGeneration.current++;
    };
  }, [target?.fileId]);
  const ask = () => {
    if (!target || mutation.current || asked) return;
    mutation.current = true;
    const generation = summaryGeneration.current;
    setAsked(true);
    setError("");
    client
      .summariseRecording(target.fileId, transcript.trim() || undefined)
      .then(
        (value) => {
          if (generation === summaryGeneration.current) {
            mutation.current = false;
            setResult(value);
          }
        },
        (e) => {
          if (generation !== summaryGeneration.current) return;
          mutation.current = false;
          setError(errorText(e));
          setAsked(false);
        },
      );
  };
  const makeTask = async (i: number) => {
    const a = result?.actions[i];
    if (!a || mutation.current || made.has(i)) return;
    mutation.current = true;
    setBusy(true);
    const generation = summaryGeneration.current;
    try {
      await client.createItem({
        title: a.title,
        kind: "task",
        ...(a.due
          ? { due_at: new Date(`${a.due}T17:00:00`).toISOString() }
          : {}),
      });
      if (generation === summaryGeneration.current)
        setMade((s) => new Set(s).add(i));
    } catch (e) {
      if (generation === summaryGeneration.current) setError(errorText(e));
    } finally {
      if (generation === summaryGeneration.current) {
        mutation.current = false;
        setBusy(false);
      }
    }
  };
  return (
    <BottomSheet
      visible={!!target}
      title="Recording summary"
      closeDisabled={busy || (asked && !result)}
      onClose={() => {
        if (!mutation.current) onClose();
      }}
    >
      <View style={s.body}>
        {target && <Text style={s.note}>{target.name}</Text>}
        {!result ? (
          <>
            <Text style={s.note}>
              Summaries use your selected AI. ChatGPT accepts transcripts; audio
              transcription needs Orbyn's provider.
            </Text>
            <Text style={s.label}>Transcript (optional)</Text>
            <TextInput
              accessibilityLabel="Transcript (optional)"
              multiline
              value={transcript}
              onChangeText={setTranscript}
              editable={!asked}
              maxLength={200000}
              style={s.transcript}
            />
            {error ? (
              <Text style={s.error} accessibilityRole="alert">
                {error}
              </Text>
            ) : null}
            <Button
              title={asked ? "Preparing summary…" : "Summarise"}
              icon="sparkles"
              disabled={asked}
              onPress={ask}
            />
          </>
        ) : (
          <>
            {result.provider && (
              <Text style={s.note}>
                {aiFeatureProviderLabel(result.provider)}
              </Text>
            )}
            {result.summary.split(/\n{2,}/).map((p, i) => (
              <Text key={i} style={s.summary}>
                {p}
              </Text>
            ))}
            {result.actions.length > 0 && (
              <Text style={s.label}>Action items</Text>
            )}
            {result.actions.map((a, i) => (
              <View key={i} style={s.action}>
                <Text style={s.actionText}>
                  {a.title}
                  {a.due ? <Text style={s.note}> · by {a.due}</Text> : null}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy || made.has(i)}
                  hitSlop={8}
                  style={{ minHeight: 44, justifyContent: "center" }}
                  onPress={() => makeTask(i)}
                >
                  <Text style={s.link}>
                    {made.has(i) ? "Added" : "Make a task"}
                  </Text>
                </Pressable>
              </View>
            ))}
            {error ? (
              <Text style={s.error} accessibilityRole="alert">
                {error}
              </Text>
            ) : null}
            {onAddToPage && (
              <Button
                title="Add to page"
                disabled={busy}
                onPress={() => {
                  if (mutation.current) return;
                  onAddToPage(summaryLines(result));
                  onClose();
                }}
              />
            )}
          </>
        )}
      </View>
    </BottomSheet>
  );
}

const s = themed(() =>
  StyleSheet.create({
    body: { gap: 14, paddingBottom: 8 },
    note: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    transcript: {
      minHeight: 100,
      padding: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radii.input,
      fontFamily: fonts.regular,
      fontSize: inputFontSize,
      color: colors.text,
      textAlignVertical: "top",
    },
    clock: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 10,
    },
    dot: {
      width: 12,
      height: 12,
      borderRadius: radii.pill,
      backgroundColor: colors.border,
    },
    dotOn: { backgroundColor: colors.danger },
    time: {
      fontFamily: fonts.display,
      fontSize: 28,
      color: colors.text,
      fontVariant: ["tabular-nums"],
    },
    error: { fontFamily: fonts.regular, fontSize: 13, color: colors.danger },
    summary: { fontFamily: fonts.regular, fontSize: 15, color: colors.text },
    label: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.muted,
    },
    action: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 12,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: radii.input,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    actionText: {
      flexGrow: 1,
      flexBasis: 160,
      minWidth: 0,
      fontFamily: fonts.regular,
      fontSize: 13,
      color: colors.text,
    },
    link: { fontFamily: fonts.medium, fontSize: 13, color: colors.accent },
  }),
);
