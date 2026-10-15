import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type {
  Item,
  DocSummary,
  Project,
  TeamMember,
  WorkRecord,
  WorkRecordKind,
} from "@orbyn/core";
import { BottomSheet } from "../../components/BottomSheet";
import { InlineDetails } from "../../components/InlineDetails";
import { Button } from "../../components/Button";
import { Chip, ChipRow } from "../../components/Chip";
import { DateField } from "../../components/Field";
import { ErrorBanner } from "../../components/ErrorBanner";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { colors, fonts, radii, themed } from "../../theme";

const KINDS: { id: WorkRecordKind; label: string }[] = [
  { id: "promise", label: "Promise" },
  { id: "decision", label: "Decision" },
  { id: "experiment", label: "Experiment" },
  { id: "meeting_outcome", label: "Meeting" },
];

/** The same project commitments as desktop, with one short form on a phone. */
export function ProjectRecords(
  props: Parameters<typeof ProjectRecordsBody>[0],
) {
  return (
    <ProjectRecordsBody
      key={`${props.project.id}:${props.userId}`}
      {...props}
    />
  );
}

function ProjectRecordsBody({
  focusId = null,
  project,
  items,
  userId,
  canWrite,
  onOpenNote,
}: {
  focusId?: string | null;
  project: Project;
  items: Item[];
  userId?: string;
  canWrite: boolean;
  onOpenNote?: (docId: string) => void;
}) {
  const [records, setRecords] = useState<WorkRecord[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<WorkRecordKind>("promise");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [day, setDay] = useState<string | null>(null);
  const [meetingMinutes, setMeetingMinutes] = useState("");
  const [participantCount, setParticipantCount] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [notes, setNotes] = useState<DocSummary[]>([]);
  const [sourceDocId, setSourceDocId] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState(userId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editingOutcome, setEditingOutcome] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("");

  const request = useRef(0);
  const mutation = useRef(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const reload = async () => {
    const epoch = ++request.current;
    setFailed(false);
    try {
      const [rows, pages, team] = await Promise.all([
        client.listWorkRecords({ project_id: project.id }),
        client.listDocs({ project: project.id }),
        project.team_id
          ? client.getTeam(project.team_id)
          : Promise.resolve(null),
      ]);
      if (epoch !== request.current) return;
      setRecords(rows);
      setNotes(pages);
      setMembers(team?.members ?? []);
      setReady(true);
    } catch (e) {
      if (epoch === request.current) {
        setFailed(true);
        setError((e as Error).message || "Records unavailable.");
      }
    }
  };
  useEffect(() => {
    void reload();
    return () => {
      request.current++;
    };
  }, [project.id, project.team_id]);

  const perform = async (
    action: () => Promise<unknown>,
    allowed = canWrite,
  ) => {
    if (!allowed || mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      await reload();
    } catch (reason) {
      setError((reason as Error).message || "Could not save this record.");
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };

  const create = () => {
    if (!canWrite || !ready || !title.trim() || !meetingEffortValid) return;
    void perform(async () => {
      await client.createWorkRecord({
        kind,
        title: title.trim(),
        details: details.trim(),
        project_id: project.id,
        team_id: project.team_id,
        source_doc_id: sourceDocId,
        ...(kind === "promise" && ownerId ? { owner_id: ownerId } : {}),
        linked_item_id: taskId,
        meeting_minutes:
          kind === "meeting_outcome" && meetingMinutes
            ? Number(meetingMinutes)
            : null,
        participant_count:
          kind === "meeting_outcome" && participantCount
            ? Number(participantCount)
            : null,
        due_at:
          kind === "promise" && day
            ? new Date(`${day}T12:00:00`).toISOString()
            : null,
        review_at:
          (kind === "experiment" || kind === "decision") && day
            ? new Date(`${day}T12:00:00`).toISOString()
            : null,
      });
      setAdding(false);
      setTitle("");
      setDetails("");
      setDay(null);
      setMeetingMinutes("");
      setParticipantCount("");
      setTaskId(null);
      setSourceDocId(null);
      setOwnerId(userId);
    });
  };

  const tasks = items.filter(
    (item) => item.kind === "task" && item.project_id === project.id,
  );
  const meetingEffortValid =
    kind !== "meeting_outcome" ||
    (!meetingMinutes && !participantCount) ||
    (Number.isInteger(Number(meetingMinutes)) &&
      Number(meetingMinutes) >= 1 &&
      Number(meetingMinutes) <= 1440 &&
      Number.isInteger(Number(participantCount)) &&
      Number(participantCount) >= 1 &&
      Number(participantCount) <= 100);
  return (
    <View style={styles.root}>
      <ErrorBanner error={error} onDismiss={() => setError("")} />
      <Text style={styles.title}>Decisions & commitments</Text>
      {failed && (
        <SmallAction
          label="Retry"
          disabled={busy}
          onPress={() => void reload()}
        />
      )}
      {canWrite && (
        <Button
          title="Add record"
          disabled={busy || !ready}
          secondary
          onPress={() => {
            setEditingOutcome(null);
            setAdding(true);
          }}
        />
      )}
      {adding && (
        <BottomSheet
          visible
          title="New record"
          onClose={() => {
            if (!busy) setAdding(false);
          }}
        >
          <View style={styles.form}>
            <ErrorBanner error={error} onDismiss={() => setError("")} />
            <ChipRow label="Type">
              {KINDS.map((option) => (
                <Chip
                  disabled={busy}
                  key={option.id}
                  label={option.label}
                  selected={kind === option.id}
                  onPress={() => {
                    setKind(option.id);
                    setDay(null);
                    setMeetingMinutes("");
                    setParticipantCount("");
                  }}
                />
              ))}
            </ChipRow>
            <TextInput
              editable={!busy}
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              maxLength={200}
              placeholder={
                kind === "experiment"
                  ? "What are we testing?"
                  : kind === "meeting_outcome"
                    ? "What was this meeting for?"
                    : kind === "decision"
                      ? "What did we decide?"
                      : "What was promised?"
              }
              placeholderTextColor={colors.faint}
              accessibilityLabel="Record title"
            />
            <TextInput
              editable={!busy}
              style={[styles.input, styles.details]}
              value={details}
              onChangeText={setDetails}
              multiline
              maxLength={4000}
              textAlignVertical="top"
              placeholder={
                kind === "experiment"
                  ? "What result would change our plan?"
                  : kind === "decision"
                    ? "Why did we choose this?"
                    : "Context or success criteria (optional)"
              }
              placeholderTextColor={colors.faint}
              accessibilityLabel="Record context"
            />
            {kind === "meeting_outcome" && (
              <View style={styles.form}>
                <Text style={styles.meta}>Meeting effort (optional)</Text>
                <TextInput
                  editable={!busy}
                  style={styles.input}
                  value={meetingMinutes}
                  onChangeText={setMeetingMinutes}
                  keyboardType="number-pad"
                  placeholder="Length in minutes"
                  placeholderTextColor={colors.faint}
                  accessibilityLabel="Meeting length in minutes"
                />
                <TextInput
                  editable={!busy}
                  style={styles.input}
                  value={participantCount}
                  onChangeText={setParticipantCount}
                  keyboardType="number-pad"
                  placeholder="People, including you"
                  placeholderTextColor={colors.faint}
                  accessibilityLabel="Number of meeting participants"
                />
                {!!meetingMinutes && !!participantCount && (
                  <Text style={styles.meta}>
                    {(
                      (Number(meetingMinutes) * Number(participantCount)) /
                      60
                    ).toLocaleString(undefined, {
                      maximumFractionDigits: 1,
                    })}{" "}
                    person-hours
                  </Text>
                )}
              </View>
            )}
            {!!notes.length && (
              <InlineDetails
                title={`Source note: ${notes.find((note) => note.id === sourceDocId)?.title || "None"}`}
              >
                <ChipRow label="Source note (optional)">
                  <Chip
                    disabled={busy}
                    label="None"
                    selected={!sourceDocId}
                    onPress={() => setSourceDocId(null)}
                  />
                  {notes.map((note) => (
                    <Chip
                      disabled={busy}
                      key={note.id}
                      label={note.title || "Untitled"}
                      selected={sourceDocId === note.id}
                      onPress={() => setSourceDocId(note.id)}
                    />
                  ))}
                </ChipRow>
              </InlineDetails>
            )}
            {kind === "promise" && !!project.team_id && (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Promised by</Text>
                <ChipRow label="Promised by">
                  <Chip
                    disabled={busy}
                    label="Me"
                    selected={!ownerId || ownerId === userId}
                    onPress={() => setOwnerId(userId)}
                  />
                  {members
                    .filter((member) => member.user_id !== userId)
                    .map((member) => (
                      <Chip
                        disabled={busy}
                        key={member.user_id}
                        label={member.name}
                        selected={ownerId === member.user_id}
                        onPress={() => setOwnerId(member.user_id)}
                      />
                    ))}
                </ChipRow>
              </View>
            )}
            {!!tasks.length && (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Linked task (optional)</Text>
                <ChipRow label="Linked task (optional)">
                  <Chip
                    disabled={busy}
                    label="None"
                    selected={!taskId}
                    onPress={() => setTaskId(null)}
                  />
                  {tasks.map((task) => (
                    <Chip
                      disabled={busy}
                      key={task.id}
                      label={task.title}
                      selected={taskId === task.id}
                      onPress={() => setTaskId(task.id)}
                    />
                  ))}
                </ChipRow>
              </View>
            )}
            {(kind === "promise" ||
              kind === "experiment" ||
              kind === "decision") && (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>
                  {kind === "promise"
                    ? "Due (optional)"
                    : "Review on (optional)"}
                </Text>
                <DateField
                  label={kind === "promise" ? "Due date" : "Review date"}
                  value={day}
                  disabled={busy}
                  clearable
                  placeholder="No date"
                  onChange={setDay}
                />
              </View>
            )}
            <Button
              title={busy ? "Saving…" : "Save record"}
              disabled={busy || !title.trim() || !meetingEffortValid}
              onPress={create}
            />
            <SmallAction
              label="Cancel"
              disabled={busy}
              onPress={() => setAdding(false)}
            />
          </View>
        </BottomSheet>
      )}
      {records === null ? (
        <Text style={styles.meta}>{failed ? "" : "Loading records…"}</Text>
      ) : records.length === 0 ? (
        <Text style={styles.meta}>No records yet.</Text>
      ) : (
        [...records]
          .sort((a, b) => Number(b.id === focusId) - Number(a.id === focusId))
          .map((record) => (
            <View
              key={record.id}
              style={[styles.card, record.id === focusId && styles.sourceFocus]}
            >
              <View style={styles.top}>
                <Text style={styles.kind}>
                  {KINDS.find((k) => k.id === record.kind)?.label}
                </Text>
                <Text style={styles.meta}>
                  {record.status === "done"
                    ? "Completed"
                    : record.status === "proposed"
                      ? "Awaiting response"
                      : record.status.charAt(0).toUpperCase() +
                        record.status.slice(1)}
                </Text>
              </View>
              <Text style={styles.title}>{record.title}</Text>
              {record.kind === "promise" &&
                record.owner_id !== record.created_by && (
                  <Text style={styles.meta}>
                    Promised by {record.owner_name}
                  </Text>
                )}
              {!!record.details && (
                <Text style={styles.body}>{record.details}</Text>
              )}
              {record.kind === "meeting_outcome" &&
                !!record.meeting_minutes &&
                !!record.participant_count && (
                  <Text style={styles.meta}>
                    {record.meeting_minutes} minutes ·{" "}
                    {record.participant_count} people ·{" "}
                    {(
                      (record.meeting_minutes * record.participant_count) /
                      60
                    ).toLocaleString(undefined, {
                      maximumFractionDigits: 1,
                    })}{" "}
                    person-hours
                  </Text>
                )}
              {!!record.source_doc_id && !!onOpenNote && (
                <SmallAction
                  label={`Source: ${notes.find((note) => note.id === record.source_doc_id)?.title || "Open note"}`}
                  disabled={false}
                  onPress={() => onOpenNote(record.source_doc_id!)}
                />
              )}
              {!!record.outcome && (
                <Text style={styles.body}>Outcome: {record.outcome}</Text>
              )}
              {!!record.linked_item_title && (
                <Text style={styles.meta}>
                  Task: {record.linked_item_title} ·{" "}
                  {record.linked_item_status === "in_progress"
                    ? "in progress"
                    : record.linked_item_status === "todo"
                      ? "not started"
                      : record.linked_item_status}
                </Text>
              )}
              {!!record.due_at && (
                <Text style={styles.meta}>
                  Due {new Date(record.due_at).toLocaleDateString()}
                </Text>
              )}
              {!!record.review_at && (
                <Text style={styles.meta}>
                  Review {new Date(record.review_at).toLocaleDateString()}
                </Text>
              )}
              {record.kind === "decision" &&
                record.status === "open" &&
                !record.linked_item_id && (
                  <View style={styles.gap}>
                    <Text style={styles.gapText}>
                      No task delivers this yet.
                    </Text>
                    {canWrite && (
                      <SmallAction
                        label="Make a task"
                        disabled={busy}
                        onPress={() =>
                          void perform(async () => {
                            const task = await client.createItem({
                              kind: "task",
                              title: record.title,
                              team_id: project.team_id,
                            });
                            await client.setItemProject(task.id, {
                              project_id: project.id,
                            });
                            await client.updateWorkRecord(record.id, {
                              version: record.version,
                              linked_item_id: task.id,
                            });
                          })
                        }
                      />
                    )}
                  </View>
                )}
              {record.status === "proposed" && record.owner_id === userId ? (
                <View style={styles.actions}>
                  <SmallAction
                    label="Accept"
                    disabled={busy}
                    onPress={() =>
                      void perform(
                        () => client.respondWorkRecord(record.id, "accept"),
                        record.owner_id === userId,
                      )
                    }
                  />
                  <SmallAction
                    label="Decline"
                    disabled={busy}
                    onPress={() =>
                      void perform(
                        () => client.respondWorkRecord(record.id, "decline"),
                        record.owner_id === userId,
                      )
                    }
                  />
                </View>
              ) : (
                canWrite &&
                (record.status === "open" || record.status === "done") && (
                  <>
                    {editingOutcome === record.id && (
                      <BottomSheet
                        visible
                        title="Record outcome"
                        onClose={() => {
                          if (!busy) setEditingOutcome(null);
                        }}
                      >
                        <View style={styles.form}>
                          <ErrorBanner
                            error={error}
                            onDismiss={() => setError("")}
                          />
                          <TextInput
                            editable={!busy}
                            style={[styles.input, styles.details]}
                            value={outcome}
                            onChangeText={setOutcome}
                            multiline
                            maxLength={4000}
                            textAlignVertical="top"
                            placeholder="What happened?"
                            placeholderTextColor={colors.faint}
                            accessibilityLabel="Record outcome"
                          />
                          <Button
                            title="Save outcome"
                            disabled={busy || !outcome.trim()}
                            onPress={() =>
                              void perform(async () => {
                                await client.updateWorkRecord(record.id, {
                                  version: record.version,
                                  outcome: outcome.trim(),
                                  status: "done",
                                });
                                setEditingOutcome(null);
                                setOutcome("");
                              })
                            }
                          />
                          <SmallAction
                            label="Cancel"
                            disabled={busy}
                            onPress={() => setEditingOutcome(null)}
                          />
                        </View>
                      </BottomSheet>
                    )}
                    {record.status === "open" &&
                    (record.kind === "experiment" ||
                      record.kind === "meeting_outcome") ? (
                      <SmallAction
                        label="Record outcome"
                        disabled={busy}
                        onPress={() => {
                          setEditingOutcome(record.id);
                          setOutcome(record.outcome);
                        }}
                      />
                    ) : (
                      <SmallAction
                        label={
                          record.status === "open" ? "Mark complete" : "Reopen"
                        }
                        disabled={busy}
                        onPress={() =>
                          void perform(() =>
                            client.updateWorkRecord(record.id, {
                              version: record.version,
                              status:
                                record.status === "open" ? "done" : "open",
                            }),
                          )
                        }
                      />
                    )}
                  </>
                )
              )}
            </View>
          ))
      )}
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    root: { gap: 12 },
    intro: { color: colors.muted, fontFamily: fonts.regular, lineHeight: 21 },
    form: {
      gap: 12,
      paddingVertical: 8,
    },
    input: {
      minHeight: 44,
      fontSize: 16,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      paddingHorizontal: 13,
      color: colors.text,
      fontFamily: fonts.regular,
    },
    details: { minHeight: 84, paddingTop: 12 },
    card: {
      gap: 7,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    sourceFocus: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    top: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: 8,
    },
    kind: {
      color: colors.text,
      fontFamily: fonts.bold,
      fontSize: 13,
    },
    title: { color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
    body: {
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 20,
    },
    meta: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    field: { gap: 8 },
    fieldLabel: {
      color: colors.textSoft,
      fontFamily: fonts.semibold,
      fontSize: 13,
    },
    gap: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 10,
    },
    gapText: {
      color: colors.warningStrong,
      fontFamily: fonts.medium,
      fontSize: 13,
    },
  }),
);
