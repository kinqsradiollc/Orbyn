import { test } from "node:test";
import assert from "node:assert/strict";
import { occurrencesBetween } from "@orbyn/core";
import { parseIcs } from "../src/modules/planner/icsParse.js";

/**
 * The subscribed-calendar reader on the rules real feeds use: the calendar's
 * own time zone, monthly "2nd Tuesday" and "last Friday" rules, extra dates
 * (RDATE), and changes to "this and all following" occurrences.
 */
const feed = (body: string, header = "") =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${header}${body}END:VCALENDAR\r\n`;
const event = (lines: string[]) =>
  `BEGIN:VEVENT\r\n${lines.join("\r\n")}\r\nEND:VEVENT\r\n`;

const expand = (
  e: ReturnType<typeof parseIcs>[number],
  from: string,
  to: string,
) =>
  occurrencesBetween(
    new Date(e.starts_at),
    e.rrule!,
    e.timezone,
    new Date(from),
    new Date(to),
    e.exdates,
  ).map((d) => d.toISOString());

test("times with no zone are read in the calendar's own zone", () => {
  const [e] = parseIcs(
    feed(
      event([
        "UID:a",
        "SUMMARY:Lecture",
        "DTSTART:20261005T100000",
        "DTEND:20261005T110000",
      ]),
      "X-WR-TIMEZONE:Australia/Melbourne\r\n",
    ),
    "UTC",
  );
  // 10:00 in Melbourne on 5 Oct 2026 (daylight time, +11).
  assert.equal(e.starts_at, "2026-10-04T23:00:00.000Z");
  assert.equal(e.timezone, "Australia/Melbourne");
});

test("whole days stay on the person's own day, whatever the calendar's zone", () => {
  const [e] = parseIcs(
    feed(
      event(["UID:h", "SUMMARY:Holiday", "DTSTART;VALUE=DATE:20261103"]),
      "X-WR-TIMEZONE:Australia/Melbourne\r\n",
    ),
    "Europe/London",
  );
  assert.equal(e.all_day, true);
  assert.equal(e.starts_at, "2026-11-03T00:00:00.000Z");
});

test("monthly rules on the nth weekday keep repeating", () => {
  const [second, last] = parseIcs(
    feed(
      event([
        "UID:m1",
        "SUMMARY:Club",
        "DTSTART;TZID=UTC:20260908T180000",
        "DTEND;TZID=UTC:20260908T190000",
        "RRULE:FREQ=MONTHLY;BYDAY=2TU",
      ]) +
        event([
          "UID:m2",
          "SUMMARY:Review",
          "DTSTART;TZID=UTC:20260925T090000",
          "DTEND;TZID=UTC:20260925T100000",
          "RRULE:FREQ=MONTHLY;BYDAY=-1FR",
        ]),
    ),
    "UTC",
  );
  assert.match(second.rrule!, /BYDAY=TU/);
  assert.match(second.rrule!, /BYSETPOS=2/);
  assert.deepEqual(expand(second, "2026-09-01", "2026-12-01"), [
    "2026-09-08T18:00:00.000Z",
    "2026-10-13T18:00:00.000Z",
    "2026-11-10T18:00:00.000Z",
  ]);
  assert.deepEqual(expand(last, "2026-09-01", "2026-12-01"), [
    "2026-09-25T09:00:00.000Z",
    "2026-10-30T09:00:00.000Z",
    "2026-11-27T09:00:00.000Z",
  ]);
});

test("extra dates (RDATE) become their own occurrences", () => {
  const events = parseIcs(
    feed(
      event([
        "UID:r",
        "SUMMARY:Consultation",
        "DTSTART:20260901T020000Z",
        "DTEND:20260901T030000Z",
        "RDATE:20260915T020000Z,20260922T040000Z",
      ]),
    ),
    "UTC",
  );
  assert.deepEqual(
    events.map((e) => [e.starts_at, e.ends_at]),
    [
      ["2026-09-01T02:00:00.000Z", "2026-09-01T03:00:00.000Z"],
      ["2026-09-15T02:00:00.000Z", "2026-09-15T03:00:00.000Z"],
      ["2026-09-22T04:00:00.000Z", "2026-09-22T05:00:00.000Z"],
    ],
  );
});

test("changing this and all following occurrences moves the rest of the series", () => {
  const events = parseIcs(
    feed(
      event([
        "UID:w",
        "SUMMARY:Tutorial",
        "DTSTART:20260907T010000Z",
        "DTEND:20260907T020000Z",
        "RRULE:FREQ=WEEKLY;COUNT=6",
      ]) +
        event([
          "UID:w",
          "SUMMARY:Tutorial (new room)",
          "RECURRENCE-ID;RANGE=THISANDFUTURE:20260921T010000Z",
          "DTSTART:20260921T030000Z",
          "DTEND:20260921T040000Z",
        ]),
    ),
    "UTC",
  );
  const all = events
    .flatMap((e) =>
      e.rrule
        ? expand(e, "2026-09-01", "2026-12-01").map((at) => [at, e.title])
        : [[e.starts_at, e.title]],
    )
    .sort();
  assert.deepEqual(all, [
    ["2026-09-07T01:00:00.000Z", "Tutorial"],
    ["2026-09-14T01:00:00.000Z", "Tutorial"],
    ["2026-09-21T03:00:00.000Z", "Tutorial (new room)"],
    ["2026-09-28T03:00:00.000Z", "Tutorial (new room)"],
    ["2026-10-05T03:00:00.000Z", "Tutorial (new room)"],
    ["2026-10-12T03:00:00.000Z", "Tutorial (new room)"],
  ]);
});

test("implicit all-day ends use next local midnight on both DST transitions", () => {
  for (const [date, start, end] of [
    ["20261004", "2026-10-03T14:00:00.000Z", "2026-10-04T13:00:00.000Z"],
    ["20260405", "2026-04-04T13:00:00.000Z", "2026-04-05T14:00:00.000Z"],
  ]) {
    const [read] = parseIcs(
      feed(event(["UID:dst", `DTSTART;VALUE=DATE:${date}`])),
      "Australia/Melbourne",
    );
    assert.equal(read.starts_at, start);
    assert.equal(read.ends_at, end);
  }
});

test("all-day nominal DURATION days and weeks keep calendar boundaries across DST", () => {
  for (const [duration, end] of [
    ["P1D", "2026-10-04T13:00:00.000Z"],
    ["P2D", "2026-10-05T13:00:00.000Z"],
    ["P1W", "2026-10-10T13:00:00.000Z"],
  ]) {
    const [read] = parseIcs(
      feed(
        event([
          "UID:duration",
          "DTSTART;VALUE=DATE:20261004",
          `DURATION:${duration}`,
        ]),
      ),
      "Australia/Melbourne",
    );
    assert.equal(read.ends_at, end);
  }
});
