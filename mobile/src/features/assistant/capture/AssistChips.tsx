import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "../../../motion";
import {
  aiFeatureProviderLabel,
  ASSIST_CHIPS,
  CHIP_CARDS,
  withDocumentSummary,
  HttpError,
  type DocEditorUpdate,
  type AssistChip,
  type CaptureAssistResult,
} from "@orbyn/core";
import * as Crypto from "expo-crypto";
import { InlineDetails } from "../../../components/InlineDetails";
import { session } from "../../../lib/session";
import { BottomSheet } from "../../../components/BottomSheet";
import { Button } from "../../../components/Button";
import { Icon, type IconName } from "../../../components/Icon";
import { showToast } from "../../../components/Toast";
import { client } from "../../../lib/api";
import { errorText } from "../../../lib/errors";
import { copyText } from "../../../lib/share";
import { colors, fonts, radii, themed } from "../../../theme";

const ICONS: Record<AssistChip, IconName> = {
  summarise: "sparkles",
  deadlines: "calendarCheck",
  cards: "graduationCap",
};

/** A due date in a few words, on this phone's clock. */
const dueText = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * The assistant's chips when sharing, importing or scanning (AI-01):
 * Summarise, Pull out deadlines as tasks, Make 10 flashcards. Optional,
 * through the selected provider, and each comes back as a
 * suggestion: nothing changes until you take it. Works on a page (just
 * imported or scanned) or on words shared in.
 */
export function AssistChips(props: Parameters<typeof AssistChipsBody>[0]) {
  return (
    <AssistChipsBody
      key={`${session.token}:${props.docId ?? ""}:${props.text ?? ""}`}
      {...props}
    />
  );
}
function AssistChipsBody({
  docId,
  text,
  title,
  onMakeCards,
  onChanged,
}: {
  /** A page; or `text`, words shared in with no page yet. */
  docId?: string;
  text?: string;
  title: string;
  /** "Make 10 flashcards": Study's suggestion for the page. */
  onMakeCards?: (docId: string, title: string, max: number) => void;
  /** Tasks were added, or the page changed. */
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState<"summarise" | "deadlines" | null>(null);
  const chips = ASSIST_CHIPS.filter(
    (c) => c.id !== "cards" || (!!docId && !!onMakeCards),
  );
  return (
    <>
      <View
        style={s.row}
        accessibilityRole="toolbar"
        accessibilityLabel="Ask the assistant"
      >
        {chips.map((chip) => (
          <Pressable
            key={chip.id}
            accessibilityRole="button"
            onPress={() =>
              chip.id === "cards"
                ? onMakeCards?.(docId!, title, CHIP_CARDS)
                : setOpen(chip.id)
            }
            style={({ pressed }) => [s.chip, pressed && s.chipPressed]}
          >
            <Icon name={ICONS[chip.id]} size={14} color={colors.accent} />
            <Text style={s.chipText}>{chip.label}</Text>
          </Pressable>
        ))}
      </View>
      {open && (
        <AssistResult
          key={open}
          action={open}
          docId={docId}
          text={text}
          title={title}
          onClose={(changed) => {
            setOpen(null);
            if (changed) onChanged?.();
          }}
        />
      )}
    </>
  );
}

/** What the assistant suggested, to take or leave. */
function AssistResult({
  action,
  docId,
  text,
  title,
  onClose,
}: {
  action: "summarise" | "deadlines";
  docId?: string;
  text?: string;
  title: string;
  onClose: (changed: boolean) => void;
}) {
  const [visible, setVisible] = useState(true);
  const changed = useRef(false);
  const [result, setResult] = useState<CaptureAssistResult | null>(null);
  const [keep, setKeep] = useState<boolean[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState("");
  const [added, setAdded] = useState<number[]>([]);
  const addedTasks = useRef(new Set<number>());
  const taskKeys = useRef<string[]>([]);
  const summaryWrite = useRef<{ key: string; input: DocEditorUpdate } | null>(
    null,
  );
  const mounted = useRef(true);
  const pending = useRef(false);
  const owner = session.token;
  const current = () => mounted.current && session.token === owner;
  const read = useRef<Promise<CaptureAssistResult> | null>(null);
  const load = async () => {
    if (!current() || pending.current) return;
    setLoading(true);
    setError("");
    try {
      const r = await (read.current ??= client.assistCapture(
        docId ? { action, doc_id: docId } : { action, text: text ?? "", title },
      ));
      if (!current()) return;
      if (r.action !== action)
        throw new Error("Unexpected suggestion. Try again.");
      setResult(r);
      setSummary(r.summary);
      setKeep(r.tasks.map(() => true));
      taskKeys.current = r.tasks.map(() => Crypto.randomUUID());
    } catch (e) {
      if (current()) {
        read.current = null;
        setError(errorText(e));
      }
    } finally {
      if (current()) setLoading(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, []);
  const leave = () => {
    if (!pending.current && current()) setVisible(false);
  };
  const take = async () => {
    if (!result || pending.current || !current()) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (action === "summarise") {
        if (!docId) {
          const copied = await copyText(summary, "Summary copied");
          if (current()) {
            if (copied) setVisible(false);
            else setError("Couldn't copy the summary. Try again.");
          }
          return;
        }
        if (!summaryWrite.current) {
          const doc = await client.getDocForEditor(docId);
          if (!current()) return;
          summaryWrite.current = {
            key: Crypto.randomUUID(),
            input: {
              version: doc.version,
              document: withDocumentSummary(
                doc.document ?? { format: 1, blocks: doc.content },
                summary,
              ),
            },
          };
        }
        const snapshot = summaryWrite.current;
        await client.once(snapshot.key, () =>
          client.updateDocForEditor(docId, snapshot.input),
        );
        if (!current()) return;
        changed.current = true;
        showToast({ text: "Summary added" });
      } else {
        for (const [n, task] of result.tasks.entries()) {
          if (!keep[n] || addedTasks.current.has(n)) continue;
          if (!current()) return;
          await client.once(taskKeys.current[n], () =>
            client.createItem({
              id: taskKeys.current[n],
              title: task.title,
              kind: "task",
              due_at: task.due_at,
              notes: task.source ? `From “${title}”: ${task.source}` : "",
            }),
          );
          if (!current()) return;
          addedTasks.current.add(n);
          changed.current = true;
          setAdded([...addedTasks.current]);
          setKeep((all) =>
            all.map((value, index) => (index === n ? false : value)),
          );
        }
        if (current())
          showToast({ text: `Added ${addedTasks.current.size} tasks` });
      }
      if (current()) setVisible(false);
    } catch (e) {
      if (
        e instanceof HttpError &&
        (e.status === 400 ||
          (e.status === 409 &&
            e.message ===
              "This document changed somewhere else. Refresh and try again."))
      )
        summaryWrite.current = null;
      if (current())
        setError(
          addedTasks.current.size
            ? `${addedTasks.current.size} tasks added. ${errorText(e)} Retry the remaining tasks.`
            : errorText(e),
        );
    } finally {
      pending.current = false;
      if (current()) setBusy(false);
    }
  };
  const chosen = keep.filter(Boolean).length;
  return (
    <BottomSheet
      visible={visible}
      title={action === "summarise" ? "Summary" : "Deadlines found"}
      closeDisabled={busy}
      onClose={leave}
      afterClose={() => {
        if (current()) onClose(changed.current);
      }}
      footer={
        <View style={s.foot}>
          <Button
            secondary
            title="Cancel"
            style={s.footButton}
            disabled={busy}
            onPress={leave}
          />
          {result &&
            (action === "summarise" ? (
              <Button
                title={docId ? "Add summary" : "Copy summary"}
                disabled={busy || !summary.trim()}
                style={s.footButton}
                onPress={() => void take()}
              />
            ) : (
              result.tasks.length > 0 && (
                <Button
                  title={`Add ${chosen} task${chosen === 1 ? "" : "s"}`}
                  disabled={busy || !chosen}
                  style={s.footButton}
                  onPress={() => void take()}
                />
              )
            ))}
        </View>
      }
    >
      <View style={s.body}>
        <Text style={s.muted}>From “{title}”</Text>
        {result?.provider && (
          <Text style={s.muted}>{aiFeatureProviderLabel(result.provider)}</Text>
        )}
        {loading && !result && (
          <Text style={s.muted} accessibilityLiveRegion="polite">
            Reading it…
          </Text>
        )}
        {result && action === "summarise" && (
          <View>
            <Text style={s.muted}>Review summary</Text>
            <TextInput
              maxLength={4000}
              accessibilityLabel="Review summary"
              multiline
              scrollEnabled
              value={summary}
              editable={!busy && !summaryWrite.current}
              onChangeText={setSummary}
              style={s.summaryInput}
            />
          </View>
        )}
        {result && action === "deadlines" && !result.tasks.length && (
          <Text style={s.muted}>No deadlines were found.</Text>
        )}
        {result &&
          action === "deadlines" &&
          result.tasks.map((t, n) => (
            <View key={n}>
              <Pressable
                accessibilityRole="checkbox"
                disabled={busy || added.includes(n)}
                accessibilityState={{
                  checked: added.includes(n) || !!keep[n],
                  disabled: busy || added.includes(n),
                }}
                onPress={() =>
                  setKeep((k) => k.map((v, i) => (i === n ? !v : v)))
                }
                style={({ pressed }) => [s.task, pressed && { opacity: 0.7 }]}
              >
                <View
                  style={[s.box, (keep[n] || added.includes(n)) && s.boxOn]}
                >
                  {(keep[n] || added.includes(n)) && (
                    <Icon name="check" size={13} color={colors.onAccent} />
                  )}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.taskTitle}>{t.title}</Text>
                  {added.includes(n) && <Text style={s.muted}>Added</Text>}
                  <Text style={s.muted}>
                    {t.due_at ? `Due ${dueText(t.due_at)}` : "No date"}
                  </Text>
                </View>
              </Pressable>
              {t.source && (
                <InlineDetails title="Source">
                  <Text style={s.muted}>{t.source}</Text>
                </InlineDetails>
              )}
            </View>
          ))}
        {!result && error && (
          <Button
            title="Retry"
            secondary
            disabled={loading}
            onPress={() => void load()}
          />
        )}
        {!!error && summaryWrite.current && (
          <Text style={s.muted}>
            Retry this save before changing the summary.
          </Text>
        )}
        {!!error && (
          <Text style={s.error} accessibilityRole="alert">
            {error}
          </Text>
        )}
      </View>
    </BottomSheet>
  );
}

const s = themed(() =>
  StyleSheet.create({
    row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minHeight: 44,
      paddingHorizontal: 12,
      paddingVertical: 6,
      maxWidth: "100%",
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.softBorder,
      backgroundColor: colors.soft,
    },
    chipPressed: { backgroundColor: colors.accentSoft },
    chipText: {
      flexShrink: 1,
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.text,
    },
    body: { gap: 12 },
    muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    summaryInput: {
      height: 160,
      maxHeight: 240,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      textAlignVertical: "top",

      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 22,
      color: colors.text,
    },
    task: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 48,
    },
    box: {
      width: 22,
      height: 22,
      flexShrink: 0,
      borderRadius: radii.check,
      borderWidth: 1.5,
      borderColor: colors.checkBorder,
      alignItems: "center",
      justifyContent: "center",
    },
    boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    taskTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
    error: { fontFamily: fonts.regular, fontSize: 13, color: colors.danger },
    foot: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    footButton: { flexGrow: 1, flexBasis: 120, marginTop: 0, marginBottom: 0 },
  }),
);
