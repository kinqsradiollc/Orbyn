import {
  slackInstallationId,
  type SlackChannelConnection,
  type SlackChannelStatus,
  type SlackInstallationRequest,
} from "@orbyn/core";
import type { OrbynClient } from "./client.js";
type Api = Pick<
  OrbynClient,
  | "slackChannel"
  | "startSlackInstallation"
  | "slackInstallation"
  | "confirmSlackInstallation"
  | "setSlackDmPermission"
  | "disconnectSlack"
>;
export type SlackChannelState = {
  status: SlackChannelStatus | null;
  installation: SlackInstallationRequest | null;
  authorizationUrl: string | null;
  busy: boolean;
  error: string;
};
/** Shared, session-bound channel settings. Tokens and OAuth callback data never enter this store. */
export class SlackChannelStore {
  private state: SlackChannelState = {
    status: null,
    installation: null,
    authorizationUrl: null,
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
  private publish(next: Partial<SlackChannelState>) {
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
            "Could not update Slack. Refresh and review the current connection before trying again.",
        });
    } finally {
      if (this.current()) this.publish({ busy: false });
      else if (!this.abort.signal.aborted)
        this.publish({
          status: null,
          installation: null,
          authorizationUrl: null,
          busy: false,
          error: "Reopen connections after switching accounts.",
        });
    }
  }
  private async read() {
    const status = await this.api.slackChannel(this.abort.signal);
    if (!this.current()) return;
    this.publish({ status });
    if (!this.pendingId) return;
    const installation = await this.api.slackInstallation(
      this.pendingId,
      this.abort.signal,
    );
    if (!this.current()) return;
    this.publish({ installation });
    if (
      ["done", "failed", "expired", "unavailable"].includes(installation.state)
    ) {
      this.pendingId = null;
      this.remember(null);
      this.publish({ authorizationUrl: null });
    }
  }
  /** Restore only an owner-scoped request UUID; the backend still requires the original session. */
  restore = (id: string | null) =>
    this.run(async () => {
      const parsed = slackInstallationId.safeParse(id);
      this.pendingId = parsed.success ? parsed.data : null;
      if (id && !parsed.success) this.remember(null);
      await this.read();
    });
  refresh = () => this.run(() => this.read());
  /** The caller reserves a web popup synchronously, then opens this validated provider URL. */
  start = (open: (url: string) => void | Promise<void>) =>
    this.run(async () => {
      if (!this.state.status?.configured) return;
      const next = await this.api.startSlackInstallation(this.abort.signal);
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
      });
      await open(next.authorization_url);
    });
  confirm = (dmEnabled: boolean) =>
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
      const next = await this.api.confirmSlackInstallation(
        pending.id,
        {
          workspace_id: pending.identity.workspace_id,
          external_user_id: pending.identity.external_user_id,
          expected_bot_scopes: pending.identity.bot_scopes,
          expected_version: status.connection?.version ?? 0,
          dm_enabled: dmEnabled,
        },
        this.abort.signal,
      );
      if (!this.current()) return;
      this.clearPending();
      this.publish({ status: { ...status, connection: next } });
    });
  private async change(
    action: (
      connection: SlackChannelConnection,
    ) => Promise<SlackChannelConnection>,
  ) {
    const status = this.state.status,
      connection = status?.connection;
    if (!status || !connection || connection.disconnected) return;
    const next = await action(connection);
    if (this.current())
      this.publish({ status: { ...status, connection: next } });
  }
  permission = (enabled: boolean) =>
    this.run(() =>
      this.change((connection) =>
        this.api.setSlackDmPermission(
          { expected_version: connection.version, dm_enabled: enabled },
          this.abort.signal,
        ),
      ),
    );
  disconnect = () =>
    this.run(() =>
      this.change((connection) =>
        this.api.disconnectSlack(
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
      busy: false,
      error: "",
    };
  };
}
