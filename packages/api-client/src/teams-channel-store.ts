import {
  teamsInstallationId,
  type TeamsChannelConnection,
  type TeamsChannelStatus,
  type TeamsInstallationRequest,
  teamsConversationChallenge,
} from "@orbyn/core";
import type { OrbynClient } from "./client.js";
type Api = Pick<
  OrbynClient,
  | "teamsChannel"
  | "startTeamsInstallation"
  | "teamsInstallation"
  | "confirmTeamsInstallation"
  | "setTeamsDmPermission"
  | "disconnectTeams"
  | "restartTeamsConversationLink"
>;
export type TeamsChannelState = {
  status: TeamsChannelStatus | null;
  installation: TeamsInstallationRequest | null;
  authorizationUrl: string | null;
  challenge: { command: string; expiresAt: string } | null;
  busy: boolean;
  error: string;
};
/** Shared, session-bound channel settings. Tokens and OAuth callback data never enter this store. */
export class TeamsChannelStore {
  private state: TeamsChannelState = {
    status: null,
    installation: null,
    authorizationUrl: null,
    challenge: null,
    busy: false,
    error: "",
  };
  private listeners = new Set<() => void>();
  private abort = new AbortController();
  private binding: unknown;
  private pendingId: string | null = null;
  constructor(
    private api: Api,
    private session: () => unknown,
    private remember: (id: string | null) => void = () => {},
  ) {
    this.binding = session();
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(next: Partial<TeamsChannelState>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((listener) => listener());
  }
  private current() {
    return (
      !this.abort.signal.aborted &&
      !!this.binding &&
      this.session() === this.binding
    );
  }
  private clearPending() {
    this.pendingId = null;
    this.remember(null);
    this.publish({ installation: null, authorizationUrl: null });
  }
  private async run(action: () => Promise<void>) {
    if (!this.current()) {
      if (!this.abort.signal.aborted)
        this.publish({
          status: null,
          installation: null,
          authorizationUrl: null,
          challenge: null,
          busy: false,
          error: "Reopen connections after switching accounts.",
        });
      return;
    }
    if (this.state.busy) return;
    this.publish({ busy: true, error: "" });
    try {
      await action();
    } catch {
      if (this.current())
        this.publish({
          error:
            "Could not update Teams. Refresh and review the current connection before trying again.",
        });
    } finally {
      if (this.current()) this.publish({ busy: false });
      else if (!this.abort.signal.aborted)
        this.publish({
          status: null,
          installation: null,
          authorizationUrl: null,
          challenge: null,
          busy: false,
          error: "Reopen connections after switching accounts.",
        });
    }
  }
  private async read() {
    const status = await this.api.teamsChannel(this.abort.signal);
    if (!this.current()) return;
    const challenge = this.state.challenge;
    this.publish({
      status,
      challenge:
        challenge &&
        status.connection?.state === "awaiting_conversation" &&
        Date.parse(challenge.expiresAt) > Date.now()
          ? challenge
          : null,
    });
    if (!this.pendingId) return;
    const installation = await this.api.teamsInstallation(
      this.pendingId,
      this.abort.signal,
    );
    if (!this.current()) return;
    this.publish({ installation });
    if (["confirmed", "failed", "expired"].includes(installation.state)) {
      this.pendingId = null;
      this.remember(null);
      this.publish({ authorizationUrl: null });
    }
  }
  /** Restore only an owner-scoped request UUID; the backend still requires the original session. */
  restore = (id: string | null) =>
    this.run(async () => {
      const parsed = teamsInstallationId.safeParse(id);
      this.pendingId = parsed.success ? parsed.data : null;
      if (id && !parsed.success) this.remember(null);
      await this.read();
    });
  refresh = () => this.run(() => this.read());
  /** Erase an expired in-memory command without triggering a network retry loop. */
  expireChallenge = () => {
    if (
      this.current() &&
      this.state.challenge &&
      Date.parse(this.state.challenge.expiresAt) <= Date.now()
    )
      this.publish({ challenge: null });
  };

  /** The caller reserves a web popup synchronously, then opens this validated provider URL. */
  start = (open: (url: string) => void | Promise<void>) =>
    this.run(async () => {
      if (!this.state.status?.configured) return;
      const next = await this.api.startTeamsInstallation(this.abort.signal);
      if (!this.current()) return;
      this.pendingId = next.id;
      this.remember(next.id);
      this.publish({
        installation: {
          id: next.id,
          state: "pending",
          expires_at: next.expires_at,
          identity: null,
        },
        authorizationUrl: next.authorization_url,
        challenge: null,
      });
      await open(next.authorization_url);
    });
  confirm = () =>
    this.run(async () => {
      const pending = this.state.installation,
        status = this.state.status;
      if (
        !status ||
        pending?.state !== "ready" ||
        !pending.identity ||
        Date.parse(pending.expires_at) <= Date.now()
      )
        return;
      const next = await this.api.confirmTeamsInstallation(
        pending.id,
        {
          tenant_id: pending.identity.tenantId,
          object_id: pending.identity.objectId,
          expected_version: status.connection?.version ?? 0,
        },
        this.abort.signal,
      );
      if (!this.current()) return;
      this.clearPending();
      const proof = teamsConversationChallenge.parse(next);
      this.publish({
        status: {
          ...status,
          connection: {
            id: proof.id,
            version: proof.version,
            display_name: pending.identity.displayName,
            tenant_id: pending.identity.tenantId,
            object_id: pending.identity.objectId,
            dm_enabled: false,
            state: "awaiting_conversation",
          },
        },
        challenge: {
          command: `/orbyn connect ${proof.link_token}`,
          expiresAt: proof.link_expires_at,
        },
      });
      await this.read();
    });
  /** A fresh challenge clears earlier conversation authority; never persists the secret command. */
  renewLink = () =>
    this.run(async () => {
      const connection = this.state.status?.connection;
      if (!connection || connection.state === "disconnected") return;
      const next = await this.api.restartTeamsConversationLink(
        { expected_version: connection.version },
        this.abort.signal,
      );
      if (!this.current()) return;
      const proof = teamsConversationChallenge.parse(next);
      this.publish({
        status: {
          ...this.state.status!,
          connection: {
            ...connection,
            version: proof.version,
            dm_enabled: false,
            state: "awaiting_conversation",
          },
        },
        challenge: {
          command: `/orbyn connect ${proof.link_token}`,
          expiresAt: proof.link_expires_at,
        },
      });
      await this.read();
    });
  private async change(
    action: (
      connection: TeamsChannelConnection,
    ) => Promise<TeamsChannelConnection>,
  ) {
    const status = this.state.status,
      connection = status?.connection;
    if (!status || !connection || connection.state === "disconnected") return;
    const next = await action(connection);
    if (this.current())
      this.publish({
        status: { ...status, connection: next },
        challenge:
          next.state === "awaiting_conversation" ? this.state.challenge : null,
      });
  }
  permission = (enabled: boolean) =>
    this.run(() =>
      this.change((connection) =>
        this.api.setTeamsDmPermission(
          { expected_version: connection.version, dm_enabled: enabled },
          this.abort.signal,
        ),
      ),
    );
  disconnect = () =>
    this.run(() =>
      this.change((connection) =>
        this.api.disconnectTeams(
          { expected_version: connection.version },
          this.abort.signal,
        ),
      ),
    );
  /** Cancels local review only; encrypted server requests expire automatically. */
  cancel = () => {
    if (this.current() && !this.state.busy) this.clearPending();
  };
  dispose = () => {
    this.abort.abort();
    this.listeners.clear();
    this.state = {
      status: null,
      installation: null,
      authorizationUrl: null,
      challenge: null,
      busy: false,
      error: "",
    };
  };
}
