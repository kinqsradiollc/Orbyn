import type { z } from "zod";
import type {
  actionSchema,
  agentReply,
  blockInput,
  blockUpdate,
  bookingPageInput,
  bookingPageUpdate,
  bookingRequest,
  BREAK_LEVELS,
  calendarSetInput,
  chatTurn,
  credentials,
  frameFilters,
  frameInput,
  frameUpdate,
  itemData,
  KINDS,
  listInput,
  listUpdate,
  placeInput,
  placeUpdate,
  plannerPrefsInput,
  planPreviewInput,
  PRIORITIES,
  STATUSES,
  tagInput,
  tagUpdate,
  WEBHOOK_EVENTS,
  webhookInput,
  webhookUpdate,
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
  /** Minutes logged with the focus timer. */
  spent_minutes?: number;
  /** The assignee's name, on list and detail responses. */
  assignee_name?: string | null;
  /** First occurrence of a repeating item; `due_at` is the current one. */
  series_start?: string | null;
  /** Occurrences removed from a repeating item. */
  exdates?: string[];
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
  /** "conflict" notices offer a Reschedule action for the block in `ref`. */
  kind?: "reminder" | "conflict" | "booking";
  item_id?: string;
  ref?: string;
};

/** An AI plan awaiting user approval. `id` is the proposal id to apply. */
export type Proposal = AgentReply & {
  id: string;
  /**
   * Quick replies the user can tap, such as the choices in a clarifying
   * question ("Which Dentist: Tuesday 9am or Friday 2pm?").
   */
  follow_ups?: string[];
  /** A schedule the assistant planned; the apps show it to review and apply. */
  plan?: Plan | null;
};

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

// ---- Planning -----------------------------------------------------------------

/** A personal list, or a team's shared list. */
export type TaskList = {
  id: string;
  user_id: string;
  team_id: string | null;
  team_name: string | null;
  name: string;
  color: string;
  position: number;
  /** Open items in the list. */
  item_count: number;
  created_at: string;
};

export type Tag = {
  id: string;
  user_id: string;
  team_id: string | null;
  name: string;
  color: string;
  created_at: string;
};

/** Time someone set aside to work on a task. */
export type TimeBlock = {
  id: string;
  item_id: string;
  user_id: string;
  start_at: string;
  end_at: string;
  source: "manual" | "planner";
  plan_id: string | null;
  /** From the task, for drawing the block. */
  title: string;
  status: Status;
  kind: Kind;
  priority: Priority;
  team_id: string | null;
  list_id: string | null;
  estimate_minutes: number | null;
};

/** One occurrence of an item on the calendar. */
export type CalendarEntry = {
  item_id: string;
  title: string;
  kind: Kind;
  status: Status;
  priority: Priority;
  start_at: string;
  end_at: string | null;
  team_id: string | null;
  team_name: string | null;
  list_id: string | null;
  location: string;
  meeting_url: string;
  /** Set for repeating items: which occurrence this is (for "skip this one"). */
  occurrence: string | null;
  rrule: string | null;
  version: number;
};

/** Time the calendar keeps around events: buffers and travel. */
export type DerivedBlock = {
  kind: "buffer" | "travel";
  item_id: string;
  start_at: string;
  end_at: string;
  label: string;
};

export type CalendarView = {
  from: string;
  to: string;
  timezone: string;
  entries: CalendarEntry[];
  blocks: TimeBlock[];
  derived: DerivedBlock[];
};

export type BreakLevel = (typeof BREAK_LEVELS)[number];
export type CalendarSet = z.output<typeof calendarSetInput>;

/** How someone likes to work; the planner, buffers and travel read these. */
export type PlannerPrefs = {
  timezone: string;
  /** 0 = Sunday … 6 = Saturday. */
  work_days: number[];
  work_start: string;
  work_end: string;
  pad_percent: number;
  split_after_minutes: number;
  min_block_minutes: number;
  break_level: BreakLevel;
  horizon_days: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  adaptive_buffers: boolean;
  default_travel_minutes: number;
  extra_timezones: string[];
  calendar_sets: CalendarSet[];
  pinned_user_ids: string[];
};

export type FrameFilters = z.output<typeof frameFilters>;

/** A recurring window reserved for a kind of work. */
export type Frame = {
  id: string;
  name: string;
  days: number[];
  start_time: string;
  end_time: string;
  filters: FrameFilters;
  color: string;
  position: number;
};

/** A place and the time it takes to get there. */
export type Place = {
  id: string;
  label: string;
  match: string;
  travel_minutes: number;
};

/** A block the planner proposes. */
export type PlannedBlock = {
  item_id: string;
  title: string;
  start_at: string;
  end_at: string;
  frame_id: string | null;
  frame_name: string | null;
  /** Session number when a long task is split (1 of `parts`). */
  part: number;
  parts: number;
  score: number;
};

export type UnplacedTask = {
  item_id: string;
  title: string;
  due_at: string | null;
  reason: string;
};

/** A generated plan; nothing is saved until it is applied. */
export type Plan = {
  id: string;
  starts_on: string;
  days: number;
  blocks: PlannedBlock[];
  unplaced: UnplacedTask[];
  /** Tasks that can't get enough time before they are due. */
  at_risk: UnplacedTask[];
  capacity_minutes: number;
  planned_minutes: number;
  applied: boolean;
  expires_at: string;
  summary: string;
};

export type AtRiskTask = UnplacedTask & {
  remaining_minutes: number;
  free_minutes: number;
};

/** What needs attention in the plan. */
export type PlannerReview = {
  /** Past blocks whose tasks are still open. */
  unfinished: TimeBlock[];
  at_risk: AtRiskTask[];
  /** Future blocks that now overlap an event. */
  conflicts: { block: TimeBlock; entry: CalendarEntry }[];
};

// ---- Teams: availability, workload, meeting times --------------------------

export type BusyInterval = { start_at: string; end_at: string };

/** A teammate's busy times. Details of their events are never included. */
export type MemberAvailability = {
  user_id: string;
  name: string;
  timezone: string;
  work_days: number[];
  work_start: string;
  work_end: string;
  busy: BusyInterval[];
};

export type MemberWorkload = {
  user_id: string;
  name: string;
  /** Working minutes not taken by events in the range. */
  capacity_minutes: number;
  /** Estimates of this team's open tasks assigned to them and due in the range. */
  assigned_minutes: number;
  open_tasks: number;
  unestimated_tasks: number;
  /** assigned / capacity. */
  load: number;
  overloaded: boolean;
  at_risk: number;
};

export type MeetingSlot = {
  start_at: string;
  end_at: string;
  /** Lower is better: slots that split someone's focus time rank later. */
  disruption: number;
};

// ---- Booking pages -------------------------------------------------------------

export type BookingHost = { user_id: string; name: string; required: boolean };

export type BookingPage = {
  id: string;
  owner_id: string;
  slug: string;
  title: string;
  description: string;
  durations: number[];
  window_days: number;
  min_notice_minutes: number;
  buffer_minutes: number;
  max_per_day: number | null;
  location: string;
  meeting_url: string;
  active: boolean;
  hosts: BookingHost[];
  created_at: string;
  updated_at: string;
};

export type Booking = {
  id: string;
  page_id: string;
  start_at: string;
  end_at: string;
  name: string;
  email: string;
  note: string;
  status: "pending" | "confirmed" | "cancelled";
  created_at: string;
};

/** What a public booking page shows. Host calendars are never exposed. */
export type PublicBookingPage = {
  slug: string;
  title: string;
  description: string;
  durations: number[];
  location: string;
  has_meeting_link: boolean;
  hosts: string[];
  timezone: string;
  duration: number;
  slots: BusyInterval[];
};

export type BookingReceipt = {
  id: string;
  status: Booking["status"];
  start_at: string;
  end_at: string;
  /** True when the booking waits for the link sent by email. */
  needs_confirmation: boolean;
};

// ---- API keys, webhooks, calendar feed ------------------------------------------

export type ApiKey = {
  id: string;
  name: string;
  /** The first characters, to tell keys apart. */
  prefix: string;
  created_at: string;
  last_used_at: string | null;
};
/** Returned once, when the key is created. */
export type NewApiKey = ApiKey & { key: string };

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export type Webhook = {
  id: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
  last_status: number | null;
  last_error: string | null;
  last_delivered_at: string | null;
  created_at: string;
};
/** Returned once, when the webhook is created: the signing secret. */
export type NewWebhook = Webhook & { secret: string };

/** A private subscription link for other calendar apps. */
export type CalendarFeed = { url: string };

// ---- Request bodies (what clients send) ------------------------------------------

export type ListInput = z.input<typeof listInput>;
export type ListUpdate = z.input<typeof listUpdate>;
export type TagInput = z.input<typeof tagInput>;
export type TagUpdate = z.input<typeof tagUpdate>;
export type BlockInput = z.input<typeof blockInput>;
export type BlockUpdate = z.input<typeof blockUpdate>;
export type PlannerPrefsInput = z.input<typeof plannerPrefsInput>;
export type FrameInput = z.input<typeof frameInput>;
export type FrameUpdate = z.input<typeof frameUpdate>;
export type PlaceInput = z.input<typeof placeInput>;
export type PlaceUpdate = z.input<typeof placeUpdate>;
export type PlanPreviewInput = z.input<typeof planPreviewInput>;
export type BookingPageInput = z.input<typeof bookingPageInput>;
export type BookingPageUpdate = z.input<typeof bookingPageUpdate>;
export type BookingRequest = z.input<typeof bookingRequest>;
export type WebhookInput = z.input<typeof webhookInput>;
export type WebhookUpdate = z.input<typeof webhookUpdate>;
export type WebhookTestResult = {
  ok: boolean;
  status: number | null;
  error: string | null;
};
