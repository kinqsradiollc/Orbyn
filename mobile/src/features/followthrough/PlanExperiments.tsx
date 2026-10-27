import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { WorkRecord } from "@orbyn/core";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { InlineDetails } from "../../components/InlineDetails";
import { Button } from "../../components/Button";
import { DateField } from "../../components/Field";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { ExperimentEvidence } from "./ExperimentEvidence";
import { colors, fonts, inputFontSize, radii, themed } from "../../theme";

/** A small trial and review loop for changes to a personal plan. */
export function PlanExperiments() {
  const [rows, setRows] = useState<WorkRecord[] | null>(null);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [success, setSuccess] = useState("");
  const [review, setReview] = useState<string | null>(null);
  const [outcomeFor, setOutcomeFor] = useState<string | null>(null);
  const outcomeTarget = useRef<string | null>(null);
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestVersion = useRef(0);
  const mutation = useRef(false);
  const mounted = useRef(true);
  const load = async () => {
    const version = ++requestVersion.current;
    try {
      const all = await client.listWorkRecords({
        kind: "experiment",
        limit: 200,
      });
      if (mounted.current && version === requestVersion.current)
        setRows(all.filter((row) => row.team_id === null));
    } catch (reason) {
      if (mounted.current && version === requestVersion.current)
        setError((reason as Error).message || "Could not load experiments.");
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      requestVersion.current += 1;
    };
  }, []);
  const active = rows?.filter((row) => row.status === "open") ?? [];
  const [showCompleted, setShowCompleted] = useState(false);
  const completed = rows?.filter((row) => row.status === "done") ?? [];
  const act = async (action: () => Promise<unknown>) => {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (reason) {
      setError((reason as Error).message || "Could not save experiment.");
    } finally {
      mutation.current = false;
      if (mounted.current) setBusy(false);
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
        title={`Plan experiments · ${rows === null ? (error ? "Unavailable" : "…") : active.length}`}
        disabled={busy}
        secondary
        onPress={() => setOpen(!open)}
      />
      {open && (
        <View style={s.body}>
          {!!error && !adding && outcomeFor === null && (
            <View>
              <Text style={s.error} accessibilityRole="alert">
                {error}
              </Text>
              {rows === null && (
                <SmallAction
                  label="Retry"
                  disabled={busy}
                  onPress={() => {
                    setError("");
                    void load().catch((reason: Error) =>
                      setError(reason.message),
                    );
                  }}
                />
              )}
            </View>
          )}
          {!adding ? (
            <Button
              title="New experiment"
              disabled={busy || outcomeFor !== null}
              secondary
              onPress={() => setAdding(true)}
            />
          ) : (
            <Sheet
              visible={adding}
              title="New experiment"
              hideClose={busy}
              onClose={() => {
                if (!busy) setAdding(false);
              }}
            >
              <ScrollView contentContainerStyle={sheetStyles.body}>
                <View style={[sheetStyles.column, s.form]}>
                  {!!error && (
                    <Text style={s.error} accessibilityRole="alert">
                      {error}
                    </Text>
                  )}
                  <Text style={s.label}>What will you try?</Text>
                  <TextInput
                    style={s.input}
                    value={title}
                    editable={!busy}
                    onChangeText={setTitle}
                    maxLength={200}
                    placeholder="Keep mornings free for deep work"
                    placeholderTextColor={colors.faint}
                    accessibilityLabel="What will you try?"
                  />
                  <Text style={s.label}>Success criteria</Text>
                  <TextInput
                    style={[s.input, s.multiline]}
                    value={success}
                    editable={!busy}
                    onChangeText={setSuccess}
                    multiline
                    textAlignVertical="top"
                    maxLength={4000}
                    placeholder="Finish more priority work without extending my day"
                    placeholderTextColor={colors.faint}
                    accessibilityLabel="Success criteria"
                  />
                  <DateField
                    label="Review on"
                    disabled={busy}
                    value={review}
                    onChange={setReview}
                    clearable
                  />
                  <View style={s.actions}>
                    <Button
                      title="Start"
                      disabled={
                        busy || !title.trim() || !success.trim() || !review
                      }
                      onPress={create}
                    />
                    <SmallAction
                      label="Cancel"
                      disabled={busy}
                      onPress={() => setAdding(false)}
                    />
                  </View>
                </View>
              </ScrollView>
            </Sheet>
          )}
          {rows !== null && !active.length && !completed.length && (
            <Text style={s.meta}>No experiments yet.</Text>
          )}
          {[
            ...active,
            ...(showCompleted ? completed : completed.slice(0, 3)),
          ].map((record) => (
            <View key={record.id} style={s.row}>
              <Text style={s.title}>{record.title}</Text>
              <Text style={s.meta}>
                {record.status === "done" ? "Completed" : "In progress"}
                {record.review_at
                  ? ` · Review ${new Date(record.review_at).toLocaleDateString()}`
                  : ""}
              </Text>
              <InlineDetails title="Experiment details">
                <Text style={s.label}>Success criteria</Text>
                <Text style={s.text}>{record.details}</Text>
                <ExperimentEvidence id={record.id} />
                {!!record.outcome && (
                  <>
                    <Text style={s.label}>Result</Text>
                    <Text style={s.text}>{record.outcome}</Text>
                  </>
                )}
              </InlineDetails>
              {record.status === "open" &&
                (outcomeFor === record.id ? (
                  <Sheet
                    visible
                    title="Record result"
                    hideClose={busy}
                    onClose={() => {
                      if (!busy) setOutcomeFor(null);
                    }}
                  >
                    <ScrollView contentContainerStyle={sheetStyles.body}>
                      <View style={[sheetStyles.column, s.form]}>
                        <Text style={s.title}>{record.title}</Text>
                        {!!error && (
                          <Text style={s.error} accessibilityRole="alert">
                            {error}
                          </Text>
                        )}
                        <Text style={s.label}>What happened?</Text>
                        <TextInput
                          style={[s.input, s.multiline]}
                          value={outcome}
                          editable={!busy}
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
                                outcomeTarget.current = null;
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
                    </ScrollView>
                  </Sheet>
                ) : (
                  <SmallAction
                    label="Record result"
                    disabled={busy || adding || outcomeFor !== null}
                    onPress={() => {
                      setOutcomeFor(record.id);
                      if (outcomeTarget.current !== record.id)
                        setOutcome(record.outcome);
                      outcomeTarget.current = record.id;
                    }}
                  />
                ))}
            </View>
          ))}
          {completed.length > 3 && (
            <SmallAction
              label={
                showCompleted
                  ? "Show fewer completed"
                  : `Show all ${completed.length} completed`
              }
              disabled={false}
              onPress={() => setShowCompleted((value) => !value)}
            />
          )}
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
      fontSize: inputFontSize,
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
    title: { color: colors.text, fontFamily: fonts.semibold, fontSize: 13 },
    text: {
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 18,
    },
    meta: {
      color: colors.muted,
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 18,
    },
    error: { color: colors.danger, fontFamily: fonts.regular },
  }),
);
