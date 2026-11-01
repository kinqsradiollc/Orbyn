import { bookingPageInput, type BookingPage } from "@orbyn/core";
export type PageDraft = ReturnType<typeof bookingPageInput.parse>;
export function newPage(): PageDraft {
  return {
    ...bookingPageInput.parse({
      slug: "new-page",
      title: "New page",
      durations: [30],
      active: false,
      buffer_before_minutes: 0,
      buffer_after_minutes: 0,
    }),
    slug: "",
    title: "",
  };
}
export function pageDraft(p: BookingPage): PageDraft {
  return {
    slug: p.slug,
    title: p.title,
    description: p.description,
    durations: p.durations,
    window_days: p.window_days,
    min_notice_minutes: p.min_notice_minutes,
    buffer_before_minutes: p.buffer_before_minutes,
    buffer_after_minutes: p.buffer_after_minutes,
    slot_interval_minutes: p.slot_interval_minutes,
    max_per_day: p.max_per_day,
    max_per_week: p.max_per_week,
    location: p.location,
    meeting_url: p.meeting_url,
    active: p.active,
    co_hosts: p.hosts
      .filter((h) => h.user_id !== p.owner_id)
      .map((h) => ({ user_id: h.user_id, required: h.required })),
    color: p.color,
    availability: p.availability,
    date_overrides: p.date_overrides,
    questions: p.questions,
    assignment: p.assignment,
    routing: p.routing,
    requires_approval: p.requires_approval,
    allow_reschedule: p.allow_reschedule,
    event_title: p.event_title,
    confirmation_message: p.confirmation_message,
    team_id: p.team_id ?? null,
    remind_before_minutes: p.remind_before_minutes ?? [1440, 60],
  };
}
