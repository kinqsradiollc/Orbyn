import React, { useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { ageLabel, pageFreshness, type Doc } from "@orbyn/core";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { colors, fonts, radii, themed } from "../../theme";
import { shared } from "../../styles";
import { errorText } from "../../lib/errors";

export function PageFreshness(props: Parameters<typeof PageFreshnessBody>[0]) {
  return <PageFreshnessBody key={props.doc.id} {...props} />;
}

/**
 * A page nobody has changed or confirmed in months may not be true any
 * more. Say it still is, or that it needs updating (its author gets a task).
 */
function PageFreshnessBody({
  doc,
  canWrite,
  always = false,
}: {
  doc: Pick<Doc, "id" | "updated_at" | "reviewed_at">;
  canWrite: boolean;
  /**
   * In Info: say how fresh it is even when it's fresh, and let anyone who
   * can edit it confirm it at any time.
   */
  always?: boolean;
}) {
  const mutation = useRef(false);
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  const fresh = pageFreshness(doc.updated_at, reviewed ?? doc.reviewed_at);
  if (done)
    return (
      <View style={[s.bar, s.done]} accessibilityRole="alert">
        <Text style={[s.text, s.doneText]}>{done}</Text>
      </View>
    );
  if (fresh.state === "fresh" && !always) return null;
  const review = async (
    input:
      { verdict: "still_true" } | { verdict: "needs_update"; note: string },
  ) => {
    if (mutation.current || !canWrite) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await client.reviewDoc(doc.id, input);
      setReviewed(r.reviewed_at);
      setDone(
        input.verdict === "still_true"
          ? "Confirmed up to date."
          : r.task?.assignee_name
            ? `Update assigned to ${r.task.assignee_name}.`
            : "Update task created.",
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  return (
    <View style={[s.bar, fresh.state === "stale" && s.stale]}>
      <Text style={[s.text, fresh.state === "stale" && s.staleText]}>
        {fresh.state === "fresh"
          ? `Changed or confirmed ${fresh.days < 1 ? "today" : `${ageLabel(fresh.days)} ago`}.`
          : `Not changed or confirmed in ${ageLabel(fresh.days)}.${
              canWrite ? " Is it still true?" : " It may be out of date."
            }`}
      </Text>
      {canWrite && !asking && (
        <View style={s.actions}>
          <SmallAction
            label="Still true"
            disabled={busy}
            onPress={() => void review({ verdict: "still_true" })}
          />
          <SmallAction
            label="Needs update"
            disabled={busy}
            onPress={() => {
              setAsking(true);
            }}
          />
        </View>
      )}
      {asking && (
        <View style={s.form}>
          <TextInput
            style={shared.input}
            editable={!busy}
            value={note}
            onChangeText={setNote}
            maxLength={1000}
            placeholder="What's changed? (optional)"
            placeholderTextColor={colors.faint}
            accessibilityLabel="What's changed"
          />
          <View style={s.actions}>
            <SmallAction
              label="Make a task"
              disabled={busy}
              onPress={() =>
                void review({ verdict: "needs_update", note: note.trim() })
              }
            />
            <SmallAction
              label="Cancel"
              disabled={busy}
              onPress={() => setAsking(false)}
            />
          </View>
        </View>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={[shared.small, s.staleText]}>
          {error}
        </Text>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    bar: {
      gap: 8,
      padding: 12,
      marginBottom: 12,
      borderRadius: radii.input,
      backgroundColor: colors.surfaceMuted,
    },
    stale: { backgroundColor: colors.dangerSoft },
    done: { backgroundColor: colors.soft },
    text: { fontFamily: fonts.medium, fontSize: 13, color: colors.textSoft },
    staleText: { color: colors.danger },
    doneText: { color: colors.accent },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    form: { gap: 8 },
  }),
);
