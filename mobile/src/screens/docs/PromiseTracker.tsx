import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { WorkRecord } from "@orbyn/core";
import { Disclosure } from "../../components/Disclosure";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { colors, fonts, themed } from "../../theme";
import { errorText } from "../../lib/errors";

/** Open workspace promises on a phone, without opening each project. */
export function PromiseTracker(
  props: Parameters<typeof PromiseTrackerBody>[0],
) {
  return <PromiseTrackerBody key={props.userId} {...props} />;
}
function PromiseTrackerBody({
  userId,
  canWriteIn,
  onProject,
  onError,
}: {
  userId?: string;
  canWriteIn: (teamId: string | null) => boolean;
  onProject: (id: string) => void;
  onError: (message: string) => void;
}) {
  const [rows, setRows] = useState<WorkRecord[] | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const mutation = useRef(false);
  const [failed, setFailed] = useState(false);
  const load = async () => {
    const epoch = ++request.current;
    setFailed(false);
    try {
      const next = await client.listWorkRecords({
        kind: "promise",
        limit: 200,
      });
      if (epoch === request.current) setRows(next);
    } catch (error) {
      if (epoch === request.current) {
        setFailed(true);
        onError(errorText(error));
      }
    }
  };
  useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const active =
    rows?.filter((row) => row.status === "open" || row.status === "proposed") ??
    [];
  const waiting = active.filter(
    (row) => row.status === "proposed" && row.owner_id === userId,
  ).length;
  const summary = failed
    ? "Unavailable"
    : rows === null
      ? "Loading…"
      : waiting
        ? `${waiting} waiting for your answer`
        : active.length
          ? `${active.length} open`
          : "Nothing open right now";
  const act = async (action: () => Promise<unknown>, allowed: boolean) => {
    if (!allowed || mutation.current) return;
    mutation.current = true;
    setBusy(true);
    try {
      await action();
      await load();
    } catch (error) {
      onError(errorText(error));
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  return (
    <Disclosure title="Promises" detail={summary}>
      <View>
        {failed && (
          <SmallAction
            label="Retry"
            disabled={busy}
            onPress={() => void load()}
          />
        )}
        {rows !== null && !active.length && (
          <Text style={styles.meta}>No open promises right now.</Text>
        )}
        {active.map((record) => {
          const due = record.due_at ? new Date(record.due_at) : null;
          const overdue = due && due.getTime() < Date.now();
          return (
            <View key={record.id} style={styles.row}>
              <Text style={styles.title}>{record.title}</Text>
              <Text style={styles.meta}>
                {record.owner_id === userId
                  ? "Promised by you"
                  : `Promised by ${record.owner_name}`}
                {due
                  ? ` · ${overdue ? "Overdue" : "Due"} ${due.toLocaleDateString()}`
                  : ""}
                {record.status === "proposed" ? " · Awaiting response" : ""}
              </Text>
              <View style={styles.actions}>
                {!!record.project_id && (
                  <SmallAction
                    label="Project"
                    disabled={busy}
                    onPress={() => onProject(record.project_id!)}
                  />
                )}
                {record.status === "proposed" && record.owner_id === userId && (
                  <>
                    <SmallAction
                      label="Accept"
                      disabled={busy}
                      onPress={() =>
                        void act(
                          () => client.respondWorkRecord(record.id, "accept"),
                          record.owner_id === userId,
                        )
                      }
                    />
                    <SmallAction
                      label="Decline"
                      disabled={busy}
                      onPress={() =>
                        void act(
                          () => client.respondWorkRecord(record.id, "decline"),
                          record.owner_id === userId,
                        )
                      }
                    />
                  </>
                )}
                {record.status === "open" && canWriteIn(record.team_id) && (
                  <SmallAction
                    label="Done"
                    disabled={busy}
                    onPress={() =>
                      void act(
                        () =>
                          client.updateWorkRecord(record.id, {
                            version: record.version,
                            status: "done",
                          }),
                        canWriteIn(record.team_id),
                      )
                    }
                  />
                )}
              </View>
            </View>
          );
        })}
      </View>
    </Disclosure>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    row: {
      gap: 5,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: { color: colors.text, fontFamily: fonts.semibold, fontSize: 15 },
    meta: {
      color: colors.muted,
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 18,
    },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  }),
);
