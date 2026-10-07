import type { AiModelUsage, AiProviderOptions } from "./ai-model-controls.js";
import type { AiFeatureProvider } from "./ai-feature.js";
import type { ProjectDecomposition } from "./projectDraft.js";
import type { AssistantSource, DraftNote } from "./docs.js";
import type { SessionChange } from "./schemas.js";
import type { DeadlineFit } from "./fit.js";
import type { AgentTaskState } from "./agent-tasks.js";

import type { z } from "zod";
import type {
  actionSchema,
  agentReply,
  blockDuplicateInput,
  blockInput,
  blockRescheduleInput,
  blockUpdate,
  bookingPageInput,
  bookingPageUpdate,
  bookingRequest,
  bookingAvailability,
  bookingQuestion,
  BOOKING_VIEWS,
  calendarFeedSettingsInput,
  calendarSubscriptionInput,
  calendarSubscriptionUpdate,
  CALENDAR_KINDS,
  CALENDAR_SHARING,
  EDIT_SCOPES,
  RSVP_STATUSES,
  dateOverride,
  BREAK_LEVELS,
  calendarSetInput,
  chatTurn,
  credentials,
  frameFilters,
  frameInput,
  frameSkipInput,
  frameUpdate,
  habitInput,
  habitUpdate,
  habitPlanInput,
  bufferScopeInput,
  inviteBookingRequest,
  itemData,
  itemLinkInput,
  itemPositionInput,
  ITEM_SORTS,
  openInviteInput,
  profileInput,
  TRAVEL_MODES,
  KINDS,
  listInput,
  listUpdate,
  placeInput,
  placeUpdate,
  plannerPrefsInput,
  planApplyInput,
  planPreviewInput,
  planScope,
  planTuneInput,
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
  /** The project this task belongs to, and which of its stages. */
  project_id?: string | null;
  stage_id?: string | null;
  /** The milestone of its project it belongs to, if any. */
  milestone_id?: string | null;
  /**
   * Its project's deadline: a latest date for the task, never its own
   * deadline (see `latestDates`). Null outside a project or without one.
   */
  project_deadline?: string | null;
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
  /**
   * Handed to the person's own agent (W3): its assistant grant while the
   * agent has it; cleared when the run ends and the task comes back.
   */
  agent_grant_id?: string | null;
  /** How the agent's work on it stands (see AGENT_TASK_STATES). */
  agent_state?: AgentTaskState | null;
  /** Handed tasks run now or wait for the person's next night shift. */
  agent_when?: "now" | "tonight";
  /** The run working on it, or the last one that did. */
  agent_job_id?: string | null;
  /** What the agent said it did, in one line. */
  agent_result?: string | null;
  /** The run's progress line while the agent has it ("Planning the steps"). */
  agent_progress?: string | null;
  /** First occurrence of a repeating item; `due_at` is the current one. */
  series_start?: string | null;
  /** Occurrences removed from a repeating item. */
  exdates?: string[];
  /**
   * The priority score (see `priorityScore`), on list responses. Null for
   * events and finished tasks.
   */
  score?: number | null;
  /** Manual order among items with the same parent, list or space. */
  position?: number;
  /** max(0, estimate − spent); null without an estimate. */
  remaining_minutes?: number | null;
  /** Subtasks that aren't cancelled, and how many of them are done. */
  child_count?: number;
  children_done?: number;
  /** Tasks this one waits on, oldest id first. Empty when nothing blocks it. */
  prerequisite_ids?: string[];
  /** A number to reach (a key result): current of target, in `value_unit`. */
  target_value?: number | null;
  current_value?: number | null;
  value_unit?: string;
};

export type ItemSort = (typeof ITEM_SORTS)[number];

/** A web link on a task. */
export type ItemLink = z.output<typeof itemLinkInput> & {
  id: string;
  position: number;
};

/** An item deleted since the sync point (only its id and when). */
export type DeletedItem = { id: string; deleted_at: string };

/** One page of `GET /items?updated_after=` (incremental sync), oldest change first. */
export type ItemSyncPage = {
  items: Item[];
  /** Present when `include_deleted=1`. */
  deleted: DeletedItem[];
  /** Pass back as `cursor` for the next page, or later for what changed since. */
  next_cursor: string;
  has_more: boolean;
};

/** A connected chat webhook, or null kind when none. */
export type ChatChannel = { kind: "slack" | "discord" | null };

/** The email-to-task address, and whether the server has inbound mail set up. */
export type InboxInfo = { address: string | null; configured: boolean };

/** A summary of what an import did (or would do, on a dry run). */
export type ImportSummary = {
  created: number;
  skipped: number;
  lists_added: number;
  tags_added: number;
  sample: string[];
  errors: string[];
};

/** A registered passkey, for the settings list. */
export type Passkey = {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
};

/** A signed-in session, for the "where you're signed in" list. */
export type Session = {
  id: string;
  created_at: string;
  last_seen_at: string;
  /** The raw User-Agent, for the client to summarise into a device name. */
  user_agent: string;
  /** The session making the request. */
  current: boolean;
};

/** Two-step verification status. */
export type TwoFactorStatus = { enabled: boolean };

/** What setting up two-step returns, to show once. */
export type TwoFactorSetup = {
  secret: string;
  otpauth_uri: string;
};

/** Recovery codes, shown once when two-step is turned on. */
export type TwoFactorEnabled = { recovery_codes: string[] };

export type User = {
  id: string;
  name: string;
  email: string;
  email_reminders: boolean;
  /** Whether the address is confirmed. Unconfirmed users can't use the app
   * when a mail server is configured; admins can confirm anyone by hand. */
  email_verified: boolean;
  role: SystemRole;
  /** Your public profile's address (/u/<handle>), if you made one. */
  handle?: string | null;
  bio?: string;
  /** The Terms version you last accepted; null until you accept one. */
  terms_version?: string | null;
  /** Whether you turned usage analytics off (Settings → Privacy). */
  analytics_opt_out?: boolean;
  /**
   * Whether the guided first run is done (or skipped). False only for a new
   * account that has not been through it; older servers leave it out.
   */
  first_run_done?: boolean;
  /** What you said Orbyn is for, in the first run. */
  purpose?: "study" | "team" | "personal" | null;
};

/** Your public profile, as you edit it. */
export type Profile = {
  handle: string | null;
  bio: string;
  /** The page's address, or null without a handle. */
  url: string | null;
};

/** What /u/<handle> shows: a name, a short bio and active booking pages. */
export type PublicProfile = {
  name: string;
  handle: string;
  bio: string;
  pages: {
    title: string;
    slug: string;
    description: string;
    durations: number[];
    color: string;
  }[];
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

export type AdminDatabaseTable = {
  name: string;
  estimated_rows: number;
  total_bytes: number;
  size: string;
  description: string | null;
};

export type AdminDatabaseColumn = {
  name: string;
  type: string;
  nullable: boolean;
  default_value: string | null;
  primary_key: boolean;
  description: string | null;
};

export type AdminDatabaseIndex = {
  name: string;
  definition: string;
};

export type AdminDatabaseTableDetail = {
  table: AdminDatabaseTable;
  columns: AdminDatabaseColumn[];
  indexes: AdminDatabaseIndex[];
};

export type AdminDatabaseRows = {
  rows: Record<string, unknown>[];
  limit: number;
  offset: number;
  has_more: boolean;
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
  /**
   * "conflict" notices offer a Reschedule action for the block in `ref`.
   * "rollforward" (ref = the local date) offers Roll forward; "at_risk" and
   * "deadline" (ref = the local date, `item_id` = the task) offer Plan it.
   */
  kind?:
    | "reminder"
    | "conflict"
    | "booking"
    | "rollforward"
    | "at_risk"
    | "deadline"
    /** Your part of a project needs planning (`ref` = project id:local day). */
    | "project"
    /** Someone you invited answered (`item_id` = the event, `ref` = the attendee). */
    | "rsvp"
    /** A template with a rhythm is ready to start (`ref` = the template). */
    | "template"
    /** Someone asked you to take on a task (`ref` = the ask). */
    | "ask"
    /** A promise offered to you, or an answer to one (`ref` = the record). */
    | "promise"
    /** A subscribed calendar's event is coming up. */
    | "calendar"
    /** An imported file is ready in Uploads (`ref` = "doc:<page id>"). */
    | "import"
    /**
     * Outside agents: a new connection, one paused or cut off for safety,
     * or a team's first use (`ref` = "grant:<id>" or "team:<id>").
     */
    | "agent"
    /** A saved assistant chat finished or needs you (`ref` = "chat:<id>:…"). */
    | "assistant"
    | "reminder_nudge"
    /** Someone named you in a page or a remark (`ref` = "doc:<page id>:…"). */
    | "mention"
    /** One of your sessions starts soon (`ref` = "<session id>:<start>"). */
    | "session"
    /** A change waits for your approval in the Review inbox (`ref` = "proposal:<id>"). */
    | "review"
    /** One of your agents asked you something (`ref` = "question:<id>"). */
    | "question"
    /** To admins: something about the server itself (`ref` = "clock:<since>"). */
    | "system";
  /** Null for booking notices, which point at the booking in `ref`. */
  item_id?: string | null;
  ref?: string;
  /**
   * The connected agent whose change caused it ("Claude"), if one: "via
   * Claude" beside it (H7).
   */
  via_agent?: string | null;
};

/** An AI plan awaiting user approval. `id` is the proposal id to apply. */
export type Proposal = AgentReply & {
  provider?: AiFeatureProvider;
  /** A dependency-aware project and schedule, approved together. */
  project?: ProjectDecomposition | null;
  id: string;
  /**
   * Quick replies the user can tap, such as the choices in a clarifying
   * question ("Which Dentist: Tuesday 9am or Friday 2pm?").
   */
  follow_ups?: string[];
  /** Pages the assistant read while answering, so an answer can be checked. */
  sources?: AssistantSource[];
  /** Notes it has drafted, which become pages only when someone keeps them. */
  notes?: DraftNote[];
  /** A schedule the assistant planned; the apps show it to review and apply. */
  plan?: Plan | null;
  /** One session move or removal awaiting the same approval as item changes. */
  session_change?: SessionChange | null;
  /** A reviewed create action that will deliver an open project decision. */
  decision_links?: {
    action_index: number;
    decision_id: string;
    decision_title: string;
  }[];
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
  /** Set while the server's clock is out against outside time. */
  clock?: ServerClock | null;
};

/**
 * The server's clock found out against outside time (the Date of two
 * well-known sites, checked by the worker every few minutes): how far, and
 * since when. Only there while it is out by more than a couple of minutes.
 */
export type ServerClock = {
  /** Server time minus outside time: positive when the server is fast. */
  skew_ms: number;
  /** When it was first found out (outside time). */
  since: string;
  /** The latest check that agreed (outside time). */
  checked_at: string;
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
  /** Set while the server's clock is out (see `ServerClock`). */
  clock?: ServerClock | null;
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
  options: AiProviderOptions;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  /** Exact connection token for embedding consent, independent of generation controls. */
  embedding_revision?: string;
  /** Exact generation token for model-control compare-and-set. */
  controls_revision?: string;
};

export type AiSettings = {
  /** Opaque current settings snapshot for independent, conditional budget edits. */
  settings_revision?: string;
  /** Shared token allowance for one person's night, set by a workspace admin. */
  night_token_budget?: number;
  provider_id: string | null;
  model: string;
  /** Where the assistant's configuration currently comes from. */
  /** "none" means the assistant is off until an admin chooses a provider. */
  source: "database" | "none";
  /** Whether pages are found by meaning as well as by words. */
  semantic_search: boolean;
  /**
   * Whether this database could do that at all. False on a Postgres without
   * pgvector, where the setting is there but has nothing to turn on.
   */
  semantic_possible: boolean;
  /** The model that measures text for search by meaning ("" until chosen). */
  embedding_model?: string;
  /** Independently selected workspace provider; never inherited from chat. */
  embedding_provider_id?: string | null;
  /** Dimensions verified by a non-personal setup probe. */
  embedding_dimensions?: number | null;
  /** Compare-and-set token for concurrent setup changes. */
  embedding_generation?: string;
  /** Saved acceptance was invalidated by a provider edit or removal. */
  embedding_needs_validation?: boolean;
  /** Eligible pages still waiting for the current embedding configuration. */
  embedding_pending_pages?: number;
  /** Eligible pages with passages measured at their current document version. */
  embedding_indexed_pages?: number;
  /** Failed queued pages for the current accepted configuration and document revision. */
  embedding_failed_pages?: number;
  /** Earliest retry due time; worker liveness is reported separately. */
  embedding_next_retry_at?: string | null;
  /** When an admin accepted that every page is sent to be measured. */
  semantic_accepted_at?: string | null;
  /** Whether the measuring service has reported in lately. */
  measure_running?: boolean;
  updated_at: string | null;
};

export type AiProvidersResponse = {
  providers: AiProvider[];
  settings: AiSettings;
};
export type AiModelList = {
  models: string[];
  /** Saved connection generation verified before returning the catalog. */
  provider_revision?: string;
};
/** Discovery is advisory; enabling search still validates dimensions and consent. */
export type AiEmbeddingModelList = AiModelList & {
  catalog_kind: "embedding" | "unclassified" | "manual";
};
export type AiTestResult = {
  /** Exact saved connection and model tested; older servers may omit them. */
  provider_revision?: string;
  model?: string;
  usage?: AiModelUsage;
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
  /** The connected agent it was written through ("Claude"), if one. */
  via_agent?: string | null;
  created_at: string;
};

/** A task with its checklist and progress timeline (newest first). */
export type ItemDetail = Item & {
  steps: ItemStep[];
  updates: ItemUpdate[];
  /** People invited to an event, with their answers. */
  attendees?: Attendee[];
  /** Occurrences of a repeating item changed on their own. */
  overrides?: ItemOverride[];
  /** Web links, in order. */
  links?: ItemLink[];
};

export type AttendeeStatus = "needs_action" | (typeof RSVP_STATUSES)[number];

/** Someone invited to an event by email. */
export type Attendee = {
  id: string;
  email: string;
  name: string;
  status: AttendeeStatus;
  responded_at: string | null;
};

/** What changed on one occurrence of a series ("edit this one"). */
export type OccurrenceChanges = {
  title?: string;
  notes?: string;
  /** The occurrence's own start and end. */
  due_at?: string;
  end_at?: string | null;
  location?: string;
  meeting_url?: string;
  busy?: boolean;
  color?: string | null;
  alerts?: number[];
};

/** One occurrence of a repeating item, changed on its own. */
export type ItemOverride = OccurrenceChanges & {
  /** Which occurrence (its original start). */
  occurrence: string;
};

export type EditScope = (typeof EDIT_SCOPES)[number];

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
  /** Monotonic server revision for conditional Undo. */
  revision?: number;
  id: string;
  item_id: string;
  user_id: string;
  start_at: string;
  end_at: string;
  source: "manual" | "planner";
  plan_id: string | null;
  /** When its person started working on it (focus mode, or "Start"). */
  started_at?: string | null;
  /** The check-in answer, once given (see session-check-in.ts). */
  outcome?: "done" | "more" | "skipped" | null;
  /** From the task, for drawing the block. */
  title: string;
  status: Status;
  kind: Kind;
  priority: Priority;
  team_id: string | null;
  list_id: string | null;
  estimate_minutes: number | null;
  // The rest come with `GET /blocks`, `GET /calendar`, `GET
  // /items/:id/sessions` and the session webhooks; lists built for other
  // uses (the review, the assistant) leave them out.
  /**
   * When the session's task is due, as the task shows it. For a repeating
   * task, the occurrence this session is for (see `sessionDueFor`). Null
   * without a date.
   */
  due_at?: string | null;
  /** That due date is a whole day: due by the end of it. */
  due_all_day?: boolean;
  /** The moment it's due by (see `deadlineOf`); null without a date. */
  deadline_at?: string | null;
  /** Earlier task or project target used for planning, without editing the task. */
  planning_deadline_at?: string | null;
  /** The task's project, if it's in one. */
  project_id?: string | null;
  /**
   * This session's number among all of your sessions for the task (for a
   * repeating task, for that occurrence), in time order: "Session 2 of 3".
   */
  part?: number;
  parts?: number;
  /** The session ends after the deadline. */
  after_deadline?: boolean;
};

/**
 * `GET /items/:id/sessions`: your sessions for one task, past ones too, and
 * how much of the time still to come ends by its deadline.
 */
export type ItemSessions = {
  item_id: string;
  /** Whether the task still belongs to this person; their old sessions remain removable. */
  assigned_to_me: boolean;
  /** When the task is due (the current occurrence of a repeating one). */
  due_at: string | null;
  due_all_day: boolean;
  /** The moment it's due by (see `deadlineOf`). */
  deadline_at: string | null;
  /**
   * Its project's deadline, a latest date for the project's tasks. Never a
   * task's own deadline.
   */
  project_deadline: string | null;
  /** Earliest deadline of an open task that depends on this one, directly or through a chain. */
  dependent_deadline?: string | null;
  /**
   * The deadline its time and status are measured against now (see
   * `fitDeadline`): the earlier of its own and its latest date while that
   * is still ahead, else its own. Never changes the task's due date.
   */
  planning_deadline_at?: string | null;
  /**
   * Your sessions for it, oldest first. For a repeating task, those for the
   * current occurrence and later ones.
   */
  sessions: TimeBlock[];
  /** Minutes still to come in sessions that end by the deadline (all of them without one). */
  planned_minutes: number;
  /** Minutes still to come in sessions that end after the deadline. */
  late_minutes: number;
  /**
   * Whether your sessions cover what it still needs before its deadline
   * (see `deadlineFit`): "On track", "Short 2h", "Session after the
   * deadline"… Null for a finished task, or one that isn't yours to plan (a
   * teammate's).
   */
  fit: DeadlineFit | null;
  /**
   * The zone the account plans in, to name the deadline in; null when it
   * isn't set (the apps then use the device's).
   */
  time_zone?: string | null;
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
  /** A whole-day entry: `start_at` and `end_at` are local midnights. */
  all_day?: boolean;
  /** Whether it counts as busy (false for free and all-day events). */
  busy?: boolean;
  color?: string | null;
  /** Minutes before the start to remind. */
  alerts?: number[];
  /** True when this occurrence was changed on its own. */
  overridden?: boolean;
  /** How many people are invited. */
  attendee_count?: number;
};

/** One occurrence of an event from a calendar you subscribe to (read-only). */
export type ExternalEntry = {
  subscription_id: string;
  /** The subscription's name. */
  name: string;
  color: string;
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string;
  /** Whether it counts as busy (the subscription's settings). */
  busy: boolean;
  /** What the subscription holds. */
  calendar_kind?: CalendarKind;
};

/** Time the calendar keeps around events: buffers and travel. */
export type DerivedBlock = {
  kind: "buffer" | "travel";
  item_id: string;
  start_at: string;
  end_at: string;
  label: string;
};

/** One occurrence of a frame on the calendar. */
export type FrameOccurrence = {
  frame_id: string;
  name: string;
  color: string;
  start_at: string;
  end_at: string;
  busy: boolean;
  /** The frame's local date for this occurrence (what `skip` takes). */
  date: string;
};

export type CalendarView = {
  from: string;
  to: string;
  timezone: string;
  entries: CalendarEntry[];
  blocks: TimeBlock[];
  derived: DerivedBlock[];
  /** Your frames in the range. */
  frames?: FrameOccurrence[];
  /** Events from calendars you subscribe to. */
  external?: ExternalEntry[];
  /** Habit sessions already set aside in the range. */
  habit_blocks?: HabitBlock[];
};

/** One event found by `GET /calendar/search`: yours, or from a subscription. */
export type CalendarSearchResult =
  | ({ source: "item" } & CalendarEntry)
  | ({ source: "external" } & ExternalEntry);

export type CalendarSearch = {
  q: string;
  from: string;
  to: string;
  /** Soonest first, up to 100. */
  results: CalendarSearchResult[];
};

/** Busy times of someone you share a team with, for overlaying on your calendar. */
export type UserAvailability = {
  user_id: string;
  name: string;
  timezone: string;
  busy: BusyInterval[];
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
  /** Days before a due time to warn about a task with no time set aside (0 = off). */
  deadline_notice_days?: number;
  /** Planner notices also go to push and email when these are on. */
  planner_notices?: PlannerNotices;
  /** Alerts new items get when created without any. */
  default_alerts?: DefaultAlerts;
  /** Completing a task adds its blocks' past time to its time spent (once). */
  count_blocks_as_spent?: boolean;
  /** Which events get buffers. */
  buffer_scope?: BufferScope;
  /** Minutes added to every travel leg. */
  travel_padding_minutes?: number;
  /** Morning agenda and evening review emails. */
  digest?: DigestPrefs;
  /** Scale each task's estimate by how long that kind of task really takes. */
  learn_estimates?: boolean;
  /** Put demanding work in the hours that usually go well (learned). */
  learn_rhythm?: boolean;
  /** Spread work so no day asks for much more than you usually get through. */
  balance_load?: boolean;
  /** A reminder this many minutes before each session starts; null or missing: off. */
  session_reminder_minutes?: number | null;
};

/** What the planner has learned about how long tasks really take. */
export type EstimateModel = {
  /**
   * actual ÷ estimated over recent finished tasks; 1 until there's enough
   * data. `range` is the middle half of how tasks go (a quarter run shorter
   * than its low end, a quarter longer than its high end).
   */
  overall: {
    ratio: number;
    samples: number;
    range?: [number, number] | null;
  };
  /** Per-tag ratios, only where there are enough finished tasks to trust. */
  tags: { tag_id: string; name: string; ratio: number; samples: number }[];
  /** Per-list ratios, the same way. */
  lists?: { list_id: string; name: string; ratio: number; samples: number }[];
  /** How long a task usually takes you when it has no estimate, once known. */
  typical_minutes?: number | null;
  /** Whether the planner is applying these corrections. */
  applied: boolean;
};

/** Which hours of the day usually go well, learned from kept blocks and focus. */
export type RhythmModel = {
  /** Per local hour 0–23, from -1 (planned time usually slips) to 1 (usually goes well). */
  hours: number[];
  /** 0–1: how much history there is behind it. */
  confidence: number;
  /** Minutes of planned blocks and focus sessions it was learned from. */
  evidence_minutes: number;
  /** The best two hours in a row, once there's enough history. */
  peak: { start_hour: number; end_hour: number } | null;
};

/** How much planned time someone usually gets through in a day. */
export type LoadModel = {
  /** Minutes a good-but-normal day gets through; null until there's history. */
  typical_day_minutes: number | null;
  /** Share of planned time that got done (0–1). */
  follow_through: number | null;
  /** Days with at least an hour planned that it was learned from. */
  days: number;
};

/** Everything the planner has learned from someone's history (`GET /planner/learning`). */
export type PlannerLearning = {
  estimates: EstimateModel;
  rhythm: RhythmModel & { applied: boolean };
  load: LoadModel & { applied: boolean };
};

/** A task worth doing now, and why (`GET /planner/next`). */
export type UpNextSuggestion = {
  item_id: string;
  title: string;
  due_at: string | null;
  priority: "low" | "medium" | "high";
  /** A sensible session to start with now, in minutes. */
  minutes: number;
  /** Short reasons, most important first ("Due today, 17:00"). */
  reasons: string[];
  /** Time is set aside for it right now. */
  planned_now: boolean;
};

export type UpNext = {
  at: string;
  /** The free time from now to the next event or the end of the working day. */
  window: {
    start_at: string;
    end_at: string;
    minutes: number;
    /** What ends the window: the next event's title, or null for the end of the day. */
    until: string | null;
  } | null;
  suggestions: UpNextSuggestion[];
};

export type BufferScope = z.output<typeof bufferScopeInput>;

export type PlannerNotices = { push: boolean; email: boolean };

/** Daily digest emails, off by default and opt-in per person. */
export type DigestPrefs = {
  morning: boolean;
  evening: boolean;
  /** Local time each digest is sent, "HH:MM". */
  morning_time: string;
  evening_time: string;
  /**
   * "What your agents did" in the morning digest, when agents changed
   * anything (H7). Missing: on.
   */
  agents?: boolean;
  /** A push when an agent finishes a job of over 20 changes. Missing: on. */
  agent_push?: boolean;
};

/** Minutes-before alerts for new events, tasks and all-day items. */
export type DefaultAlerts = {
  event: number[];
  task: number[];
  all_day: number[];
};

export type FrameFilters = z.output<typeof frameFilters>;

/** A recurring window reserved for a kind of work. */
export type Frame = {
  id: string;
  name: string;
  /** Weekdays it repeats on, when it has no `rrule`. */
  days: number[];
  start_time: string;
  end_time: string;
  filters: FrameFilters;
  color: string;
  position: number;
  /** How it repeats; wins over `days` when set. */
  rrule?: string | null;
  /** The first day of the rule ("YYYY-MM-DD"). */
  series_start?: string | null;
  /** Busy frames block booking pages and teammates' meeting times. */
  busy?: boolean;
  /** Skipped dates ("YYYY-MM-DD", in the frame's zone). */
  exdates?: string[];
  /** Its time zone; the owner's planner zone when null. */
  timezone?: string | null;
};

/** How often a habit repeats. */
export type HabitPeriod = "day" | "week";

/**
 * A flexible routine. The planner fits `cadence` sessions of `duration_minutes`
 * into each period, on the allowed `days` and inside the time-of-day window,
 * and moves them as the calendar changes — unlike a rigid recurring event.
 */
export type Habit = {
  id: string;
  name: string;
  cadence: number;
  period: HabitPeriod;
  duration_minutes: number;
  /** Weekdays a session may land on (0 = Sunday). */
  days: number[];
  /** Time-of-day window; null means "my working hours". */
  window_start: string | null;
  window_end: string | null;
  priority: Priority;
  active: boolean;
  position: number;
  created_at: string;
  /** Sessions already set aside this period, and the target for it. */
  progress?: { done: number; target: number };
};

/** One placed session of a habit, shown on the calendar. */
export type HabitBlock = {
  outcome?: "done" | "skipped" | null;
  outcome_at?: string | null;
  version?: number;
  id: string;
  habit_id: string;
  name: string;
  start_at: string;
  end_at: string;
  source: "manual" | "planner";
};

/** A session the habit planner proposes, before it is applied. */
export type ProposedHabitBlock = {
  habit_id: string;
  name: string;
  start_at: string;
  end_at: string;
};

/** What planning habits found: sessions to add, and what couldn't be fit. */
export type HabitPlan = {
  blocks: ProposedHabitBlock[];
  /** Per habit: how many of the period's target were placed. */
  summary: {
    habit_id: string;
    name: string;
    placed: number;
    needed: number;
    reason: string | null;
  }[];
};

/** A place and the time it takes to get there. */
export type Place = {
  id: string;
  label: string;
  match: string;
  travel_minutes: number;
  /** How you get there (a label only). */
  mode?: TravelMode | null;
  /** Minutes on weekdays 07:00-09:00 and 16:00-18:00; null: the same as usual. */
  peak_minutes?: number | null;
};

export type TravelMode = (typeof TRAVEL_MODES)[number];

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
  /** A block the user pinned while tuning the plan; it stays where it is. */
  pinned?: boolean;
};

export type UnplacedTask = {
  item_id: string;
  title: string;
  due_at: string | null;
  /** When it's due by (`deadlineOf`): the end of its day when all-day, its end time when it has one. */
  deadline_at?: string | null;
  /** Due on a whole day (by the end of it) rather than at a time. */
  due_all_day?: boolean;
  reason: string;
  /**
   * For a task at risk: what it still needs before the deadline, and the
   * free working time there was for it before then.
   */
  remaining_minutes?: number;
  free_minutes?: number;
};

/**
 * A session that ends after its task's deadline, which a plan offers to move
 * to free time before it. Sessions the planner made are ticked (`selected`);
 * ones you placed by hand are offered unticked. Nothing moves until the plan
 * is applied with it ticked.
 */
export type PlanMove = {
  /** The session. */
  block_id: string;
  item_id: string;
  title: string;
  /** Where it is now. */
  from_start_at: string;
  from_end_at: string;
  /** Where it would go, ending by the deadline. */
  start_at: string;
  end_at: string;
  /** The deadline it would end by, and whether that's a whole day. */
  deadline_at: string | null;
  due_all_day?: boolean;
  /** Who placed it: the planner, or you. */
  source: "manual" | "planner";
  /** Ticked to move when the plan is applied. */
  selected: boolean;
};

/** `POST /planner/plans/:id/apply`: what was added, moved and left out. */
export type PlanApplied = {
  /** The sessions added. */
  blocks: TimeBlock[];
  /** Sessions left out because something else is there now. */
  skipped: number;
  /** Sessions moved before their deadline. */
  moved: TimeBlock[];
  /** Moves left out: the session changed or went, or the time is taken now. */
  moves_skipped: number;
};

export type PlanScope = z.output<typeof planScope>;

/** Every task a plan looked at, for a checklist of what's in and out. */
export type PlanTask = {
  item_id: string;
  title: string;
  due_at: string | null;
  /** When it's due by (`deadlineOf`), and whether that's a whole day. */
  deadline_at?: string | null;
  due_all_day?: boolean;
  priority: Priority;
  team_id: string | null;
  list_id: string | null;
  /** The minutes planned for: the tuned estimate, or the task's own. */
  estimate_minutes: number | null;
  /** True when the plan uses a tuned estimate rather than the task's. */
  estimate_tuned: boolean;
  /**
   * For a task with no estimate, the length learned from finished tasks that
   * the plan used instead of 30 minutes, and what it came from.
   */
  estimate_guess?: {
    minutes: number;
    basis: "similar" | "list" | "tag" | "typical";
  } | null;
  /** False for tasks left out of this plan. */
  included: boolean;
  /** Minutes the plan gives it (pinned blocks and ticked moves included). */
  planned_minutes: number;
  /**
   * Of those, minutes in the ticked sessions the plan moves before the
   * deadline (one of yours it offers unticked isn't counted).
   */
  moved_minutes?: number;
  /** Why it wasn't (fully) planned, or why it was left out; null when it fits. */
  reason: string | null;
  at_risk: boolean;
  /**
   * Its "does it fit?" status once the plan is applied as proposed (see
   * `deadlineFit`); left out for tasks the plan leaves out.
   */
  fit?: DeadlineFit | null;
};

/** The options a plan was made with, resolved from the request and preferences. */
export type PlanOptions = {
  /** Present for a project plan; refresh must keep its ownership filter. */
  project_id?: string;
  start_date: string;
  days: number;
  pad_percent: number;
  split: boolean;
  break_level: BreakLevel;
  use_frames: boolean;
  timezone: string;
  scope: PlanScope | null;
  keep_free: BusyInterval[];
  item_ids: string[] | null;
  include_item_ids: string[];
  exclude_item_ids: string[];
  estimates: Record<string, number>;
  pinned_blocks: { item_id: string; start_at: string; end_at: string }[];
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
  /**
   * Sessions after their task's deadline that the plan can move to free
   * time before it. A plan may hold only moves.
   */
  moves?: PlanMove[];
  capacity_minutes: number;
  planned_minutes: number;
  applied: boolean;
  expires_at: string;
  summary: string;
  /** Every task considered: included, left out, and why. */
  tasks?: PlanTask[];
  options?: PlanOptions;
  /** Set once a tuned plan replaces this one. */
  superseded_by?: string | null;
  /** Tasks whose estimates were saved while tuning. */
  estimates_saved?: string[];
};

/** Whether the calendar or tasks changed since a plan was made. */
export type PlanStaleness = { stale: boolean };

export type AtRiskTask = UnplacedTask & {
  remaining_minutes: number;
  free_minutes: number;
};

/** What needs attention in the plan. */
/** Where set-aside time went over a period: totals, by list and by tag. */
export type PlannerAnalytics = {
  from: string;
  to: string;
  days: number;
  /** Minutes set aside (time blocks) in the range. */
  planned_minutes: number;
  /** Tasks marked done in the range. */
  completed: number;
  by_list: { name: string; minutes: number }[];
  by_tag: { name: string; minutes: number }[];
};

export type PlannerReview = {
  /** Past blocks whose tasks are still open. */
  unfinished: TimeBlock[];
  at_risk: AtRiskTask[];
  /** Future blocks that now overlap an event, yours or a subscribed one. */
  conflicts: { block: TimeBlock; entry: AgendaEntry }[];
};

/**
 * One thing on your day, from your own events or a calendar you subscribe
 * to: what digests, clash checks, the assistant and widgets read. Only ever
 * shown to its owner.
 */
export type AgendaEntry = {
  subscription_id?: string;
  source: "event" | "subscription";
  /** Your event's item; null for a subscribed event. */
  item_id: string | null;
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string;
  /** Whether it counts as busy. */
  busy: boolean;
  /** The subscribed calendar's name; null for your own events. */
  calendar: string | null;
  calendar_kind: CalendarKind | null;
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

/** Team owners' view: set-aside time on team items, per member. No titles. */
export type TeamAnalytics = {
  from: string;
  to: string;
  days: number;
  total_planned_minutes: number;
  members: {
    user_id: string;
    name: string;
    planned_minutes: number;
    completed: number;
  }[];
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
  /** This member's tasks that can't get enough time before they're due. */
  at_risk_items?: TeamAtRiskItem[];
};

/** A team task that can't get enough time before it's due. */
export type TeamAtRiskItem = {
  id: string;
  title: string;
  assignee_id: string;
  assignee_name: string;
  due_at: string;
  /** The moment it's due by (see `deadlineOf`): free time before this counts. */
  deadline_at: string;
  /** Due on a whole day: name the day, not a time. */
  due_all_day: boolean;
  remaining_minutes: number;
};

export type MeetingSlot = {
  start_at: string;
  end_at: string;
  /** Lower is better: slots that split someone's focus time rank later. */
  disruption: number;
};

// ---- Booking pages -------------------------------------------------------------

export type BookingHost = { user_id: string; name: string; required: boolean };

export type BookingQuestion = z.output<typeof bookingQuestion>;
export type BookingAvailability = z.output<typeof bookingAvailability>;
export type DateOverride = z.output<typeof dateOverride>;
export type BookingView = (typeof BOOKING_VIEWS)[number];

export type BookingPage = {
  id: string;
  owner_id: string;
  slug: string;
  title: string;
  description: string;
  durations: number[];
  window_days: number;
  min_notice_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  /** How often start times are offered, in minutes. */
  slot_interval_minutes: number;
  max_per_day: number | null;
  max_per_week: number | null;
  location: string;
  meeting_url: string;
  active: boolean;
  /** Accent colour of the public page. */
  color: string;
  availability: BookingAvailability;
  date_overrides: DateOverride[];
  questions: BookingQuestion[];
  requires_approval: boolean;
  allow_reschedule: boolean;
  /** collective: every required host must be free. round_robin: any host, and
   * each booking goes to the fairest available one. */
  assignment: "collective" | "round_robin";
  /** Round-robin routing: an answer that equals a value prefers a host. */
  routing: { question_id: string; equals: string; host_user_id: string }[];
  /** The hosts' event title; {page}, {name} and {email} are filled in. */
  event_title: string;
  confirmation_message: string;
  hosts: BookingHost[];
  /** Upcoming confirmed bookings, and requests waiting for a host. */
  counts: { upcoming: number; needs_approval: number };
  created_at: string;
  updated_at: string;
  /** A team's page (its owners and admins manage it); null for your own. */
  team_id?: string | null;
  team_name?: string | null;
  /** Whether you can change the page (its owner, or a team owner or admin). */
  can_edit?: boolean;
  /** Minutes before the meeting the booker is emailed a reminder. */
  remind_before_minutes?: number[];
};

/**
 * pending: waiting for the booker's email link. awaiting_approval: waiting
 * for a host. expired: neither happened in time.
 */
export type BookingStatus =
  | "pending"
  | "awaiting_approval"
  | "confirmed"
  | "declined"
  | "cancelled"
  | "expired";

export type Booking = {
  id: string;
  /** Null for bookings made from an open invite, which has no page. */
  page_id: string | null;
  page_title: string | null;
  page_slug: string | null;
  start_at: string;
  end_at: string;
  name: string;
  email: string;
  note: string;
  /** Answers by question id. */
  answers: Record<string, string>;
  status: BookingStatus;
  no_show: boolean;
  /** Private: only hosts see it. */
  host_note: string;
  cancel_reason: string;
  cancelled_by: "booker" | "host" | null;
  reschedule_count: number;
  /** The booker's time zone. */
  timezone: string;
  created_at: string;
  updated_at: string;
  /** Set for a booking made from an open invite (then `page_id` is null). */
  invite_id?: string | null;
};

/** One step in a booking's history. */
export type BookingEvent = {
  id: string;
  kind:
    | "requested"
    | "email_confirmed"
    | "approved"
    | "declined"
    | "confirmed"
    | "rescheduled"
    | "cancelled"
    | "no_show"
    | "note";
  actor: "host" | "booker" | "system";
  actor_name: string | null;
  detail: string;
  created_at: string;
};

export type BookingDetail = Booking & {
  questions: BookingQuestion[];
  hosts: BookingHost[];
  location: string;
  meeting_url: string;
  events: BookingEvent[];
};

/** A summary of bookings across your pages, or one page. */
export type BookingStats = {
  upcoming: number;
  needs_approval: number;
  /** Waiting for the booker's email link. */
  awaiting_email: number;
  confirmed: number;
  cancelled: number;
  declined: number;
  no_show: number;
  /** Bookings made in the last 30 days. */
  last_30_days: number;
  /** cancelled / (confirmed + cancelled), 0 to 1. */
  cancellation_rate: number;
  next: Booking | null;
  pages: {
    page_id: string;
    title: string;
    slug: string;
    upcoming: number;
    needs_approval: number;
    total: number;
  }[];
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
  color: string;
  questions: BookingQuestion[];
  requires_approval: boolean;
  allow_reschedule: boolean;
};

export type BookingReceipt = {
  id: string;
  status: BookingStatus;
  start_at: string;
  end_at: string;
  /** True when the booking waits for the link sent by email. */
  needs_confirmation: boolean;
  /** True when a host has to approve it. */
  needs_approval: boolean;
  confirmation_message: string;
};

/** What a booker sees from their private manage link. */
export type ManagedBooking = {
  booking: {
    id: string;
    status: BookingStatus;
    start_at: string;
    end_at: string;
    name: string;
    duration: number;
    timezone: string;
  };
  page: {
    slug: string;
    title: string;
    color: string;
    location: string;
    has_meeting_link: boolean;
    hosts: string[];
    /** True when the booking came from an open invite (no page to book again from). */
    invite?: boolean;
  };
  can_reschedule: boolean;
  can_cancel: boolean;
};

/**
 * open: waiting for someone to pick a time. booked: someone did. expired:
 * its time ran out. cancelled: its owner withdrew it.
 */
export type OpenInviteStatus = "open" | "booked" | "expired" | "cancelled";

/** A one-off link offering hand-picked windows, as its owner sees it. */
export type OpenInvite = {
  id: string;
  title: string;
  duration: number;
  windows: BusyInterval[];
  location: string;
  meeting_url: string;
  co_hosts: { user_id: string; name: string }[];
  remind_before_minutes: number[];
  status: OpenInviteStatus;
  expires_at: string;
  /** The private link to send (`<APP_URL>/invite/<token>`). */
  url: string;
  booking: {
    id: string;
    name: string;
    email: string;
    start_at: string;
    end_at: string;
    status: BookingStatus;
  } | null;
  created_at: string;
};

/** What someone with an open invite's link sees. */
export type PublicInvite = {
  title: string;
  hosts: string[];
  duration: number;
  location: string;
  has_meeting_link: boolean;
  status: OpenInviteStatus;
  expires_at: string;
  timezone: string;
  /** Free start times inside the windows (empty unless open). */
  slots: BusyInterval[];
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
  /** Minutes before a busy event that `event.starting` is sent. */
  lead_minutes?: number;
  active: boolean;
  last_status: number | null;
  last_error: string | null;
  last_delivered_at: string | null;
  created_at: string;
};
/** Returned once, when the webhook is created: the signing secret. */
export type NewWebhook = Webhook & { secret: string };

/** A private subscription link for other calendar apps. */
export type CalendarFeed = {
  url: string;
  /** True for the link that only shows when you're busy. */
  busy?: boolean;
};

/** Which feed links are on (the links themselves are only shown once) and what they include. */
export type CalendarFeedSettings = {
  enabled: boolean;
  busy_enabled: boolean;
  include_blocks: boolean;
};

/** A calendar from another app that Orbyn reads by its ICS link. */
export type CalendarKind = (typeof CALENDAR_KINDS)[number];
export type CalendarSharing = (typeof CALENDAR_SHARING)[number];

export type CalendarSubscription = {
  id: string;
  url: string;
  name: string;
  color: string;
  kind: CalendarKind;
  busy: boolean;
  all_day_busy: boolean;
  visible: boolean;
  sharing: CalendarSharing;
  reminder_minutes: number | null;
  last_fetched_at: string | null;
  /** Why the last refresh failed; null when it worked. */
  last_error: string | null;
  event_count: number;
  created_at: string;
};

/** What an invitee sees from their RSVP link. */
export type RsvpView = {
  title: string;
  start_at: string;
  end_at: string | null;
  all_day: boolean;
  timezone: string;
  rrule: string | null;
  organizer: string;
  location: string;
  meeting_url: string;
  name: string;
  email: string;
  status: AttendeeStatus;
};

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
export type HabitInput = z.input<typeof habitInput>;
export type HabitUpdate = z.input<typeof habitUpdate>;
export type HabitPlanInput = z.input<typeof habitPlanInput>;
export type PlaceInput = z.input<typeof placeInput>;
export type PlaceUpdate = z.input<typeof placeUpdate>;
export type PlanPreviewInput = z.input<typeof planPreviewInput>;
export type PlanTuneInput = z.input<typeof planTuneInput>;
export type FrameSkipInput = z.input<typeof frameSkipInput>;
export type BlockDuplicateInput = z.input<typeof blockDuplicateInput>;
export type BlockRescheduleInput = z.input<typeof blockRescheduleInput>;
export type PlanApplyInput = z.input<typeof planApplyInput>;
export type BookingPageInput = z.input<typeof bookingPageInput>;
export type BookingPageUpdate = z.input<typeof bookingPageUpdate>;
export type BookingRequest = z.input<typeof bookingRequest>;
export type CalendarSubscriptionInput = z.input<
  typeof calendarSubscriptionInput
>;
export type CalendarSubscriptionUpdate = z.input<
  typeof calendarSubscriptionUpdate
>;
export type CalendarFeedSettingsInput = z.input<
  typeof calendarFeedSettingsInput
>;
export type ItemPositionInput = z.input<typeof itemPositionInput>;
export type ItemLinkInput = z.input<typeof itemLinkInput>;
export type BufferScopeInput = z.input<typeof bufferScopeInput>;
export type OpenInviteInput = z.input<typeof openInviteInput>;
export type InviteBookingRequest = z.input<typeof inviteBookingRequest>;
export type ProfileInput = z.input<typeof profileInput>;
export type WebhookInput = z.input<typeof webhookInput>;
export type WebhookUpdate = z.input<typeof webhookUpdate>;
export type WebhookTestResult = {
  ok: boolean;
  status: number | null;
  error: string | null;
};
