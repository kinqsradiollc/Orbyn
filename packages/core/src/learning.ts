import type {
  EstimateModel,
  LoadModel,
  PlannerLearning,
  RhythmModel,
  UpNextSuggestion,
} from "./types.js";

/**
 * How the planner learns from someone's own history. Pure functions: the
 * server loads the rows and passes them in, and the same rows always give the
 * same model.
 *
 * Durations. How long a task really takes against its estimate is skewed:
 * most run a little over, a few run far over, so the "blow-up" ratio is
 * modelled in log space (roughly log-normal), where one wild task can't drag
 * the average. Recent tasks count more (a 45-day half-life), and every
 * average is shrunk towards "no correction" by a couple of tasks' worth of
 * evidence, so three tasks move it a little and thirty move it a lot
 * (empirical-Bayes partial pooling). Tags and lists shrink towards the
 * overall figure the same way.
 *
 * Rhythm. Which hours someone's time usually goes well: planned blocks whose
 * time went into the task, and focus sessions, by hour of the day. Rates are
 * smoothed towards the person's own average (a Beta prior worth two hours) and
 * across neighbouring hours, and the result is scaled by how much evidence
 * there is, so a new account is neutral rather than guessing a chronotype.
 *
 * Load. How much planned time someone usually gets through in a day, from
 * the same kept blocks: the planner can spread work so no day asks for
 * much more than that.
 */

const DAY_MS = 86_400_000;
/** A task finished this long ago counts half as much as one finished today. */
export const LEARNING_HALF_LIFE_DAYS = 45;
/** Below this many finished tasks, a ratio isn't shown or used (stays 1). */
export const ESTIMATE_MIN_SAMPLES = 3;
/** The overall ratio starts as if two tasks had gone exactly to plan. */
const OVERALL_PRIOR = 2;
/** A tag's or list's ratio starts as if three tasks had matched the overall one. */
const GROUP_PRIOR = 3;
/** The usual spread of log ratios before any data (about ±50%). */
const PRIOR_SPREAD = 0.4;
/** A single task's ratio is capped at ¼…4× before it's averaged. */
const LOG_CAP = Math.log(4);
/** The ratio applied never swings a plan more than half…triple. */
const MIN_RATIO = 0.5;
const MAX_RATIO = 3;

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));
const weightOf = (finishedAt: number, now: number) =>
  Math.pow(
    0.5,
    Math.max(0, now - finishedAt) / DAY_MS / LEARNING_HALF_LIFE_DAYS,
  );

/** One finished task: what it was, what was estimated and what it took. */
export type DurationSample = {
  title: string;
  estimate_minutes: number | null;
  /** Time logged on it (focus sessions, counted blocks). */
  actual_minutes: number;
  finished_at: string;
  list_id: string | null;
  tag_ids: string[];
};

type Group = {
  id: string;
  name: string;
  /** Posterior mean log ratio. */
  mu: number;
  /** Effective (recency-weighted) number of tasks. */
  weight: number;
  samples: number;
};

/** Everything learned about durations, including what the API doesn't show. */
export type DurationLearning = {
  mu: number;
  spread: number;
  samples: number;
  weight: number;
  tags: Group[];
  lists: Group[];
  /** Finished tasks with time logged, for guessing tasks without an estimate. */
  history: {
    tokens: string[];
    log_minutes: number;
    weight: number;
    list_id: string | null;
    tag_ids: string[];
  }[];
  /** Posterior mean of log minutes over all finished tasks with time logged. */
  typical_log_minutes: number | null;
  typical_samples: number;
};

const STOPWORDS = new Set(
  "the and for with from into onto about this that these those your our their have has had was were are its it's then than will just some more most very make made do does doing done get got new old one two three all any via per out off over up down on in at to of a an by or as is be".split(
    " ",
  ),
);

const stem = (w: string) => {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss"))
    return w.slice(0, -1);
  return w;
};

/** A title's distinctive words, for finding similar tasks. */
export function titleTokens(title: string): string[] {
  return [
    ...new Set(
      title
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .split(/[^a-z]+/)
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
        // A light stem: "reports", "reporting" and "reported" meet as "report".
        .map(stem),
    ),
  ];
}

const jaccard = (a: string[], b: string[]) => {
  if (!a.length || !b.length) return 0;
  const set = new Set(a);
  const shared = b.filter((w) => set.has(w)).length;
  return shared / (a.length + b.length - shared);
};

/** Learn how long tasks take from finished ones. */
export function learnDurations(
  samples: DurationSample[],
  names: { tags: Map<string, string>; lists: Map<string, string> },
  now = new Date(),
): DurationLearning {
  const at = now.getTime();
  const rated = samples
    .filter((s) => s.estimate_minutes && s.estimate_minutes > 0)
    .filter((s) => s.actual_minutes > 0)
    .map((s) => ({
      ...s,
      r: clamp(
        Math.log(s.actual_minutes / s.estimate_minutes!),
        -LOG_CAP,
        LOG_CAP,
      ),
      w: weightOf(Date.parse(s.finished_at), at),
    }));
  const weight = rated.reduce((n, s) => n + s.w, 0);
  const mu =
    rated.reduce((n, s) => n + s.w * s.r, 0) / (weight + OVERALL_PRIOR);
  const spread = Math.sqrt(
    (rated.reduce((n, s) => n + s.w * (s.r - mu) ** 2, 0) +
      OVERALL_PRIOR * PRIOR_SPREAD ** 2) /
      (weight + OVERALL_PRIOR),
  );

  const grouped = (
    key: (s: (typeof rated)[number]) => string[],
    name: Map<string, string>,
  ): Group[] => {
    const by = new Map<string, { w: number; wr: number; n: number }>();
    for (const s of rated)
      for (const id of key(s)) {
        const g = by.get(id) ?? { w: 0, wr: 0, n: 0 };
        g.w += s.w;
        g.wr += s.w * s.r;
        g.n += 1;
        by.set(id, g);
      }
    return [...by]
      .filter(([, g]) => g.n >= ESTIMATE_MIN_SAMPLES)
      .map(([id, g]) => ({
        id,
        name: name.get(id) ?? "",
        mu: (g.wr + GROUP_PRIOR * mu) / (g.w + GROUP_PRIOR),
        weight: g.w,
        samples: g.n,
      }))
      .sort((a, b) => b.samples - a.samples || a.name.localeCompare(b.name));
  };

  const timed = samples.filter((s) => s.actual_minutes > 0);
  const history = timed.map((s) => ({
    tokens: titleTokens(s.title),
    log_minutes: Math.log(s.actual_minutes),
    weight: weightOf(Date.parse(s.finished_at), at),
    list_id: s.list_id,
    tag_ids: s.tag_ids,
  }));
  const hw = history.reduce((n, h) => n + h.weight, 0);
  const typical =
    history.length >= 5
      ? (history.reduce((n, h) => n + h.weight * h.log_minutes, 0) +
          GROUP_PRIOR * Math.log(30)) /
        (hw + GROUP_PRIOR)
      : null;

  return {
    mu,
    spread,
    samples: rated.length,
    weight,
    tags: grouped((s) => s.tag_ids, names.tags),
    lists: grouped((s) => (s.list_id ? [s.list_id] : []), names.lists),
    history,
    typical_log_minutes: typical,
    typical_samples: history.length,
  };
}

const ratioOf = (mu: number) =>
  round2(clamp(Math.exp(mu), MIN_RATIO, MAX_RATIO));

/** What the API shows of the duration model. */
export function estimateModelOf(
  d: DurationLearning,
  applied: boolean,
): EstimateModel {
  const trusted = d.samples >= ESTIMATE_MIN_SAMPLES;
  return {
    overall: {
      ratio: trusted ? ratioOf(d.mu) : 1,
      samples: d.samples,
      // The middle half of how tasks go: a quarter run shorter, a quarter longer.
      range: trusted
        ? [ratioOf(d.mu - 0.674 * d.spread), ratioOf(d.mu + 0.674 * d.spread)]
        : null,
    },
    tags: d.tags.map((g) => ({
      tag_id: g.id,
      name: g.name,
      ratio: ratioOf(g.mu),
      samples: g.samples,
    })),
    lists: d.lists.map((g) => ({
      list_id: g.id,
      name: g.name,
      ratio: ratioOf(g.mu),
      samples: g.samples,
    })),
    typical_minutes:
      d.typical_log_minutes == null
        ? null
        : roundMinutes(Math.exp(d.typical_log_minutes)),
    applied,
  };
}

/**
 * The factor to scale a task's estimate by: its tags' and list's learned
 * ratios, each weighted by how much evidence it has, else the overall one.
 * 1 while there isn't enough history.
 */
export function learnedRatio(
  task: { tag_ids: string[]; list_id: string | null },
  d: DurationLearning,
): number {
  if (d.samples < ESTIMATE_MIN_SAMPLES) return 1;
  const groups = [
    ...d.tags.filter((g) => task.tag_ids.includes(g.id)),
    ...d.lists.filter((g) => g.id === task.list_id),
  ];
  if (!groups.length) return ratioOf(d.mu);
  const total = groups.reduce((n, g) => n + g.weight + GROUP_PRIOR, 0);
  return ratioOf(
    groups.reduce((n, g) => n + (g.weight + GROUP_PRIOR) * g.mu, 0) / total,
  );
}

const roundMinutes = (m: number) => clamp(Math.round(m / 5) * 5, 10, 240);

export type GuessedEstimate = {
  minutes: number;
  /** What the guess came from. */
  basis: "similar" | "list" | "tag" | "typical";
  /** How many finished tasks it rests on. */
  from: number;
};

/**
 * How long a task with no estimate will probably take, from finished tasks:
 * ones with similar titles first (the reference class), then the same list
 * or tag, then this person's typical task. Null when there's too little
 * history, and the planner keeps its 30-minute default.
 */
export function guessEstimate(
  task: { title: string; tag_ids: string[]; list_id: string | null },
  d: DurationLearning,
): GuessedEstimate | null {
  const tokens = titleTokens(task.title);
  const near = d.history
    .map((h) => ({ h, sim: jaccard(tokens, h.tokens) }))
    .filter((x) => x.sim >= 0.5)
    .sort((a, b) => b.sim - a.sim || b.h.weight - a.h.weight)
    .slice(0, 5);
  const exact = near.some((x) => x.sim === 1);
  if (near.length >= 2 || exact) {
    const w = near.reduce((n, x) => n + x.sim * x.h.weight, 0);
    const log = near.reduce(
      (n, x) => n + x.sim * x.h.weight * x.h.log_minutes,
      0,
    );
    if (w > 0)
      return {
        minutes: roundMinutes(Math.exp(log / w)),
        basis: "similar",
        from: near.length,
      };
  }
  const base = d.typical_log_minutes ?? Math.log(30);
  const pooled = (
    rows: DurationLearning["history"],
    basis: "list" | "tag",
  ): GuessedEstimate | null => {
    if (rows.length < ESTIMATE_MIN_SAMPLES) return null;
    const w = rows.reduce((n, h) => n + h.weight, 0);
    const log =
      (rows.reduce((n, h) => n + h.weight * h.log_minutes, 0) +
        GROUP_PRIOR * base) /
      (w + GROUP_PRIOR);
    return { minutes: roundMinutes(Math.exp(log)), basis, from: rows.length };
  };
  const byList = task.list_id
    ? pooled(
        d.history.filter((h) => h.list_id === task.list_id),
        "list",
      )
    : null;
  if (byList) return byList;
  const byTag = task.tag_ids.length
    ? pooled(
        d.history.filter((h) =>
          h.tag_ids.some((t) => task.tag_ids.includes(t)),
        ),
        "tag",
      )
    : null;
  if (byTag) return byTag;
  if (d.typical_log_minutes != null)
    return {
      minutes: roundMinutes(Math.exp(d.typical_log_minutes)),
      basis: "typical",
      from: d.typical_samples,
    };
  return null;
}

// ---- Rhythm ----------------------------------------------------------------

/** Evidence of how an hour of someone's day went. */
export type RhythmSample = {
  /** Local hour of day, 0–23. */
  hour: number;
  /** Minutes of time meant for work in that hour (a block, a focus session). */
  planned: number;
  /** Of those, minutes that went into the work. */
  kept: number;
};

/** A Beta prior worth this many minutes pulls each hour towards the average. */
const RHYTHM_PRIOR_MINUTES = 120;
/** Evidence needed for full confidence: about twenty hours. */
const RHYTHM_FULL_MINUTES = 1200;
/** Below this, nothing is said at all. */
const RHYTHM_MIN_MINUTES = 240;

/**
 * Which hours of the day usually go well for someone. `hours[h]` runs from
 * -1 (time planned then usually slips) to 1 (time planned then usually goes
 * into the work, and where focus sessions cluster); `confidence` (0–1) says
 * how much to believe it.
 */
export function learnRhythm(samples: RhythmSample[]): RhythmModel {
  const planned = Array<number>(24).fill(0);
  const kept = Array<number>(24).fill(0);
  for (const s of samples) {
    if (s.hour < 0 || s.hour > 23) continue;
    planned[s.hour] += s.planned;
    kept[s.hour] += Math.min(s.planned, s.kept);
  }
  const total = planned.reduce((a, b) => a + b, 0);
  const neutral: RhythmModel = {
    hours: Array<number>(24).fill(0),
    confidence: 0,
    evidence_minutes: Math.round(total),
    peak: null,
  };
  if (total < RHYTHM_MIN_MINUTES) return neutral;
  const mean = kept.reduce((a, b) => a + b, 0) / total;
  // Success rate per hour, smoothed towards the person's own average.
  const rate = planned.map(
    (p, h) =>
      (kept[h] + RHYTHM_PRIOR_MINUTES * mean) / (p + RHYTHM_PRIOR_MINUTES),
  );
  // Where their working time actually happens, against an even spread over
  // the hours they use at all.
  const active = planned.filter((p) => p > 0).length;
  const density = planned.map((p) =>
    p > 0 ? clamp((p / total) * active - 1, -1, 1) : 0,
  );
  const raw = rate.map((r, h) => 0.65 * (r - mean) * 4 + 0.35 * density[h]);
  const smooth = raw.map(
    (v, h) => 0.5 * v + 0.25 * (raw[h - 1] ?? v) + 0.25 * (raw[h + 1] ?? v),
  );
  const scale = Math.max(0.25, ...smooth.map(Math.abs));
  const hours = smooth.map((v) => round2(clamp(v / scale, -1, 1)));
  const confidence = round2(clamp(total / RHYTHM_FULL_MINUTES, 0, 1));
  // The best two hours in a row, among hours with evidence.
  let peak: RhythmModel["peak"] = null;
  let best = 0.25;
  for (let h = 0; h < 23; h++) {
    if (!planned[h] || !planned[h + 1]) continue;
    const v = (hours[h] + hours[h + 1]) / 2;
    if (v > best) {
      best = v;
      peak = { start_hour: h, end_hour: h + 2 };
    }
  }
  return {
    hours,
    confidence,
    evidence_minutes: Math.round(total),
    peak: confidence >= 0.3 ? peak : null,
  };
}

/**
 * How demanding a task is, 0–1: important and long work wants someone's
 * best hours; small, low-priority work can take the rest.
 */
export function taskDemand(task: {
  priority: "low" | "medium" | "high";
  minutes: number;
}) {
  const base = { low: 0.25, medium: 0.6, high: 1 }[task.priority];
  return clamp(base + (task.minutes >= 60 ? 0.25 : 0), 0, 1);
}

/** Average rhythm fit over [start, end), weighted by minutes in each hour. */
export function rhythmFit(
  hours: number[],
  confidence: number,
  startHour: number,
  startMinute: number,
  minutes: number,
) {
  if (!confidence || minutes <= 0) return 0;
  let left = minutes;
  let h = startHour;
  let m = startMinute;
  let sum = 0;
  while (left > 0) {
    const take = Math.min(left, 60 - m);
    sum += (hours[h % 24] ?? 0) * take;
    left -= take;
    h += 1;
    m = 0;
  }
  return (sum / minutes) * confidence;
}

// ---- Load ------------------------------------------------------------------

/** Days of history needed before a typical day is claimed. */
export const LOAD_MIN_DAYS = 5;

/**
 * How much planned time someone usually gets through in a day, from past
 * days with at least an hour planned: the upper quartile of what was kept, so
 * a good day counts as normal and a bad one doesn't set the bar.
 */
export function learnLoad(
  days: { planned: number; kept: number }[],
): LoadModel {
  const counted = days.filter((d) => d.planned >= 60);
  const planned = counted.reduce((n, d) => n + d.planned, 0);
  const kept = counted.reduce((n, d) => n + Math.min(d.planned, d.kept), 0);
  if (counted.length < LOAD_MIN_DAYS)
    return {
      typical_day_minutes: null,
      follow_through: null,
      days: counted.length,
    };
  const sorted = counted
    .map((d) => Math.min(d.planned, d.kept))
    .sort((a, b) => a - b);
  const q =
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75))];
  return {
    // Never below two hours: a quiet stretch shouldn't shrink every plan.
    typical_day_minutes: Math.max(120, Math.round(q / 15) * 15),
    follow_through: round2(kept / planned),
    days: counted.length,
  };
}

// ---- Words -----------------------------------------------------------------

const hoursText = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
};

/** "10:00" for an hour of the day; 24 stays "24:00". */
export const hourText = (hour: number) =>
  `${String(hour === 24 ? 24 : hour % 24).padStart(2, "0")}:00`;

/** What the planner has learned, in a sentence each, for settings screens. */
export function learningSummary(l: PlannerLearning | null) {
  const e = l?.estimates;
  let estimates =
    "A few finished tasks with an estimate and logged time are needed first.";
  if (e && e.overall.samples >= ESTIMATE_MIN_SAMPLES) {
    const range = e.overall.range
      ? ` (usually ${e.overall.range[0]}–${e.overall.range[1]}×)`
      : "";
    const typical = e.typical_minutes
      ? ` Tasks without an estimate are planned from similar finished ones (about ${e.typical_minutes} min is typical for you).`
      : "";
    estimates = `You take about ${e.overall.ratio}× your estimate${range}, from ${e.overall.samples} finished tasks.${typical}`;
  }
  const r = l?.rhythm;
  const rhythm =
    !r || !r.confidence
      ? "Learns which hours go well from your sessions and focus time. Nothing to go on yet."
      : !r.peak
        ? `Learning from ${hoursText(r.evidence_minutes)} of planned and focus time; no clear best hours yet.`
        : `Your best hours are usually ${hourText(r.peak.start_hour)}–${hourText(r.peak.end_hour)}, from ${hoursText(r.evidence_minutes)} of planned and focus time.`;
  const d = l?.load;
  let load =
    "Learns how much of a planned day usually gets done. A few planned days are needed first.";
  if (d && d.typical_day_minutes != null) {
    const share =
      d.follow_through != null
        ? ` (${Math.round(d.follow_through * 100)}% of what you plan)`
        : "";
    load = `You usually get through about ${hoursText(d.typical_day_minutes)} of planned work a day${share}. Plans over several days spread work so no day asks for much more.`;
  }
  return { estimates, rhythm, load };
}

// ---- Up next ---------------------------------------------------------------

/** Words for why a task is suggested now, most important first. */
export function upNextSummary(s: UpNextSuggestion) {
  return s.reasons.slice(0, 2).join(" · ");
}
