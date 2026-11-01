import { newId } from "@orbyn/core";
import { CalendarDays, History, Plus, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { client } from "../../lib/session";
import { navigate, useSearch, useTitle } from "../../lib/router";
import {
  Button,
  ErrorNotice,
  Field,
  Input,
  Loading,
  SelectBox,
  TextArea,
} from "../../ui/kit";
import { Character } from "../agents-shared/Character";
import { useOwner, useOwned, useControls } from "../agents-shared/hooks";
import { More } from "../agents-shared/parts";
import { tasks } from "../shared-task";
import { ChatList } from "./ChatList";
import { SavedHistory } from "./History";
import { PersonalIdentity } from "./PersonalIdentity";
import { Transcript } from "./Transcript";
import { Upcoming } from "./Upcoming";
import { Waiting } from "./Waiting";
import { useAssistant } from "./useAssistant";
import { timezone, useRead } from "./state";
import "./assistant.css";

export default function AssistantScreen() {
  const owner = useOwner();
  useTitle("Assistant");
  return <AssistantWorkspace key={owner} />;
}
function AssistantWorkspace() {
  const owned = useOwned(),
    query = useSearch(),
    assistant = useAssistant(query),
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
    [upcoming, setUpcoming] = useState(
      () => new URLSearchParams(query).get("panel") === "upcoming",
    );
  useEffect(() => {
    setUpcoming(new URLSearchParams(query).get("panel") === "upcoming");
  }, [query]);
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
    const next = new URLSearchParams({ fresh: newId() });
    if (assistant.scope) next.set(assistant.scope.kind, assistant.scope.id);
    navigate(`/app/assistant?${next}`);
  };
  const scopedProject = (id: string) => {
    if (!owned() || assistant.sending) return;
    navigate(
      id
        ? `/app/assistant?project=${encodeURIComponent(id)}`
        : "/app/assistant",
    );
  };
  const overLimit = assistant.message.trim().length > 4000;
  const disabled =
    overLimit ||
    assistant.loading ||
    !assistant.ready ||
    assistant.sending ||
    !!assistant.scope?.disabled ||
    !!assistant.replyError ||
    (!!assistant.reply && !assistant.replyEntry);
  const zone = prefs.data?.timezone ?? timezone();
  return (
    <main className="assistant-workspace">
      <header className="assistant-header">
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
          size={52}
        />
        <div className="assistant-title">
          <h1>Assistant</h1>
          <p className="muted">
            {assistant.scope?.name ?? "Personal conversation"}
          </p>
        </div>
        <div className="agents-buttons">
          <Button disabled={assistant.sending} onClick={newChat}>
            <Plus />
            New chat
          </Button>
          <Button
            disabled={assistant.sending}
            onClick={() => setPanel("chats")}
          >
            <History />
            Saved chats
          </Button>
          <Button onClick={openUpcoming}>
            <CalendarDays />
            Upcoming
          </Button>
        </div>
      </header>
      <div className="assistant-toolbar">
        <Field label="Project scope">
          <SelectBox
            value={
              assistant.scope?.kind === "project" ? assistant.scope.id : ""
            }
            disabled={assistant.sending || projects.loading}
            onChange={(e) => scopedProject(e.target.value)}
          >
            <option value="">Personal</option>
            {projects.data?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
                {project.assistant_off ? " · Assistant off" : ""}
              </option>
            ))}
          </SelectBox>
        </Field>
        {assistant.scope?.kind === "task" && (
          <Button onClick={() => owned() && tasks.open(assistant.scope!.id)}>
            Open task
          </Button>
        )}
        <More summary="Activity and preferences">
          <div className="agents-buttons">
            <Button onClick={() => owned() && navigate("/app/background")}>
              Background
            </Button>
            <Button onClick={() => owned() && navigate("/app/overnight")}>
              Overnight
            </Button>
            <Button onClick={() => owned() && navigate("/app/review")}>
              Review
            </Button>
            <Button onClick={() => setPanel("identity")}>
              <Settings2 />
              Name and character
            </Button>
            {assistant.canonicalEnabled &&
              assistant.chat?.has_legacy_history &&
              assistant.chat.legacy_history_destination_id && (
                <Button onClick={() => setPanel("history")}>
                  Previous saved history
                </Button>
              )}
          </div>
          {controls.error && (
            <ErrorNotice
              message="Couldn't load notification preferences."
              onRetry={() => void refreshControls()}
            />
          )}{" "}
          {deliveryError && (
            <ErrorNotice
              message={deliveryError}
              onRetry={() => void refreshDelivery()}
            />
          )}
          {deliveryAvailable === false && (
            <p className="small muted">
              Conversation notifications are unavailable on this server.
            </p>
          )}
          {controls.data && deliveryAvailable === true && (
            <label className="check">
              <input
                type="checkbox"
                disabled={controls.busy}
                checked={controls.data.muted}
                onChange={(e) => void control("muted", e.target.checked)}
              />
              Mute Assistant delivery notifications
            </label>
          )}
        </More>
      </div>
      {projects.error && (
        <ErrorNotice
          message={projects.error}
          onRetry={() => void projects.reload()}
        />
      )}{" "}
      {assistant.error && (
        <ErrorNotice
          message={assistant.error}
          onRetry={assistant.sending ? undefined : assistant.reload}
        />
      )}{" "}
      {assistant.loading && <Loading label="Opening conversation" />}
      {assistant.projectUncertain && (
        <p role="status">
          A project draft is awaiting confirmation. Drafting another project is
          blocked.{" "}
          <Button onClick={() => owned() && navigate("/app/review")}>
            Check Review
          </Button>
        </p>
      )}
      {assistant.scope?.disabled && (
        <p role="status">
          Assistant access is off for this project. Choose another scope or
          change its project settings.
        </p>
      )}
      <Transcript
        assistant={assistant}
        timezone={zone}
        onOpenChat={openChat}
        covered={!!panel || upcoming}
      />
      {assistant.progress && (
        <Waiting
          key={`${assistant.progress.job_id}:${assistant.progress.waiting?.id ?? "run"}`}
          progress={assistant.progress}
          act={assistant.runAction}
        />
      )}
      {assistant.failedAnswers.map((failed) => (
        <section key={failed.id}>
          <p role="alert">
            An answer could not be confirmed. Your original text is retained.
          </p>
          <Button
            disabled={!assistant.waiting.canRestore(failed.id)}
            onClick={() => assistant.waiting.restore(failed.id)}
          >
            Restore failed answer
          </Button>
        </section>
      ))}
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
            )}{" "}
            {assistant.replyError && (
              <ErrorNotice
                message={assistant.replyError}
                onRetry={assistant.reload}
              />
            )}{" "}
            {!assistant.replyEntry && !assistant.replyError && (
              <p role="status">Checking reply access…</p>
            )}
            <Button
              disabled={assistant.sending}
              onClick={() => assistant.setReply(null)}
            >
              Cancel reply
            </Button>
          </section>
        )}
        <Field
          error={
            overLimit
              ? "Keep the message within 4,000 characters. All your text is retained."
              : undefined
          }
          label={
            assistant.scope
              ? `Message about ${assistant.scope.name}`
              : "Message your assistant"
          }
        >
          <TextArea
            rows={3}
            maxLength={4000}
            value={assistant.message}
            disabled={
              assistant.loading ||
              !assistant.ready ||
              !!assistant.scope?.disabled
            }
            placeholder="Ask or describe the work you want to review"
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
        </Field>
        <div className="assistant-compose-actions">
          <span className="muted small">
            {assistant.message.length}/4,000 · Text only
          </span>
          <div className="agents-buttons">
            {!assistant.scope && (
              <Button
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
            <Button
              type="submit"
              variant="primary"
              busy={assistant.sending}
              disabled={disabled || !assistant.message.trim()}
            >
              Send
            </Button>
          </div>
        </div>
        <More summary="Provider and scope">
          {capabilities.loading ? (
            <p role="status">Checking assistant availability…</p>
          ) : capabilities.error ? (
            <ErrorNotice
              message={capabilities.error}
              onRetry={() => void capabilities.reload()}
            />
          ) : (
            <p>
              {capabilities.data?.enabled
                ? "Uses your configured Orbyn AI connection."
                : "No AI connection is available. Manual goals, routines and saved history remain accessible."}
            </p>
          )}
          <p>
            Scope:{" "}
            {assistant.scope
              ? `${assistant.scope.kind} · ${assistant.scope.name}`
              : "your permitted personal context"}
            . Proposed changes wait for review or your existing permissions.
          </p>
        </More>
      </form>
      {panel === "chats" && (
        <ChatList
          personal={
            assistant.conversation.destination?.personal
              ? (assistant.chat?.id ?? null)
              : null
          }
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
    </main>
  );
}
