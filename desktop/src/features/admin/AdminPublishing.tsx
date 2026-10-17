import { useEffect, useRef, useState } from "react";
import { Orbit, Plus, RefreshCw, Sparkles } from "lucide-react";
import type {
  PublishingConnection,
  PublishingContent,
  PublishingDraft,
  PublishingListEntry,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { useConfirm } from "../../components/Confirm";
import { DateField } from "../../components/DateField";
import { usePaneLeaveGuard } from "../../app/page-commands";
import { PublishingImageEditor } from "./PublishingImageEditor";
import "./publishing.css";

type Props = {
  report: (error: unknown) => void;
  leaveGuard: React.MutableRefObject<(() => Promise<boolean>) | null>;
};
const stateLabel = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  published: "Published on LinkedIn",
  failed: "Delivery failed",
  unknown: "Check company Page",
};
export function AdminPublishing({ report, leaveGuard }: Props) {
  const { ask } = useConfirm();
  const [rows, setRows] = useState<PublishingListEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<PublishingDraft | null>(null);
  const [content, setContent] = useState<PublishingContent | null>(null);
  const [connection, setConnection] = useState<PublishingConnection | null>(
    null,
  );
  const [section, setSection] = useState("Post");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [instruction, setInstruction] = useState(
    "Write a concise launch update from these release notes.",
  );
  const [suggestion, setSuggestion] = useState("");
  const [at, setAt] = useState("");
  const lock = useRef(false),
    mounted = useRef(true);
  const dirty =
    !!draft &&
    !!content &&
    JSON.stringify(content) !== JSON.stringify(draft.content);
  const editable = !!draft && ["draft", "failed"].includes(draft.state);
  const selectedId = useRef<string | null>(null);
  const adopt = (row: PublishingDraft | null) => {
    selectedId.current = row?.id ?? null;
    setDraft(row);
    setContent(row?.content ?? null);
    setSuggestion("");
  };
  async function loadList() {
    const list = await client.publishingList();
    if (mounted.current) {
      setRows(list);
      setLoaded(true);
    }
  }
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      if (mounted.current) {
        setError(errorText(e));
        report(e);
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function leave() {
    if (lock.current) return false;
    return (
      !dirty ||
      (await ask({
        title: "Discard unsaved changes?",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        destructive: true,
      }))
    );
  }
  usePaneLeaveGuard(leave);
  useEffect(() => {
    leaveGuard.current = leave;
    return () => {
      leaveGuard.current = null;
    };
  });
  useEffect(() => {
    mounted.current = true;
    void run(async () => {
      await loadList();
      const c = await client.publishingConnection();
      if (mounted.current) setConnection(c);
    });
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty || busy) event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, busy]);
  useEffect(() => {
    const refresh = () => {
      if (!lock.current)
        void client
          .publishingConnection()
          .then((c) => {
            if (mounted.current) setConnection(c);
          })
          .catch(() => {});
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => {
    if (!draft || !["scheduled", "sending"].includes(draft.state)) return;
    const id = draft.id;
    const timer = setInterval(() => {
      if (!lock.current)
        void client
          .publishingGet(id)
          .then((row) => {
            if (mounted.current && selectedId.current === id) adopt(row);
          })
          .catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [draft?.id, draft?.state]);
  function change<K extends keyof PublishingContent>(
    key: K,
    value: PublishingContent[K],
  ) {
    setContent((c) => (c ? { ...c, [key]: value } : c));
  }
  async function action(
    kind: "publish" | "cancel" | "release" | "unrelease" | "delete" | "reset",
    time?: string,
  ) {
    if (!draft || dirty) return;
    const messages = {
      publish: time
        ? "Schedule this post to the Orbyn company Page?"
        : "Publish this post to the Orbyn company Page?",
      cancel: "Cancel this scheduled post?",
      release: "Publish these notes on the public changelog?",
      unrelease: "Remove these notes from the public changelog?",
      delete: "Delete this draft?",
      reset: "Have you checked that this post is absent from the company Page?",
    };
    if (
      !(await ask({
        title: messages[kind],
        body:
          kind === "reset"
            ? "Retrying a post that already exists creates a duplicate."
            : kind === "delete" && draft.post_urn
              ? "The LinkedIn post stays published."
              : undefined,
        confirmLabel: time
          ? "Schedule post"
          : kind === "publish"
            ? "Publish post"
            : kind === "reset"
              ? "Reset draft"
              : "Continue",
        destructive: ["delete", "unrelease"].includes(kind),
      }))
    )
      return;
    await run(async () => {
      const row = await client.publishingAction(
        draft.id,
        draft.version,
        kind,
        time,
      );
      if (mounted.current) adopt(row);
      await loadList();
    });
  }
  return (
    <div className="publishing">
      <header className="section-heading">
        <h2>Publishing</h2>
        <div className="publishing-toolbar">
          <button
            className="icon-button"
            aria-label="Refresh publishing"
            disabled={busy}
            onClick={async () => {
              if (!(await leave())) return;
              void run(async () => {
                if (draft) adopt(await client.publishingGet(draft.id));
                await loadList();
                setConnection(await client.publishingConnection());
              });
            }}
          >
            <RefreshCw size={16} />
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={async () => {
              if (await leave())
                void run(async () => {
                  const row = await client.publishingCreate();
                  if (mounted.current) adopt(row);
                  await loadList();
                });
            }}
          >
            <Plus size={15} /> New update
          </button>
        </div>
      </header>
      <section className="publishing-connection">
        <span>
          <strong>Orbyn · LinkedIn</strong>
          <small>
            {connection
              ? connection.connected
                ? `Company Page connected${connection.expires_at ? ` · ${connection.renewable ? "Renews automatically" : `Permission ends ${new Date(connection.expires_at).toLocaleDateString()}`}` : ""}`
                : connection.configured
                  ? "Not connected"
                  : "Server setup required"
              : "Loading connection…"}
          </small>
        </span>
        {connection?.connected ? (
          <button
            className="text-button"
            disabled={busy}
            onClick={async () => {
              if (
                await ask({
                  title: "Disconnect LinkedIn?",
                  body: "Queued posts will be cancelled. Published posts stay on LinkedIn.",
                  confirmLabel: "Disconnect",
                })
              )
                void run(async () => {
                  await client.publishingDisconnect();
                  setConnection(await client.publishingConnection());
                  if (draft && !dirty)
                    adopt(await client.publishingGet(draft.id));
                  await loadList();
                });
            }}
          >
            Disconnect
          </button>
        ) : (
          <button
            className="secondary"
            disabled={busy || !connection?.configured}
            onClick={() => {
              // Open synchronously so browsers do not block the OAuth tab after the request.
              const tab = window.open("about:blank", "_blank");
              if (tab) tab.opener = null;
              void run(async () => {
                try {
                  const result = await client.publishingConnect();
                  if (tab) tab.location.href = result.url;
                  else throw new Error("Allow a new tab to connect LinkedIn.");
                } catch (e) {
                  tab?.close();
                  throw e;
                }
              });
            }}
          >
            Connect LinkedIn
          </button>
        )}
      </section>
      {connection && !connection.configured && (
        <details className="publishing-setup">
          <summary>LinkedIn setup</summary>
          <p>
            Configure an approved LinkedIn Community Management app and the
            Orbyn company Page ID on the server. Drafting and image editing work
            before connecting.
          </p>
        </details>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="publishing-workspace">
        <nav className="publishing-drafts" aria-label="Publishing drafts">
          {!loaded ? (
            <p className="muted">Loading drafts…</p>
          ) : !rows.length ? (
            <p className="muted">No drafts yet.</p>
          ) : (
            rows.map((row) => (
              <button
                key={row.id}
                aria-current={draft?.id === row.id ? "page" : undefined}
                disabled={busy}
                onClick={async () => {
                  if (await leave())
                    void run(async () => {
                      const next = await client.publishingGet(row.id);
                      if (mounted.current) adopt(next);
                    });
                }}
              >
                <strong>{row.title}</strong>
                <small>{stateLabel[row.state]}</small>
              </button>
            ))
          )}
        </nav>
        {draft && content ? (
          <div className="publishing-document" aria-busy={busy}>
            <div className="publishing-toolbar publishing-document-head">
              <span className="muted" role="status">
                {busy
                  ? "Working…"
                  : dirty
                    ? "Unsaved changes"
                    : stateLabel[draft.state]}
              </span>
              <button
                className="secondary"
                disabled={busy || !dirty || !editable}
                onClick={() =>
                  void run(async () => {
                    const saved = await client.publishingSave(
                      draft.id,
                      draft.version,
                      content,
                    );
                    if (mounted.current) adopt(saved);
                    await loadList();
                  })
                }
              >
                Save draft
              </button>
              <details className="publishing-more">
                <summary aria-label="Manage update">···</summary>
                <div>
                  {draft.state === "scheduled" && (
                    <button
                      disabled={busy}
                      onClick={() => void action("cancel")}
                    >
                      Cancel scheduled post
                    </button>
                  )}
                  {["unknown", "failed"].includes(draft.state) && (
                    <button
                      disabled={busy || dirty}
                      onClick={() => void action("reset")}
                    >
                      Reset delivery
                    </button>
                  )}
                  {draft.release && (
                    <button
                      disabled={busy || dirty}
                      onClick={() => void action("unrelease")}
                    >
                      Unpublish notes
                    </button>
                  )}
                  <button
                    disabled={busy || dirty}
                    onClick={() => void action("delete")}
                  >
                    Delete draft
                  </button>
                </div>
              </details>
            </div>
            {draft.error && (
              <p className="error" role="alert">
                {draft.error}
              </p>
            )}
            {draft.state === "scheduled" && (
              <p className="muted">
                Approved for {new Date(draft.scheduled_at!).toLocaleString()}
              </p>
            )}
            {draft.post_urn && (
              <a
                href={`https://www.linkedin.com/feed/update/${encodeURIComponent(draft.post_urn)}`}
                target="_blank"
                rel="noreferrer"
              >
                View LinkedIn post
              </a>
            )}
            <label>
              Title
              <input
                value={content.title}
                maxLength={160}
                disabled={busy || !editable}
                onChange={(e) => change("title", e.target.value)}
              />
            </label>
            <div
              className="publishing-tabs"
              role="group"
              aria-label="Update editor"
            >
              {["Post", "Release notes", "Image"].map((tab) => (
                <button
                  aria-pressed={section === tab}
                  key={tab}
                  onClick={() => setSection(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>
            <div className="publishing-compose">
              <section className="publishing-fields">
                {section === "Post" && (
                  <>
                    <label>
                      LinkedIn post
                      <textarea
                        rows={10}
                        value={content.commentary}
                        maxLength={3000}
                        disabled={busy || !editable}
                        onChange={(e) => change("commentary", e.target.value)}
                      />
                      <small className="muted">
                        {content.commentary.length}/3000
                      </small>
                    </label>
                    {editable && (
                      <details>
                        <summary>
                          <Sparkles size={14} /> Draft with AI
                        </summary>
                        <label>
                          Instructions
                          <input
                            maxLength={1000}
                            value={instruction}
                            onChange={(e) => setInstruction(e.target.value)}
                          />
                        </label>
                        <p className="muted">
                          Sends this draft’s text to your selected AI provider.
                          Usage counts toward your budget.
                        </p>
                        <button
                          className="secondary"
                          disabled={busy || !instruction.trim()}
                          onClick={() =>
                            void run(async () => {
                              const result = await client.publishingSuggest(
                                content,
                                instruction,
                              );
                              if (mounted.current) setSuggestion(result.text);
                            })
                          }
                        >
                          Suggest post
                        </button>
                      </details>
                    )}
                    {suggestion && (
                      <section className="publishing-suggestion">
                        <strong>Suggested post</strong>
                        <p>{suggestion}</p>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => {
                            change("commentary", suggestion);
                            setSuggestion("");
                          }}
                        >
                          Use suggestion
                        </button>
                        <button
                          className="text-button"
                          onClick={() => setSuggestion("")}
                        >
                          Dismiss
                        </button>
                      </section>
                    )}
                  </>
                )}
                {section === "Release notes" && (
                  <>
                    <label>
                      Summary
                      <textarea
                        value={content.summary}
                        rows={2}
                        maxLength={500}
                        disabled={busy || !editable}
                        onChange={(e) => change("summary", e.target.value)}
                      />
                    </label>
                    {(["new", "better", "fixed"] as const).map((key) => (
                      <label key={key}>
                        {key === "new"
                          ? "New"
                          : key === "better"
                            ? "Better"
                            : "Fixed"}
                        <textarea
                          rows={4}
                          value={content.notes[key].join("\n")}
                          disabled={busy || !editable}
                          onChange={(e) =>
                            change("notes", {
                              ...content.notes,
                              [key]: e.target.value.split("\n"),
                            })
                          }
                        />
                      </label>
                    ))}
                    <small className="muted">One change per line.</small>
                  </>
                )}
                {section === "Image" && (
                  <>
                    <PublishingImageEditor
                      image={content.image}
                      disabled={busy || !editable}
                      onApply={(image) => change("image", image)}
                    />
                    <label>
                      Image alt text
                      <input
                        value={content.alt_text}
                        maxLength={1000}
                        disabled={busy || !editable}
                        onChange={(e) => change("alt_text", e.target.value)}
                      />
                    </label>
                  </>
                )}
              </section>
              <aside
                className="publishing-preview"
                aria-label="Company post preview"
              >
                <div className="publishing-author">
                  <Orbit size={28} />
                  <span>
                    <strong>Orbyn</strong>
                    <small>Company Page · Public</small>
                  </span>
                </div>
                <p>{content.commentary || "Your post preview"}</p>
                {content.image && (
                  <img
                    src={content.image}
                    alt={content.alt_text || "Draft attachment"}
                  />
                )}
              </aside>
            </div>
            <footer className="publishing-actions">
              <div className="publishing-toolbar">
                <span className="muted">
                  Changelog {draft.release ? "· Published" : "· Private"}
                </span>
                <button
                  className="secondary"
                  disabled={
                    busy ||
                    dirty ||
                    draft.state === "scheduled" ||
                    draft.state === "sending"
                  }
                  onClick={() => void action("release")}
                >
                  {draft.release ? "Update notes" : "Publish notes"}
                </button>
              </div>
              <div className="publishing-toolbar">
                <button
                  className="primary"
                  disabled={
                    busy || dirty || !editable || !connection?.connected
                  }
                  onClick={() => void action("publish")}
                >
                  Publish to LinkedIn
                </button>
                <details>
                  <summary>Schedule</summary>
                  <div className="publishing-schedule">
                    <DateField
                      type="datetime-local"
                      value={at}
                      disabled={busy || !editable}
                      onChange={(e) => setAt(e.target.value)}
                    />
                    <small className="muted">
                      {Intl.DateTimeFormat().resolvedOptions().timeZone}
                    </small>
                    <button
                      className="secondary"
                      disabled={
                        busy ||
                        dirty ||
                        !at ||
                        !editable ||
                        !connection?.connected
                      }
                      onClick={() =>
                        void action("publish", new Date(at).toISOString())
                      }
                    >
                      Approve schedule
                    </button>
                  </div>
                </details>
              </div>
            </footer>
          </div>
        ) : (
          <p className="muted publishing-empty">
            Choose a draft or create an update.
          </p>
        )}
      </div>
    </div>
  );
}
