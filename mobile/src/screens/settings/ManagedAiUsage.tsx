import React, { useEffect, useState } from "react";
import { aiUsageSummary, type ManagedAiUsageSummary } from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { Text, View } from "react-native";
import { SmallAction } from "../../components/SmallAction";
import { shared } from "../../styles";
import { errorText } from "../../lib/errors";
/** On-demand owner metrics; account/token changes discard pending responses. */
export function ManagedAiUsage({ userId }: { userId: string }) {
  const token = session.token;
  const identity = `${userId}:${token ?? ""}`;
  const [open, setOpen] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{
    identity: string;
    data?: ManagedAiUsageSummary;
    error?: string;
  } | null>(null);
  const expanded = open === identity;
  const current = result?.identity === identity ? result : null;
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    if (!expanded || !token || !userId) return () => controller.abort();
    void client.managedAiUsage(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted && session.token === token)
          setResult({ identity, data });
      },
      (error) => {
        if (!controller.signal.aborted && session.token === token)
          setResult({ identity, error: errorText(error) });
      },
    );
    return () => controller.abort();
  }, [expanded, identity, reload]);
  return (
    <View style={{ gap: 10 }}>
      <SmallAction
        label="Workspace provider usage"
        disabled={!userId || !token}
        onPress={() => setOpen(expanded ? null : identity)}
      />
      {expanded && (
        <View style={{ gap: 10 }}>
          {!current && <Text style={shared.small}>Loading usage…</Text>}
          {current?.error && <Text style={shared.small}>{current.error}</Text>}
          {current?.data && (
            <>
              <Text style={shared.small}>
                {current.data.requests} provider responses · Last{" "}
                {current.data.window_days} days
              </Text>
              <Text style={shared.small}>
                {aiUsageSummary(current.data.usage)}
              </Text>
              {!current.data.enabled && (
                <Text style={shared.small}>
                  Usage collection is off in Privacy.
                </Text>
              )}
              <Text style={shared.small}>
                Recorded responses only. Not billing or ChatGPT plan limits.
              </Text>
            </>
          )}
          <SmallAction
            label="Refresh usage"
            disabled={!userId || !token}
            onPress={() => setReload((v) => v + 1)}
          />
        </View>
      )}
    </View>
  );
}
