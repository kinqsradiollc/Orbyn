import { parseRichText } from "./richText.js";
import type { AiChatSummary } from "./project-chats.js";

/** Presentation groups consume only the already-authorized chat list. */
export function groupAssistantChats(
  chats: readonly AiChatSummary[],
  personalChatId: string | null,
) {
  const projects = new Map<
    string,
    { id: string; name: string; chats: AiChatSummary[] }
  >();
  const pinned: AiChatSummary[] = [];
  const recent: AiChatSummary[] = [];
  const seen = new Set<string>();
  for (const chat of chats) {
    if (chat.id === personalChatId || seen.has(chat.id)) continue;
    seen.add(chat.id);
    if (chat.project_id) {
      let project = projects.get(chat.project_id);
      if (!project) {
        project = {
          id: chat.project_id,
          name: chat.project_name || "Project",
          chats: [],
        };
        projects.set(chat.project_id, project);
      }
      project.chats.push(chat);
    } else if (chat.pinned) pinned.push(chat);
    else recent.push(chat);
  }
  return { projects: [...projects.values()], pinned, recent };
}

/** Calendar days use the person's timezone, including DST transitions. */
export function assistantDateLabel(
  iso: string,
  previous: string | undefined,
  timezone: string,
  now = new Date(),
): string | null {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  const key = (value: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(value);
  const current = key(date);
  if (previous && current === key(new Date(previous))) return null;
  if (current === key(now)) return "Today";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const part = (name: string) =>
    Number(parts.find((value) => value.type === name)!.value);
  const yesterday = new Date(
    Date.UTC(part("year"), part("month") - 1, part("day") - 1),
  );
  const yesterdayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(yesterday);
  if (current === yesterdayKey) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  }).format(date);
}

/** Match selected visible words using the same light-Markdown renderer on both clients. */
export function assistantExcerptMatches(
  source: string,
  excerpt: string,
): boolean {
  if (!excerpt.trim() || excerpt.length > 2000) return false;
  if (source.includes(excerpt)) return true;
  const words = (value: string) => value.replace(/\s+/gu, " ").trim();
  if (words(source).includes(words(excerpt))) return true;
  const text = parseRichText(source)
    .map((block) => {
      if (block.type === "list")
        return block.items
          .map((parts) => parts.map((part) => part.text).join(""))
          .join("\n");
      if (block.type === "table")
        return [block.header, ...block.rows]
          .map((row) =>
            row
              .map((parts) => parts.map((part) => part.text).join(""))
              .join("\t"),
          )
          .join("\n");
      return block.inlines.map((part) => part.text).join("");
    })
    .join("\n");
  return words(text).includes(words(excerpt));
}
