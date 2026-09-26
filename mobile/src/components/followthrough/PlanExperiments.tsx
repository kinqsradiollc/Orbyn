import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { WorkRecord } from "@orbyn/core";
import { Button } from "../Button";
import { DateField } from "../Field";
import { SmallAction } from "../SmallAction";
import { client } from "../../lib/api";
import { ExperimentEvidence } from "./ExperimentEvidence";
import { colors, fonts, radii, themed } from "../../theme";

/** A small trial and review loop for changes to a personal plan. */
export function PlanExperiments() {
  const [rows, setRows] = useState<WorkRecord[] | null>(null);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [success, setSuccess] = useState("");
  const [review, setReview] = useState<string | null>(null);
  const [outcomeFor, setOutcomeFor] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = () =>
    client
      .listWorkRecords({ kind: "experiment", limit: 200 })
      .then((all) => setRows(all.filter((row) => row.team_id === null)));
  useEffect(() => {
    void load().catch((reason: Error) => setError(reason.message));
  }, []);
  const active = rows?.filter((row) => row.status === "open") ?? [];
  const completed =
    rows?.filter((row) => row.status === "done").slice(0, 3) ?? [];
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (reason) {
      setError((reason as Error).message || "Could not save experiment.");
    } finally {
      setBusy(false);
    }
  };
  const create = () =>
    void act(async () => {
      await client.createWorkRecord({
        kind: "experiment",
        title: title.trim(),
        details: success.trim(),
        review_at: review ? new Date(`${review}T12:00:00`).toISOString() : null,
      });
      setTitle("");
      setSuccess("");
      setReview(null);
      setAdding(false);
    });
  return (
    <View style={s.root}>
      <Button
        title={`Plan experiments · ${rows === null ? "…" : active.length}`}
        secondary
        onPress={() => setOpen(!open)}
      />
      {open && (
        <View style={s.body}>
          <Text style={s.meta}>
            Try one planning change, then check whether it helped.
          </Text>
          {!!error && <Text style={s.error}>{error}</Text>}
          {!adding ? (
            <Button
              title="Start an experiment"
              secondary
              onPress={() => setAdding(true)}
            />
          ) : (
            <View style={s.form}>
              <Text style={s.label}>What will you try?</Text>
              <TextInput
                style={s.input}
                value={title}
                onChangeText={setTitle}
                maxLength={200}
                placeholder="Keep mornings free for deep work"
                placeholderTextColor={colors.faint}
                accessibilityLabel="What will you try?"
              />
              <Text style={s.label}>What would success look like?</Text>
              <TextInput
                style={[s.input, s.multiline]}
                value={success}
                onChangeText={setSuccess}
                multiline
                textAlignVertical="top"
                maxLength={4000}
                placeholder="Finish more priority work without extending my day"
                placeholderTextColor={colors.faint}
                accessibilityLabel="What would success look like?"
              />
              <DateField
                label="Review on"
                value={review}
                onChange={setReview}
                clearable
              />
              <View style={s.actions}>
                <Button
                  title="Start"
                  disabled={busy || !title.trim() || !success.trim() || !review}
                  onPress={create}
                />
                <SmallAction
                  label="Cancel"
                  disabled={busy}
                  onPress={() => setAdding(false)}
                />
              </View>
            </View>
          )}
          {!active.length && !completed.length && (
            <Text style={s.meta}>No experiments yet.</Text>
          )}
          {[...active, ...completed].map((record) => (
            <View key={record.id} style={s.row}>
              <Text style={s.title}>{record.title}</Text>
              <Text style={s.meta}>
                {record.status === "done" ? "Completed" : "In progress"}
                {record.review_at
                  ? ` · Review ${new Date(record.review_at).toLocaleDateString()}`
                  : ""}
              </Text>
              <Text style={s.text}>Success looks like: {record.details}</Text>
              <ExperimentEvidence id={record.id} />
              {!!record.outcome && (
                <Text style={s.text}>What happened: {record.outcome}</Text>
              )}
              {record.status === "open" &&
                (outcomeFor === record.id ? (
                  <View style={s.form}>
                    <TextInput
                      style={[s.input, s.multiline]}
                      value={outcome}
                      onChangeText={setOutcome}
                      multiline
                      textAlignVertical="top"
                      maxLength={4000}
                      placeholder="What happened?"
                      placeholderTextColor={colors.faint}
                      accessibilityLabel="Experiment result"
                    />
                    <View style={s.actions}>
                      <Button
                        title="Finish experiment"
                        disabled={busy || !outcome.trim()}
                        onPress={() =>
                          void act(async () => {
                            await client.updateWorkRecord(record.id, {
                              version: record.version,
                              outcome: outcome.trim(),
                              status: "done",
                            });
                            setOutcomeFor(null);
                            setOutcome("");
                          })
                        }
                      />
                      <SmallAction
                        label="Cancel"
                        disabled={busy}
                        onPress={() => setOutcomeFor(null)}
                      />
                    </View>
                  </View>
                ) : (
                  <SmallAction
                    label="Record result"
                    disabled={busy}
                    onPress={() => {
                      setOutcomeFor(record.id);
                      setOutcome(record.outcome);
                    }}
                  />
                ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    root: { gap: 9 },
    body: {
      gap: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    form: { gap: 9 },
    label: { color: colors.text, fontFamily: fonts.regular, fontSize: 13 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      padding: 10,
      color: colors.text,
      fontFamily: fonts.regular,
    },
    multiline: { minHeight: 76 },
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
    },
    row: {
      gap: 7,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    title: { color: colors.text, fontFamily: fonts.bold },
    text: { color: colors.text, fontFamily: fonts.regular, lineHeight: 20 },
    meta: {
      color: colors.muted,
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 18,
    },
    error: { color: colors.danger, fontFamily: fonts.regular },
  }),
);
