import { AssistantSavedHistoryStore } from "@orbyn/api-client";
import type { AssistantConversationEntry } from "@orbyn/core";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { client, getSessionVersion } from "../../lib/session";
import { useNavigate } from "../../lib/router";
import { Button, Dialog, ErrorNotice, Loading } from "../../ui/kit";
import { onForeground, useOwned } from "../agents-shared/hooks";
import { Evidence, More } from "../agents-shared/parts";
import { ReplyText } from "../agents-shared/ReplyText";
import {
  nightRunsInOrder,
  nightRunWords,
  updateWords,
} from "../agents-shared/words";
import { useTasks } from "../shared-task";
import { useRead } from "./state";

export function MessageDetails({
  destination,
  entry,
  onClose,
  onOpenChat,
}: {
  destination: string;
  entry: AssistantConversationEntry;
  onClose: () => void;
  onOpenChat: (id: string) => void;
}) {
  const tasks = useTasks();
  const navigate = useNavigate();
  const owned = useOwned(),
    lock = useRef(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const read = useRead(
    () => client.assistantConversationDetails(destination, entry.id),
    [destination, entry.id, entry.revision],
  );
  const value = read.data?.entry;
  const stop = async () => {
    if (
      !owned() ||
      lock.current ||
      !value ||
      value.kind !== "update" ||
      value.work.kind !== "job" ||
      value.actionable === false
    )
      return;
    lock.current = true;
    setPending(true);
    try {
      await client.stopAssistantRun(value.work.id);
      if (owned()) {
        setError(
          "Cancellation requested. Check current work for its final status.",
        );
        await read.reload();
      }
    } catch {
      if (owned())
        setError("Couldn't confirm cancellation. Reload before trying again.");
    } finally {
      lock.current = false;
      if (owned()) setPending(false);
    }
  };
  return (
    <Dialog
      title="Message details"
      wide
      onClose={() => !pending && owned() && onClose()}
      actions={
        <Button disabled={pending} onClick={onClose}>
          Close
        </Button>
      }
    >
      {read.loading && <Loading label="Loading authorized message details" />}
      {read.error && (
        <ErrorNotice message={read.error} onRetry={() => void read.reload()} />
      )}
      {error && <p role="status">{error}</p>}
      {value && (
        <>
          <p className="muted small">
            Delivered {new Date(value.created_at).toLocaleString()} · Updated{" "}
            {new Date(value.updated_at).toLocaleString()}
          </p>
          {value.kind === "turn" ? (
            <>
              <ReplyText text={value.turn.text} />
              {value.turn.execution_outcome && (
                <Evidence receipt={value.turn.execution_outcome} />
              )}
            </>
          ) : (
            <>
              <h3>{updateWords(value)}</h3>
              <ReplyText text={value.text} />
              {value.completed_at && (
                <p className="muted small">
                  Completed {new Date(value.completed_at).toLocaleString()}
                </p>
              )}
              <div className="agents-buttons">
                {value.execution_chat_id && (
                  <Button
                    onClick={() =>
                      owned() && onOpenChat(value.execution_chat_id!)
                    }
                  >
                    View work
                  </Button>
                )}
                <Button
                  onClick={() => owned() && navigate(`/app/${value.lane}`)}
                >
                  Open {value.lane} activity
                </Button>
                {value.actionable !== false &&
                  value.event === "question" &&
                  value.work.kind === "job" && (
                    <Button
                      variant="danger"
                      disabled={pending}
                      onClick={() => void stop()}
                    >
                      Stop waiting run
                    </Button>
                  )}
              </div>
              {nightRunsInOrder(value).map((run) => (
                <section key={`${run.work.kind}:${run.work.id}`}>
                  <strong>{nightRunWords[run.state]}</strong>
                  <ReplyText text={run.text} />
                  <Button
                    onClick={() =>
                      owned() &&
                      navigate(
                        `/app/${run.work.kind === "page_run" ? "overnight" : "background"}`,
                      )
                    }
                  >
                    Open activity
                  </Button>
                </section>
              ))}
            </>
          )}
          <More summary="Authorized sources" open>
            {read.data?.sources.length === 0 && <p>No sources available.</p>}
            {read.data?.sources.map((source) => (
              <Button
                key={`${source.kind}:${source.id}`}
                onClick={() => {
                  if (!owned()) return;
                  if (source.kind === "task") tasks.open(source.id);
                  else
                    navigate(
                      `/app/${source.kind === "doc" ? "doc" : "project"}/${encodeURIComponent(source.id)}`,
                    );
                }}
              >
                {source.title || "Untitled"}
              </Button>
            ))}
          </More>
        </>
      )}
    </Dialog>
  );
}
export function SavedHistory({
  destination,
  chat,
  onClose,
}: {
  destination: string;
  chat: string;
  onClose: () => void;
}) {
  const owned = useOwned();
  const [store] = useState(
    () =>
      new AssistantSavedHistoryStore(
        client,
        destination,
        chat,
        getSessionVersion,
      ),
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot),
    scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void store.refresh();
    const validate = () => {
      if (owned() && !document.hidden) void store.validate();
    };
    const fg = onForeground(validate),
      timer = setInterval(validate, 15000);
    return () => {
      fg();
      clearInterval(timer);
      store.reset();
    };
  }, [store, owned]);
  const earlier = async () => {
    if (!owned()) return;
    const node = scroll.current,
      height = node?.scrollHeight ?? 0,
      top = node?.scrollTop ?? 0;
    await store.loadEarlier();
    if (!owned()) return;
    requestAnimationFrame(() => {
      if (owned() && node?.isConnected)
        node.scrollTop = top + node.scrollHeight - height;
    });
  };
  return (
    <Dialog
      title="Previous saved history"
      wide
      onClose={onClose}
      actions={<Button onClick={onClose}>Close</Button>}
    >
      <p className="muted">
        Read-only history from before the retained conversation. It does not
        mark messages read or become model context.
      </p>
      {state.error && (
        <ErrorNotice
          message="This saved history changed or is unavailable. Reload its current version."
          onRetry={() => void store.refresh()}
        />
      )}
      <div
        className="assistant-history"
        ref={scroll}
        tabIndex={0}
        role="region"
        aria-label="Saved history"
      >
        {state.before && (
          <Button disabled={state.busy} onClick={() => void earlier()}>
            Earlier saved messages
          </Button>
        )}
        {state.busy && <Loading label="Loading saved history" />}
        {state.turns.map((turn, i) => (
          <section key={`${turn.turn_id ?? i}:${turn.role}`}>
            <strong>{turn.role === "user" ? "You" : "Assistant"}</strong>
            <ReplyText text={turn.text} />
          </section>
        ))}
        {!state.busy && !state.error && !state.turns.length && (
          <p>No previous saved messages.</p>
        )}
      </div>
    </Dialog>
  );
}
