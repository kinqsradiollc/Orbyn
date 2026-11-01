import {
  AGENT_ACCESS_LABELS,
  AGENT_TRUST_LABELS,
  aiUsageSummary,
  formatChatgptTokens,
} from "@orbyn/core";
import { useState } from "react";
import { navigate } from "../../../lib/router";
import { client } from "../../../lib/session";
import { Button, ErrorNotice, Loading } from "../../../ui/kit";
import { SettingsSection, useSettingsRead } from "../shared";

export function AutomationOverview() {
  const capabilities = useSettingsRead(() => client.aiCapabilities()),
    route = useSettingsRead(() => client.aiProviderChoice()),
    profiles = useSettingsRead(() => client.assistantProfiles()),
    access = useSettingsRead(() => client.agents());
  const [usage, setUsage] = useState(false);
  const grants = access.data?.grants.filter(
    (grant) => grant.kind !== "assistant",
  );
  const refreshing =
    capabilities.loading || route.loading || profiles.loading || access.loading;
  return (
    <SettingsSection
      title="AI & connections"
      description="Provider routing, outside access and Orbyn's own agents have separate permissions."
    >
      <div className="settings-automation-actions">
        <Button
          disabled={refreshing}
          onClick={() => {
            void capabilities.reload();
            void route.reload();
            void profiles.reload();
            void access.reload();
          }}
        >
          Refresh overview
        </Button>
      </div>
      <div className="settings-automation-overview">
        <article>
          <h4>Provider route</h4>
          {route.loading && !route.data && (
            <Loading label="Loading provider route" />
          )}
          {route.error && (
            <ErrorNotice
              message={route.error}
              onRetry={() => void route.reload()}
            />
          )}
          {route.data && (
            <>
              <strong>
                {route.data.primary === "chatgpt"
                  ? "Personal ChatGPT"
                  : "Orbyn default"}
              </strong>
              {route.data.primary === "chatgpt" && (
                <p>
                  Default fallback{" "}
                  {route.data.fallback_to_default ? "enabled" : "off"}
                </p>
              )}
            </>
          )}
          {capabilities.error && (
            <ErrorNotice
              message={capabilities.error}
              onRetry={() => void capabilities.reload()}
            />
          )}
          {capabilities.data && (
            <p>
              {capabilities.data.enabled
                ? "Configured for requests"
                : "Setup needed"}
            </p>
          )}
          <p className="muted small">
            Live availability is checked when work starts.
          </p>
          <Button
            onClick={() => navigate("/app/settings?setting=chatgpt-models")}
          >
            Providers & models
          </Button>
        </article>
        <article>
          <h4>Outside-agent access</h4>
          {access.loading && !access.data && (
            <Loading label="Loading connection permissions" />
          )}
          {access.error && (
            <ErrorNotice
              message={access.error}
              onRetry={() => void access.reload()}
            />
          )}
          {grants && (
            <>
              <p>
                {grants.length} saved{" "}
                {grants.length === 1 ? "connection" : "connections"}
              </p>
              <ul className="settings-automation-list">
                {grants.slice(0, 3).map((grant) => (
                  <li key={grant.id}>
                    <strong dir="auto">
                      {grant.name || grant.client_name || "Connected agent"}
                    </strong>
                    <p>
                      {AGENT_ACCESS_LABELS[grant.access].name} ·{" "}
                      {AGENT_TRUST_LABELS[grant.trust].name}
                      {grant.suspended_at
                        ? " · Paused"
                        : grant.reconnect_required
                          ? " · Reconnect required"
                          : grant.expires_at &&
                              Date.parse(grant.expires_at) <= Date.now()
                            ? " · Expired"
                            : ""}
                    </p>
                    <p className="small muted">
                      {[
                        grant.personal && "Personal",
                        ...(grant.team_ids === null
                          ? ["Teams you can access"]
                          : grant.teams.map((team) => team.name)),
                      ]
                        .filter(Boolean)
                        .join(" · ") || "No spaces selected"}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
          <Button onClick={() => navigate("/app/settings?setting=agents")}>
            Manage access
          </Button>
        </article>
      </div>
      <div className="settings-automation-actions">
        <Button
          onClick={() => navigate("/app/settings?setting=assistant-rules")}
        >
          Action permissions
        </Button>
        <Button
          onClick={() => {
            const target = document.getElementById("settings-work-limits");
            target?.scrollIntoView({ block: "start" });
            target?.focus();
          }}
        >
          Work limits
        </Button>
      </div>
      <h4>Background & Overnight activity</h4>
      {profiles.loading && !profiles.data && (
        <Loading label="Loading agent activity" />
      )}
      {profiles.error && (
        <ErrorNotice
          message={profiles.error}
          onRetry={() => void profiles.reload()}
        />
      )}
      {profiles.data && (
        <>
          <ul className="settings-automation-list">
            {profiles.data.profiles.map((profile) => (
              <li key={profile.lane}>
                <strong>
                  {profile.lane === "background" ? "Background" : "Overnight"}
                </strong>
                <p>
                  {profile.counts.working} running · {profile.counts.waiting}{" "}
                  waiting · {profile.counts.queued} queued ·{" "}
                  {profile.counts.recovering} recovering
                </p>
                {!profile.runtime.reporting && (
                  <p className="muted small">Worker heartbeat unavailable</p>
                )}
                <Button onClick={() => navigate(`/app/${profile.lane}`)}>
                  View{" "}
                  {profile.lane === "background" ? "Background" : "Overnight"}{" "}
                  activity
                </Button>
              </li>
            ))}
          </ul>
          <p className="small muted">
            Observed {new Date(profiles.data.observed_at).toLocaleString()}
          </p>
        </>
      )}
      <h4>Usage recorded by Orbyn</h4>
      <p className="small muted">
        Completed Orbyn requests only. Provider billing and ChatGPT plan limits
        are separate.
      </p>
      <Button aria-expanded={usage} onClick={() => setUsage((value) => !value)}>
        {usage ? "Hide recorded usage" : "Show recorded usage"}
      </Button>
      {usage && <RecordedUsage />}
    </SettingsSection>
  );
}
function RecordedUsage() {
  const managed = useSettingsRead(() => client.managedAiUsage()),
    chatgpt = useSettingsRead(() => client.chatgptUsage());
  return (
    <div className="settings-automation-overview">
      <article>
        <h4>Workspace requests</h4>
        {managed.loading && !managed.data && (
          <Loading label="Loading workspace usage" />
        )}
        {managed.error && (
          <ErrorNotice
            message={managed.error}
            onRetry={() => void managed.reload()}
          />
        )}
        {managed.data && (
          <>
            <p>
              {managed.data.requests} provider responses in{" "}
              {managed.data.window_days} days
            </p>
            <p>{aiUsageSummary(managed.data.usage)}</p>
            {!managed.data.enabled && (
              <p>Usage collection is off in Privacy.</p>
            )}
          </>
        )}
        <Button
          disabled={managed.loading}
          onClick={() => void managed.reload()}
        >
          Refresh workspace usage
        </Button>
      </article>
      <article>
        <h4>ChatGPT requests</h4>
        {chatgpt.loading && !chatgpt.data && (
          <Loading label="Loading ChatGPT usage" />
        )}
        {chatgpt.error && (
          <ErrorNotice
            message={chatgpt.error}
            onRetry={() => void chatgpt.reload()}
          />
        )}
        {chatgpt.data && (
          <>
            {!chatgpt.data.recording_enabled ? (
              <p>Usage history is off in Privacy.</p>
            ) : (
              <>
                <p>
                  {chatgpt.data.completed_requests} completed requests ·{" "}
                  {formatChatgptTokens(chatgpt.data.total_tokens)} reported
                  tokens
                </p>
                <p className="small muted">
                  {new Date(chatgpt.data.since).toLocaleDateString()}–
                  {new Date(chatgpt.data.until).toLocaleDateString()} · All
                  ChatGPT connections
                </p>
                <p>
                  {formatChatgptTokens(chatgpt.data.input_tokens)} input ·{" "}
                  {formatChatgptTokens(chatgpt.data.output_tokens)} output
                </p>
                {chatgpt.data.measured_requests <
                  chatgpt.data.completed_requests && (
                  <p>
                    {chatgpt.data.completed_requests -
                      chatgpt.data.measured_requests}{" "}
                    completed requests did not report token counts.
                  </p>
                )}
                {chatgpt.data.completed_requests === 0 && (
                  <p>No completed ChatGPT calls recorded.</p>
                )}
                <ul className="settings-automation-list">
                  {chatgpt.data.recent.map((row) => (
                    <li key={row.request_id}>
                      {row.model} ·{" "}
                      {new Date(row.completed_at).toLocaleString()} ·{" "}
                      {row.usage
                        ? `${formatChatgptTokens(String(row.usage.total_tokens))} tokens`
                        : "Usage not reported"}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
        <Button
          disabled={chatgpt.loading}
          onClick={() => void chatgpt.reload()}
        >
          Refresh ChatGPT usage
        </Button>
      </article>
    </div>
  );
}
