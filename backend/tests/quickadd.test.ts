import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clockMinutes,
  dayTime,
  parseQuickAdd,
  type QuickAddOptions,
} from "@orbyn/core";

/**
 * Quick add without AI: markers for place, people, lists, tags and priority,
 * natural dates and times, lengths and estimates, and task-or-event. Pure:
 * a fixed clock (Tuesday 15 September 2026, 10:30 in Melbourne).
 */
const TZ = "Australia/Melbourne";
const now = new Date("2026-09-15T10:30:00+10:00");
const options: QuickAddOptions = {
  timeZone: TZ,
  now,
  selfId: "me",
  lists: [
    { id: "L-work", name: "Work", team_id: null },
    { id: "L-launch", name: "Launch plan", team_id: "T1" },
  ],
  tags: [
    { id: "G-urgent", name: "urgent", team_id: null },
    { id: "G-urgent-team", name: "urgent", team_id: "T1" },
    { id: "G-design", name: "design", team_id: "T1" },
  ],
  members: [
    {
      user_id: "u-anna",
      name: "Anna Lee",
      email: "anna@example.com",
      team_ids: ["T1"],
    },
    {
      user_id: "u-andy",
      name: "Andy Brown",
      email: "andy@example.com",
      team_ids: ["T1"],
    },
    {
      user_id: "me",
      name: "Me Myself",
      email: "me@example.com",
      team_ids: ["T1"],
    },
  ],
};
const parse = (text: string) => parseQuickAdd(text, options);
/** A Melbourne wall-clock time as an ISO instant (daylight saving included). */
const at = (date: string, time = "00:00") =>
  dayTime(date, clockMinutes(time), TZ).toISOString();

test("an event with a person, a day, a time and a place", () => {
  const r = parse("Lunch with @anna tomorrow 1pm ;Cafe Roma");
  assert.equal(r.input.title, "Lunch");
  assert.equal(r.input.kind, "event");
  assert.equal(r.input.due_at, at("2026-09-16", "13:00"));
  assert.equal(r.input.location, "Cafe Roma");
  // Anna isn't in a team item here, so she's invited rather than assigned.
  assert.deepEqual(r.input.attendees, [
    { email: "anna@example.com", name: "Anna Lee" },
  ]);
  assert.deepEqual(
    r.chips.map((c) => [c.kind, c.text, c.value]),
    [
      ["kind", "", "event"],
      ["person", "@anna", "anna@example.com"],
      ["date", "tomorrow", "2026-09-16"],
      ["time", "1pm", "13:00"],
      ["location", ";Cafe Roma", "Cafe Roma"],
    ],
  );
});

test("the location stops where a date or time starts, or at a closing ;", () => {
  const a = parse("Coffee ;Cafe Roma tomorrow 3pm");
  assert.equal(a.input.location, "Cafe Roma");
  assert.equal(a.input.due_at, at("2026-09-16", "15:00"));
  const b = parse("Team meeting 20/9 15:00-16:30 ;Room 4; bring slides");
  assert.equal(b.input.location, "Room 4");
  assert.equal(b.input.title, "Team meeting bring slides");
  assert.equal(b.input.end_at, at("2026-09-20", "16:30"));
  // A full stop inside a place name isn't a date marker.
  assert.equal(
    parse("Brunch ;St. Kilda pier").input.location,
    "St. Kilda pier",
  );
});

test("a date alone makes a whole-day task; priority marks", () => {
  const r = parse("Pay rent friday !!!");
  assert.equal(r.input.kind, "task");
  assert.equal(r.input.all_day, true);
  assert.equal(r.input.due_at, at("2026-09-18"));
  assert.equal(r.input.end_at, undefined);
  assert.equal(r.input.timezone, TZ);
  assert.equal(r.input.priority, "high");
  assert.equal(parse("Email Sam !").input.priority, "low");
  assert.equal(parse("Email Sam !!").input.priority, "medium");
  assert.equal(parse("Email Sam !high").input.priority, "high");
  // An exclamation mark inside the title is just punctuation.
  assert.equal(parse("Ship it!").input.priority, undefined);
  assert.equal(parse("Ship it!").input.title, "Ship it!");
});

test("lists, tags and estimates, by name", () => {
  const r = parse("Write report >Work #urgent ~45m");
  assert.equal(r.input.title, "Write report");
  assert.equal(r.input.list_id, "L-work");
  assert.deepEqual(r.input.tag_ids, ["G-urgent"]);
  assert.equal(r.input.team_id, null);
  assert.equal(r.input.estimate_minutes, 45);
  assert.equal(parse("Read ~1.5h").input.estimate_minutes, 90);
  assert.equal(parse("Read ~1h30m").input.estimate_minutes, 90);
  // Unknown names stay in the title rather than vanishing.
  const unknown = parse("Fix bug >Nowhere #nothing @nobody");
  assert.equal(unknown.input.title, "Fix bug >Nowhere #nothing @nobody");
  assert.equal(unknown.input.list_id, undefined);
});

test("a team list makes a team item: teammates are assigned, tags come from the team", () => {
  const r = parse("Ship it >Launch plan @anna #urgent next friday");
  assert.equal(r.input.title, "Ship it");
  assert.equal(r.input.team_id, "T1");
  assert.equal(r.input.list_id, "L-launch");
  assert.equal(r.input.assignee_id, "u-anna");
  assert.deepEqual(r.input.tag_ids, ["G-urgent-team"]);
  assert.equal(r.input.attendees, undefined);
  assert.equal(r.input.kind, "task");
  // "next friday" is the Friday of next week; "friday" the coming one.
  assert.equal(r.input.due_at, at("2026-09-25"));
  // Team tags alone put it in that team too.
  assert.equal(parse("Mockups #design").input.team_id, "T1");
  // Several people match "an": ambiguous names stay as text.
  assert.equal(parse("Ask @an").input.title, "Ask @an");
  // A full name works; you aren't invited to your own event.
  assert.equal(
    parse("Review @Andy Brown >Launch plan").input.assignee_id,
    "u-andy",
  );
  assert.equal(parse("Catch up @me 3pm-4pm").input.attendees, undefined);
});

test("times: ranges, am and pm, 24-hour clocks, noon, and afternoon for small hours", () => {
  const range = parse("Standup 9:30-10am");
  assert.equal(range.input.kind, "event");
  // 9:30 has passed today (it's 10:30), so it's tomorrow.
  assert.equal(range.input.due_at, at("2026-09-16", "09:30"));
  assert.equal(range.input.end_at, at("2026-09-16", "10:00"));
  const eleven = parse("Workshop 11-1pm");
  assert.equal(eleven.input.due_at, at("2026-09-15", "11:00"));
  assert.equal(eleven.input.end_at, at("2026-09-15", "13:00"));
  assert.equal(parse("Call at 3").input.due_at, at("2026-09-15", "15:00"));
  assert.equal(parse("Call at 9").input.due_at, at("2026-09-16", "09:00"));
  assert.equal(parse("Lunch noon").input.due_at, at("2026-09-15", "12:00"));
  assert.equal(parse("Call 15:30").input.due_at, at("2026-09-15", "15:30"));
  assert.equal(parse("Drinks tonight").input.due_at, at("2026-09-15", "19:00"));
  // Numbers that aren't times stay in the title.
  const plain = parse("Buy 2 apples");
  assert.equal(plain.input.title, "Buy 2 apples");
  assert.equal(plain.input.due_at, undefined);
});

test("lengths: an event's end, or a task's estimate", () => {
  const event = parse("Call mum at 5 for 30m");
  assert.equal(event.input.kind, "event");
  assert.equal(event.input.end_at, at("2026-09-15", "17:30"));
  const long = parse("Workshop thu 2pm for 1h30m");
  assert.equal(long.input.end_at, at("2026-09-17", "15:30"));
  assert.equal(
    parse("Sync fri 9am for an hour").input.end_at,
    at("2026-09-18", "10:00"),
  );
  const chore = parse("Read 2 books for 2h");
  assert.equal(chore.input.kind, "task");
  assert.equal(chore.input.estimate_minutes, 120);
  assert.deepEqual(
    chore.chips.find((c) => c.kind === "estimate"),
    { kind: "estimate", text: "for 2h", value: "120" },
  );
});

test("dates: numbers, month names, weekdays, relative days and the . marker", () => {
  const due = (text: string) => parse(text).input.due_at;
  assert.equal(due("Holiday sep 20"), at("2026-09-20"));
  assert.equal(due("Holiday 20th of September"), at("2026-09-20"));
  assert.equal(due("Holiday 20/9"), at("2026-09-20"));
  assert.equal(due("Renew 1/2"), at("2027-02-01"));
  assert.equal(due("Renew 2027-03-04"), at("2027-03-04"));
  assert.equal(due("Renew mar 4 2028"), at("2028-03-04"));
  assert.equal(due("Report tuesday"), at("2026-09-15"));
  assert.equal(due("Report next tuesday"), at("2026-09-22"));
  assert.equal(due("Report .fri"), at("2026-09-18"));
  assert.equal(due("Report in 3 days"), at("2026-09-18"));
  assert.equal(due("Report in 2 weeks"), at("2026-09-29"));
  assert.equal(due("Report next week"), at("2026-09-21"));
  assert.equal(due("Report by tomorrow"), at("2026-09-16"));
  assert.equal(parse("Report by tomorrow").input.title, "Report");
  // A month name needs a day next to it: "May" in a title is left alone.
  assert.equal(parse("May the best win").input.title, "May the best win");
  // Impossible dates are left as text.
  assert.equal(parse("Party 31/2").input.due_at, undefined);
});

test("events: all day, meetings and invitations by email", () => {
  const holiday = parse("Holiday sep 20 all day");
  assert.equal(holiday.input.kind, "event");
  assert.equal(holiday.input.all_day, true);
  assert.equal(holiday.input.due_at, at("2026-09-20"));
  assert.equal(holiday.input.end_at, at("2026-09-21"));
  // "meeting" makes an event; with no time it's the next full hour.
  const board = parse("Board meeting");
  assert.equal(board.input.kind, "event");
  assert.equal(board.input.due_at, at("2026-09-15", "11:00"));
  assert.equal(board.input.title, "Board meeting");
  const demo = parse("Invite @bob@x.com to demo .fri 2pm for 1h");
  assert.deepEqual(demo.input.attendees, [{ email: "bob@x.com" }]);
  assert.equal(demo.input.title, "Invite to demo");
  assert.equal(demo.input.end_at, at("2026-09-18", "15:00"));
});

test("the same text always gives the same result", () => {
  const text = "Lunch with @anna tomorrow 1-2pm ;Cafe Roma #urgent !!";
  assert.deepEqual(parse(text), parse(text));
  assert.deepEqual(parse("Buy milk"), {
    input: { title: "Buy milk", kind: "task", team_id: null },
    chips: [{ kind: "kind", text: "", value: "task" }],
  });
});
