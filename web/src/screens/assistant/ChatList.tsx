import { groupAssistantChats, type AiChatSummary } from "@orbyn/core";
import { useEffect, useRef, useState } from "react";
import { client } from "../../lib/session";
import { messageOf } from "../../lib/resource";
import { useNavigate } from "../../lib/router";
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  Loading,
  Pill,
  SelectBox,
  useConfirm,
} from "../../ui/kit";
import { useOwned, onForeground } from "../agents-shared/hooks";
import { More } from "../agents-shared/parts";
import { useRead } from "./state";
export function ChatList({
  personal,
  active,
  onOpen,
  onClose,
}: {
  personal: string | null;
  active: string | null;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const owned = useOwned(),
    confirm = useConfirm(),
    lock = useRef(false);
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [kind, setKind] = useState<"all" | "chat" | "work">("all"),
    [rename, setRename] = useState<AiChatSummary | null>(null),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      if (owned()) setSearch(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, owned]);
  const read = useRead(
    () => client.aiChats({ search, kind, limit: 100 }),
    [search, kind],
  );
  useEffect(
    () =>
      onForeground(() => {
        if (owned() && !lock.current) void read.reload();
      }),
    [owned, read.reload],
  );
  const group = groupAssistantChats(read.data ?? [], personal);
  const mutate = async (
    row: AiChatSummary,
    action: "rename" | "pin" | "note" | "delete",
  ) => {
    if (!owned() || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (
        action === "delete" &&
        !(await confirm({
          title: "Delete this saved chat?",
          body: "Its saved messages will be removed. Applied planner changes remain.",
          action: "Delete chat",
          danger: true,
        }))
      )
        return;
      if (!owned()) return;
      if (action === "delete") await client.deleteProjectChat(row.id);
      if (action === "rename")
        await client.updateAiChat(row.id, { title: name });
      if (action === "pin")
        await client.updateAiChat(row.id, { pinned: !row.pinned });
      if (action === "note") {
        const note = await client.saveChatAsNote(row.id);
        if (!owned()) return;
        navigate(`/app/doc/${encodeURIComponent(note.id)}`);
        return;
      }
      if (!owned()) return;
      setRename(null);
      await read.reload();
    } catch (failure) {
      if (owned())
        setError(
          messageOf(failure, "Couldn't save this change. Your draft is kept."),
        );
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const closeRename = async () => {
    if (!owned() || lock.current) return;
    lock.current = true;
    try {
      if (
        rename &&
        name !== rename.title &&
        !(await confirm({
          title: "Discard chat name?",
          action: "Discard",
          danger: true,
        }))
      )
        return;
      if (owned()) setRename(null);
    } finally {
      lock.current = false;
    }
  };
  const list = (rows: AiChatSummary[]) => (
    <ul className="assistant-records">
      {rows.map((row) => (
        <li key={row.id}>
          <div className="agents-row">
            <Button
              className={active === row.id ? "assistant-selected" : ""}
              disabled={busy}
              onClick={() => owned() && onOpen(row.id)}
            >
              {row.title || "Untitled chat"}
            </Button>
            {row.active && (
              <Pill tone={row.active === "needs_you" ? "amber" : "blue"}>
                {row.active === "needs_you" ? "Needs you" : "Working"}
              </Pill>
            )}
          </div>
          {row.swept_at && (
            <p className="muted small">
              Older messages were summarized.
              {row.summary_doc_id && (
                <Button
                  onClick={() =>
                    owned() &&
                    navigate(
                      `/app/doc/${encodeURIComponent(row.summary_doc_id!)}`,
                    )
                  }
                >
                  Read summary
                </Button>
              )}
            </p>
          )}
          <More summary="Manage chat">
            <div className="agents-buttons">
              <Button
                disabled={busy}
                onClick={() => {
                  setName(row.title);
                  setRename(row);
                }}
              >
                Rename
              </Button>
              <Button disabled={busy} onClick={() => void mutate(row, "pin")}>
                {row.pinned ? "Unpin" : "Pin"}
              </Button>
              <Button disabled={busy} onClick={() => void mutate(row, "note")}>
                Save as agent note
              </Button>
              <Button
                variant="danger"
                disabled={busy || !!row.active}
                onClick={() => void mutate(row, "delete")}
              >
                Delete chat
              </Button>
            </div>
          </More>
        </li>
      ))}
    </ul>
  );
  return (
    <Dialog
      title="Saved chats"
      wide
      onClose={() => !busy && !rename && owned() && onClose()}
      actions={
        <Button disabled={busy || !!rename} onClick={onClose}>
          Close
        </Button>
      }
    >
      <Field label="Search chats">
        <Input
          type="search"
          maxLength={200}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </Field>
      <Field label="History">
        <SelectBox
          value={kind}
          onChange={(e) =>
            setKind(
              e.target.value === "work"
                ? "work"
                : e.target.value === "chat"
                  ? "chat"
                  : "all",
            )
          }
        >
          <option value="all">All chats and work</option>
          <option value="chat">Conversations</option>
          <option value="work">Work only</option>
        </SelectBox>
      </Field>
      {read.loading && <Loading label="Loading saved chats" />}
      {read.error && (
        <ErrorNotice message={read.error} onRetry={() => void read.reload()} />
      )}
      {error && <ErrorNotice message={error} />}{" "}
      {personal && (
        <Button onClick={() => owned() && onOpen(personal)}>
          Personal conversation
        </Button>
      )}
      {!read.loading && read.data?.length === 0 && <p>No saved chats match.</p>}
      {group.pinned.length > 0 && (
        <section>
          <h3>Pinned</h3>
          {list(group.pinned)}
        </section>
      )}
      {group.projects.map((project) => (
        <section key={project.id}>
          <h3 dir="auto">{project.name}</h3>
          {list(project.chats)}
        </section>
      ))}
      {group.recent.length > 0 && (
        <section>
          <h3>Recent</h3>
          {list(group.recent)}
        </section>
      )}
      {rename && (
        <Dialog
          title="Rename chat"
          onClose={() => void closeRename()}
          actions={
            <>
              <Button disabled={busy} onClick={() => void closeRename()}>
                Cancel
              </Button>
              <Button
                variant="primary"
                busy={busy}
                disabled={!name.trim() || name === rename.title}
                onClick={() => void mutate(rename, "rename")}
              >
                Save name
              </Button>
            </>
          }
        >
          <Field label="Chat name">
            <Input
              maxLength={120}
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          {error && <ErrorNotice message={error} />}
        </Dialog>
      )}
    </Dialog>
  );
}
