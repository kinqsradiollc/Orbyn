import { newId } from "@orbyn/core";
import {
  ArrowUp,
  CalendarDays,
  Ellipsis,
  FolderOpen,
  ListChecks,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Square,
  User,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { client } from "../../lib/session";
import { useNavigate, useSearch, useTitle } from "../../lib/router";
import {
  Button,
  ErrorNotice,
  IconButton,
  Loading,
  Menu,
  TextArea,
  useConfirm,
} from "../../ui/kit";
import { Character } from "../agents-shared/Character";
import { useOwner, useOwned, useControls } from "../agents-shared/hooks";
import { useTasks } from "../shared-task";
import { ChatList } from "./ChatList";
import { ChatRail } from "./ChatRail";
import { SavedHistory } from "./History";
import { PersonalIdentity } from "./PersonalIdentity";
import { Transcript } from "./Transcript";
import { Upcoming } from "./Upcoming";
import { Waiting } from "./Waiting";
import { useAssistant } from "./useAssistant";
import { timezone, useRead } from "./state";
import "./assistant.css";

const RAIL_KEY = "orbyn.assistant.rail";
// On a narrow screen the rail covers the chat, so it starts closed there.
const narrow = () =>
  typeof matchMedia === "function" && matchMedia("(max-width: 760px)").matches;
function savedRail() {
  if (narrow()) return false;
  try {
    return localStorage.getItem(RAIL_KEY) !== "hidden";
  } catch {
    return true;
  }
}

/** Starters follow the chat's scope, so they never ask beyond what it can see. */
function suggestionsFor(scope: { kind: string; name: string } | null) {
  if (!scope)
    return [
      "What needs my attention today?",
      "Help me plan this week",
      "What should I study next?",
    ];
  if (scope.kind === "task")
    return [
      `Help me finish ${scope.name}`,
      `Break ${scope.name} into steps`,
      `What is blocking ${scope.name}?`,
    ];
  return [
    `What's blocking ${scope.name}?`,
    `What should I do next in ${scope.name}?`,
    `Summarize progress on ${scope.name}`,
  ];
}

export default function AssistantScreen() {
  const owner = useOwner();
  useTitle("Assistant");
  return <AssistantWorkspace key={owner} />;
}
type EmbeddedAssistant = {
  projectId: string;
  query: string;
  collapsed: boolean;
  disabled: boolean;
  onChat: (id: string) => void;
  onBusy: (busy: boolean) => void;
};

export function AssistantWorkspace({
  embedded,
}: { embedded?: EmbeddedAssistant } = {}) {
  const instanceId = useId();
  const messageId = embedded
    ? `project-message-${instanceId}`
    : "assistant-message";
  const limitId = embedded ? `project-limit-${instanceId}` : "assistant-limit";
  const tasks = useTasks();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const owned = useOwned(),
    routeQuery = useSearch(),
    query = embedded?.query ?? routeQuery,
    assistant = useAssistant(
      query,
      embedded && {
        onChat: embedded.onChat,
        retainPath: `/app/project/${embedded.projectId}`,
        disabled: embedded.disabled,
      },
    ),
    projects = useRead(() => client.listProjects()),
    prefs = useRead(() => client.getPlannerPrefs()),
    capabilities = useRead(() => client.aiCapabilities()),
    identity = useRead(() => client.agentSettings({ fresh: true }));
  const {
    state: controls,
    set: control,
    refresh: refreshControls,
    deliveryAvailable,
    deliveryError,
    refreshDelivery,
  } = useControls(true);
  const [panel, setPanel] = useState<"chats" | "history" | "identity" | null>(
      null,
    ),
    [rail, setRail] = useState(savedRail),
    [upcoming, setUpcoming] = useState(
      () => new URLSearchParams(query).get("panel") === "upcoming",
    );
  useEffect(() => {
    embedded?.onBusy(assistant.sending);
  }, [embedded?.onBusy, assistant.sending]);
  useEffect(() => {
    setUpcoming(new URLSearchParams(query).get("panel") === "upcoming");
  }, [query]);
  const toggleRail = () => {
    const next = !rail;
    setRail(next);
    if (narrow()) return;
    try {
      localStorage.setItem(RAIL_KEY, next ? "shown" : "hidden");
    } catch {
      // The choice still applies for this visit.
    }
  };
  const openChat = (id: string) => {
    if (!owned()) return;
    if (assistant.sending) {
      assistant.setError(
        "This run is still attached. Wait for it to finish or request cancellation before changing chats.",
      );
      return;
    }
    setPanel(null);
    setUpcoming(false);
    if (embedded) {
      embedded.onChat(id);
      return;
    }
    if (narrow()) setRail(false);
    navigate(`/app/assistant?chat=${encodeURIComponent(id)}`);
  };
  const closeUpcoming = () => {
    if (!owned()) return;
    const next = new URLSearchParams(query);
    next.delete("panel");
    setUpcoming(false);
    navigate(`/app/assistant${next.size ? `?${next}` : ""}`, true);
  };
  const openUpcoming = () => {
    if (!owned()) return;
    setUpcoming(true);
    const next = new URLSearchParams(query);
    next.set("panel", "upcoming");
    navigate(`/app/assistant?${next}`);
  };
  const newChat = () => {
    if (!owned() || assistant.sending) return;
    navigate(`/app/assistant?${new URLSearchParams({ fresh: newId() })}`);
  };
  // A scope is chosen only before the first message; each choice opens a new chat.
  const chooseScope = (id: string) => {
    if (!owned() || assistant.sending || assistant.display.length) return;
    navigate(
      id
        ? `/app/assistant?project=${encodeURIComponent(id)}`
        : `/app/assistant?${new URLSearchParams({ fresh: newId() })}`,
    );
  };
  const stopRun = async () => {
    if (!owned() || !assistant.progress) return;
    if (
      !(await confirm({
        title: "Stop this run?",
        body: "Cancellation is requested; already applied changes remain.",
        action: "Request stop",
        danger: true,
      }))
    )
      return;
    try {
      await assistant.runAction("stop");
    } catch {
      if (owned())
        assistant.setError("Couldn't request a stop. Retry in a moment.");
    }
  };
  const overLimit = assistant.message.trim().length > 4000;
  const scopeDisabled = embedded
    ? embedded.disabled
    : !!assistant.scope?.disabled;
  const disabled =
    overLimit ||
    assistant.loading ||
    !assistant.ready ||
    assistant.sending ||
    scopeDisabled ||
    !!assistant.replyError ||
    (!!assistant.reply && !assistant.replyEntry);
  const zone = prefs.data?.timezone ?? timezone();
  const started = assistant.display.length > 0;
  const scopeName = assistant.scope
    ? `${assistant.scope.kind === "task" ? "Task" : "Project"} · ${assistant.scope.name}`
    : "Personal";
  const suggestions = suggestionsFor(assistant.scope);
  const personal = assistant.conversation.destination?.personal
    ? (assistant.chat?.id ?? null)
    : null;
  const scopePicker = (
    <section className="assistant-empty">
      <h2>What would you like to work on?</h2>
      <p className="muted">
        Choose what this chat can see. It stays fixed once you send.
      </p>
      <div className="assistant-scopes" role="group" aria-label="Chat scope">
        <button
          type="button"
          aria-pressed={!assistant.scope}
          disabled={assistant.sending}
          onClick={() => assistant.scope && chooseScope("")}
        >
          <User aria-hidden="true" />
          Personal
        </button>
        {assistant.scope?.kind === "task" && (
          <span className="assistant-scope-current">
            <ListChecks aria-hidden="true" />
            <span dir="auto">{assistant.scope.name}</span>
          </span>
        )}
        {projects.data?.map((project) => (
          <button
            key={project.id}
            type="button"
            aria-pressed={
              assistant.scope?.kind === "project" &&
              assistant.scope.id === project.id
            }
            disabled={assistant.sending || project.assistant_off}
            title={
              project.assistant_off
                ? "Assistant access is off for this project"
                : undefined
            }
            onClick={() =>
              !(
                assistant.scope?.kind === "project" &&
                assistant.scope.id === project.id
              ) && chooseScope(project.id)
            }
          >
            <FolderOpen aria-hidden="true" />
            <span dir="auto">{project.name}</span>
          </button>
        ))}
      </div>
      <p className="small muted">
        {assistant.scope
          ? `Only ${assistant.scope.name} and its linked work.`
          : "Your own tasks, calendar, notes and study."}
      </p>
    </section>
  );
  const Container = embedded ? "div" : "main";
  return (
    <Container
      className="assistant-workspace"
      data-rail={!embedded && rail ? "open" : "closed"}
    >
      {!embedded && rail && (
        <ChatRail
          personal={personal}
          active={assistant.chat?.id ?? null}
          disabled={assistant.sending}
          onOpen={openChat}
          onManage={() => setPanel("chats")}
          onHide={toggleRail}
        />
      )}
      <div className="assistant-main">
        <header className="assistant-header" hidden={!!embedded}>
          <IconButton
            label={rail ? "Hide saved chats" : "Show saved chats"}
            aria-expanded={rail}
            onClick={toggleRail}
          >
            {rail ? (
              <PanelLeftClose aria-hidden="true" />
            ) : (
              <PanelLeftOpen aria-hidden="true" />
            )}
          </IconButton>
          <Character
            appearance={identity.data?.character}
            name={identity.data?.name ?? "Assistant"}
            state={
              assistant.progress?.state === "waiting"
                ? "waiting"
                : assistant.sending
                  ? "working"
                  : "ready"
            }
            size={32}
          />
          <div className="assistant-title">
            <h1>Assistant</h1>
            <p className="muted" dir="auto">
              {assistant.sending
                ? assistant.progress?.state === "waiting"
                  ? "Waiting for you"
                  : "Working…"
                : started
                  ? scopeName
                  : "New chat"}
            </p>
          </div>
          {started && (
            <span
              className="assistant-scope-lock"
              title="Scope is fixed for this chat. Start a new chat to change it."
            >
              <Lock aria-hidden="true" />
              <span dir="auto">{scopeName}</span>
            </span>
          )}
          {assistant.scope?.kind === "task" && (
            <Button
              variant="ghost"
              onClick={() => owned() && tasks.open(assistant.scope!.id)}
            >
              Open task
            </Button>
          )}
          <Button onClick={openUpcoming}>
            <CalendarDays aria-hidden="true" />
            Upcoming
          </Button>
          <IconButton
            label="New chat"
            disabled={assistant.sending}
            onClick={newChat}
          >
            <Plus aria-hidden="true" />
          </IconButton>
          <Menu
            label="Assistant options"
            trigger={(show, expanded) => (
              <IconButton
                label="More"
                aria-expanded={expanded}
                aria-haspopup="menu"
                onClick={show}
              >
                <Ellipsis aria-hidden="true" />
              </IconButton>
            )}
          >
            {(close) => (
              <>
                <button
                  role="menuitem"
                  onClick={() => {
                    close();
                    setPanel("chats");
                  }}
                >
                  Search and manage chats
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    close();
                    setPanel("identity");
                  }}
                >
                  Name and character
                </button>
                {assistant.canonicalEnabled &&
                  assistant.chat?.has_legacy_history &&
                  assistant.chat.legacy_history_destination_id && (
                    <button
                      role="menuitem"
                      onClick={() => {
                        close();
                        setPanel("history");
                      }}
                    >
                      Previous saved history
                    </button>
                  )}
                <button
                  role="menuitem"
                  onClick={() => {
                    close();
                    if (owned()) navigate("/app/background");
                  }}
                >
                  Background
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    close();
                    if (owned()) navigate("/app/overnight");
                  }}
                >
                  Overnight
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    close();
                    if (owned()) navigate("/app/review");
                  }}
                >
                  Review
                </button>
                {controls.data && deliveryAvailable === true && (
                  <button
                    role="menuitemcheckbox"
                    aria-checked={controls.data.muted}
                    disabled={controls.busy}
                    onClick={() => void control("muted", !controls.data!.muted)}
                  >
                    Mute delivery notifications
                  </button>
                )}
              </>
            )}
          </Menu>
        </header>
        <div className="assistant-notices">
          {controls.error && (
            <ErrorNotice
              message="Couldn't load notification preferences."
              onRetry={() => void refreshControls()}
            />
          )}
          {!embedded && deliveryError && (
            <ErrorNotice
              message={deliveryError}
              onRetry={() => void refreshDelivery()}
            />
          )}
          {!embedded && deliveryAvailable === false && (
            <p role="status" className="small muted">
              Conversation notifications are unavailable on this server.
            </p>
          )}
          {projects.error && (
            <ErrorNotice
              message={projects.error}
              onRetry={() => void projects.reload()}
            />
          )}
          {assistant.error && (
            <ErrorNotice
              message={assistant.error}
              onRetry={assistant.sending ? undefined : assistant.reload}
            />
          )}
          {capabilities.error && (
            <ErrorNotice
              message={capabilities.error}
              onRetry={() => void capabilities.reload()}
            />
          )}
          {capabilities.data && !capabilities.data.enabled && (
            <p role="status" className="small muted">
              No AI connection is available. Manual goals, routines and saved
              history remain accessible.
            </p>
          )}
          {assistant.loading && <Loading label="Opening conversation" />}
          {assistant.projectUncertain && (
            <p role="status">
              A project draft is awaiting confirmation. Drafting another project
              is blocked.{" "}
              <Button onClick={() => owned() && navigate("/app/review")}>
                Check Review
              </Button>
            </p>
          )}
          {scopeDisabled && (
            <p role="status">
              Assistant access is off for this project. Choose another scope or
              change its project settings.
            </p>
          )}
        </div>
        <Transcript
          assistant={assistant}
          timezone={zone}
          onOpenChat={openChat}
          covered={!!panel || upcoming || !!embedded?.collapsed}
          emptyState={
            embedded ? (
              <section className="assistant-empty">
                <h2>Ask about this project</h2>
                <p className="muted">
                  Tasks, pages and linked work in{" "}
                  {assistant.scope?.name ?? "this project"}.
                </p>
              </section>
            ) : (
              scopePicker
            )
          }
        />
        <div className="assistant-dock">
          {assistant.progress?.state === "waiting" && (
            <Waiting
              key={`${assistant.progress.job_id}:${assistant.progress.waiting?.id ?? "run"}`}
              progress={assistant.progress}
              act={assistant.runAction}
            />
          )}
          {assistant.failedAnswers.map((failed) => (
            <section key={failed.id} className="assistant-waiting">
              <p role="alert">
                An answer could not be confirmed. Your original text is
                retained.
              </p>
              <Button
                disabled={!assistant.waiting.canRestore(failed.id)}
                onClick={() => assistant.waiting.restore(failed.id)}
              >
                Restore failed answer
              </Button>
            </section>
          ))}
          {!assistant.sending && !assistant.message && (
            <div className="assistant-suggestions" aria-label="Suggestions">
              {suggestions.map((text) => (
                <button
                  key={text}
                  type="button"
                  dir="auto"
                  disabled={disabled}
                  onClick={() => void assistant.send(text)}
                >
                  {text}
                </button>
              ))}
            </div>
          )}
          <form
            className="assistant-composer"
            onSubmit={(e) => {
              e.preventDefault();
              if (!disabled) void assistant.send();
            }}
          >
            {assistant.reply && (
              <section className="assistant-reply-target">
                <strong>
                  {assistant.replyEntry?.kind === "update" &&
                  assistant.replyEntry.event === "question"
                    ? "Answering a retained question"
                    : "Replying to a message"}
                </strong>
                {assistant.canonicalEnabled && assistant.reply.excerpt && (
                  <blockquote dir="auto">{assistant.reply.excerpt}</blockquote>
                )}
                {assistant.replyError && (
                  <ErrorNotice
                    message={assistant.replyError}
                    onRetry={assistant.reload}
                  />
                )}
                {!assistant.replyEntry && !assistant.replyError && (
                  <p role="status">Checking reply access…</p>
                )}
                <Button
                  variant="ghost"
                  disabled={assistant.sending}
                  onClick={() => assistant.setReply(null)}
                >
                  Cancel reply
                </Button>
              </section>
            )}
            <label className="sr-only" htmlFor={messageId}>
              {assistant.scope
                ? `Message about ${assistant.scope.name}`
                : "Message your assistant"}
            </label>
            <TextArea
              id={messageId}
              rows={1}
              maxLength={4000}
              value={assistant.message}
              disabled={assistant.loading || !assistant.ready || scopeDisabled}
              placeholder={
                assistant.scope
                  ? `Message about ${assistant.scope.name}`
                  : "Message your assistant"
              }
              aria-invalid={overLimit || undefined}
              aria-describedby={overLimit ? limitId : undefined}
              onChange={(e) => assistant.setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  if (!disabled) void assistant.send();
                }
              }}
            />
            <div className="assistant-compose-actions">
              {!assistant.scope && (
                <Button
                  variant="ghost"
                  disabled={
                    disabled ||
                    assistant.projectUncertain ||
                    !assistant.message.trim() ||
                    capabilities.data?.tools === false
                  }
                  onClick={() => void assistant.send(undefined, true)}
                >
                  Draft project
                </Button>
              )}
              {assistant.message.length > 3500 && (
                <span
                  id={limitId}
                  className={`small ${overLimit ? "assistant-over" : "muted"}`}
                >
                  {overLimit
                    ? "Keep the message within 4,000 characters. All your text is retained."
                    : `${assistant.message.length}/4,000`}
                </span>
              )}
              <span className="assistant-compose-gap" />
              {assistant.sending ? (
                <IconButton
                  label="Stop"
                  variant="primary"
                  className="assistant-send"
                  disabled={
                    !assistant.progress ||
                    assistant.progress.label?.startsWith(
                      "Cancellation requested",
                    )
                  }
                  onClick={() => void stopRun()}
                >
                  <Square aria-hidden="true" />
                </IconButton>
              ) : (
                <IconButton
                  label="Send"
                  type="submit"
                  variant="primary"
                  className="assistant-send"
                  disabled={disabled || !assistant.message.trim()}
                >
                  <ArrowUp aria-hidden="true" />
                </IconButton>
              )}
            </div>
          </form>
          <p className="assistant-footnote">
            Proposed changes wait for your review or your existing permissions.
          </p>
        </div>
      </div>
      {panel === "chats" && (
        <ChatList
          personal={personal}
          active={assistant.chat?.id ?? null}
          onOpen={openChat}
          onClose={() => owned() && setPanel(null)}
        />
      )}
      {panel === "history" &&
        assistant.canonicalEnabled &&
        assistant.chat?.legacy_history_destination_id && (
          <SavedHistory
            destination={assistant.chat.legacy_history_destination_id}
            chat={assistant.chat.id}
            onClose={() => owned() && setPanel(null)}
          />
        )}
      {panel === "identity" && (
        <PersonalIdentity
          onClose={() => owned() && setPanel(null)}
          onSaved={() => void identity.reload()}
        />
      )}
      {upcoming && <Upcoming onClose={closeUpcoming} onOpenChat={openChat} />}
    </Container>
  );
}
