import { useEffect, useState } from "react";
import { aiUsageSummary, type ManagedAiUsageSummary } from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { errorText } from "../../lib/errors";
/** On-demand owner metrics; account/token changes discard pending responses. */
export function ManagedAiUsage({ userId }: { userId: string }) {
  const token = session.get();
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
        if (!controller.signal.aborted && session.get() === token)
          setResult({ identity, data });
      },
      (error) => {
        if (!controller.signal.aborted && session.get() === token)
          setResult({ identity, error: errorText(error) });
      },
    );
    return () => controller.abort();
  }, [expanded, identity, reload]);
  return (
    <div className="settings-subform">
      <button
        className="link-button"
        disabled={!userId || !token}
        aria-expanded={expanded}
        onClick={() => setOpen(expanded ? null : identity)}
      >
        Workspace usage
      </button>
      {expanded && (
        <div role="status">
          {!current && <p>Loading usage…</p>}
          {current?.error && <p>{current.error}</p>}
          {current?.data && (
            <>
              <p>
                {current.data.requests} provider responses · Last{" "}
                {current.data.window_days} days
              </p>
              <p>{aiUsageSummary(current.data.usage)}</p>
              {!current.data.enabled && (
                <p>Usage collection is off in Privacy.</p>
              )}
              <p className="muted">
                Orbyn usage only; billing and ChatGPT limits are separate.
              </p>
            </>
          )}
          <button
            className="link-button"
            onClick={() => setReload((v) => v + 1)}
          >
            Refresh usage
          </button>
        </div>
      )}
    </div>
  );
}
