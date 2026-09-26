import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  ASSIST_CHIPS,
  CHIP_CARDS,
  withSummary,
  type AssistChip,
  type CaptureAssistResult,
} from "@orbyn/core";
import { BottomSheet } from "./BottomSheet";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { showToast } from "./Toast";
import { client } from "../lib/api";
import { errorText } from "../lib/errors";
import { copyText } from "../lib/share";
import { colors, fonts, radii, themed } from "../theme";

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
 * through Orbyn's hosted assistant only, and each comes back as a
 * suggestion: nothing changes until you take it. Works on a page (just
 * imported or scanned) or on words shared in.
 */
export function AssistChips({
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
  const [changed, setChanged] = useState(false);
  const [result, setResult] = useState<CaptureAssistResult | null>(null);
  const [keep, setKeep] = useState<boolean[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    client
      .assistCapture(
        docId ? { action, doc_id: docId } : { action, text: text ?? "", title },
      )
      .then(
        (r) => {
          setResult(r);
          setKeep(r.tasks.map(() => true));
        },
        (e) => setError(errorText(e)),
      );
  }, [action, docId, text, title]);

  const leave = (didChange = false) => {
    setChanged(didChange);
    setVisible(false);
  };
  const take = async () => {
    if (!result) return;
    setBusy(true);
    setError("");
    try {
      if (action === "summarise") {
        if (!docId) {
          await copyText(result.summary, "Summary copied");
          return leave(false);
        }
        const doc = await client.getDoc(docId);
        await client.updateDoc(docId, {
          version: doc.version,
          content: withSummary(doc.content, result.summary),
        });
        showToast({ text: "Summary added to the top of the page" });
      } else {
        let added = 0;
        for (const [n, t] of result.tasks.entries())
          if (keep[n]) {
            await client.createItem({
              title: t.title,
              kind: "task",
              due_at: t.due_at,
              notes: t.source ? `From “${title}”: ${t.source}` : "",
            });
            added++;
          }
        showToast({ text: `Added ${added} task${added === 1 ? "" : "s"}` });
      }
      leave(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const chosen = keep.filter(Boolean).length;
  return (
    <BottomSheet
      visible={visible}
      title={action === "summarise" ? "Summary" : "Deadlines found"}
      onClose={() => leave(false)}
      afterClose={() => onClose(changed)}
      footer={
        <View style={s.foot}>
          <Button
            secondary
            title="Leave it"
            style={s.footButton}
            onPress={() => leave(false)}
          />
          {result &&
            (action === "summarise" ? (
              <Button
                title={docId ? "Add to the top of the page" : "Copy it"}
                disabled={busy}
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
        <Text style={s.muted}>
          From “{title}”, by Orbyn's assistant. Nothing changes until you take
          it.
        </Text>
        {!result && !error && (
          <Text style={s.muted} accessibilityLiveRegion="polite">
            Reading it…
          </Text>
        )}
        {result && action === "summarise" && (
          <Text style={s.summary}>{result.summary}</Text>
        )}
        {result && action === "deadlines" && !result.tasks.length && (
          <Text style={s.muted}>No deadlines were found.</Text>
        )}
        {result &&
          action === "deadlines" &&
          result.tasks.map((t, n) => (
            <Pressable
              key={n}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: !!keep[n] }}
              onPress={() =>
                setKeep((k) => k.map((v, i) => (i === n ? !v : v)))
              }
              style={({ pressed }) => [s.task, pressed && { opacity: 0.7 }]}
            >
              <View style={[s.box, keep[n] && s.boxOn]}>
                {keep[n] && (
                  <Icon name="check" size={13} color={colors.white} />
                )}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.taskTitle}>{t.title}</Text>
                <Text style={s.muted} numberOfLines={2}>
                  {t.due_at ? `Due ${dueText(t.due_at)}` : "No date"}
                  {t.source ? ` · “${t.source}”` : ""}
                </Text>
              </View>
            </Pressable>
          ))}
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
      minHeight: 32,
      paddingHorizontal: 12,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.softBorder,
      backgroundColor: colors.soft,
    },
    chipPressed: { backgroundColor: colors.accentSoft },
    chipText: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
    body: { gap: 12 },
    muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    summary: {
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
      borderRadius: 6,
      borderWidth: 1.5,
      borderColor: colors.checkBorder,
      alignItems: "center",
      justifyContent: "center",
    },
    boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    taskTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
    error: { fontFamily: fonts.regular, fontSize: 13, color: colors.danger },
    foot: { flexDirection: "row", gap: 8 },
    footButton: { flex: 1, marginTop: 0, marginBottom: 0 },
  }),
);
