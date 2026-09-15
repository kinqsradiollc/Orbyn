const DAY = 86_400_000;

export function offsetAt(timezone: string, at: Date) {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longOffset",
  })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  // "GMT" alone means UTC; otherwise "GMT+10:00" -> "+10:00".
  return !name || name === "GMT" ? "+00:00" : name.replace("GMT", "");
}

/** "Tuesday 15 September 2026" in the user's timezone. */
export function localDay(timezone: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
}

/**
 * The user's local wall-clock time, plus every UTC-offset change in the next
 * 120 days. Small models otherwise guess daylight-saving offsets wrong and
 * schedule items an hour off.
 */
export function localTimeContext(timezone: string, now = new Date()) {
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const current = offsetAt(timezone, now);
  const changes: string[] = [];
  let previous = current;
  for (let d = 1; d <= 120; d++) {
    const at = new Date(now.getTime() + d * DAY);
    const offset = offsetAt(timezone, at);
    if (offset !== previous) {
      const date = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(at);
      changes.push(`from about ${date} the offset is ${offset}`);
      previous = offset;
    }
  }
  return `User timezone: ${timezone}. Local time now: ${local} (UTC${current}).${
    changes.length
      ? ` Daylight saving: ${changes.join("; ")}. Use the offset that applies on each item's date.`
      : ` The UTC offset stays ${current} for the next 120 days.`
  }`;
}
