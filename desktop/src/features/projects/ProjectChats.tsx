import { useEffect, useRef, useState } from "react";
import { Pin } from "lucide-react";
import type { AiChatSummary } from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";

export function ProjectChats({
  projectId,
  onOpen,
}: {
  projectId: string;
  onOpen: (id: string) => void;
}) {
  const [chats, setChats] = useState<AiChatSummary[]>([]);
  const [search, setSearch] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const writing = useRef(false);
  const alive = useRef(true);
  const token = useRef(session.get());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const current = () => alive.current && token.current === session.get();
  useEffect(() => {
    let active = true;
    setLoading(true);
    setChats([]);
    setError("");
    client.aiChats({ project_id: projectId, search, limit: 100 }).then(
      (rows) => {
        if (active && current()) {
          setChats(rows);
          setLoading(false);
        }
      },
      () => {
        if (active && current()) {
          setError("Couldn't load chats. Try again.");
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [projectId, search, revision]);
  const pin = async (chat: AiChatSummary) => {
    if (writing.current || !current()) return;
    writing.current = true;
    setPending(chat.id);
    setError("");
    try {
      await client.updateAiChat(chat.id, { pinned: !chat.pinned });
      if (current()) setRevision((value) => value + 1);
    } catch {
      if (current()) setError("Couldn't update pin. Try again.");
    } finally {
      writing.current = false;
      if (current()) setPending(null);
    }
  };
  return (
    <div className="project-chat-history">
      <input
        type="search"
        aria-label="Search project chats"
        placeholder="Search chats"
        value={search}
        maxLength={200}
        onChange={(event) => setSearch(event.target.value)}
      />
      {error && (
        <p role="alert">
          {error}{" "}
          <button
            type="button"
            className="text-button"
            disabled={!!pending}
            onClick={() => setRevision((value) => value + 1)}
          >
            Retry
          </button>
        </p>
      )}
      {loading ? (
        <p role="status">Loading chats…</p>
      ) : !error && chats.length === 0 ? (
        <p className="muted">
          {search ? "No chats match" : "No project chats yet"}
        </p>
      ) : null}
      {!loading &&
        chats.map((chat) => (
          <div className="settings-list-row" key={chat.id}>
            <button
              type="button"
              className="text-button project-chat-open"
              disabled={!!pending}
              onClick={() => onOpen(chat.id)}
            >
              <span>{chat.title}</span>
              <small className="muted">
                {chat.swept_at
                  ? "Summary saved"
                  : chat.active === "needs_you"
                    ? "Needs you"
                    : chat.active === "working"
                      ? "Working"
                      : new Date(chat.last_used_at).toLocaleDateString()}
              </small>
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`${chat.pinned ? "Unpin" : "Pin"} ${chat.title}`}
              aria-pressed={chat.pinned}
              disabled={!!pending}
              onClick={() => void pin(chat)}
            >
              <Pin size={16} />
            </button>
          </div>
        ))}
    </div>
  );
}
