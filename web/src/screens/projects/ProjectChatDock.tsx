import { newId, type Project } from "@orbyn/core";
import { ArrowUpRight, MessageSquare, Minus, Plus } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "../../lib/router";
import { Button, ErrorNotice, IconButton, useToast } from "../../ui/kit";
import { AssistantWorkspace } from "../assistant";
import { Chats } from "./Chats";
import "./project-chat-dock.css";

export type ProjectChatRequest = { id: string; chatId?: string; ask?: string };

/** Each visited project keeps its mounted conversation and drafts in the shell. */
export function ProjectChatDock({
  project,
  request,
  open,
  onClose,
  onBusyChange,
  picker,
  unavailable,
  projectError,
  onRefreshProjects,
}: {
  project: Project;
  request: ProjectChatRequest | null;
  open: boolean;
  onClose: () => void;
  onBusyChange: (projectId: string, busy: boolean) => void;
  picker: ReactNode;
  unavailable: boolean;
  projectError: string;
  onRefreshProjects: () => void;
}) {
  const navigate = useNavigate();
  const panelId = useId();
  const toast = useToast();
  const [query, setQuery] = useState(() =>
    new URLSearchParams({ project: project.id }).toString(),
  );
  const [chats, setChats] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const handled = useRef<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  const onBusy = useCallback(
    (value: boolean) => {
      busyRef.current = value;
      setBusy(value);
      onBusyChange(project.id, value);
    },
    [onBusyChange, project.id],
  );
  useEffect(
    () => () => onBusyChange(project.id, false),
    [onBusyChange, project.id],
  );
  const onChat = useCallback(
    (id: string) => {
      setQuery(
        new URLSearchParams({ project: project.id, chat: id }).toString(),
      );
    },
    [project.id],
  );

  useEffect(() => {
    if (!request || handled.current === request.id) return;
    handled.current = request.id;
    if (busyRef.current) {
      toast({
        text: "This chat is still working. Stop the run before changing chats.",
      });
      return;
    }
    const next = new URLSearchParams({ project: project.id });
    if (request.chatId) next.set("chat", request.chatId);
    else next.set("fresh", request.id);
    if (request.ask) next.set("ask", request.ask);
    setQuery(next.toString());
  }, [project.id, request, toast]);

  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);
  const newChat = () => {
    if (busyRef.current) return;
    setQuery(
      new URLSearchParams({ project: project.id, fresh: newId() }).toString(),
    );
  };

  return (
    <>
      <section
        ref={panel}
        id={panelId}
        className="pj-chat-panel"
        aria-label={`Chat about ${project.name}`}
        tabIndex={-1}
        hidden={!open}
        inert={!open}
        onKeyDown={(event) => {
          if (
            event.key !== "Escape" ||
            event.defaultPrevented ||
            (event.target as HTMLElement).closest('[role="dialog"]')
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
      >
        <header className="pj-chat-head">
          <MessageSquare aria-hidden="true" />
          <div className="pj-chat-title">
            <strong>Project chat</strong>
            {picker}
          </div>
          <Button
            variant="ghost"
            disabled={busy || unavailable}
            onClick={() => setChats(true)}
          >
            Chats
          </Button>
          <IconButton
            label="New project chat"
            disabled={busy || unavailable}
            onClick={newChat}
          >
            <Plus aria-hidden="true" />
          </IconButton>
          <IconButton
            label="Open in Assistant"
            disabled={busy || unavailable}
            onClick={() => {
              onClose();
              void navigate(`/app/assistant?${query}`);
            }}
          >
            <ArrowUpRight aria-hidden="true" />
          </IconButton>
          <IconButton label="Collapse project chat" onClick={onClose}>
            <Minus aria-hidden="true" />
          </IconButton>
        </header>
        {(unavailable || projectError) && (
          <div className="pj-chat-status">
            <ErrorNotice
              message={
                unavailable
                  ? "This project is no longer available. Choose another project."
                  : "Couldn't refresh projects. Your chat is retained."
              }
              onRetry={onRefreshProjects}
            />
          </div>
        )}
        <div
          className="pj-chat-session-presentation"
          hidden={unavailable}
          inert={unavailable}
        >
          <AssistantWorkspace
            embedded={{
              projectId: project.id,
              query,
              collapsed: !open || chats || unavailable,
              disabled: !!project.assistant_off || unavailable,
              onChat,
              onBusy,
            }}
          />
        </div>
      </section>
      {chats && open && !unavailable && (
        <Chats
          projectId={project.id}
          onClose={() => setChats(false)}
          onOpen={(id, scope) => {
            if (busyRef.current) return;
            setChats(false);
            if (scope?.kind !== "project" || scope.id !== project.id) {
              onClose();
              void navigate(`/app/assistant?chat=${encodeURIComponent(id)}`);
              return;
            }
            onChat(id);
          }}
        />
      )}
    </>
  );
}
