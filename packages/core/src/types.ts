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
  source: "database" | "environment" | "none";
  /** False until SECRETS_KEY is set; keys cannot be saved before then. */
  secrets_ready: boolean;
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
