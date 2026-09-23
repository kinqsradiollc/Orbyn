import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuickAdd, type QuickAddOptions } from "@orbyn/core";

/**
 * Repeats in plain words, read by quick add without AI. A clock time or set
 * days make a repeating item; "how often" with no "when" makes a habit. A
 * fixed clock: Tuesday 15 September 2026, 10:30 in Melbourne.
 */
const options: QuickAddOptions = {
  timeZone: "Australia/Melbourne",
  now: new Date("2026-09-15T10:30:00+10:00"),
};
const parse = (text: string, extra: Partial<QuickAddOptions> = {}) =>
  parseQuickAdd(text, { ...options, ...extra });
const local = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString("sv-SE", {
        timeZone: "Australia/Melbourne",
      })
    : undefined;

test("a clock time with a repeat makes a repeating item on its next day", () => {
  const r = parse("Team standup every weekday at 9am");
  assert.equal(r.habit, undefined);
  assert.equal(r.input.title, "Team standup");
  assert.equal(r.input.rrule, "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
  // 9 am today has gone, so it starts tomorrow.
  assert.equal(local(r.input.due_at), "2026-09-16 09:00:00");
  const chip = r.chips.find((c) => c.kind === "repeat");
  assert.equal(chip?.text, "every weekday");
});

test("weekdays, intervals and lists of days", () => {
  const cases: [string, string, string][] = [
    ["Water plants every monday", "FREQ=WEEKLY;BYDAY=MO", "2026-09-21"],
    [
      "Review every other Friday 4pm",
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR",
      "2026-09-18",
    ],
    [
      "Yoga on Tuesdays and Thursdays at 6pm",
      "FREQ=WEEKLY;BYDAY=TU,TH",
      "2026-09-15",
    ],
    ["Clean every weekend", "FREQ=WEEKLY;BYDAY=SU,SA", "2026-09-19"],
    ["Pay rent every month", "FREQ=MONTHLY", "2026-09-15"],
    ["Taxes yearly", "FREQ=YEARLY", "2026-09-15"],
    ["Sync fortnightly", "FREQ=WEEKLY;INTERVAL=2", "2026-09-15"],
  ];
  for (const [text, rrule, day] of cases) {
    const r = parse(text);
    assert.equal(r.input.rrule, rrule, text);
    assert.equal(local(r.input.due_at)?.slice(0, 10), day, text);
  }
});

test("days of the month: ordinals, the last one, a date", () => {
  const first = parse("Board sync first Tuesday of every month");
  assert.equal(first.input.rrule, "FREQ=MONTHLY;BYDAY=TU;BYSETPOS=1");
  assert.equal(local(first.input.due_at)?.slice(0, 10), "2026-10-06");
  assert.equal(first.input.all_day, true);

  const last = parse("Invoices last Friday of the month at 3pm");
  assert.equal(last.input.rrule, "FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1");
  assert.equal(local(last.input.due_at), "2026-09-25 15:00:00");

  const lastDay = parse("Close books on the last day of the month");
  assert.equal(lastDay.input.rrule, "FREQ=MONTHLY;BYMONTHDAY=-1");
  assert.equal(local(lastDay.input.due_at)?.slice(0, 10), "2026-09-30");

  const fifteenth = parse("Budget on the 15th of each month");
  assert.equal(fifteenth.input.rrule, "FREQ=MONTHLY;BYMONTHDAY=15");
  assert.equal(local(fifteenth.input.due_at)?.slice(0, 10), "2026-09-15");
});

test("when a repeat ends: a count, a length, a month, a date", () => {
  assert.equal(
    parse("Standup every day at 9 for 10 times").input.rrule,
    "FREQ=DAILY;COUNT=10",
  );
  // Six weeks from its first day (tomorrow, as 7 am has gone).
  assert.equal(
    parse("Stretch daily at 7am for 6 weeks").input.rrule,
    "FREQ=DAILY;UNTIL=20261027",
  );
  // "until December" is up to December.
  assert.equal(
    parse("Call mum every Mon and Thu until December").input.rrule,
    "FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20261130",
  );
  assert.equal(
    parse("Call mum every Mon until the end of December").input.rrule,
    "FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231",
  );
  assert.equal(
    parse("Walk every day at 6pm until 20 Dec").input.rrule,
    "FREQ=DAILY;UNTIL=20261220",
  );
});

test("a start date is kept, and moved to a day the repeat happens", () => {
  const r = parse("Plan the week every sunday starting next sunday");
  assert.equal(r.input.title, "Plan the week");
  assert.equal(r.input.rrule, "FREQ=WEEKLY;BYDAY=SU");
  assert.equal(local(r.input.due_at)?.slice(0, 10), "2026-09-27");
});

test("how often without when makes a habit", () => {
  const read = parse("Read 20 minutes every day");
  assert.deepEqual(read.habit, {
    name: "Read",
    cadence: 1,
    period: "day",
    duration_minutes: 20,
    days: [0, 1, 2, 3, 4, 5, 6],
    window_start: null,
    window_end: null,
    priority: "medium",
  });
  assert.equal(read.chips.find((c) => c.kind === "kind")?.value, "habit");
  assert.equal(
    read.chips.find((c) => c.kind === "habit")?.value,
    "Every day · 20 min",
  );
  // The length belongs to the habit, not an estimate beside it.
  assert.ok(!read.chips.some((c) => c.kind === "estimate"));

  const gym = parse("Gym 3 times a week, mornings !!");
  assert.equal(gym.habit?.cadence, 3);
  assert.equal(gym.habit?.period, "week");
  assert.equal(gym.habit?.duration_minutes, 30);
  assert.equal(gym.habit?.window_start, "06:00");
  assert.equal(gym.habit?.window_end, "12:00");
  assert.equal(gym.habit?.priority, "medium");
  assert.equal(gym.habit?.name, "Gym");

  assert.equal(parse("Run 3x a week for 45 min").habit?.duration_minutes, 45);
  assert.equal(parse("Guitar twice a week").habit?.cadence, 2);
  assert.equal(parse("Meditate 15 minutes a day").habit?.duration_minutes, 15);
  // With a time, "3 times a week" keeps to a window around it.
  const swim = parse("Swim 3 times a week at 7am for 1h");
  assert.equal(swim.habit?.window_start, "07:00");
  assert.equal(swim.habit?.window_end, "09:00");
});

test("with habits off, a phrase only a habit holds stays in the title", () => {
  const r = parse("Gym 3 times a week", { habits: false });
  assert.equal(r.habit, undefined);
  assert.equal(r.input.rrule, undefined);
  assert.equal(r.input.title, "Gym 3 times a week");
  // "every day" with a length can still repeat the item.
  const read = parse("Read 20 minutes every day", { habits: false });
  assert.equal(read.input.rrule, "FREQ=DAILY");
  assert.equal(read.input.estimate_minutes, 20);
});

test("text without a repeat is read as before", () => {
  const r = parse("Lunch with Sam tomorrow 1pm");
  assert.equal(r.input.rrule, undefined);
  assert.equal(r.habit, undefined);
  assert.ok(!r.chips.some((c) => c.kind === "repeat"));
  // "month" is not "Mon", and a weekday alone is one day, not a repeat.
  assert.equal(parse("Monthly report friday").input.rrule, "FREQ=MONTHLY");
  assert.equal(parse("Call Sam friday").input.rrule, undefined);
  // The location stops where the repeat starts.
  assert.equal(
    parse("Swim ;City Baths every monday 7am").input.location,
    "City Baths",
  );
});
