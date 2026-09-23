import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { WorkRecord } from "@orbyn/core";
import { Disclosure } from "../../components/Disclosure";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { colors, fonts, themed } from "../../theme";

/** Open workspace promises on a phone, without opening each project. */
export function PromiseTracker({
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
  const load = () =>
    client.listWorkRecords({ kind: "promise", limit: 200 }).then(setRows);
  useEffect(() => {
    void load().catch((error: Error) => onError(error.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const active =
    rows?.filter((row) => row.status === "open" || row.status === "proposed") ??
    [];
  const waiting = active.filter(
    (row) => row.status === "proposed" && row.owner_id === userId,
  ).length;
  const summary =
    rows === null
      ? "Loading…"
      : waiting
        ? `${waiting} waiting for your answer`
        : active.length
          ? `${active.length} open`
          : "Nothing open right now";
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await load();
    } catch (error) {
      onError((error as Error).message || "Could not update promise.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Disclosure title="Promises" detail={summary}>
      <View>
        {!active.length && (
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
                        void act(() =>
                          client.respondWorkRecord(record.id, "accept"),
                        )
                      }
                    />
                    <SmallAction
                      label="Decline"
                      disabled={busy}
                      onPress={() =>
                        void act(() =>
                          client.respondWorkRecord(record.id, "decline"),
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
                      void act(() =>
                        client.updateWorkRecord(record.id, {
                          version: record.version,
                          status: "done",
                        }),
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
    title: { color: colors.text, fontFamily: fonts.bold },
    meta: {
      color: colors.muted,
      fontFamily: fonts.regular,
      fontSize: 12,
      lineHeight: 18,
    },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  }),
);
