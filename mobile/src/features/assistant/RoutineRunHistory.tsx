import { RoutineOccurrenceDetails } from "./RoutineRecovery";
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  ASSISTANT_OUTCOME_LABELS,
  assistantOutcomeDetails,
  type AssistantRoutineRun,
  type AssistantRoutineRunsPage,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { SmallAction } from "../../components/SmallAction";
import { InlineDetails } from "../../components/InlineDetails";
import { shared } from "../../styles";
import { colors, themed } from "../../theme";

const binding = () => `${session.generation}:${session.token}`;
type Props = {
  routineId: string;
  timezone: string;
  open: boolean;
  disabled: boolean;
  onToggle: () => void;
  onOpenChat?: (id: string) => void;
};
export function RoutineRunHistory({ open, onToggle, ...props }: Props) {
  return (
    <View style={{ gap: 6 }}>
      <SmallAction
        quiet
        label={open ? "Hide run history" : "Run history"}
        disabled={props.disabled}
        onPress={onToggle}
      />
      {open && (
        <HistoryBody key={`${binding()}:${props.routineId}`} {...props} />
      )}
    </View>
  );
}
function HistoryBody({
  routineId,
  timezone,
  disabled,
  onOpenChat,
}: Omit<Props, "open" | "onToggle">) {
  const owner = useRef(binding()).current;
  const mounted = useRef(true);
  const sequence = useRef(0);
  const pending = useRef<number | null>(null);
  const failedPage = useRef<{ cursor?: string; append: boolean }>({
    append: false,
  });
  const [rows, setRows] = useState<AssistantRoutineRun[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const current = () => mounted.current && binding() === owner;
  const load = async (next?: string, append = false) => {
    if (!current() || pending.current !== null) return;
    const ticket = ++sequence.current;
    pending.current = ticket;
    failedPage.current = { cursor: next, append };
    setLoading(true);
    setFailed(false);
    if (!append) {
      setRows(null);
      setCursor(null);
    }
    try {
      const page: AssistantRoutineRunsPage = await client.listAgentRoutineRuns(
        routineId,
        { limit: 10, ...(next ? { cursor: next } : {}) },
      );
      if (!current() || ticket !== sequence.current) return;
      setRows((previous) => [
        ...new Map(
          [...(append ? (previous ?? []) : []), ...page.runs].map((row) => [
            row.id,
            row,
          ]),
        ).values(),
      ]);
      setCursor(page.next_cursor);
    } catch {
      if (current() && ticket === sequence.current) setFailed(true);
    } finally {
      if (pending.current === ticket) pending.current = null;
      if (current() && ticket === sequence.current) setLoading(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      sequence.current++;
      pending.current = null;
    };
  }, []);
  const when = (value: string) =>
    new Date(value).toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    });
  return (
    <View style={{ gap: 8 }}>
      <Text style={shared.small}>Scheduled time · {timezone}</Text>
      <SmallAction
        quiet
        label="Refresh history"
        disabled={loading || disabled}
        onPress={() => void load()}
      />
      {failed && (
        <>
          <Text style={shared.small} accessibilityRole="alert">
            Couldn’t load run history. Try again.
          </Text>
          <SmallAction
            quiet
            label="Retry history"
            disabled={loading || disabled}
            onPress={() =>
              void load(failedPage.current.cursor, failedPage.current.append)
            }
          />
        </>
      )}
      {loading && (
        <Text style={shared.small} accessibilityLiveRegion="polite">
          Loading run history…
        </Text>
      )}
      {rows?.length === 0 && !failed && (
        <Text style={shared.small}>No retained runs for this routine.</Text>
      )}
      {rows?.map((run) => (
        <View key={run.id} style={s.run}>
          <Text style={shared.body}>{when(run.scheduled_for)}</Text>
          <Text style={shared.small}>
            {(run.state === "done" || run.state === "failed") &&
            run.visibility === "available" &&
            run.execution_outcome
              ? ASSISTANT_OUTCOME_LABELS[run.execution_outcome.outcome]
              : run.state === "done"
                ? "Run finished · Outcome not verified"
                : run.state === "waiting"
                  ? "Waiting for you"
                  : run.state === "failed"
                    ? "Run failed"
                    : run.state === "queued"
                      ? "Queued"
                      : "Running"}
          </Text>
          {run.resume_count > 0 && (
            <Text style={shared.small}>
              {run.resume_count} recovery{" "}
              {run.resume_count === 1 ? "resume" : "resumes"}
            </Text>
          )}
          <Text style={shared.small}>
            Observed {when(run.last_observed_at)}
          </Text>
          <RoutineOccurrenceDetails
            routineId={routineId}
            occurrenceId={run.id}
            disabled={disabled}
            onOpenChat={onOpenChat}
          />
          {run.visibility === "restricted" ? (
            <Text style={shared.small}>Result no longer available</Text>
          ) : (
            <>
              {!!run.summary && (
                <InlineDetails title="Result preview">
                  <Text style={shared.body}>{run.summary}</Text>
                </InlineDetails>
              )}
              {run.execution_outcome && (
                <InlineDetails title="Evidence & open questions">
                  {assistantOutcomeDetails(run.execution_outcome).map(
                    (line, index) => (
                      <Text key={index} style={shared.small}>
                        {line}
                      </Text>
                    ),
                  )}
                </InlineDetails>
              )}
              {onOpenChat && (
                <SmallAction
                  quiet
                  label="Open result"
                  disabled={disabled}
                  onPress={() => {
                    if (current() && !disabled) onOpenChat(run.chat_id);
                  }}
                />
              )}
            </>
          )}
        </View>
      ))}
      {cursor && !failed && (
        <SmallAction
          quiet
          label="Load 10 older runs"
          disabled={loading || disabled}
          onPress={() => void load(cursor, true)}
        />
      )}
    </View>
  );
}
const s = themed(() =>
  StyleSheet.create({
    run: {
      gap: 6,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
  }),
);
