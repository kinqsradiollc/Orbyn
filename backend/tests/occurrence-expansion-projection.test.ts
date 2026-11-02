import { test, after } from "node:test";
import assert from "node:assert/strict";
import "./setup.js";
import { dayTime, resolveOccurrenceTimes } from "@orbyn/core";
const { expandSeries, occurrenceEnd } =
  await import("../src/modules/planner/calendar.js");
const { pool } = await import("../src/db/pool.js");
after(async () => pool.end());

const series = {
  id: "71000000-0000-4000-8000-000000000001",
  kind: "event" as const,
  due_at: new Date("2030-01-01T17:00:00.000Z"),
  end_at: new Date("2030-01-01T18:00:00.000Z"),
  rrule: "FREQ=DAILY;COUNT=3",
  timezone: "UTC",
  series_start: new Date("2030-01-01T17:00:00.000Z"),
  exdates: [],
  all_day: false,
};
const window = {
  from: new Date("2030-01-01T00:00:00.000Z"),
  to: new Date("2030-01-05T00:00:00.000Z"),
};

test("backend finite expansion delegates time projection and restores time after override removal", () => {
  const key = new Date("2030-01-02T17:00:00.000Z"),
    change = { due_at: "2030-01-03T09:00:00.000Z", end_at: null };
  const moved = expandSeries(
    series,
    window.from,
    window.to,
    new Map([[key.getTime(), change]]),
  );
  const selected = moved.find(
    (value) => value.occurrence.getTime() === key.getTime(),
  )!;
  const resolved = resolveOccurrenceTimes(series, key, change);
  assert.equal(selected.start.toISOString(), resolved.start.toISOString());
  assert.equal(selected.end, null);
  const reset = expandSeries(series, window.from, window.to).find(
    (value) => value.occurrence.getTime() === key.getTime(),
  )!;
  assert.equal(reset.start.toISOString(), key.toISOString());
  assert.equal(reset.end?.toISOString(), "2030-01-02T18:00:00.000Z");
  assert.equal(moved.length, 3);
  assert.equal(
    occurrenceEnd(series, key)?.toISOString(),
    reset.end?.toISOString(),
  );
});

test("backend all-day range enumeration preserves DST local midnight and exdates", () => {
  const zone = "Australia/Melbourne",
    start = dayTime("2026-10-03", 0, zone);
  const allDay = {
    ...series,
    due_at: start,
    end_at: dayTime("2026-10-04", 0, zone),
    series_start: start,
    all_day: true,
    timezone: zone,
    exdates: [dayTime("2026-10-03", 0, zone)],
  };
  const entries = expandSeries(
    allDay,
    dayTime("2026-10-02", 0, zone),
    dayTime("2026-10-07", 0, zone),
  );
  assert.equal(entries.length, 2);
  assert.equal(
    (entries[0].end!.getTime() - entries[0].start.getTime()) / 3600000,
    23,
  );
  assert.equal(
    entries[1].end!.getTime() - entries[1].start.getTime(),
    24 * 3600000,
  );
});

for (const [first, last, hours] of [
  ["2026-10-03", "2026-10-06", 71],
  ["2026-04-04", "2026-04-07", 73],
] as const) {
  test(`backend three-day event projection retains local span across DST at ${first}`, () => {
    const zone = "Australia/Melbourne";
    const start = dayTime(first, 0, zone);
    const item = {
      ...series,
      due_at: start,
      end_at: dayTime(last, 0, zone),
      series_start: start,
      all_day: true,
      timezone: zone,
      rrule: "FREQ=DAILY;COUNT=1",
    };
    const entries = expandSeries(item, start, dayTime(last, 0, zone));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].start.getTime(), start.getTime());
    assert.equal(entries[0].end!.getTime(), dayTime(last, 0, zone).getTime());
    assert.equal(
      (entries[0].end!.getTime() - entries[0].start.getTime()) / 3600000,
      hours,
    );
  });
}
