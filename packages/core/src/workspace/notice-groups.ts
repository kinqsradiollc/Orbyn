import type { Notice } from "../types.js";

export type NoticeSourceKind =
  | "item"
  | "doc"
  | "project"
  | "booking"
  | "proposal"
  | "question"
  | "ask"
  | "record"
  | "conversation"
  | "chat"
  | "overnight"
  | "grant"
  | "team"
  | "template"
  | "session";
export type NoticeGroup = {
  key: string;
  source: { kind: NoticeSourceKind; id: string } | null;
  notices: Notice[];
  /** Counts only the supplied, already authorized snapshot. */
  unread: number;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const valid = (id: string | null | undefined) =>
  id && uuid.test(id) ? id.toLowerCase() : null;

/** Only transport-owned IDs identify a source. Titles and prose never do. */
export function noticeSource(notice: Notice): NoticeGroup["source"] {
  const parts = notice.ref?.split(":") ?? [];
  const typed = (
    prefix: string,
    kind: NoticeSourceKind,
  ): NoticeGroup["source"] => {
    const id = parts[0] === prefix ? valid(parts[1]) : null;
    return id ? { kind, id } : null;
  };
  // Decisions belong to their exact request, even if they also name an item.
  if (notice.kind === "review") return typed("proposal", "proposal");
  if (notice.kind === "question") return typed("question", "question");
  if (notice.kind === "ask") {
    const id = valid(notice.ref);
    return id ? { kind: "ask", id } : null;
  }
  if (notice.kind === "promise") {
    const id = valid(notice.ref);
    return id ? { kind: "record", id } : null;
  }
  const item = valid(notice.item_id);
  if (item) return { kind: "item", id: item };
  if (notice.kind === "import" || notice.kind === "mention")
    return typed("doc", "doc");
  if (notice.kind === "project") {
    const id = valid(parts[0]);
    return id ? { kind: "project", id } : null;
  }
  if (notice.kind === "booking" || notice.kind === "template") {
    const id = valid(notice.ref);
    return id ? { kind: notice.kind, id } : null;
  }
  if (notice.kind === "agent")
    return typed("grant", "grant") ?? typed("team", "team");
  if (notice.kind === "assistant")
    return (
      typed("conversation", "conversation") ??
      typed("chat", "chat") ??
      typed("overnight", "overnight")
    );
  if (notice.kind === "reminder_nudge") return typed("chat", "chat");
  if (notice.kind === "session" || notice.kind === "conflict") {
    const id = valid(parts[0]);
    return id ? { kind: "session", id } : null;
  }
  return null;
}

/** Stable first-source order and original per-source order; no dedup or mutation. */
export function groupNotices(notices: readonly Notice[]): NoticeGroup[] {
  const groups = new Map<string, NoticeGroup>();
  for (const notice of notices) {
    const source = noticeSource(notice),
      key = source ? `${source.kind}:${source.id}` : `notice:${notice.id}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, source, notices: [], unread: 0 };
      groups.set(key, group);
    }
    group.notices.push(notice);
    if (!notice.read) group.unread++;
  }
  return [...groups.values()];
}

const labels: Record<NoticeSourceKind, string> = {
  item: "Task or event",
  doc: "Page",
  project: "Project",
  booking: "Booking",
  proposal: "Review request",
  question: "Agent question",
  ask: "Task request",
  record: "Promise",
  conversation: "Conversation",
  chat: "Assistant chat",
  overnight: "Overnight",
  grant: "Agent connection",
  team: "Team",
  template: "Template",
  session: "Session",
};
export const noticeGroupLabel = (group: NoticeGroup) =>
  group.source ? labels[group.source.kind] : "Updates";
export const noticeGroupCount = (group: NoticeGroup) =>
  `${group.notices.length} updates · ${group.unread} unread`;
