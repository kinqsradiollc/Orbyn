import type { AiChatSummary } from "@orbyn/core";
import { Pin } from "lucide-react";
import { useRef, useState } from "react";
import { useResource } from "../../lib/resource";
import { client } from "../../lib/session";
import { Dialog, ErrorNotice, IconButton, Input, Loading } from "../../ui/kit";

export function Chats({
  projectId,
  onOpen,
  onClose,
}: {
  projectId: string;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const lock = useRef(false);
  const read = useResource<AiChatSummary[]>(
    () => client.aiChats({ project_id: projectId, search, limit: 100 }),
    [projectId, search, revision],
  );
  const pin = async (chat: AiChatSummary) => {
    if (lock.current) return;
    lock.current = true;
    setPending(chat.id);
    setError("");
    try {
      await client.updateAiChat(chat.id, { pinned: !chat.pinned });
      setRevision((n) => n + 1);
    } catch {
      setError("Couldn't update the pin. Try again.");
    } finally {
      lock.current = false;
      setPending(null);
    }
  };
  const chats = read.data ?? [];
  return (
    <Dialog title="Project chats" onClose={onClose}>
      <Input
        type="search"
        aria-label="Search project chats"
        placeholder="Search chats"
        value={search}
        maxLength={200}
        onChange={(event) => setSearch(event.target.value)}
      />
      {read.error && (
        <ErrorNotice
          message="Couldn't load chats."
          onRetry={() => setRevision((n) => n + 1)}
        />
      )}
      {error && <ErrorNotice message={error} />}
      {read.loading && !read.data && <Loading label="Loading chats" />}
      {read.data && !chats.length && (
        <p className="muted">
          {search ? "No chats match" : "No project chats yet"}
        </p>
      )}
      <div className="rows">
        {chats.map((chat) => (
          <div key={chat.id} className="row">
            <button
              className="row-main"
              disabled={!!pending}
              onClick={() => onOpen(chat.id)}
              style={{ textAlign: "left" }}
            >
              <span className="row-title" dir="auto">
                {chat.title}
              </span>
              <span className="muted small">
                {chat.swept_at
                  ? "Summary saved"
                  : chat.active === "needs_you"
                    ? "Needs you"
                    : chat.active === "working"
                      ? "Working"
                      : new Date(chat.last_used_at).toLocaleDateString()}
              </span>
            </button>
            <IconButton
              label={`${chat.pinned ? "Unpin" : "Pin"} ${chat.title}`}
              aria-pressed={chat.pinned}
              disabled={!!pending}
              onClick={() => void pin(chat)}
            >
              <Pin />
            </IconButton>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
