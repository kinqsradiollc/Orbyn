import { useEffect, useState } from "react";
import { formatChatgptTokens, type ChatgptUsageSummary } from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { errorText } from "../../lib/errors";
/** Usage loads on demand and cannot show measurements from a previous session. */
export function ChatgptUsage({ userId }: { userId: string }) {
  const token = session.get();
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
        if (!controller.signal.aborted && token === session.get())
          setOwned({ userId, token, data, error: null });
      },
      (error) => {
        if (!controller.signal.aborted && token === session.get())
          setOwned({ userId, token, data: null, error: errorText(error) });
      },
    );
    return () => controller.abort();
  }, [userId, token, expanded, reload]);
  const data = current?.data;
  return (
    <div className="settings-subform">
      <button
        type="button"
        className="secondary"
        aria-expanded={expanded}
        disabled={!userId || !token}
        onClick={() => setOpen(expanded ? null : { userId, token })}
      >
        {expanded ? "Hide usage" : "Usage in Orbyn"}
      </button>
      {expanded && (
        <div style={{ overflowWrap: "anywhere" }}>
          {!current && <p role="status">Loading usage…</p>}
          {current?.error && <p role="alert">{current.error}</p>}
          {data &&
            (!data.recording_enabled ? (
              <p className="muted">Usage history is off in Privacy.</p>
            ) : (
              <>
                <p className="muted">Last 30 days · all ChatGPT connections</p>
                {!!data.completed_requests && (
                  <p>
                    <strong>{formatChatgptTokens(data.total_tokens)}</strong>{" "}
                    reported tokens · {data.completed_requests} completed{" "}
                    {data.completed_requests === 1 ? "request" : "requests"}
                  </p>
                )}
                {!!data.completed_requests && (
                  <p className="muted">
                    {formatChatgptTokens(data.input_tokens)} input ·{" "}
                    {formatChatgptTokens(data.output_tokens)} output
                  </p>
                )}
                {data.measured_requests < data.completed_requests && (
                  <p className="muted">
                    {data.completed_requests - data.measured_requests}{" "}
                    {data.completed_requests - data.measured_requests === 1
                      ? "request did"
                      : "requests did"}{" "}
                    not report token counts.
                  </p>
                )}
                {!data.completed_requests && (
                  <p className="muted">No completed ChatGPT requests yet.</p>
                )}
                {data.recent.map((row) => (
                  <p key={row.request_id} className="muted">
                    {row.model} · {new Date(row.completed_at).toLocaleString()}{" "}
                    ·{" "}
                    {row.usage
                      ? `${formatChatgptTokens(String(row.usage.total_tokens))} tokens`
                      : "Usage not reported"}
                  </p>
                ))}
                <small className="field-hint">
                  Recorded assistant calls only. Account limits stay in ChatGPT.
                </small>
              </>
            ))}
          <button
            type="button"
            className="secondary"
            disabled={!current}
            onClick={() => setReload((n) => n + 1)}
          >
            Refresh usage
          </button>
        </div>
      )}
    </div>
  );
}
