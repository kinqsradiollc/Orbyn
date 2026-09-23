import { z } from "zod";
import type { BreakLevel } from "./types.js";

/**
 * Focus sessions: work for a set time, take the break it asks for, and after
 * a few rounds a longer one. The same rhythm on every device, so the web and
 * the phone agree on what comes next.
 *
 * Time is kept as instants ("this phase ends at 10:25"), never as a ticking
 * counter, so a phone that sleeps or a tab in the background still ends the
 * phase on time.
 */
export const FOCUS_PHASES = ["work", "short_break", "long_break"] as const;
export type FocusPhase = (typeof FOCUS_PHASES)[number];

/** A rhythm. `work` 0 is the open timer: it counts up and never breaks. */
export type FocusRhythm = {
  id: string;
  label: string;
  work: number;
  short_break: number;
  long_break: number;
  /** Work sessions before the long break. */
  rounds: number;
};

export const OPEN_TIMER: FocusRhythm = {
  id: "open",
  label: "Open timer",
  work: 0,
  short_break: 0,
  long_break: 0,
  rounds: 0,
};

export const FOCUS_RHYTHMS: FocusRhythm[] = [
  {
    id: "25-5",
    label: "25 / 5",
    work: 25,
    short_break: 5,
    long_break: 15,
    rounds: 4,
  },
  {
    id: "50-10",
    label: "50 / 10",
    work: 50,
    short_break: 10,
    long_break: 20,
    rounds: 3,
  },
  {
    id: "45-15",
    label: "45 / 15",
    work: 45,
    short_break: 15,
    long_break: 30,
    rounds: 3,
  },
  OPEN_TIMER,
];

/**
 * The rhythm someone gets before they choose one, from the breaks they asked
 * the planner for: no breaks keeps the open timer.
 */
export function rhythmForBreakLevel(level: BreakLevel | undefined) {
  const id =
    level === "none"
      ? "open"
      : level === "light"
        ? "25-5"
        : level === "intense"
          ? "45-15"
          : "50-10";
  return FOCUS_RHYTHMS.find((r) => r.id === id)!;
}

/** A rhythm from its id, or a custom one written "custom:30/5/15/4". */
export function focusRhythm(id: string | null | undefined): FocusRhythm | null {
  if (!id) return null;
  const known = FOCUS_RHYTHMS.find((r) => r.id === id);
  if (known) return known;
  const m = /^custom:(\d{1,3})\/(\d{1,2})\/(\d{1,2})\/(\d)$/.exec(id);
  if (!m) return null;
  const [work, short, long, rounds] = m.slice(1).map(Number);
  if (work < 5 || work > 180 || short < 1 || long < 1 || rounds < 1)
    return null;
  return {
    id,
    label: `${work} / ${short}`,
    work,
    short_break: short,
    long_break: long,
    rounds,
  };
}

export const customRhythmId = (
  work: number,
  shortBreak: number,
  longBreak: number,
  rounds: number,
) => `custom:${work}/${shortBreak}/${longBreak}/${rounds}`;

/**
 * Where a session is. Running, `ends_at` is when the phase ends; paused,
 * `remaining_ms` is what's left of it. `ran_ms` and `run_started_at` say how
 * long the phase has actually run, for logging one cut short.
 */
export type FocusState = {
  rhythm: string;
  phase: FocusPhase;
  /** 1-based: which work session this is, or the one a break follows. */
  round: number;
  ends_at: string | null;
  remaining_ms: number;
  /** When the current run of this phase started, while running. */
  run_started_at: string | null;
  /** Time this phase already ran before the current run. */
  ran_ms: number;
  /** The task being worked on. */
  item_id: string | null;
  item_title?: string;
};

export const phaseMinutes = (rhythm: FocusRhythm, phase: FocusPhase) =>
  phase === "work"
    ? rhythm.work
    : phase === "short_break"
      ? rhythm.short_break
      : rhythm.long_break;

/** The first work session of a rhythm, paused and ready to start. */
export function freshFocus(
  rhythm: FocusRhythm,
  itemId: string | null,
): FocusState {
  return {
    rhythm: rhythm.id,
    phase: "work",
    round: 1,
    ends_at: null,
    remaining_ms: rhythm.work * 60_000,
    run_started_at: null,
    ran_ms: 0,
    item_id: itemId,
  };
}

export const focusRunning = (s: FocusState) => s.ends_at !== null;

/** Milliseconds left in the phase at `now`. */
export function focusRemaining(s: FocusState, now: number) {
  return s.ends_at ? Math.max(0, Date.parse(s.ends_at) - now) : s.remaining_ms;
}

/** How long the phase has run in all, at `now`. */
export function focusRan(s: FocusState, now: number) {
  return s.ran_ms + (s.run_started_at ? now - Date.parse(s.run_started_at) : 0);
}

export function startFocus(s: FocusState, now: number): FocusState {
  if (s.ends_at) return s;
  return {
    ...s,
    ends_at: new Date(now + s.remaining_ms).toISOString(),
    run_started_at: new Date(now).toISOString(),
  };
}

export function pauseFocus(s: FocusState, now: number): FocusState {
  if (!s.ends_at) return s;
  return {
    ...s,
    ends_at: null,
    remaining_ms: focusRemaining(s, now),
    run_started_at: null,
    ran_ms: focusRan(s, now),
  };
}

/** The phase after this one: a break after work, work after a break. */
export function nextFocusPhase(
  rhythm: FocusRhythm,
  s: Pick<FocusState, "phase" | "round">,
) {
  if (s.phase === "work")
    return {
      phase: (s.round % rhythm.rounds === 0
        ? "long_break"
        : "short_break") as FocusPhase,
      round: s.round,
    };
  return { phase: "work" as FocusPhase, round: s.round + 1 };
}

/**
 * Move on to the next phase. A break starts on its own when work ends at
 * `now`; the next work session waits to be started, so no one comes back
 * from a break to find the clock already running.
 */
export function advanceFocus(
  rhythm: FocusRhythm,
  s: FocusState,
  now: number,
): FocusState {
  const next = nextFocusPhase(rhythm, s);
  const remaining = phaseMinutes(rhythm, next.phase) * 60_000;
  const autostart = next.phase !== "work";
  return {
    ...s,
    ...next,
    remaining_ms: remaining,
    ran_ms: 0,
    ends_at: autostart ? new Date(now + remaining).toISOString() : null,
    run_started_at: autostart ? new Date(now).toISOString() : null,
  };
}

/** "Session 2 of 4", "Short break", "Long break". */
export function focusPhaseLabel(rhythm: FocusRhythm, s: FocusState) {
  if (s.phase === "short_break") return "Short break";
  if (s.phase === "long_break") return "Long break";
  const within = ((s.round - 1) % rhythm.rounds) + 1;
  return `Session ${within} of ${rhythm.rounds}`;
}

/** What follows this phase, in words: "Then a 5-minute break". */
export function focusThen(rhythm: FocusRhythm, s: FocusState) {
  const next = nextFocusPhase(rhythm, s);
  if (next.phase === "work")
    return `Then session ${((next.round - 1) % rhythm.rounds) + 1}`;
  const minutes = phaseMinutes(rhythm, next.phase);
  return `Then a ${minutes}-minute ${next.phase === "long_break" ? "long break" : "break"}`;
}

/** What the server keeps of a finished (or cut short) phase. */
export type FocusSession = {
  id: string;
  item_id: string | null;
  item_title: string | null;
  kind: FocusPhase;
  started_at: string;
  ended_at: string;
  planned_minutes: number;
  /** Minutes actually worked (or rested). */
  minutes: number;
  completed: boolean;
};

/** Focus time over a range, for "where your time went". */
export type FocusSummary = {
  from: string;
  to: string;
  work_minutes: number;
  /** Work sessions that ran to the end. */
  completed: number;
  /** Work sessions cut short. */
  cut_short: number;
  breaks_taken: number;
  by_day: { day: string; minutes: number }[];
  by_item: { item_id: string; title: string; minutes: number }[];
  /** The newest sessions, newest first (up to 20). */
  recent: FocusSession[];
};

/** A session running somewhere, as other devices see it. */
export type FocusCurrent = {
  state: FocusState;
  device: string | null;
  /** The device it runs on, so that device doesn't show it as "elsewhere". */
  device_id: string | null;
  updated_at: string;
};

const instant = z.iso.datetime({ offset: true });

/** One phase to keep: `POST /focus/sessions`. */
export const focusSessionInput = z
  .object({
    /** Made on the device, so a retry after a dropped connection is one record. */
    id: z.uuid(),
    item_id: z.uuid().nullable().default(null),
    kind: z.enum(FOCUS_PHASES),
    started_at: instant,
    ended_at: instant,
    planned_minutes: z.number().int().min(0).max(600),
    /** Minutes actually spent; work minutes are logged to the task. */
    minutes: z.number().int().min(0).max(600),
    completed: z.boolean(),
  })
  .strict()
  .refine(
    (d) => Date.parse(d.ended_at) > Date.parse(d.started_at),
    "A session ends after it starts",
  );

const focusStateSchema = z
  .object({
    rhythm: z.string().max(40),
    phase: z.enum(FOCUS_PHASES),
    round: z.number().int().min(1).max(999),
    ends_at: instant.nullable(),
    remaining_ms: z.number().int().min(0).max(86_400_000),
    run_started_at: instant.nullable(),
    ran_ms: z.number().int().min(0).max(86_400_000),
    item_id: z.uuid().nullable(),
    item_title: z.string().max(200).optional(),
  })
  .strict();

/** What's running now: `PUT /focus/current`. */
export const focusCurrentInput = z
  .object({
    state: focusStateSchema,
    /** Where it runs, in words: "iPhone", "Web". */
    device: z.string().trim().max(60).optional(),
    /** The device's own id, so it can ignore the news of its own change. */
    device_id: z.string().trim().max(64).optional(),
  })
  .strict();

export const focusSummaryQuery = z
  .object({ from: instant, to: instant })
  .strict()
  .refine(
    (d) => Date.parse(d.to) > Date.parse(d.from),
    "The range ends after it starts",
  )
  .refine(
    (d) => Date.parse(d.to) - Date.parse(d.from) <= 93 * 86_400_000,
    "Up to three months at a time",
  );
