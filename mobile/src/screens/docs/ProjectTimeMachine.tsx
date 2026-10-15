import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ProjectCheckpoint, ProjectSnapshot } from "@orbyn/core";
import { Button } from "../../components/Button";
import { ErrorBanner } from "../../components/ErrorBanner";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { colors, fonts, radii, themed } from "../../theme";

/** Browse read-only planning snapshots without crowding the project timeline. */
export function ProjectTimeMachine(props: { projectId: string }) {
  return <ProjectTimeMachineBody key={props.projectId} {...props} />;
}
function ProjectTimeMachineBody({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [checkpoints, setCheckpoints] = useState<ProjectCheckpoint[]>([]);
  const [visibleCount, setVisibleCount] = useState(5);
  const [more, setMore] = useState(true);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failedRequest, setFailedRequest] = useState<
    "catalog" | "snapshot" | "earlier"
  >("catalog");

  const request = useRef(0);
  const [retry, setRetry] = useState(0);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState("");
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    setError("");
    setReady(false);
    setBusy(true);
    setSnapshot(null);
    setCheckpoints([]);
    setVisibleCount(5);
    client.projectCheckpoints(projectId).then(
      (rows) => {
        if (!active) return;
        setCheckpoints(rows);
        setMore(rows.length === 100);
        setReady(true);
        setBusy(false);
      },
      (reason: Error) => {
        if (active) {
          setFailedRequest("catalog");
          setError(reason.message);
          setBusy(false);
        }
      },
    );
    return () => {
      active = false;
      request.current++;
    };
  }, [projectId, retry]);

  const show = async (order: string) => {
    if (pending.current || !ready) return;
    const epoch = ++request.current;
    setSelected(order);
    setSnapshot(null);
    setBusy(true);
    setError("");
    try {
      const next = await client.projectSnapshot(projectId, order);
      if (epoch === request.current) setSnapshot(next);
    } catch (reason) {
      if (epoch === request.current) {
        setFailedRequest("snapshot");
        setError((reason as Error).message || "Could not load past state.");
      }
    } finally {
      if (epoch === request.current) setBusy(false);
    }
  };

  const showMore = async () => {
    if (busy || pending.current || !ready) return;
    if (visibleCount < checkpoints.length) {
      setVisibleCount((count) => count + 10);
      return;
    }
    const cursor = checkpoints.at(-1)?.event_order;
    if (!cursor || !more) return;
    pending.current = true;
    const epoch = request.current;
    setBusy(true);
    setError("");
    try {
      const older = await client.projectCheckpoints(projectId, cursor);
      if (epoch !== request.current) return;
      setCheckpoints((current) => [...current, ...older]);
      setVisibleCount((count) => count + 10);
      setMore(older.length === 100);
    } catch (reason) {
      if (epoch === request.current) {
        setFailedRequest("earlier");
        setError(
          (reason as Error).message || "Could not load earlier changes.",
        );
      }
    } finally {
      pending.current = false;
      if (epoch === request.current) setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <Button
        title={open ? "Hide past state" : "Past state"}
        secondary
        onPress={() => setOpen(!open)}
      />
      {open && (
        <View style={styles.body}>
          <ErrorBanner error={error} onDismiss={() => setError("")} />
          {!!error && (
            <SmallAction
              label="Retry"
              disabled={busy}
              onPress={() => {
                if (failedRequest === "catalog") setRetry((value) => value + 1);
                else if (failedRequest === "snapshot" && selected)
                  void show(selected);
                else void showMore();
              }}
            />
          )}
          {ready && !checkpoints.length && (
            <Text style={styles.meta}>No past changes yet.</Text>
          )}
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
          {ready && (visibleCount < checkpoints.length || more) && (
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
    rowText: { flex: 1, minWidth: 0, gap: 3 },
    title: {
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 20,
    },
    meta: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13 },
    snapshot: {
      gap: 9,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    snapshotTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 15 },
    group: { gap: 5 },
    heading: { color: colors.text, fontFamily: fonts.bold },
  }),
);
