import { getSessionVersion } from "../../../lib/session";
import { SettingsSection, useSettingsExit } from "../shared";
import { useCallback, useState } from "react";
import type { RoutineEditorState } from "../../calendar/ManageRoutines";
import { FeedPanel, SubscriptionsPanel } from "../../calendar/ManageCalendars";
import { Agents } from "./Agents";
import { AgentRules } from "./AgentRules";
import { Channels } from "./Channels";
import { Credentials } from "./Credentials";
import { Webhooks } from "./Webhooks";
import { EmailDelivery, ChatDelivery } from "./Delivery";
import { CopyText } from "./common";
import { Portability } from "./Portability";
import "../../calendar/calendar.css";
import "./connections.css";
export function ConnectionsSettings() {
  return <ConnectionsBody key={getSessionVersion()} />;
}
function ConnectionsBody() {
  const [feed, setFeed] = useState<RoutineEditorState>({
      dirty: false,
      pending: false,
      uncertain: false,
    }),
    [subscribed, setSubscribed] = useState<RoutineEditorState>({
      dirty: false,
      pending: false,
      uncertain: false,
    });
  const feedState = useCallback(
    (next: RoutineEditorState) =>
      setFeed((old) =>
        old.dirty === next.dirty &&
        old.pending === next.pending &&
        old.uncertain === next.uncertain
          ? old
          : next,
      ),
    [],
  );
  const subscriptionState = useCallback(
    (next: RoutineEditorState) =>
      setSubscribed((old) =>
        old.dirty === next.dirty &&
        old.pending === next.pending &&
        old.uncertain === next.uncertain
          ? old
          : next,
      ),
    [],
  );
  useSettingsExit({
    dirty: feed.dirty || subscribed.dirty,
    pending:
      feed.pending ||
      subscribed.pending ||
      feed.uncertain ||
      subscribed.uncertain,
    message:
      "Finish the calendar change and save any private link before leaving.",
  });
  return (
    <div className="settings-connections">
      <Agents />
      <AgentRules />
      <Channels />
      <Credentials />
      <Webhooks />
      <SettingsSection title="Calendar feed">
        <FeedPanel onStateChange={feedState} />
      </SettingsSection>
      <SettingsSection title="Subscribed calendars">
        <SubscriptionsPanel
          onStateChange={subscriptionState}
          onChanged={() => {
            window.dispatchEvent(new Event("orbyn:calendars-changed"));
          }}
        />
      </SettingsSection>
      <EmailDelivery />
      <ChatDelivery />
      <Credentials clip />
      <SettingsSection
        title="Calendar app"
        description="Read-only CalDAV access with your email and a personal API key."
      >
        <code>{`${location.origin.replace(/\/$/, "")}/dav/`}</code>
        <CopyText
          value={`${location.origin.replace(/\/$/, "")}/dav/`}
          label="Copy CalDAV address"
        />
      </SettingsSection>
      <Portability />
      <SettingsSection title="Developer reference">
        <a
          href={`${(import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "")}/openapi.yaml`}
          target="_blank"
          rel="noopener noreferrer"
        >
          OpenAPI specification
        </a>
        <a href="/developers/mcp">MCP tools and connection guide</a>
      </SettingsSection>
    </div>
  );
}
