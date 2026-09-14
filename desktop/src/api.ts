export type Item = {
  id: string;
  title: string;
  notes: string;
  kind: "task" | "event";
  status: "todo" | "done";
  priority: "low" | "medium" | "high";
  due_at: string | null;
  end_at: string | null;
  reminder_minutes: number;
  version: number;
};
export type User = {
  id: string;
  name: string;
  email: string;
  email_reminders: boolean;
};
export type Notice = {
  id: string;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
};
export type Proposal = {
  id: string;
  summary: string;
  actions: {
    operation: string;
    item_id?: string;
    data?: Omit<Item, "id" | "version">;
  }[];
};
export const apiBase =
  import.meta.env.VITE_API_URL ||
  (location.protocol === "file:" ? "http://localhost:8008" : "/api");
export async function api<T>(
  path: string,
  token: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(apiBase + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(70000),
  });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: "Unable to reach Orbyn" }));
    throw Object.assign(new Error(error.message || "Request failed"), {
      status: response.status,
    });
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export const itemBody = (i: Item) => ({
  title: i.title,
  notes: i.notes,
  kind: i.kind,
  status: i.status,
  priority: i.priority,
  due_at: i.due_at,
  end_at: i.end_at,
  reminder_minutes: i.reminder_minutes,
  version: i.version,
});
