import { Select } from "../../components/Select";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarPlus,
  Copy,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  DEFAULT_BOOKER_REMINDERS,
  QUESTION_TYPES,
  SLOT_INTERVALS,
  addDays,
  clockMinutes,
  localDateKey,
  type BookingPage,
  type BookingPageInput,
  type DateOverride,
  type Team,
  type TeamMember,
  type User,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { Swatches } from "../lists/ListsView";
import {
  copyText,
  deviceTimeZone,
  minutesLabel,
  timeZones,
} from "../../lib/planning";
import { RemindersField } from "./RemindersField";
import {
  DEFAULT_COLOR,
  accentStyle,
  bookingLink,
  fillTitle,
  isHex,
  questionId,
  readableAccent,
} from "./bookingUi";
import { DateField } from "../../components/DateField";

type Range = { start: string; end: string };
type Weekly = Range & { day: number };
type QuestionType = (typeof QUESTION_TYPES)[number];
type QuestionDraft = {
  /** React key; saved questions use their id. */
  key: string;
  id: string;
  /** Saved questions keep their id; new ones get one from the label. */
  fixed: boolean;
  label: string;
  type: QuestionType;
  required: boolean;
  options: string[];
};
type Draft = {
  slug: string;
  title: string;
  description: string;
  durations: number[];
  window_days: number;
  min_notice_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  slot_interval_minutes: number;
  max_per_day: number | null;
  max_per_week: number | null;
  location: string;
  meeting_url: string;
  active: boolean;
  co_hosts: { user_id: string; required: boolean }[];
  color: string;
  hours_mode: "working_hours" | "custom";
  /** Kept while "working hours" is picked, so switching back restores them. */
  timezone: string;
  weekly: Weekly[];
  date_overrides: DateOverride[];
  questions: QuestionDraft[];
  assignment: "collective" | "round_robin";
  routing: { question_id: string; equals: string; host_user_id: string }[];
  requires_approval: boolean;
  allow_reschedule: boolean;
  event_title: string;
  confirmation_message: string;
  /** A team's page, managed by its owners and admins; null for yours. */
  team_id: string | null;
  remind_before_minutes: number[];
};
type SectionId =
  "details" | "rules" | "hours" | "dates" | "form" | "approval" | "look";

const SECTIONS: [SectionId, string][] = [
  ["details", "Details"],
  ["rules", "Scheduling"],
  ["hours", "Availability"],
  ["dates", "Date overrides"],
  ["form", "Booking form"],
  ["approval", "Approval"],
  ["look", "Look & messages"],
];
const LENGTHS = [15, 20, 30, 45, 60, 90, 120];
const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
/** Weekdays in the order shown, Monday first. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const MAX_RANGES = 6;
const TYPE_LABELS: Record<QuestionType, string> = {
  text: "Short answer",
  long_text: "Paragraph",
  choice: "Pick one",
  phone: "Phone number",
};
const PLACEHOLDERS = ["{page}", "{name}", "{email}"];
let newQuestions = 0;

const workdays = (): Weekly[] =>
  [1, 2, 3, 4, 5].map((day) => ({ day, start: "09:00", end: "17:00" }));

const blank = (): Draft => ({
  slug: "",
  title: "",
  description: "",
  durations: [30],
  window_days: 14,
  min_notice_minutes: 240,
  buffer_before_minutes: 0,
  buffer_after_minutes: 0,
  slot_interval_minutes: 15,
  max_per_day: null,
  max_per_week: null,
  location: "",
  meeting_url: "",
  active: true,
  co_hosts: [],
  color: DEFAULT_COLOR,
  hours_mode: "working_hours",
  timezone: deviceTimeZone(),
  weekly: workdays(),
  date_overrides: [],
  questions: [],
  assignment: "collective",
  routing: [],
  requires_approval: false,
  allow_reschedule: true,
  event_title: "{page} with {name}",
  confirmation_message: "",
  team_id: null,
  remind_before_minutes: [...DEFAULT_BOOKER_REMINDERS],
});
const draftFrom = (p: BookingPage): Draft => ({
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
  hours_mode: p.availability.mode,
  timezone:
    p.availability.mode === "custom"
      ? p.availability.timezone
      : deviceTimeZone(),
  weekly: p.availability.mode === "custom" ? p.availability.weekly : workdays(),
  date_overrides: p.date_overrides,
  questions: p.questions.map((q) => ({ ...q, key: q.id, fixed: true })),
  assignment: p.assignment ?? "collective",
  routing: p.routing ?? [],
  requires_approval: p.requires_approval,
  allow_reschedule: p.allow_reschedule,
  event_title: p.event_title,
  confirmation_message: p.confirmation_message,
  team_id: p.team_id ?? null,
  remind_before_minutes: p.remind_before_minutes ?? [
    ...DEFAULT_BOOKER_REMINDERS,
  ],
});
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

const clock = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
/** Another range after the last one, or a working day for the first. */
function nextRange(ranges: Range[]): Range {
  if (!ranges.length) return { start: "09:00", end: "17:00" };
  const last = ranges[ranges.length - 1].end || "17:00";
  const start = Math.min(clockMinutes(last) + 60, 22 * 60);
  return {
    start: clock(start),
    end: clock(Math.min(start + 60, 23 * 60 + 59)),
  };
}
const cleanOptions = (options: string[]) =>
  options.map((o) => o.trim()).filter(Boolean);
const whole = (n: number, min: number, max: number) =>
  Number.isInteger(n) && n >= min && n <= max;

/** The first thing to fix before saving, and the section it's in. */
function problem(d: Draft): [SectionId, string] | null {
  if (!d.durations.length) return ["rules", "Offer at least one length."];
  if (!whole(d.window_days, 1, 90))
    return ["rules", "Show between 1 and 90 days ahead."];
  if (!whole(d.min_notice_minutes, 0, 20160))
    return ["rules", "Minimum notice can be up to 20160 minutes (two weeks)."];
  if (
    !whole(d.buffer_before_minutes, 0, 120) ||
    !whole(d.buffer_after_minutes, 0, 120)
  )
    return ["rules", "Buffers can be 0 to 120 minutes."];
  if (d.max_per_day !== null && !whole(d.max_per_day, 1, 50))
    return ["rules", "Most bookings a day can be 1 to 50, or blank."];
  if (d.max_per_week !== null && !whole(d.max_per_week, 1, 200))
    return ["rules", "Most bookings a week can be 1 to 200, or blank."];
  if (d.hours_mode === "custom") {
    if (!d.weekly.length)
      return ["hours", "Add some hours, or use your working hours."];
    if (d.weekly.some((r) => !r.start || !r.end || r.end <= r.start))
      return ["hours", "Each range of hours has to end after it starts."];
  }
  const dates = d.date_overrides.map((o) => o.date);
  if (dates.some((x) => !x)) return ["dates", "Pick a date for each override."];
  if (new Set(dates).size !== dates.length)
    return ["dates", "Each date can only be listed once."];
  if (
    d.date_overrides.some((o) =>
      o.hours.some((r) => !r.start || !r.end || r.end <= r.start),
    )
  )
    return ["dates", "Each range of hours has to end after it starts."];
  for (const q of d.questions) {
    const label = q.label.trim();
    if (!label) return ["form", "Give every question a label."];
    if (q.type !== "choice") continue;
    const options = cleanOptions(q.options);
    if (options.length < 2)
      return ["form", `“${label}” needs at least two options.`];
    if (options.length > 12)
      return ["form", `“${label}” can have up to 12 options.`];
    if (options.some((o) => o.length > 100))
      return ["form", "Keep each option to 100 characters."];
    if (new Set(options).size !== options.length)
      return ["form", `“${label}” lists the same option twice.`];
  }
  if (!isHex(d.color)) return ["look", "Colours look like #376c51."];
  if (!d.event_title.trim()) return ["look", "Give the hosts' event a title."];
  return null;
}

function Section({
  id,
  title,
  hint,
  children,
}: {
  id: SectionId;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={"bp-sec-" + id}
      className="booking-section"
      aria-labelledby={"bp-sec-" + id + "-title"}
    >
      <header>
        <h3 id={"bp-sec-" + id + "-title"}>{title}</h3>
        {hint && <p>{hint}</p>}
      </header>
      {children}
    </section>
  );
}

/** From–until ranges for one day, with add and remove. */
function Ranges({
  label,
  ranges,
  onChange,
}: {
  label: string;
  ranges: Range[];
  onChange: (ranges: Range[]) => void;
}) {
  const edit = (i: number, patch: Partial<Range>) =>
    onChange(ranges.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  return (
    <div className="hours-ranges">
      {ranges.map((r, i) => (
        <span key={i} className="hours-range">
          <DateField
            type="time"
            required
            aria-label={`${label}, from`}
            value={r.start}
            onChange={(e) => edit(i, { start: e.target.value })}
          />
          <span aria-hidden="true">–</span>
          <DateField
            type="time"
            required
            aria-label={`${label}, until`}
            value={r.end}
            onChange={(e) => edit(i, { end: e.target.value })}
          />
          <button
            type="button"
            className="icon-button"
            aria-label={`Remove ${label} ${r.start}–${r.end}`}
            onClick={() => onChange(ranges.filter((_, n) => n !== i))}
          >
            <X size={14} />
          </button>
        </span>
      ))}
      {!ranges.length && <span className="hours-closed">Unavailable</span>}
      {ranges.length < MAX_RANGES && (
        <button
          type="button"
          className="link-button"
          onClick={() => onChange([...ranges, nextRange(ranges)])}
        >
          <Plus size={12} /> Add hours
        </button>
      )}
    </div>
  );
}

/** Creating or editing a booking page, in sections. */
/** The HTML that shows a booking page inside another website. */
const embedSnippet = (slug: string) =>
  `<iframe src="${bookingLink(slug)}?embed=1" title="Book a time" width="100%" height="760" style="border:0"></iframe>`;

export function PageForm({
  page,
  user,
  teams,
  report,
  onClose,
  onSaved,
}: {
  page: BookingPage | null;
  user: User | null;
  teams: Team[];
  report: (e: unknown) => void;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(() =>
    page ? draftFrom(page) : blank(),
  );
  const [slugTouched, setSlugTouched] = useState(!!page);
  const [people, setPeople] = useState<TeamMember[]>([]);
  const [embedCopied, setEmbedCopied] = useState(false);
  const [peopleLoaded, setPeopleLoaded] = useState(false);
  const action = useAction(report);

  // Co-hosts come from the people in your teams.
  useEffect(() => {
    let alive = true;
    Promise.all(teams.map((t) => client.getTeam(t.id))).then(
      (details) => {
        if (!alive) return;
        const seen = new Map<string, TeamMember>();
        for (const d of details)
          for (const m of d.members)
            if (m.user_id !== user?.id && !seen.has(m.user_id))
              seen.set(m.user_id, m);
        setPeople(
          [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)),
        );
        setPeopleLoaded(true);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [teams, user?.id]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const lengths = [...new Set([...LENGTHS, ...draft.durations])].sort(
    (a, b) => a - b,
  );
  const zones = timeZones();
  // Co-hosts are sent only when the list changed: a co-host who has since
  // left your teams would otherwise make every save fail.
  const byUser = (a: { user_id: string }, b: { user_id: string }) =>
    a.user_id.localeCompare(b.user_id);
  const savedCoHosts = page ? draftFrom(page).co_hosts : [];
  const coHostsChanged =
    !page ||
    JSON.stringify([...draft.co_hosts].sort(byUser)) !==
      JSON.stringify([...savedCoHosts].sort(byUser));
  const goneCoHosts = peopleLoaded
    ? draft.co_hosts.filter((h) => !people.some((m) => m.user_id === h.user_id))
    : [];
  const hostName = (id: string) =>
    page?.hosts.find((h) => h.user_id === id)?.name ?? "A co-host";
  // A page can belong to a team whose owners and admins manage it.
  const ownerTeams = teams.filter(
    (t) => t.role === "owner" || t.role === "admin" || t.id === draft.team_id,
  );
  const jump = (id: SectionId) =>
    document
      .getElementById("bp-sec-" + id)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });

  const setDay = (day: number, ranges: Range[]) =>
    set("weekly", [
      ...draft.weekly.filter((w) => w.day !== day),
      ...ranges.map((r) => ({ day, ...r })),
    ]);
  const copyToAll = (ranges: Range[]) =>
    set(
      "weekly",
      WEEK.flatMap((day) => ranges.map((r) => ({ day, ...r }))),
    );

  const setOverride = (i: number, next: DateOverride) =>
    set(
      "date_overrides",
      draft.date_overrides.map((o, n) => (n === i ? next : o)),
    );
  const addOverride = () => {
    const used = new Set(draft.date_overrides.map((o) => o.date));
    let day = addDays(localDateKey(new Date(), deviceTimeZone()), 1);
    while (used.has(day)) day = addDays(day, 1);
    set("date_overrides", [...draft.date_overrides, { date: day, hours: [] }]);
  };

  const setQuestion = (key: string, patch: Partial<QuestionDraft>) =>
    set(
      "questions",
      draft.questions.map((q) => (q.key === key ? { ...q, ...patch } : q)),
    );
  const moveQuestion = (i: number, by: -1 | 1) => {
    const next = [...draft.questions];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    set("questions", next);
  };
  const addQuestion = () =>
    set("questions", [
      ...draft.questions,
      {
        key: `new-${++newQuestions}`,
        id: "",
        fixed: false,
        label: "",
        type: "text",
        required: false,
        options: [],
      },
    ]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (coHostsChanged && goneCoHosts.length) {
      action.setOutcome({
        ok: false,
        text: "Remove the co-hosts who are no longer in your teams to save changes to co-hosts.",
      });
      jump("details");
      return;
    }
    const issue = problem(draft);
    if (issue) {
      action.setOutcome({ ok: false, text: issue[1] });
      jump(issue[0]);
      return;
    }
    const taken = new Set(
      draft.questions.filter((q) => q.fixed).map((q) => q.id),
    );
    const questions = draft.questions.map((q) => {
      const id = q.fixed ? q.id : questionId(q.label, taken);
      taken.add(id);
      return {
        id,
        label: q.label.trim(),
        type: q.type,
        required: q.required,
        options: q.type === "choice" ? cleanOptions(q.options) : [],
      };
    });
    const byStart = (a: Range, b: Range) => a.start.localeCompare(b.start);
    const body: BookingPageInput = {
      slug: draft.slug.trim().toLowerCase(),
      title: draft.title.trim(),
      description: draft.description.trim(),
      durations: draft.durations,
      window_days: draft.window_days,
      min_notice_minutes: draft.min_notice_minutes,
      buffer_before_minutes: draft.buffer_before_minutes,
      buffer_after_minutes: draft.buffer_after_minutes,
      slot_interval_minutes: draft.slot_interval_minutes,
      max_per_day: draft.max_per_day,
      max_per_week: draft.max_per_week,
      location: draft.location.trim(),
      meeting_url: draft.meeting_url.trim(),
      active: draft.active,
      ...(coHostsChanged ? { co_hosts: draft.co_hosts } : {}),
      color: draft.color.toLowerCase(),
      availability:
        draft.hours_mode === "custom"
          ? {
              mode: "custom",
              timezone: draft.timezone,
              weekly: [...draft.weekly].sort(
                (a, b) => a.day - b.day || byStart(a, b),
              ),
            }
          : { mode: "working_hours" },
      date_overrides: [...draft.date_overrides]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((o) => ({ date: o.date, hours: [...o.hours].sort(byStart) })),
      questions,
      assignment: draft.assignment,
      routing: draft.routing.filter(
        (r) => r.question_id && r.equals && r.host_user_id,
      ),
      requires_approval: draft.requires_approval,
      allow_reschedule: draft.allow_reschedule,
      event_title: draft.event_title.trim(),
      confirmation_message: draft.confirmation_message.trim(),
      team_id: draft.team_id,
      remind_before_minutes: draft.remind_before_minutes,
    };
    void action
      .run(async () => {
        if (page) await client.updateBookingPage(page.id, body);
        else await client.createBookingPage(body);
      })
      .then((ok) => ok && void onSaved());
  };

  const numberOrNull = (value: string) => (value ? Number(value) : null);
  const lightColour =
    isHex(draft.color) &&
    readableAccent(draft.color) !== draft.color.toLowerCase();

  return (
    <section
      className="card booking-form-card"
      aria-labelledby="booking-form-title"
    >
      <div className="section-heading">
        <h2 id="booking-form-title">
          {page ? "Edit booking page" : "New booking page"}
        </h2>
        <button
          className="icon-button"
          aria-label="Close form"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <form className="settings-form booking-form" onSubmit={submit}>
        <nav className="booking-jump" aria-label="Form sections">
          {SECTIONS.map(([id, label]) => (
            <button key={id} type="button" onClick={() => jump(id)}>
              {label}
            </button>
          ))}
        </nav>

        <Section id="details" title="Details">
          {ownerTeams.length > 0 && (
            <div className="settings-field">
              <label htmlFor="bp-owner">Owner</label>
              <Select
                id="bp-owner"
                value={draft.team_id ?? ""}
                aria-describedby="bp-owner-hint"
                onChange={(e) => set("team_id", e.target.value || null)}
              >
                <option value="">Me</option>
                {ownerTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
              <small id="bp-owner-hint" className="field-hint">
                A team&apos;s owners and admins can change its pages; every
                member sees them.
              </small>
            </div>
          )}
          <div className="settings-grid">
            <div className="settings-field wide">
              <label htmlFor="bp-title">Title</label>
              <input
                id="bp-title"
                required
                autoFocus
                maxLength={120}
                value={draft.title}
                placeholder="Coffee chat"
                onChange={(e) => {
                  set("title", e.target.value);
                  if (!slugTouched) set("slug", slugify(e.target.value));
                }}
              />
            </div>
            <div className="settings-field wide">
              <label htmlFor="bp-slug">Link</label>
              <div className="field-row slug-row">
                <span className="slug-prefix" aria-hidden="true">
                  {bookingLink("")}
                </span>
                <input
                  id="bp-slug"
                  required
                  minLength={3}
                  maxLength={60}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  title="Lowercase letters, numbers and single dashes"
                  value={draft.slug}
                  aria-describedby="bp-slug-hint"
                  onChange={(e) => {
                    setSlugTouched(true);
                    set("slug", e.target.value.toLowerCase());
                  }}
                />
              </div>
              <small id="bp-slug-hint" className="field-hint">
                Lowercase letters, numbers and single dashes.
              </small>
            </div>
            <div className="settings-field wide">
              <label htmlFor="bp-desc">Description</label>
              <textarea
                id="bp-desc"
                rows={3}
                maxLength={2000}
                value={draft.description}
                placeholder="What the time is for, and anything to bring."
                onChange={(e) => set("description", e.target.value)}
              />
            </div>
            <div className="settings-field">
              <label htmlFor="bp-location">Location</label>
              <input
                id="bp-location"
                maxLength={300}
                value={draft.location}
                placeholder="Office, a café, a phone call…"
                onChange={(e) => set("location", e.target.value)}
              />
            </div>
            <div className="settings-field">
              <label htmlFor="bp-meeting">Meeting link</label>
              <input
                id="bp-meeting"
                type="url"
                maxLength={500}
                pattern="https?://\S+"
                title="Meeting links start with https://"
                value={draft.meeting_url}
                placeholder="https://"
                onChange={(e) => set("meeting_url", e.target.value)}
              />
            </div>
            <label className="switch-line settings-field wide">
              <input
                type="checkbox"
                role="switch"
                className="ai-switch"
                checked={draft.active}
                onChange={(e) => set("active", e.target.checked)}
              />
              <span>
                Taking bookings
                <small>Switch off to hide the page without deleting it.</small>
              </span>
            </label>
            <fieldset className="settings-field wide check-group">
              <legend>Co-hosts</legend>
              {goneCoHosts.length > 0 && (
                <ul className="cohost-list">
                  {goneCoHosts.map((h) => (
                    <li key={h.user_id}>
                      <span className="check-line">
                        {hostName(h.user_id)}
                        <small>
                          No longer in your teams — remove to save changes to
                          co-hosts.
                        </small>
                      </span>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() =>
                          set(
                            "co_hosts",
                            draft.co_hosts.filter(
                              (x) => x.user_id !== h.user_id,
                            ),
                          )
                        }
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {!people.length ? (
                <small className="field-hint">
                  People in your teams can host with you. Join or make a team to
                  add co-hosts.
                </small>
              ) : (
                <ul className="cohost-list">
                  {people.map((m) => {
                    const host = draft.co_hosts.find(
                      (h) => h.user_id === m.user_id,
                    );
                    return (
                      <li key={m.user_id}>
                        <label className="check-line">
                          <input
                            type="checkbox"
                            checked={!!host}
                            disabled={!host && draft.co_hosts.length >= 10}
                            onChange={() =>
                              set(
                                "co_hosts",
                                host
                                  ? draft.co_hosts.filter(
                                      (h) => h.user_id !== m.user_id,
                                    )
                                  : [
                                      ...draft.co_hosts,
                                      { user_id: m.user_id, required: true },
                                    ],
                              )
                            }
                          />
                          {m.name}
                          <small>{m.email}</small>
                        </label>
                        {host && (
                          <label className="switch-line compact">
                            <input
                              type="checkbox"
                              role="switch"
                              className="ai-switch"
                              checked={host.required}
                              onChange={(e) =>
                                set(
                                  "co_hosts",
                                  draft.co_hosts.map((h) =>
                                    h.user_id === m.user_id
                                      ? { ...h, required: e.target.checked }
                                      : h,
                                  ),
                                )
                              }
                            />
                            <span>
                              {host.required ? "Must be free" : "Optional"}
                            </span>
                          </label>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </fieldset>
            {draft.co_hosts.length > 0 && (
              <fieldset className="settings-field wide">
                <legend>How bookings are shared</legend>
                <label className="radio-line">
                  <input
                    type="radio"
                    name="assignment"
                    checked={draft.assignment === "collective"}
                    onChange={() => set("assignment", "collective")}
                  />
                  <span>
                    Everyone together
                    <small>
                      A time is offered only when every required host is free,
                      and it goes on all their calendars.
                    </small>
                  </span>
                </label>
                <label className="radio-line">
                  <input
                    type="radio"
                    name="assignment"
                    checked={draft.assignment === "round_robin"}
                    onChange={() => set("assignment", "round_robin")}
                  />
                  <span>
                    Round-robin
                    <small>
                      A time is offered when any host is free, and each booking
                      goes to the host with the fewest so far.
                    </small>
                  </span>
                </label>
                {draft.assignment === "round_robin" &&
                  draft.questions.length > 0 && (
                    <div className="routing-rules">
                      <span className="settings-label">
                        Send answers to a host
                      </span>
                      {draft.routing.map((rule, n) => (
                        <div className="routing-rule" key={n}>
                          <Select
                            aria-label="Question"
                            value={rule.question_id}
                            onChange={(e) =>
                              set(
                                "routing",
                                draft.routing.map((r, i) =>
                                  i === n
                                    ? { ...r, question_id: e.target.value }
                                    : r,
                                ),
                              )
                            }
                          >
                            <option value="">Question…</option>
                            {draft.questions.map((q) => (
                              <option key={q.id} value={q.id}>
                                {q.label}
                              </option>
                            ))}
                          </Select>
                          <span aria-hidden="true">=</span>
                          <input
                            aria-label="Answer"
                            placeholder="answer"
                            value={rule.equals}
                            onChange={(e) =>
                              set(
                                "routing",
                                draft.routing.map((r, i) =>
                                  i === n
                                    ? { ...r, equals: e.target.value }
                                    : r,
                                ),
                              )
                            }
                          />
                          <span aria-hidden="true">→</span>
                          <Select
                            aria-label="Host"
                            value={rule.host_user_id}
                            onChange={(e) =>
                              set(
                                "routing",
                                draft.routing.map((r, i) =>
                                  i === n
                                    ? { ...r, host_user_id: e.target.value }
                                    : r,
                                ),
                              )
                            }
                          >
                            <option value="">Host…</option>
                            {draft.co_hosts.map((h) => (
                              <option key={h.user_id} value={h.user_id}>
                                {hostName(h.user_id)}
                              </option>
                            ))}
                          </Select>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Remove rule"
                            onClick={() =>
                              set(
                                "routing",
                                draft.routing.filter((_, i) => i !== n),
                              )
                            }
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                      {draft.routing.length < 20 && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() =>
                            set("routing", [
                              ...draft.routing,
                              { question_id: "", equals: "", host_user_id: "" },
                            ])
                          }
                        >
                          <Plus size={13} /> Add a rule
                        </button>
                      )}
                    </div>
                  )}
              </fieldset>
            )}
          </div>
        </Section>

        <Section
          id="rules"
          title="Scheduling"
          hint="How long bookings are, how often times start, and how much room to leave around them."
        >
          <div className="settings-grid">
            <fieldset className="settings-field wide check-group">
              <legend>Lengths people can pick (up to 4)</legend>
              <div className="day-toggles">
                {lengths.map((m) => {
                  const on = draft.durations.includes(m);
                  return (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={on}
                      className={on ? "active" : ""}
                      disabled={!on && draft.durations.length >= 4}
                      onClick={() =>
                        set(
                          "durations",
                          on
                            ? draft.durations.filter((x) => x !== m)
                            : [...draft.durations, m].sort((a, b) => a - b),
                        )
                      }
                    >
                      {minutesLabel(m)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <div className="settings-field">
              <label htmlFor="bp-interval">Start times every</label>
              <Select
                id="bp-interval"
                value={draft.slot_interval_minutes}
                onChange={(e) =>
                  set("slot_interval_minutes", Number(e.target.value))
                }
              >
                {SLOT_INTERVALS.map((m) => (
                  <option key={m} value={m}>
                    {minutesLabel(m)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="settings-field">
              <label htmlFor="bp-window">Days ahead to show</label>
              <input
                id="bp-window"
                type="number"
                min={1}
                max={90}
                required
                value={draft.window_days}
                onChange={(e) => set("window_days", Number(e.target.value))}
              />
            </div>
            <div className="settings-field">
              <label htmlFor="bp-notice">Minimum notice (minutes)</label>
              <input
                id="bp-notice"
                type="number"
                min={0}
                max={20160}
                required
                value={draft.min_notice_minutes}
                aria-describedby="bp-notice-hint"
                onChange={(e) =>
                  set("min_notice_minutes", Number(e.target.value))
                }
              />
              <small id="bp-notice-hint" className="field-hint">
                {minutesLabel(draft.min_notice_minutes)} before a booking can
                start.
              </small>
            </div>
            <div className="settings-field">
              <label htmlFor="bp-buffer-before">Buffer before (min)</label>
              <input
                id="bp-buffer-before"
                type="number"
                min={0}
                max={120}
                required
                value={draft.buffer_before_minutes}
                onChange={(e) =>
                  set("buffer_before_minutes", Number(e.target.value))
                }
              />
            </div>
            <div className="settings-field">
              <label htmlFor="bp-buffer-after">Buffer after (min)</label>
              <input
                id="bp-buffer-after"
                type="number"
                min={0}
                max={120}
                required
                value={draft.buffer_after_minutes}
                aria-describedby="bp-buffer-hint"
                onChange={(e) =>
                  set("buffer_after_minutes", Number(e.target.value))
                }
              />
              <small id="bp-buffer-hint" className="field-hint">
                Free time kept around each booking.
              </small>
            </div>
            <div className="settings-field">
              <label htmlFor="bp-max">Most bookings a day</label>
              <input
                id="bp-max"
                type="number"
                min={1}
                max={50}
                placeholder="No limit"
                value={draft.max_per_day ?? ""}
                onChange={(e) =>
                  set("max_per_day", numberOrNull(e.target.value))
                }
              />
            </div>
            <div className="settings-field">
              <label htmlFor="bp-max-week">Most bookings a week</label>
              <input
                id="bp-max-week"
                type="number"
                min={1}
                max={200}
                placeholder="No limit"
                value={draft.max_per_week ?? ""}
                onChange={(e) =>
                  set("max_per_week", numberOrNull(e.target.value))
                }
              />
            </div>
          </div>
        </Section>

        <Section
          id="hours"
          title="Availability"
          hint="When people can book. Busy time on every host's calendar is always left out."
        >
          <div
            className="segmented hours-mode"
            role="radiogroup"
            aria-label="Hours"
          >
            <button
              type="button"
              role="radio"
              aria-checked={draft.hours_mode === "working_hours"}
              className={draft.hours_mode === "working_hours" ? "active" : ""}
              onClick={() => set("hours_mode", "working_hours")}
            >
              Use my working hours
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={draft.hours_mode === "custom"}
              className={draft.hours_mode === "custom" ? "active" : ""}
              onClick={() => set("hours_mode", "custom")}
            >
              Custom hours
            </button>
          </div>
          {draft.hours_mode === "working_hours" ? (
            <p className="booking-section-note">
              Times follow each host's working days and hours from Settings →
              Planning.
            </p>
          ) : (
            <>
              <div className="settings-grid">
                <div className="settings-field">
                  <label htmlFor="bp-zone">Time zone</label>
                  <Select
                    id="bp-zone"
                    value={draft.timezone}
                    onChange={(e) => set("timezone", e.target.value)}
                  >
                    {!zones.includes(draft.timezone) && (
                      <option value={draft.timezone}>{draft.timezone}</option>
                    )}
                    {zones.map((z) => (
                      <option key={z} value={z}>
                        {z.replaceAll("_", " ")}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="hours-week">
                {WEEK.map((day) => {
                  const ranges = draft.weekly
                    .filter((w) => w.day === day)
                    .map(({ start, end }) => ({ start, end }));
                  return (
                    <div key={day} className="hours-day">
                      <strong>{DAYS[day]}</strong>
                      <Ranges
                        label={DAYS[day]}
                        ranges={ranges}
                        onChange={(next) => setDay(day, next)}
                      />
                      {ranges.length > 0 ? (
                        <button
                          type="button"
                          className="link-button"
                          title={`Use ${DAYS[day]}'s hours on every day`}
                          onClick={() => copyToAll(ranges)}
                        >
                          <Copy size={12} /> Copy to all days
                        </button>
                      ) : (
                        <span />
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Section>

        <Section
          id="dates"
          title="Date overrides"
          hint="Different hours for particular dates, like a holiday or a late start."
        >
          {draft.date_overrides.length > 0 && (
            <div className="override-list">
              {draft.date_overrides.map((o, i) => (
                <div key={i} className="override-row">
                  <DateField
                    type="date"
                    required
                    aria-label="Date"
                    value={o.date}
                    onChange={(e) =>
                      setOverride(i, { ...o, date: e.target.value })
                    }
                  />
                  <Select
                    aria-label={`Hours on ${o.date || "this date"}`}
                    value={o.hours.length ? "custom" : "closed"}
                    onChange={(e) =>
                      setOverride(i, {
                        ...o,
                        hours:
                          e.target.value === "closed"
                            ? []
                            : [{ start: "09:00", end: "17:00" }],
                      })
                    }
                  >
                    <option value="closed">Unavailable</option>
                    <option value="custom">Custom hours</option>
                  </Select>
                  {o.hours.length > 0 && (
                    <Ranges
                      label={o.date || "This date"}
                      ranges={o.hours}
                      onChange={(hours) => setOverride(i, { ...o, hours })}
                    />
                  )}
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${o.date || "this date"}`}
                    onClick={() =>
                      set(
                        "date_overrides",
                        draft.date_overrides.filter((_, n) => n !== i),
                      )
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            className="secondary"
            disabled={draft.date_overrides.length >= 100}
            onClick={addOverride}
          >
            <CalendarPlus size={14} /> Add a date
          </button>
        </Section>

        <Section
          id="form"
          title="Booking form"
          hint="Everyone gives their name and email, and can add a note. Ask up to 10 more questions."
        >
          {draft.questions.length > 0 && (
            <ol className="question-list">
              {draft.questions.map((q, i) => (
                <li key={q.key} className="question-card">
                  <div className="settings-grid">
                    <div className="settings-field wide">
                      <label htmlFor={`bq-${q.key}-label`}>
                        Question {i + 1}
                      </label>
                      <input
                        id={`bq-${q.key}-label`}
                        required
                        maxLength={200}
                        value={q.label}
                        placeholder="What would you like to talk about?"
                        onChange={(e) =>
                          setQuestion(q.key, { label: e.target.value })
                        }
                      />
                    </div>
                    <div className="settings-field">
                      <label htmlFor={`bq-${q.key}-type`}>Answer</label>
                      <Select
                        id={`bq-${q.key}-type`}
                        value={q.type}
                        onChange={(e) =>
                          setQuestion(q.key, {
                            type: e.target.value as QuestionType,
                          })
                        }
                      >
                        {QUESTION_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {TYPE_LABELS[t]}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <label className="switch-line compact settings-field question-required">
                      <input
                        type="checkbox"
                        role="switch"
                        className="ai-switch"
                        checked={q.required}
                        onChange={(e) =>
                          setQuestion(q.key, { required: e.target.checked })
                        }
                      />
                      <span>Required</span>
                    </label>
                    {q.type === "choice" && (
                      <div className="settings-field wide">
                        <label htmlFor={`bq-${q.key}-options`}>
                          Options, one per line
                        </label>
                        <textarea
                          id={`bq-${q.key}-options`}
                          rows={3}
                          value={q.options.join("\n")}
                          placeholder={"Intro call\nFollow-up"}
                          onChange={(e) =>
                            setQuestion(q.key, {
                              options: e.target.value.split("\n"),
                            })
                          }
                        />
                      </div>
                    )}
                  </div>
                  <div className="question-tools">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Move question ${i + 1} up`}
                      disabled={i === 0}
                      onClick={() => moveQuestion(i, -1)}
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Move question ${i + 1} down`}
                      disabled={i === draft.questions.length - 1}
                      onClick={() => moveQuestion(i, 1)}
                    >
                      <ArrowDown size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove question ${i + 1}`}
                      onClick={() =>
                        set(
                          "questions",
                          draft.questions.filter((x) => x.key !== q.key),
                        )
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <button
            type="button"
            className="secondary"
            disabled={draft.questions.length >= 10}
            onClick={addQuestion}
          >
            <Plus size={14} /> Add a question
          </button>
        </Section>

        <Section id="approval" title="Approval & changes">
          <div className="booking-switches">
            <label className="switch-line">
              <input
                type="checkbox"
                role="switch"
                className="ai-switch"
                checked={draft.requires_approval}
                onChange={(e) => set("requires_approval", e.target.checked)}
              />
              <span>
                Require my approval
                <small>
                  New requests wait for you or a co-host to approve them. The
                  time stays held until then.
                </small>
              </span>
            </label>
            <label className="switch-line">
              <input
                type="checkbox"
                role="switch"
                className="ai-switch"
                checked={draft.allow_reschedule}
                onChange={(e) => set("allow_reschedule", e.target.checked)}
              />
              <span>
                Let bookers reschedule
                <small>
                  People can move their booking from the link in their email.
                  They can always cancel.
                </small>
              </span>
            </label>
          </div>
          <RemindersField
            value={draft.remind_before_minutes}
            onChange={(v) => set("remind_before_minutes", v)}
          />
        </Section>

        <Section id="look" title="Look & messages">
          <div className="settings-grid">
            <div className="settings-field wide">
              <span className="settings-label">Accent colour</span>
              <div className="color-row">
                <Swatches
                  value={draft.color}
                  onChange={(c) => set("color", c)}
                  label="Accent colour"
                />
                <input
                  type="color"
                  aria-label="Pick any colour"
                  value={
                    isHex(draft.color)
                      ? draft.color.toLowerCase()
                      : DEFAULT_COLOR
                  }
                  onChange={(e) => set("color", e.target.value)}
                />
                <input
                  className="hex-input"
                  aria-label="Colour code"
                  maxLength={7}
                  pattern="#[0-9a-fA-F]{6}"
                  title="Colours look like #376c51"
                  value={draft.color}
                  onChange={(e) => set("color", e.target.value.trim())}
                />
                <span
                  className="accent-preview booking-accent"
                  style={accentStyle(draft.color)}
                  aria-hidden="true"
                >
                  <span className="primary">Book this time</span>
                </span>
              </div>
              <small className="field-hint">
                {lightColour
                  ? "This colour is light, so buttons use a deeper shade to keep text readable."
                  : "Used for buttons and highlights on the public page."}
              </small>
            </div>
            <div className="settings-field wide">
              <label htmlFor="bp-event-title">Event title for hosts</label>
              <input
                id="bp-event-title"
                required
                maxLength={200}
                value={draft.event_title}
                aria-describedby="bp-event-title-hint"
                onChange={(e) => set("event_title", e.target.value)}
              />
              <div className="placeholder-chips">
                {PLACEHOLDERS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="chip"
                    aria-label={`Add ${p}`}
                    disabled={draft.event_title.length + p.length >= 200}
                    onClick={() =>
                      set("event_title", `${draft.event_title} ${p}`.trim())
                    }
                  >
                    {p}
                  </button>
                ))}
              </div>
              <small id="bp-event-title-hint" className="field-hint">
                {"{page}"} is this page's title; {"{name}"} and {"{email}"} are
                the booker's. Preview:{" "}
                <strong className="title-preview">
                  {fillTitle(
                    draft.event_title,
                    draft.title.trim() || "Coffee chat",
                    "Sam Lee",
                    "sam@example.com",
                  ) || "—"}
                </strong>
              </small>
            </div>
            <div className="settings-field wide">
              <label htmlFor="bp-confirm-message">Confirmation message</label>
              <textarea
                id="bp-confirm-message"
                rows={3}
                maxLength={1000}
                value={draft.confirmation_message}
                placeholder="Anything people should know once they're booked."
                aria-describedby="bp-confirm-hint"
                onChange={(e) => set("confirmation_message", e.target.value)}
              />
              <small id="bp-confirm-hint" className="field-hint">
                Shown after booking and in the confirmation email.{" "}
                {draft.confirmation_message.length}/1000
              </small>
            </div>
            {page && (
              <div className="settings-field wide">
                <span className="settings-label">Embed on a website</span>
                <div className="secret-row">
                  <code className="embed-code">{embedSnippet(page.slug)}</code>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      void copyText(embedSnippet(page.slug)).then(
                        setEmbedCopied,
                      )
                    }
                  >
                    <Copy size={13} /> {embedCopied ? "Copied" : "Copy"}
                  </button>
                </div>
                <small className="field-hint">
                  Paste it into your site&apos;s HTML. There the page shows
                  without Orbyn&apos;s header and footer.
                </small>
              </div>
            )}
          </div>
        </Section>

        <div className="settings-footer">
          <button className="primary" disabled={action.pending}>
            {action.pending ? "Saving…" : page ? "Save page" : "Create page"}
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <OutcomeNote outcome={action.outcome} />
        </div>
      </form>
    </section>
  );
}
