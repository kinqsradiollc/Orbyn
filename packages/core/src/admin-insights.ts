import { z } from "zod";
import type { ApiKey } from "./types.js";

/** What the admin console shows about traffic, usage and one account. */

export const REQUEST_STATUS_CLASSES = ["2xx", "3xx", "4xx", "5xx"] as const;

export const requestLogQuery = z
  .object({
    service: z.string().trim().max(40).optional(),
    status: z.enum(REQUEST_STATUS_CLASSES).optional(),
    route: z.string().trim().max(200).optional(),
    /** Part of the person's email or name. */
    user: z.string().trim().max(200).optional(),
    request_id: z.string().trim().max(64).optional(),
    /** Only requests that took a second or more. */
    // A query string says "true" or "false"; coercion would read "false" as true.
    slow: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
    /** Page back from this row id. */
    before: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export const requestSummaryQuery = z
  .object({ hours: z.coerce.number().int().min(1).max(168).default(24) })
  .strict();

export const analyticsQuery = z
  .object({ days: z.coerce.number().int().min(7).max(365).default(30) })
  .strict();

export type RequestLogRow = {
  id: number;
  at: string;
  service: string;
  instance: string;
  request_id: string;
  method: string;
  route: string;
  status: number;
  duration_ms: number;
  user_id: string | null;
  user_email: string | null;
};

export type ServiceTraffic = {
  service: string;
  requests: number;
  client_errors: number;
  server_errors: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
  instances: number;
  last_at: string | null;
};

export type RouteTraffic = {
  service: string;
  method: string;
  route: string;
  requests: number;
  server_errors: number;
  p95_ms: number;
};

export type RequestSummary = {
  hours: number;
  /** Share of ordinary requests kept in the log; errors and slow ones always are. */
  sample: number;
  services: ServiceTraffic[];
  /** Requests and server errors per hour, oldest first. */
  timeline: { hour: string; requests: number; server_errors: number }[];
  slowest_routes: RouteTraffic[];
  failing_routes: RouteTraffic[];
  instances: { service: string; instance: string; last_at: string }[];
};

export type AnalyticsDay = {
  day: string;
  active_users: number;
  signups: number;
  items_created: number;
  tasks_done: number;
  docs_created: number;
  ai_requests: number;
  requests: number;
  server_errors: number;
  bookings: number;
  focus_minutes: number;
};

export type AdminAnalytics = {
  days: number;
  totals: {
    users: number;
    active_today: number;
    active_7_days: number;
    active_30_days: number;
    signups: number;
    items_created: number;
    tasks_done: number;
    docs_created: number;
    projects_created: number;
    ai_requests: number;
    bookings: number;
    focus_minutes: number;
    notifications_sent: number;
    notifications_failed: number;
  };
  series: AnalyticsDay[];
  /** The people most active in the period, by days active. */
  most_active: {
    user_id: string;
    email: string;
    name: string;
    days_active: number;
    requests: number;
  }[];
};

/** Everything an admin sees about one account (never the contents of items). */
export type AdminUserDetail = {
  id: string;
  email: string;
  name: string;
  role: string;
  disabled: boolean;
  email_verified: boolean;
  created_at: string;
  last_active: string | null;
  sessions: {
    id: string;
    user_agent: string;
    last_seen_at: string;
    expires_at: string;
  }[];
  two_factor: boolean;
  passkeys: number;
  api_keys: number;
  /** Their personal API keys (never the keys themselves), newest first. */
  keys: ApiKey[];
  teams: { id: string; name: string; role: string }[];
  counts: {
    items: number;
    open_items: number;
    docs: number;
    projects: number;
    bookings: number;
  };
  activity: { day: string; requests: number }[];
  audit: {
    id: string;
    action: string;
    actor_email: string | null;
    created_at: string;
  }[];
};

export const adminUserProfileUpdate = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    email: z.email().trim().toLowerCase().max(254).optional(),
  })
  .strict();

export const announcementInput = z
  .object({
    message: z.string().trim().max(300),
    tone: z.enum(["info", "warning"]).default("info"),
    /** When it stops showing; null shows it until cleared. */
    until: z.iso.datetime({ offset: true }).nullable().default(null),
  })
  .strict();

export type Announcement = {
  message: string;
  tone: "info" | "warning";
  until: string | null;
  updated_at: string | null;
};

/** One kind of record the sweeper clears, as Admin → System shows it. */
export type SweepRuleView = {
  key: string;
  label: string;
  detail: string;
  configurable: boolean;
  /** Days kept; 0 keeps forever; null for records that always go once expired. */
  days: number | null;
  default_days: number | null;
  min_days: number | null;
  rows: number;
  size: string;
};

export type SweepView = {
  rules: SweepRuleView[];
  last: {
    at: string;
    took_ms: number;
    removed: Record<string, number>;
    errors: Record<string, string>;
  } | null;
};
