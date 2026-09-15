/** "Tue, Sep 15, 3:30 PM" in the viewer's time zone. */
export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const pad = (n: number) => String(n).padStart(2, "0");

/** An ISO time as a `datetime-local` input value (local time), or "". */
export const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** A `datetime-local` input value as an ISO time, or null when empty. */
export const fromLocalInput = (value: string) =>
  value ? new Date(value).toISOString() : null;
