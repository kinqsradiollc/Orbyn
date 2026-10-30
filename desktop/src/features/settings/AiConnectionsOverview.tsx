import { useEffect, useState } from "react";
import { AGENT_ACCESS_LABELS, AGENT_TRUST_LABELS } from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { ManagedAiUsage } from "./ManagedAiUsage";
import { ChatgptUsage } from "./ChatgptUsage";
import "./ai-connections-overview.css";

type Overview = {
  identity: string;
  capability?: Awaited<ReturnType<typeof client.aiCapabilities>>;
  provider?: Awaited<ReturnType<typeof client.aiProviderChoice>>;
  profiles?: Awaited<ReturnType<typeof client.assistantProfiles>>;
  grants?: Awaited<ReturnType<typeof client.agents>>["grants"];
  failed: string[];
};

/** Route, permissions and recorded runtime evidence remain separate settings owners. */
export function AiConnectionsOverview({
  userId,
  visible = true,
  onProviders,
  onAccess,
  onRules,
  onLimits,
  onOpenActivity,
}: {
  userId: string;
  visible?: boolean;
  onProviders: () => void;
  onAccess: () => void;
  onRules: () => void;
  onLimits: () => void;
  onOpenActivity?: (lane: "background" | "overnight") => void;
}) {
  const binding = session.binding();
  const token = binding.token;
  const generation = binding.generation;
  const identity = `${generation}:${userId}:${token}`;
  const [read, setRead] = useState<Overview | null>(null);
  const [retry, setRetry] = useState(0);
  const data = read?.identity === identity ? read : null;
  useEffect(() => {
    if (!visible || !token || !userId) return;
    let live = true;
    const abort = new AbortController();
    setRead(null);
    void Promise.allSettled([
      client.aiCapabilities(),
      client.aiProviderChoice(abort.signal),
      client.assistantProfiles(abort.signal),
      client.agents(),
    ]).then(([capability, provider, profiles, agents]) => {
      const current = session.binding();
      if (!live || current.token !== token || current.generation !== generation)
        return;
      setRead({
        identity,
        ...(capability.status === "fulfilled"
          ? { capability: capability.value }
          : {}),
        ...(provider.status === "fulfilled"
          ? { provider: provider.value }
          : {}),
        ...(profiles.status === "fulfilled"
          ? { profiles: profiles.value }
          : {}),
        ...(agents.status === "fulfilled"
          ? { grants: agents.value.grants }
          : {}),
        failed: [
          capability.status === "rejected" && "request configuration",
          provider.status === "rejected" && "provider choice",
          profiles.status === "rejected" && "agent activity",
          agents.status === "rejected" && "connection permissions",
        ].filter((value): value is string => !!value),
      });
    });
    return () => {
      live = false;
      abort.abort();
    };
  }, [identity, retry, visible]);
  const external = data?.grants?.filter((grant) => grant.kind !== "assistant");
  const route = data?.provider
    ? data.provider.primary === "chatgpt"
      ? "Personal ChatGPT"
      : "Orbyn default"
    : data
      ? "Provider choice unavailable"
      : "Loading…";
  return (
    <section
      className="ai-connections-overview"
      aria-label="AI and connections overview"
    >
      <header>
        <h2>AI &amp; connections</h2>
        <button
          className="text-button"
          disabled={!data}
          onClick={() => setRetry((value) => value + 1)}
        >
          {data?.failed.length ? "Retry overview" : "Refresh overview"}
        </button>
      </header>
      {!data && <p role="status">Loading AI and connections…</p>}
      {!!data?.failed.length && (
        <p role="alert">
          Couldn’t load {data.failed.join(", ")}. Retry to refresh.
        </p>
      )}
      <div className="ai-overview-row">
        <div>
          <h3>Selected provider route</h3>
          <strong>{route}</strong>
          {data?.capability && (
            <p>
              {data.capability.enabled
                ? "Configured for requests"
                : "Setup needed"}
            </p>
          )}
          {data?.provider?.primary === "chatgpt" && (
            <p>
              Default fallback{" "}
              {data.provider.fallback_to_default ? "enabled" : "off"}
            </p>
          )}
          <p className="muted">
            Live availability is checked when a run starts.
          </p>
        </div>
        <button className="text-button" onClick={onProviders}>
          Providers &amp; models
        </button>
      </div>
      <div className="ai-overview-row">
        <div>
          <h3>External access</h3>
          <p className="muted">
            Saved grants remain subject to team limits and action rules.
          </p>
          <p>
            {external
              ? `${external.length} saved ${external.length === 1 ? "connection" : "connections"}`
              : data
                ? "Connection permissions unavailable"
                : "Loading…"}
          </p>
          {external?.slice(0, 3).map((grant) => (
            <p key={grant.id}>
              <strong>
                {grant.name || grant.client_name || "Connected agent"}
              </strong>{" "}
              · {AGENT_ACCESS_LABELS[grant.access].name} ·{" "}
              {AGENT_TRUST_LABELS[grant.trust].name}
              {grant.suspended_at
                ? " · Paused"
                : grant.reconnect_required
                  ? " · Reconnect required"
                  : grant.expires_at &&
                      Date.parse(grant.expires_at) <= Date.now()
                    ? " · Expired"
                    : ""}
              <small>
                {[
                  grant.personal && "Personal",
                  ...(grant.team_ids === null
                    ? ["Teams you can access"]
                    : grant.teams.map((team) => team.name)),
                ]
                  .filter(Boolean)
                  .join(" · ") || "No spaces selected"}
              </small>
            </p>
          ))}
        </div>
        <button className="text-button" onClick={onAccess}>
          Manage access
        </button>
      </div>
      <div className="ai-overview-row">
        <div>
          <h3>Background &amp; Overnight</h3>
          {data?.profiles ? (
            <>
              {data.profiles.profiles.map((profile) => (
                <p key={profile.lane}>
                  <strong>
                    {profile.lane === "background" ? "Background" : "Overnight"}
                  </strong>{" "}
                  · {profile.counts.working} running · {profile.counts.waiting}{" "}
                  waiting · {profile.counts.queued} queued
                  {profile.counts.recovering
                    ? ` · ${profile.counts.recovering} recovering`
                    : ""}
                  {!profile.runtime.reporting && (
                    <small>Worker heartbeat unavailable</small>
                  )}
                  {onOpenActivity && (
                    <button
                      className="text-button"
                      onClick={() => onOpenActivity(profile.lane)}
                    >
                      View{" "}
                      {profile.lane === "background"
                        ? "Background"
                        : "Overnight"}{" "}
                      activity
                    </button>
                  )}
                </p>
              ))}
              <small>
                Observed {new Date(data.profiles.observed_at).toLocaleString()}
              </small>
            </>
          ) : (
            <p>{data ? "Agent activity unavailable" : "Loading…"}</p>
          )}
        </div>
        <div className="ai-overview-actions">
          <button className="text-button" onClick={onRules}>
            Action permissions
          </button>
          <button className="text-button" onClick={onLimits}>
            Work limits
          </button>
        </div>
      </div>
      <div className="ai-overview-usage">
        <h3>Usage recorded by Orbyn</h3>
        <ManagedAiUsage userId={userId} />
        <ChatgptUsage userId={userId} />
      </div>
    </section>
  );
}
