import type { z } from "zod";
import type {
  actionSchema,
  agentReply,
  chatTurn,
  credentials,
  itemData,
  KINDS,
  PRIORITIES,
  STATUSES,
} from "./schemas.js";
import type { SystemRole, TeamRole } from "./rbac.js";
import type { AiProviderKind } from "./aiProviders.js";

export type Kind = (typeof KINDS)[number];
export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];

/** Fields a client sends when creating or updating an item. */
export type ItemInput = z.output<typeof itemData>;
export type Credentials = z.input<typeof credentials>;
export type Action = z.output<typeof actionSchema>;
export type AgentReply = z.output<typeof agentReply>;
export type ChatTurn = z.output<typeof chatTurn>;

export type Item = ItemInput & {
  id: string;
  version: number;
  /** Creator for team items; owner for personal items. */
  user_id?: string;
  /** Present on list responses when the item belongs to a team. */
  team_name?: string | null;
  /** Checklist and timeline counts, present on list and detail responses. */
  steps_total?: number;
  steps_done?: number;
  updates_count?: number;
  last_update_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type User = {
  id: string;
  name: string;
  email: string;
  email_reminders: boolean;
  role: SystemRole;
};

export type Team = {
  id: string;
  name: string;
  /** Your membership role, or null when a system admin views a team they are not in. */
  role: TeamRole | null;
  member_count: number;
  item_count: number;
  created_at: string;
};

export type TeamMember = {
  user_id: string;
  name: string;
  email: string;
  role: TeamRole;
  joined_at: string;
};

export type TeamDetail = Team & { members: TeamMember[] };

export type AdminUser = User & {
  disabled: boolean;
  created_at: string;
  team_count: number;
  item_count: number;
};

export type AdminOverview = {
  users: number;
  admins: number;
  disabled_users: number;
  teams: number;
  items: number;
  open_items: number;
  notifications_pending: number;
  notifications_failed: number;
};

export type AuditEntry = {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

export type Page<T> = { rows: T[]; total: number };

export type AuthResponse = { token: string; user: User };

export type Notice = {
  id: string;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
};

/** An AI plan awaiting user approval. `id` is the proposal id to apply. */
export type Proposal = AgentReply & { id: string };

/** A status page component's current condition. */
export type ServiceState = "operational" | "degraded" | "outage" | "unknown";

export type StatusComponent = {
  id: string;
  name: string;
  description: string;
  state: ServiceState;
  latency_ms: number | null;
  checked_at: string | null;
  /** Share of passing checks, 0 to 1; null when there is no data yet. */
  uptime: { day: number | null; week: number | null; quarter: number | null };
  /** One entry per UTC day for the last 90 days, oldest first. */
  history: { date: string; uptime: number | null }[];
};

export type StatusIncident = {
  component: string;
  name: string;
  started_at: string;
  resolved_at: string | null;
  duration_s: number;
};

export type StatusReport = {
  state: ServiceState;
  updated_at: string;
  components: StatusComponent[];
  incidents: StatusIncident[];
  /** Set while an admin has switched maintenance mode on. */
  maintenance: Maintenance | null;
};

/** Maintenance mode: members can read but not change anything; admins can. */
export type Maintenance = {
  enabled: boolean;
  /** Shown in the apps and on the status page. */
  message: string;
  /** When maintenance is expected to end, if known. */
  until: string | null;
  updated_at: string | null;
};

/**
 * Settings admins change in the app. They apply within seconds on every
 * instance, with no restart; anything not set falls back to `.env`.
 */
export type SystemSettings = {
  /** Browser origins allowed to call the API. */
  cors_origins: string[];
  /** Requests per minute per client, per instance; 0 leaves it to the gateway. */
  rate_limit_per_minute: number;
  /** Parallel reminder deliveries per notifier instance. */
  notifier_concurrency: number;
  /** How often the status page probes every service. */
  status_interval_ms: number;
  smtp: {
    /** Empty turns email reminders off. */
    host: string;
    port: number;
    user: string;
    secure: boolean;
    from: string;
    /** The password is never sent back, only whether one is saved. */
    has_password: boolean;
  };
};

export type SystemSettingKey = keyof SystemSettings;

/** Settings plus where each value currently comes from. */
export type SystemSettingsView = {
  settings: SystemSettings;
  sources: Record<SystemSettingKey, "database" | "environment">;
  updated_at: string | null;
};

/** The build a service is running. */
export type VersionInfo = {
  /** Short commit, or "dev" for local builds. */
  version: string;
  built_at: string | null;
  service: string;
  uptime_s: number;
};

/** The running version against the newest commit on GitHub. */
export type UpdateInfo = {
  current: VersionInfo;
  /** False when no repository is configured for update checks. */
  checks_enabled: boolean;
  latest: {
    version: string;
    message: string;
    date: string;
    url: string;
  } | null;
  available: boolean;
  /** Where an admin starts a deploy (the GitHub Actions workflow), if known. */
  deploy_url: string | null;
  error: string | null;
};

/** A configured AI provider as admins see it. The key itself is never sent. */
export type AiProvider = {
  id: string;
  kind: AiProviderKind;
  name: string;
  base_url: string;
  has_key: boolean;
  /** For example "sk-…9f2a". */
  key_hint: string;
  options: { apiVersion?: string };
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type AiSettings = {
  provider_id: string | null;
  model: string;
  /** Where the assistant's configuration currently comes from. */
  /** "none" means the assistant is off until an admin chooses a provider. */
  source: "database" | "none";
  updated_at: string | null;
};

export type AiProvidersResponse = {
  providers: AiProvider[];
  settings: AiSettings;
};
export type AiModelList = { models: string[] };
export type AiTestResult = {
  ok: boolean;
  latency_ms: number | null;
  message: string;
};

export type ItemStep = {
  id: string;
  item_id: string;
  title: string;
  done: boolean;
  position: number;
  created_at: string;
};

/** One entry in a task's progress timeline. */
export type ItemUpdate = {
  id: string;
  item_id: string;
  user_id: string | null;
  author_name: string;
  body: string;
  /** Set when this update changed the status. */
  status: Status | null;
  /** Set when this update changed the progress. */
  progress: number | null;
  created_at: string;
};

/** A task with its checklist and progress timeline (newest first). */
export type ItemDetail = Item & { steps: ItemStep[]; updates: ItemUpdate[] };
