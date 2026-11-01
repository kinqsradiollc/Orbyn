import { AGENT_TRUST_LABELS, type OAuthCheck } from "@orbyn/core";
import { Pill } from "../../../ui/kit";
export function Identity({ check }: { check: OAuthCheck }) {
  return (
    <section className="connect-identity" aria-labelledby="connect-client">
      <div className="connect-title-row">
        <h2 id="connect-client" dir="auto">
          {check.client.name}
        </h2>
        <Pill tone={check.client.verified ? "green" : "amber"}>
          {check.client.verified ? "Verified origin" : "Self-registered app"}
        </Pill>
      </div>
      <p dir="auto">From {check.client.host}</p>
      {!check.client.verified && (
        <p className="connect-warning">
          Orbyn has not verified who made this app. Continue only if you trust
          it and started this connection.
        </p>
      )}
      <p dir="auto">Returns to {check.client.redirect_host}</p>
      {check.client.redirect_local && (
        <p className="connect-warning">
          This opens an app on this device. Continue only if you just started
          connecting from that app.
        </p>
      )}
      {check.resource && (
        <p className="small" dir="auto">
          {check.resource.kind === "plugin"
            ? "Plugin integration"
            : "Portable MCP connection"}{" "}
          · {check.resource.url}
        </p>
      )}
      {check.account?.existing && (
        <div className="connect-existing">
          <p>
            This replaces permissions for this app and ends its existing
            sign-ins. Return to the app to finish reconnecting.
          </p>
          <p className="small">
            Current trust:{" "}
            {AGENT_TRUST_LABELS[check.account.existing.trust].name}. Review
            ask-first rules in Settings → Connections.
          </p>
        </div>
      )}
    </section>
  );
}
