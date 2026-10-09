import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { formatChatgptTokens, type ChatgptUsageSummary } from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { errorText } from "../../lib/errors";
import { SmallAction } from "../../components/SmallAction";
import { shared } from "../../styles";
/** Completed request history is separate from OpenAI's account limits. */
export function ChatgptUsage({ userId }: { userId: string }) {
  const token = session.token;
  const [open, setOpen] = useState<{
    userId: string;
    token: string | null;
  } | null>(null);
  const expanded = open?.userId === userId && open.token === token;
  const [owned, setOwned] = useState<{
    userId: string;
    token: string | null;
    data: ChatgptUsageSummary | null;
    error: string | null;
  } | null>(null);
  const [reload, setReload] = useState(0);
  const current =
    owned?.userId === userId && owned.token === token ? owned : null;
  useEffect(() => {
    const controller = new AbortController();
    setOwned(null);
    if (!expanded || !userId || !token) return () => controller.abort();
    void client.chatgptUsage(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted && token === session.token)
          setOwned({ userId, token, data, error: null });
      },
      (error) => {
        if (!controller.signal.aborted && token === session.token)
          setOwned({ userId, token, data: null, error: errorText(error) });
      },
    );
    return () => controller.abort();
  }, [userId, token, expanded, reload]);
  const data = current?.data;
  return (
    <View style={{ gap: 10 }}>
      <SmallAction
        label={expanded ? "Hide usage" : "Usage in Orbyn"}
        disabled={!userId || !token}
        onPress={() => setOpen(expanded ? null : { userId, token })}
      />
      {expanded && (
        <View style={{ gap: 10 }}>
          {!current && (
            <Text accessibilityRole="text" style={shared.small}>
              Loading usage…
            </Text>
          )}
          {current?.error && (
            <Text accessibilityRole="alert" style={shared.small}>
              {current.error}
            </Text>
          )}
          {data &&
            (!data.recording_enabled ? (
              <Text style={shared.small}>Usage history is off in Privacy.</Text>
            ) : (
              <>
                <Text style={shared.small}>
                  Last 30 days · all ChatGPT connections
                </Text>
                {!!data.completed_requests && (
                  <Text style={shared.body}>
                    {formatChatgptTokens(data.total_tokens)} reported tokens ·{" "}
                    {data.completed_requests} completed{" "}
                    {data.completed_requests === 1 ? "request" : "requests"}
                  </Text>
                )}
                {!!data.completed_requests && (
                  <Text style={shared.small}>
                    {formatChatgptTokens(data.input_tokens)} input ·{" "}
                    {formatChatgptTokens(data.output_tokens)} output
                  </Text>
                )}
                {data.measured_requests < data.completed_requests && (
                  <Text style={shared.small}>
                    {data.completed_requests - data.measured_requests}{" "}
                    {data.completed_requests - data.measured_requests === 1
                      ? "request did"
                      : "requests did"}{" "}
                    not report token counts.
                  </Text>
                )}
                {!data.completed_requests && (
                  <Text style={shared.small}>No ChatGPT requests yet.</Text>
                )}
                {data.recent.map((row) => (
                  <Text key={row.request_id} style={shared.small}>
                    {row.model} · {new Date(row.completed_at).toLocaleString()}{" "}
                    ·{" "}
                    {row.usage
                      ? `${formatChatgptTokens(String(row.usage.total_tokens))} tokens`
                      : "Usage not reported"}
                  </Text>
                ))}
                <Text style={shared.small}>
                  Orbyn calls only. Plan limits are in ChatGPT.
                </Text>
              </>
            ))}
          <SmallAction
            label="Refresh usage"
            disabled={!current}
            onPress={() => setReload((n) => n + 1)}
          />
        </View>
      )}
    </View>
  );
}
