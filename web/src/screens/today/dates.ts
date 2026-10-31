/** Day and time words Today shares. Keep to a person's own clock. */
export const clockText = (iso: string, timeZone?: string) =>
  new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });

export const longWhen = (iso: string) =>
  new Date(iso).toLocaleString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

export const shortDay = (iso: string) =>
  new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

/** "Thu 24 Sep" for a YYYY-MM-DD day. */
export const dayName = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
};

/** "Calm" wording for a span of minutes. */
export const minutesText = (m: number) => {
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return h ? (rest ? `${h} h ${rest} min` : `${h} h`) : `${m} min`;
};
