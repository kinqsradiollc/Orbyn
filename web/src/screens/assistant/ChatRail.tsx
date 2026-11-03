import { groupAssistantChats, type AiChatSummary } from "@orbyn/core";
import { X } from "lucide-react";
import { useEffect } from "react";
import { client } from "../../lib/session";
import { Button, ErrorNotice, IconButton } from "../../ui/kit";
import { useOwned, onForeground } from "../agents-shared/hooks";
import { useRead } from "./state";

/** Compact saved-chat list beside the conversation; managing chats stays in ChatList. */
export function ChatRail({
  personal,
  active,
  disabled,
  onOpen,
  onManage,
  onHide,
}: {
  personal: string | null;
  active: string | null;
  disabled: boolean;
  onOpen: (id: string) => void;
  onManage: () => void;
  onHide: () => void;
}) {
  const owned = useOwned();
  const read = useRead(
    () => client.aiChats({ search: "", kind: "all", limit: 50 }),
    [active],
    { retain: true },
  );
  useEffect(
    () =>
      onForeground(() => {
        if (owned()) void read.reload();
      }),
    [owned, read.reload],
  );
  const group = groupAssistantChats(read.data ?? [], personal);
  const row = (chat: AiChatSummary) => (
    <li key={chat.id}>
      <button
        type="button"
        className="assistant-rail-row"
        aria-current={active === chat.id ? "page" : undefined}
        disabled={disabled}
        onClick={() => owned() && onOpen(chat.id)}
      >
        <span dir="auto">{chat.title || "Untitled chat"}</span>
        {chat.active && (
          <span
            className={`assistant-rail-dot${chat.active === "needs_you" ? " is-warn" : ""}`}
            title={chat.active === "needs_you" ? "Needs you" : "Working"}
          >
            <span className="sr-only">
              {chat.active === "needs_you" ? "Needs you" : "Working"}
            </span>
          </span>
        )}
      </button>
    </li>
  );
  const section = (title: string, chats: AiChatSummary[], key = title) =>
    chats.length > 0 && (
      <section key={key} className="assistant-rail-group">
        <h2 dir="auto">{title}</h2>
        <ul>{chats.map(row)}</ul>
      </section>
    );
  return (
    <nav className="assistant-rail" aria-label="Saved chats">
      <div className="assistant-rail-head">
        <span>Chats</span>
        <Button variant="ghost" onClick={onManage}>
          Search and manage
        </Button>
        <IconButton
          label="Hide saved chats"
          className="assistant-rail-close"
          onClick={onHide}
        >
          <X aria-hidden="true" />
        </IconButton>
      </div>
      {read.error && (
        <ErrorNotice message={read.error} onRetry={() => void read.reload()} />
      )}
      <div className="assistant-rail-list">
        {personal && (
          <ul>
            <li>
              <button
                type="button"
                className="assistant-rail-row"
                aria-current={active === personal ? "page" : undefined}
                disabled={disabled}
                onClick={() => owned() && onOpen(personal)}
              >
                <span>Personal conversation</span>
              </button>
            </li>
          </ul>
        )}
        {section("Pinned", group.pinned)}
        {group.projects.map((project) =>
          section(project.name, project.chats, project.id),
        )}
        {section("Recent", group.recent)}
        {read.loading && !read.data && (
          <p className="small muted" role="status">
            Loading chats…
          </p>
        )}
      </div>
    </nav>
  );
}
