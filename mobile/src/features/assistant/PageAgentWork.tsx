import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import {
  assistantPageReviewStateLabel,
  type AssistantProfile,
  type AssistantPageReviewRun,
} from "@orbyn/core";
import { InlineDetails } from "../../components/InlineDetails";
import { SmallAction } from "../../components/SmallAction";
import { ActionSheet } from "../../components/MoreMenu";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { shared } from "../../styles";
export function PageAgentWork({
  runs,
  truncated,
  onOpenPage,
  onRefresh,
}: {
  runs: NonNullable<AssistantProfile["page_runs"]>;
  truncated?: boolean;
  onOpenPage?: (id: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const mounted = useRef(true),
    locked = useRef(false),
    latest = useRef(runs),
    owner = useRef({
      token: session.token,
      generation: session.generation,
    }).current;
  latest.current = runs;
  const [confirm, setConfirm] = useState<string | null>(null),
    [stopping, setStopping] = useState<string | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () =>
    mounted.current &&
    session.token === owner.token &&
    session.generation === owner.generation;
  const stop = async () => {
    const run = latest.current.find(
      (r) =>
        r.id === confirm && ["queued", "running", "waiting"].includes(r.state),
    );
    if (!run || locked.current || !current()) return;
    locked.current = true;
    setConfirm(null);
    setStopping(run.id);
    setError("");
    try {
      const result = await client.stopPageMaintenanceRun(run.doc_id, run.id);
      if (!current()) return;
      setNotice(
        result.stopped
          ? "This run was stopped. Its schedule is unchanged."
          : "The run already ended. Its saved result is unchanged.",
      );
      await onRefresh();
    } catch {
      if (current())
        setError(
          "Couldn’t confirm the stop. Refresh page work before trying again.",
        );
    } finally {
      locked.current = false;
      if (current()) setStopping(null);
    }
  };
  if (!runs.length) return null;
  const active = runs.filter(
      (run) => !["done", "cancelled"].includes(run.state),
    ),
    history = runs.filter((run) => !active.includes(run));
  const row = (run: AssistantPageReviewRun) => (
    <View key={run.id} style={{ gap: 6, paddingVertical: 8 }}>
      <Text style={shared.body}>{run.title}</Text>
      <Text style={shared.small}>
        {run.work_kind === "comment_reply" ? "Comment reply" : "Page update"} ·{" "}
        {assistantPageReviewStateLabel(run)}
      </Text>
      <Text style={shared.small}>
        {new Date(run.updated_at).toLocaleString()}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {onOpenPage && (
          <SmallAction
            label={run.state === "waiting" ? "Review in page" : "Open page"}
            disabled={false}
            onPress={() => {
              if (current()) onOpenPage(run.doc_id);
            }}
          />
        )}
        {["queued", "running", "waiting"].includes(run.state) && (
          <SmallAction
            quiet
            label={stopping === run.id ? "Stopping…" : "Stop this page run"}
            disabled={!!stopping}
            onPress={() => {
              if (current()) setConfirm(run.id);
            }}
          />
        )}
      </View>
    </View>
  );
  return (
    <View style={{ gap: 10 }}>
      <Text style={shared.sectionTitle} accessibilityRole="header">
        Page work
      </Text>
      {error && (
        <Text style={shared.small} accessibilityRole="alert">
          {error}
        </Text>
      )}
      {notice && (
        <Text style={shared.small} accessibilityLiveRegion="polite">
          {notice}
        </Text>
      )}
      {active.map(row)}
      {history.length > 0 && (
        <InlineDetails title={`Finished page work · latest ${history.length}`}>
          {history.map(row)}
        </InlineDetails>
      )}
      {truncated && (
        <Text style={shared.small}>
          More page runs are available in each page’s update history.
        </Text>
      )}
      <ActionSheet
        visible={!!confirm}
        label="Stop current page work"
        title="Stop this page run?"
        message="Stops this run and discards its unapplied proposal. The routine schedule and changes already saved are kept."
        actions={[
          {
            label: "Stop run",
            destructive: true,
            disabled: !!stopping,
            onPress: () => void stop(),
          },
        ]}
        onClose={() => setConfirm(null)}
      />
    </View>
  );
}
