import { useEffect, useRef, useState } from "react";
import {
  publishingContent,
  type PublishingContent,
  type PublishingDraft,
} from "@orbyn/core";
import { client } from "../../lib/session";
import { Button, Field, Input, TextArea } from "../../ui/kit";
import {
  Facts,
  Outcome,
  ReadState,
  Section,
  toIso,
  useAdminLeave,
  useExit,
  useOperation,
  useRead,
} from "./shared";
import { ImageEditor } from "./publishing-image";
type DraftAttempt = {
  kind:
    | "save"
    | "publish"
    | "cancel"
    | "release"
    | "unrelease"
    | "delete"
    | "reset"
    | "suggest";
  identity: string;
  version: number;
  state: PublishingDraft["state"];
  content: PublishingContent;
  at?: string;
};
/** JSON object property order is not content identity; array order remains significant. */
function sameValue(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((v, i) => sameValue(actual[i], v))
    );
  if (expected !== null && typeof expected === "object")
    return (
      actual !== null &&
      typeof actual === "object" &&
      !Array.isArray(actual) &&
      Object.keys(actual).length === Object.keys(expected).length &&
      Object.entries(expected).every(
        ([key, value]) =>
          Object.hasOwn(actual, key) &&
          sameValue(Reflect.get(actual, key), value),
      )
    );
  return Object.is(actual, expected);
}
function matchesReceipt(r: PublishingDraft, a: DraftAttempt, id: string) {
  const parsed = publishingContent.safeParse(r?.content);
  if (
    r?.id !== id ||
    r.version !== a.version + 1 ||
    !parsed.success ||
    !sameValue(parsed.data, a.content)
  )
    return false;
  if (a.kind === "save")
    return (
      ["draft", "failed"].includes(a.state) &&
      r.state === a.state &&
      r.error === null
    );
  if (a.kind === "publish")
    return (
      ["draft", "failed"].includes(a.state) &&
      r.state === "scheduled" &&
      typeof r.scheduled_at === "string" &&
      !!r.scheduled_at &&
      Number.isFinite(Date.parse(r.scheduled_at)) &&
      (!a.at || Date.parse(r.scheduled_at) === Date.parse(a.at)) &&
      r.error === null
    );
  if (a.kind === "cancel")
    return (
      a.state === "scheduled" && r.state === "draft" && r.scheduled_at === null
    );
  if (a.kind === "release") {
    const release = r.release;
    if (
      !release ||
      release.id !== id ||
      !Number.isFinite(Date.parse(release.published_at)) ||
      r.state !== a.state
    )
      return false;
    return sameValue(
      {
        title: release.title,
        summary: release.summary,
        notes: release.notes,
        image: release.image,
        alt_text: release.alt_text,
      },
      {
        title: a.content.title,
        summary: a.content.summary,
        notes: a.content.notes,
        image: a.content.image,
        alt_text: a.content.alt_text,
      },
    );
  }
  if (a.kind === "unrelease") return r.release === null && r.state === a.state;
  if (a.kind === "reset")
    return (
      ["failed", "unknown"].includes(a.state) &&
      r.state === "draft" &&
      r.scheduled_at === null &&
      r.error === null
    );
  return false;
}
export function Publisher() {
  const list = useRead(() => client.publishingList()),
    connection = useRead(() => client.publishingConnection()),
    op = useOperation(),
    leave = useAdminLeave(),
    [id, setId] = useState(""),
    [connectUrl, setConnectUrl] = useState("");
  const ownedIds = useRef(new Set<string>());
  useEffect(() => {
    if (list.data) ownedIds.current = new Set(list.data.map((d) => d.id));
  }, [list.data]);
  return (
    <>
      <Section title="Publishing connection">
        <ReadState read={connection}>
          <Facts value={connection.data} />
          <div className="admin-actions">
            <Button
              disabled={op.blocked || !connection.data?.configured}
              onClick={() =>
                void op.run(
                  () => client.publishingConnect(),
                  (r) => {
                    const url = new URL(r.url);
                    if (url.protocol !== "https:")
                      throw new Error("Connection URL is invalid.");
                    setConnectUrl(url.href);
                  },
                  {
                    title: "Prepare external publishing connection?",
                    body: "Creates a company-page authorization link. Continue only if authorized to manage the organization.",
                    action: "Prepare connection",
                  },
                )
              }
            >
              {connection.data?.connected
                ? "Renew connection"
                : "Connect organization"}
            </Button>
            <Button
              disabled={op.blocked || !connection.data?.connected}
              onClick={() =>
                void op.run(
                  () => client.publishingDisconnect(),
                  () => {
                    setConnectUrl("");
                    void connection.reload();
                    void list.reload();
                  },
                  {
                    title: "Disconnect publishing?",
                    body: "Queued posts are cancelled. Already published external posts stay published.",
                    action: "Disconnect",
                    danger: true,
                  },
                )
              }
            >
              Disconnect
            </Button>
            <Button onClick={() => void connection.reload()}>
              Refresh connection
            </Button>
          </div>
          {connectUrl && (
            <a href={connectUrl} target="_blank" rel="noreferrer">
              Continue external authorization
            </a>
          )}
        </ReadState>
        <Outcome op={op} />
      </Section>
      <Section title="Updates and announcements">
        <Button
          disabled={op.blocked}
          onClick={() =>
            void leave().then((ok) => {
              if (ok && op.owned())
                void op.run(
                  () => client.publishingCreate(),
                  (r) => {
                    if (!r.id || ownedIds.current.has(r.id) || r.version < 1)
                      throw new Error("New draft receipt is ambiguous.");
                    setId(r.id);
                    void list.reload();
                  },
                );
            })
          }
        >
          Create update draft
        </Button>
        <ReadState read={list}>
          <div className="admin-master">
            <div className="admin-collection">
              {list.data?.map((d) => (
                <Button
                  variant="ghost"
                  key={d.id}
                  aria-pressed={id === d.id}
                  onClick={() =>
                    void leave().then((ok) => {
                      if (ok && list.owned()) setId(d.id);
                    })
                  }
                >
                  {d.title || "Untitled update"}
                  <small>
                    {d.state} · revision {d.version}
                    {d.scheduled_at ? ` · ${d.scheduled_at}` : ""}
                  </small>
                </Button>
              ))}
            </div>
            {id && (
              <Editor
                key={id}
                id={id}
                connected={!!connection.data?.connected}
                onDeleted={() => {
                  setId("");
                  void list.reload();
                }}
                onChange={() => void list.reload()}
              />
            )}
          </div>
        </ReadState>
      </Section>
    </>
  );
}
function Editor({
  id,
  connected,
  onDeleted,
  onChange,
}: {
  id: string;
  connected: boolean;
  onDeleted: () => void;
  onChange: () => void;
}) {
  const read = useRead(() => client.publishingGet(id), [id]);
  return (
    <ReadState read={read}>
      {read.data && (
        <Draft
          key={id}
          original={read.data}
          connected={connected}
          refresh={read.reload}
          onDeleted={onDeleted}
          onChange={onChange}
        />
      )}
    </ReadState>
  );
}
function Draft({
  original,
  connected,
  refresh,
  onDeleted,
  onChange,
}: {
  original: PublishingDraft;
  connected: boolean;
  refresh: () => Promise<void>;
  onDeleted: () => void;
  onChange: () => void;
}) {
  const id = useRef(original.id).current;
  const op = useOperation(),
    [saved, setSaved] = useState(original),
    [content, setContent] = useState(original.content),
    [imageDraft, setImageDraft] = useState(false),
    [schedule, setSchedule] = useState(""),
    [instruction, setInstruction] = useState(
      "Write a concise update based on these notes.",
    ),
    [suggestion, setSuggestion] = useState(""),
    [poll, setPoll] = useState(true),
    attempt = useRef<DraftAttempt | null>(null);
  const dirty = !sameValue(content, saved.content),
    editable = ["draft", "failed"].includes(saved.state);
  useExit({ dirty });
  useEffect(() => {
    if (!op.owned()) return;
    if (original.id !== id) {
      op.reject(
        "The refreshed draft belongs to a different update. Your current buffer is kept.",
      );
      return;
    }
    if (original.version > saved.version && !dirty && !op.busy && !op.unknown) {
      const parsed = publishingContent.safeParse(original.content);
      if (!parsed.success) {
        op.reject(
          "The refreshed content is invalid. The last valid preview is kept.",
        );
        return;
      }
      setSaved({ ...original, content: parsed.data });
      setContent(parsed.data);
    }
  }, [original, dirty, op.busy, op.unknown, saved.version, id]);
  useEffect(() => {
    if (!poll || !["scheduled", "sending"].includes(saved.state)) return;
    const t = setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        !op.busy &&
        !op.unknown &&
        !dirty
      )
        void refresh();
    }, 5000);
    return () => clearInterval(t);
  }, [poll, saved.state, dirty, op.busy, op.unknown]);
  function adopt(r: PublishingDraft, submitted: DraftAttempt) {
    if (
      !op.owned() ||
      attempt.current !== submitted ||
      !matchesReceipt(r, submitted, id)
    )
      throw new Error(
        "Publishing receipt does not match the exact update, next revision, submitted content and requested outcome.",
      );
    const normalized = { ...r, content: publishingContent.parse(r.content) };
    setSaved(normalized);
    setContent(normalized.content);
    onChange();
  }
  function edit<K extends keyof PublishingContent>(
    key: K,
    value: PublishingContent[K],
  ) {
    setContent((c) => ({ ...c, [key]: value }));
  }
  async function save() {
    if (!editable || imageDraft || op.blocked) {
      op.reject(
        "Finish the current operation and image edit before saving an editable draft.",
      );
      return;
    }
    const parsed = publishingContent.safeParse(content);
    if (!parsed.success) {
      op.reject(parsed.error.issues[0]?.message || "Check update fields.");
      return;
    }
    const expected = saved.version;
    const submitted = {
      kind: "save" as const,
      identity: crypto.randomUUID(),
      version: expected,
      state: saved.state,
      content: parsed.data,
    };
    await op.run(
      () => {
        attempt.current = submitted;
        return client.publishingSave(id, expected, parsed.data);
      },
      (r) => {
        if (attempt.current !== submitted)
          throw new Error("Save receipt belongs to another attempt.");
        adopt(r, submitted);
        attempt.current = null;
      },
    );
  }
  function action(
    kind: "publish" | "cancel" | "release" | "unrelease" | "delete" | "reset",
    at?: string,
  ) {
    if (dirty || imageDraft) return;
    const version = saved.version;
    const labels = {
      publish: at ? "Approve scheduled post" : "Publish external post",
      cancel: "Cancel scheduled post",
      release: "Publish public changelog",
      unrelease: "Remove public changelog entry",
      delete: "Delete draft",
      reset: "Reset unknown post state",
    };
    const submitted = {
      kind,
      identity: crypto.randomUUID(),
      version,
      state: saved.state,
      at,
      content: saved.content,
    };
    void op.run(
      () => {
        attempt.current = submitted;
        return client.publishingAction(id, version, kind, at);
      },
      (r) => {
        if (attempt.current !== submitted)
          throw new Error("Action receipt belongs to another attempt.");
        if (kind === "delete") {
          if (r !== null) throw new Error("Delete receipt is ambiguous.");
          attempt.current = null;
          onDeleted();
          return;
        }
        if (!r) throw new Error("Draft receipt missing.");
        adopt(r, submitted);
        attempt.current = null;
      },
      {
        title: `${labels[kind]}?`,
        body:
          kind === "reset"
            ? "Confirm you checked the external company page and this post is absent. Resetting a post that exists can create a duplicate."
            : kind === "delete"
              ? "Deletes the stored draft. An already published external post stays published."
              : kind === "release"
                ? "Makes these notes and image public in the product changelog."
                : kind === "publish"
                  ? "This publishes or schedules a real company-page post using the saved revision."
                  : "Changes this exact saved draft.",
        action: labels[kind],
        danger: ["publish", "release", "delete", "reset", "unrelease"].includes(
          kind,
        ),
      },
    );
  }
  async function reconcile() {
    const a = attempt.current;
    if (!a || a.kind === "suggest" || !op.owned()) return false;
    const r = await client.publishingGet(id);
    if (!op.owned() || attempt.current !== a) return false;
    if (a.kind === "reset" || !matchesReceipt(r, a, id)) return false;
    attempt.current = null;
    const normalized = { ...r, content: publishingContent.parse(r.content) };
    setSaved(normalized);
    setContent(normalized.content);
    onChange();
    return true;
  }
  return (
    <article className="admin-detail">
      <h3>Update editor</h3>
      <Facts
        value={{
          id: saved.id,
          version: saved.version,
          state: saved.state,
          scheduled_at: saved.scheduled_at,
          post_urn: saved.post_urn,
          error: saved.error,
          release: saved.release,
        }}
      />
      <label>
        <input
          type="checkbox"
          checked={poll}
          onChange={(e) => setPoll(e.target.checked)}
        />
        Refresh scheduled or sending status while visible
      </label>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={op.blocked || !editable}>
          <Field label="Update title">
            <Input
              required
              maxLength={160}
              value={content.title}
              onChange={(e) => edit("title", e.target.value)}
            />
          </Field>
          <Field label="Summary">
            <TextArea
              maxLength={500}
              value={content.summary}
              onChange={(e) => edit("summary", e.target.value)}
            />
          </Field>
          {(["new", "better", "fixed"] as const).map((key) => (
            <Field key={key} label={`${key} notes (one per line, 30 maximum)`}>
              <TextArea
                rows={5}
                value={content.notes[key].join("\n")}
                onChange={(e) =>
                  edit("notes", {
                    ...content.notes,
                    [key]: e.target.value.split("\n"),
                  })
                }
              />
            </Field>
          ))}
          <Field label="External post text">
            <TextArea
              rows={8}
              maxLength={3000}
              value={content.commentary}
              onChange={(e) => edit("commentary", e.target.value)}
            />
          </Field>
          <ImageEditor
            image={content.image}
            disabled={op.blocked || !editable}
            onApply={(value) => edit("image", value)}
            onStagedChange={setImageDraft}
          />
          <Field label="Image alternative text">
            <TextArea
              maxLength={1000}
              value={content.alt_text}
              onChange={(e) => edit("alt_text", e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={!dirty || imageDraft}>
            Save update draft
          </Button>
        </fieldset>
      </form>
      <details>
        <summary>Preview saved or draft content</summary>
        <h4>{content.title}</h4>
        <p>{content.summary}</p>
        {(["new", "better", "fixed"] as const).map((key) => (
          <div key={key}>
            <h5>{key}</h5>
            <ul>
              {content.notes[key].filter(Boolean).map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        ))}
        <pre className="admin-prose">{content.commentary}</pre>
        {content.image && (
          <img
            className="admin-image"
            src={content.image}
            alt={content.alt_text}
          />
        )}
      </details>
      <Field label="Writing suggestion instruction">
        <TextArea
          disabled={op.blocked}
          maxLength={1000}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
        />
      </Field>
      <Button
        disabled={op.blocked || !instruction.trim()}
        onClick={() => {
          const parsed = publishingContent.safeParse(content);
          if (!parsed.success) {
            op.reject("Check the draft before requesting a suggestion.");
            return;
          }
          void op.run(
            () => {
              attempt.current = {
                kind: "suggest",
                identity: crypto.randomUUID(),
                version: saved.version,
                state: saved.state,
                content: parsed.data,
              };
              return client.publishingSuggest(parsed.data, instruction);
            },
            (r) => {
              if (typeof r.text !== "string")
                throw new Error("Suggestion receipt is missing.");
              attempt.current = null;
              setSuggestion(r.text);
            },
            {
              title: "Request model-written suggestion?",
              body: "Sends this draft and instruction to the configured model and may use quota. It does not publish or automatically replace your text.",
              action: "Request suggestion",
            },
          );
        }}
      >
        Request suggestion
      </Button>
      {suggestion && (
        <div>
          <pre className="admin-prose">{suggestion}</pre>
          <Button
            disabled={op.blocked || !editable || suggestion.length > 3000}
            onClick={() => edit("commentary", suggestion)}
          >
            Use suggestion as post text
          </Button>
          <Button disabled={op.blocked} onClick={() => setSuggestion("")}>
            Discard suggestion
          </Button>
        </div>
      )}
      <div className="admin-actions">
        <Button
          disabled={
            op.blocked ||
            dirty ||
            imageDraft ||
            ["scheduled", "sending"].includes(saved.state)
          }
          onClick={() => action("release")}
        >
          {saved.release ? "Update" : "Publish"} changelog notes
        </Button>
        {saved.release && (
          <Button
            disabled={op.blocked || dirty || imageDraft}
            onClick={() => action("unrelease")}
          >
            Remove changelog notes
          </Button>
        )}
        <Button
          variant="danger"
          disabled={
            op.blocked || dirty || imageDraft || !editable || !connected
          }
          onClick={() => action("publish")}
        >
          Publish to external company page
        </Button>
        {saved.state === "scheduled" && (
          <Button
            disabled={op.blocked || dirty || imageDraft}
            onClick={() => action("cancel")}
          >
            Cancel schedule
          </Button>
        )}
        {["unknown", "failed"].includes(saved.state) && (
          <Button
            disabled={op.blocked || dirty || imageDraft}
            onClick={() => action("reset")}
          >
            I checked the page: reset post
          </Button>
        )}
        <Button
          variant="danger"
          disabled={
            op.blocked || dirty || imageDraft || saved.state === "sending"
          }
          onClick={() => action("delete")}
        >
          Delete draft
        </Button>
      </div>
      <Field label="Schedule time (your local timezone)">
        <Input
          disabled={op.blocked || !editable}
          type="datetime-local"
          value={schedule}
          onChange={(e) => setSchedule(e.target.value)}
        />
      </Field>
      <p>{Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
      <Button
        disabled={
          op.blocked ||
          dirty ||
          imageDraft ||
          !editable ||
          !connected ||
          !schedule
        }
        onClick={() => {
          const at = toIso(schedule);
          if (!at || Date.parse(at) <= Date.now()) {
            op.reject("Choose a future schedule time.");
            return;
          }
          action("publish", at);
        }}
      >
        Approve schedule
      </Button>
      <Outcome
        op={op}
        check={
          attempt.current && attempt.current.kind !== "suggest"
            ? reconcile
            : undefined
        }
      />
      <Button disabled={op.busy || dirty} onClick={() => void refresh()}>
        Refresh saved draft
      </Button>
    </article>
  );
}
