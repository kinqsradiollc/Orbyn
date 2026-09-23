import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ProjectCheckpoint, ProjectSnapshot } from "@orbyn/core";
import { Button } from "../../components/Button";
import { ErrorBanner } from "../../components/ErrorBanner";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { colors, fonts, radii, themed } from "../../theme";

/** Browse read-only planning snapshots without crowding the project timeline. */
export function ProjectTimeMachine({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [checkpoints, setCheckpoints] = useState<ProjectCheckpoint[]>([]);
  const [visibleCount, setVisibleCount] = useState(5);
  const [more, setMore] = useState(true);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setOpen(false);
    setSnapshot(null);
    setCheckpoints([]);
    setVisibleCount(5);
    client.projectCheckpoints(projectId).then(
      (rows) => {
        if (!active) return;
        setCheckpoints(rows);
        setMore(rows.length === 100);
      },
      (reason: Error) => {
        if (active) setError(reason.message);
      },
    );
    return () => {
      active = false;
    };
  }, [projectId]);

  const show = async (order: string) => {
    setBusy(true);
    setError("");
    try {
      setSnapshot(await client.projectSnapshot(projectId, order));
    } catch (reason) {
      setError((reason as Error).message || "Could not load past state.");
    } finally {
      setBusy(false);
    }
  };

  const showMore = async () => {
    if (visibleCount < checkpoints.length) {
      setVisibleCount((count) => count + 10);
      return;
    }
    const cursor = checkpoints.at(-1)?.event_order;
    if (!cursor || !more) return;
    setBusy(true);
    setError("");
    try {
      const older = await client.projectCheckpoints(projectId, cursor);
      setCheckpoints((current) => [...current, ...older]);
      setVisibleCount((count) => count + 10);
      setMore(older.length === 100);
    } catch (reason) {
      setError((reason as Error).message || "Could not load earlier changes.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <Button
        title={open ? "Hide past state" : "See project at a past change"}
        secondary
        onPress={() => setOpen(!open)}
      />
      {open && (
        <View style={styles.body}>
          <ErrorBanner error={error} onDismiss={() => setError("")} />
          <Text style={styles.hint}>
            Read-only planning state. Note contents are not shown.
          </Text>
          {checkpoints.slice(0, visibleCount).map((point) => (
            <View key={point.event_order} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.title}>{point.summary}</Text>
                <Text style={styles.meta}>
                  {new Date(point.created_at).toLocaleString()}
                </Text>
              </View>
              <SmallAction
                label="View"
                disabled={busy}
                onPress={() => void show(point.event_order)}
              />
            </View>
          ))}
          {(visibleCount < checkpoints.length || more) && (
            <SmallAction
              label="Earlier changes"
              disabled={busy}
              onPress={() => void showMore()}
            />
          )}
          {busy && <Text style={styles.meta}>Loading…</Text>}
          {snapshot && (
            <View style={styles.snapshot}>
              <Text style={styles.snapshotTitle}>{snapshot.project.name}</Text>
              <Text style={styles.meta}>
                {new Date(snapshot.created_at).toLocaleString()} ·{" "}
                {snapshot.project.status.replace("_", " ")}
              </Text>
              {!!snapshot.project.summary && (
                <Text style={styles.title}>{snapshot.project.summary}</Text>
              )}
              <Text style={styles.meta}>
                {snapshot.tasks.length} tasks · {snapshot.notes.length} notes ·{" "}
                {snapshot.records.length} records
              </Text>
              {!!snapshot.stages.length && (
                <Text style={styles.title}>
                  Stages:{" "}
                  {snapshot.stages.map((stage) => stage.name).join(" → ")}
                </Text>
              )}
              {!!snapshot.tasks.length && (
                <View style={styles.group}>
                  <Text style={styles.heading}>Tasks</Text>
                  {snapshot.tasks.map((task) => (
                    <Text key={task.id} style={styles.title}>
                      • {task.title} · {task.status.replace("_", " ")}
                    </Text>
                  ))}
                </View>
              )}
              {!!snapshot.notes.length && (
                <View style={styles.group}>
                  <Text style={styles.heading}>Notes</Text>
                  {snapshot.notes.map((note) => (
                    <Text key={note.id} style={styles.title}>
                      • {note.title || "Untitled"}
                    </Text>
                  ))}
                </View>
              )}
              {!!snapshot.records.length && (
                <View style={styles.group}>
                  <Text style={styles.heading}>Decisions & commitments</Text>
                  {snapshot.records.map((record) => (
                    <Text key={record.id} style={styles.title}>
                      • {record.title} · {record.status.replace("_", " ")}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    root: { gap: 10 },
    body: { gap: 10 },
    hint: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    rowText: { flex: 1, gap: 3 },
    title: { color: colors.text, fontFamily: fonts.regular, lineHeight: 20 },
    meta: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12 },
    snapshot: {
      gap: 9,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    snapshotTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 17 },
    group: { gap: 5 },
    heading: { color: colors.text, fontFamily: fonts.bold },
  }),
);
