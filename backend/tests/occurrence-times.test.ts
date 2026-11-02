import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayTime,
  occurrenceDayLength,
  occurrenceEndAt,
  resolveOccurrenceTimes,
} from "@orbyn/core";

const timed = {
  due_at: "2030-01-01T17:00:00.000Z",
  end_at: "2030-01-01T18:30:00.000Z",
  all_day: false,
  timezone: "UTC",
};
const original = "2030-01-03T17:00:00.000Z";
const times = (value: ReturnType<typeof resolveOccurrenceTimes>) => ({
  key: value.occurrence.toISOString(),
  start: value.start.toISOString(),
  end: value.end?.toISOString() ?? null,
});

test("normal selected span uses original key and canonical duration without mutating Dates", () => {
  const key = new Date(original),
    start = new Date(timed.due_at),
    end = new Date(timed.end_at);
  const result = resolveOccurrenceTimes(
    { ...timed, due_at: start, end_at: end },
    key,
  );
  assert.deepEqual(times(result), {
    key: original,
    start: original,
    end: "2030-01-03T18:30:00.000Z",
  });
  result.start.setUTCDate(9);
  assert.equal(key.toISOString(), original);
  assert.equal(start.toISOString(), timed.due_at);
  assert.equal(end.toISOString(), timed.end_at);
});

test("moved override owns start and nullable end but keeps original key", () => {
  const moved = "2030-01-04T09:00:00.000Z";
  assert.deepEqual(
    times(
      resolveOccurrenceTimes(timed, original, { due_at: moved, end_at: null }),
    ),
    { key: original, start: moved, end: null },
  );
  assert.equal(
    resolveOccurrenceTimes(timed, original, { due_at: moved }).end,
    null,
  );
  assert.equal(
    resolveOccurrenceTimes(timed, original, {
      due_at: moved,
      end_at: "2030-01-04T10:00:00.000Z",
    }).end?.toISOString(),
    "2030-01-04T10:00:00.000Z",
  );
});

test("removing a date override or leaving only unrelated/end-only data restores normal span", () => {
  const normal = times(resolveOccurrenceTimes(timed, original));
  assert.deepEqual(times(resolveOccurrenceTimes(timed, original, {})), normal);
  assert.deepEqual(
    times(resolveOccurrenceTimes(timed, original, { end_at: null })),
    normal,
  );
  assert.deepEqual(
    times(
      resolveOccurrenceTimes(timed, original, {
        end_at: "2031-01-01T00:00:00.000Z",
      }),
    ),
    normal,
  );
  assert.equal(occurrenceEndAt({ ...timed, end_at: null }, original), null);
});

for (const [day, hours] of [
  ["2026-10-04", 23],
  ["2026-04-05", 25],
] as const) {
  test(`all-day selected ${day} keeps a local day across Melbourne DST (${hours} hours)`, () => {
    const zone = "Australia/Melbourne";
    const source = {
      due_at: dayTime("2026-01-01", 0, zone),
      end_at: dayTime("2026-01-02", 0, zone),
      all_day: true,
      timezone: zone,
    };
    const key = dayTime(day, 0, zone),
      result = resolveOccurrenceTimes(source, key);
    assert.equal(occurrenceDayLength(source), 1);
    assert.equal(
      (result.end!.getTime() - result.start.getTime()) / 3600000,
      hours,
    );
    assert.equal(
      result.end!.toLocaleTimeString("en-GB", {
        timeZone: zone,
        hour12: false,
      }),
      "00:00:00",
    );
  });
}

test("timed durations remain elapsed durations across DST; invalid keys cannot become dates", () => {
  const key = dayTime("2026-10-04", 90, "Australia/Melbourne");
  assert.equal(
    resolveOccurrenceTimes(timed, key).end!.getTime() - key.getTime(),
    90 * 60_000,
  );
  assert.throws(() => resolveOccurrenceTimes(timed, "not-a-date"), RangeError);
});

for (const [day, expectedHours] of [
  ["2026-10-03", 71],
  ["2026-04-04", 73],
] as const) {
  test(`three all-day local dates across DST at ${day}`, () => {
    const zone = "Australia/Melbourne";
    const source = {
      due_at: dayTime("2026-01-01", 0, zone),
      end_at: dayTime("2026-01-04", 0, zone),
      all_day: true,
      timezone: zone,
    };
    const key = dayTime(day, 0, zone);
    const result = resolveOccurrenceTimes(source, key);
    assert.equal(occurrenceDayLength(source), 3);
    assert.equal(
      (result.end!.getTime() - result.start.getTime()) / 3600000,
      expectedHours,
    );
    assert.equal(
      result.end!.getTime(),
      dayTime(
        day === "2026-10-03" ? "2026-10-06" : "2026-04-07",
        0,
        zone,
      ).getTime(),
    );
  });
}
