import { useEffect, useId, useRef, useState } from "react";
import { Copy, ExternalLink, Globe, X } from "lucide-react";
import { PUBLISH_SLUG, type PublishState } from "@orbyn/core";
import { session } from "../../lib/session";
import { client } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { copyText } from "../planner/planning";
import { webOrigin } from "../../lib/links";
import { useModalFocus } from "../../hooks/useModalFocus";
import { useConfirm } from "../../components/Confirm";
import "./publish.css";
import { PagePublicationDialog } from "./PagePublicationDialog";

export function PublishDialog(props: {
  kind: "doc" | "folder";
  id: string;
  name: string;
  onClose: () => void;
}) {
  return props.kind === "doc" ? (
    <PagePublicationDialog id={props.id} onClose={props.onClose} />
  ) : (
    <LegacyPublishDialog
      key={`${session.get()}:${props.kind}:${props.id}`}
      {...props}
    />
  );
}

/**
 * "Publish to web" (SHR-05, SHR-06) for a page or a folder: off until
 * turned on, hidden from search engines unless you say otherwise, an
 * optional password and a description for the card a shared link shows.
 * Unpublish takes it off at once.
 */
function LegacyPublishDialog({
  kind,
  id,
  name,
  onClose,
}: {
  kind: "doc" | "folder";
  id: string;
  /** The page's title or the folder's name. */
  name: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<PublishState | null>(null);
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [pageDescription, setPageDescription] = useState("");
  const [hidden, setHidden] = useState(true);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const { ask } = useConfirm();
  const owner = useRef(session.get());
  const mounted = useRef(false);
  const lock = useRef(false);
  const titleId = useId();
  const baseline = useRef("");
  const current = () => mounted.current && owner.current === session.get();
  const snapshot = () =>
    JSON.stringify([slug, description, pageDescription, hidden, password]);
  const close = async () => {
    if (lock.current || !current()) return;
    if (state && baseline.current !== snapshot()) {
      lock.current = true;
      setBusy(true);
      const yes = await ask({
        title: "Discard publishing changes?",
        confirmLabel: "Discard",
        destructive: true,
      });
      lock.current = false;
      if (!current()) return;
      setBusy(false);
      if (!yes) return;
    }
    onClose();
  };
  const modal = useModalFocus(() => void close(), busy);

  const take = (s: PublishState) => {
    setState(s);
    setSlug(s.published?.slug ?? "");
    setDescription(s.published?.description ?? "");
    setHidden(s.published?.noindex ?? true);
    setPageDescription(s.web_description);
    setPassword("");
    baseline.current = JSON.stringify([
      s.published?.slug ?? "",
      s.published?.description ?? "",
      s.web_description,
      s.published?.noindex ?? true,
      "",
    ]);
  };
  const load = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await client.getPublish(kind, id);
      if (current()) take(next);
    } catch (e) {
      if (current()) setError(errorText(e));
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = async (fn: () => Promise<PublishState | void>, done?: string) => {
    if (lock.current || !current()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNote("");
    try {
      const next = await fn();
      if (!current()) return;
      if (next) take(next);
      if (done) setNote(done);
    } catch (e) {
      if (current()) setError(errorText(e));
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  };

  const origin = webOrigin() ?? "";
  const published = state?.published ?? null;
  const url = published ? `${origin}${published.path}` : "";
  const viaUrl = state?.via_folder ? `${origin}${state.via_folder.path}` : "";
  const slugOk = !slug || PUBLISH_SLUG.test(slug);
  const noun = kind === "doc" ? "page" : "folder";

  const unpublish = async () => {
    if (lock.current || !current()) return;
    lock.current = true;
    setBusy(true);
    const yes = await ask({
      title: `Unpublish this ${noun}?`,
      body: "The public address stops working. You can publish it again later.",
      confirmLabel: "Unpublish",
      destructive: true,
    });
    lock.current = false;
    if (!current()) return;
    setBusy(false);
    if (yes) await run(() => client.unpublish(kind, id), "Unpublished.");
  };

  const removePassword = async () => {
    if (!published || lock.current || !current()) return;
    lock.current = true;
    setBusy(true);
    const yes = await ask({
      title: "Remove password?",
      body: "Anyone with the public link will be able to read this folder.",
      confirmLabel: "Remove password",
      destructive: true,
    });
    lock.current = false;
    if (!current()) return;
    setBusy(false);
    if (yes)
      await run(
        () =>
          client.publish(kind, id, {
            slug: published.slug,
            noindex: hidden,
            description: kind === "folder" ? description : pageDescription,
            password: null,
          }),
        "Password removed.",
      );
  };

  const save = (publishing: boolean) =>
    void run(
      async () => {
        if (
          kind === "doc" &&
          pageDescription !== (state?.web_description ?? "")
        )
          await client.setWebDescription(id, pageDescription);
        return client.publish(kind, id, {
          ...(slug ? { slug } : {}),
          noindex: hidden,
          description: kind === "folder" ? description : pageDescription,
          ...(password ? { password } : {}),
        });
      },
      publishing ? `The ${noun} is on the web.` : "Saved.",
    );

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (!busy && e.target === e.currentTarget) void close();
      }}
    >
      <section
        ref={modal.ref}
        data-modal-focus={modal.id}
        tabIndex={-1}
        className="modal publish-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="section-heading">
          <h2 id={titleId}>
            <Globe size={18} aria-hidden="true" /> Publish to web
          </h2>
          <button
            disabled={busy}
            className="icon-button"
            aria-label="Close"
            onClick={() => void close()}
          >
            <X size={20} />
          </button>
        </div>
        <div className="publish-body">
          {!state && !error && <p className="muted">Loading…</p>}
          {state && (
            <>
              <p className="muted">
                {published
                  ? `“${name}” is published. ${published.has_password ? "Password required to read it." : "Anyone with the link can read it."}`
                  : `“${name}” stays private until published. ${password ? "Readers will need the password." : "Anyone with the link will be able to read it."}`}
              </p>
              {state.via_folder && (
                <p className="publish-via">
                  This page is on the web already, in the folder “
                  {state.via_folder.folder_name}”:{" "}
                  <a href={viaUrl} target="_blank" rel="noreferrer">
                    {viaUrl}
                  </a>
                </p>
              )}
              {!state.can_publish && state.reason && (
                <p className="publish-reason" role="note">
                  {state.reason}
                </p>
              )}
              {published && (
                <div className="publish-link">
                  <input readOnly value={url} aria-label="The address" />
                  <button
                    className="secondary"
                    onClick={() =>
                      void copyText(url).then((ok) =>
                        setNote(
                          ok ? "Link copied." : "Couldn't copy the link.",
                        ),
                      )
                    }
                  >
                    <Copy size={14} /> Copy
                  </button>
                  <a
                    className="secondary publish-open"
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={14} /> Open
                  </a>
                </div>
              )}
              {state.can_publish && (
                <fieldset disabled={busy} className="publish-fields">
                  <label>
                    Address
                    <span className="publish-slug">
                      <span className="muted">{origin}/p/</span>
                      <input
                        value={slug}
                        placeholder="made from the title"
                        aria-invalid={!slugOk}
                        onChange={(e) => setSlug(e.target.value.toLowerCase())}
                      />
                    </span>
                    {!slugOk && (
                      <small className="publish-error">
                        Use 3 to 80 letters, numbers and dashes.
                      </small>
                    )}
                  </label>
                  <label>
                    {kind === "doc"
                      ? "Description"
                      : "The folder's description"}
                    <textarea
                      rows={2}
                      maxLength={300}
                      value={kind === "doc" ? pageDescription : description}
                      placeholder="Short link preview"
                      onChange={(e) =>
                        kind === "doc"
                          ? setPageDescription(e.target.value)
                          : setDescription(e.target.value)
                      }
                    />
                  </label>
                  <label className="switch-line">
                    <input
                      type="checkbox"
                      role="switch"
                      className="ai-switch"
                      checked={hidden}
                      onChange={(e) => setHidden(e.target.checked)}
                    />
                    <span>
                      Hide from search engines
                      <small>
                        Requests exclusion from search results. Access settings
                        are unchanged.
                      </small>
                    </span>
                  </label>
                  <label>
                    {published?.has_password
                      ? "New password"
                      : "Password (optional)"}
                    <input
                      type="password"
                      autoComplete="new-password"
                      minLength={4}
                      value={password}
                      placeholder={
                        published?.has_password
                          ? "Leave empty to keep the password"
                          : "Leave empty for no password"
                      }
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                  {published?.has_password && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => void removePassword()}
                    >
                      Remove password
                    </button>
                  )}
                </fieldset>
              )}
              {kind === "doc" && !state.can_publish && state.via_folder && (
                <label>
                  Description
                  <textarea
                    rows={2}
                    maxLength={300}
                    value={pageDescription}
                    onChange={(e) => setPageDescription(e.target.value)}
                  />
                </label>
              )}
              {published && (
                <p className="muted publish-views">
                  Read {published.views} time{published.views === 1 ? "" : "s"}.
                </p>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="publish-error">
              {error}
            </p>
          )}
          {!state && error && (
            <button disabled={busy} onClick={() => void load()}>
              Retry
            </button>
          )}
          {note && (
            <p role="status" className="muted">
              {note}
            </p>
          )}
        </div>
        {state && (
          <div className="publish-foot">
            {published ? (
              <details className="publish-options">
                <summary>Options</summary>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() => void unpublish()}
                >
                  Unpublish
                </button>
              </details>
            ) : (
              <span />
            )}
            {state.can_publish && (
              <button
                className="primary"
                disabled={
                  busy || !slugOk || (!!password && password.length < 4)
                }
                onClick={() => save(!published)}
              >
                {published ? "Save" : "Publish"}
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * A team's switch for publishing (SHR-05): on unless an owner or admin
 * turns it off, which takes every one of the team's pages off the web at
 * once (they come back if it is turned on again).
 */
export function TeamPublishing({ teamId }: { teamId: string }) {
  return (
    <TeamPublishingBody key={`${session.get()}:${teamId}`} teamId={teamId} />
  );
}
function TeamPublishingBody({ teamId }: { teamId: string }) {
  const [state, setState] = useState<{
    allowed: boolean;
    published: number;
    can_change: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const owner = useRef(session.get());
  const mounted = useRef(false);
  const lock = useRef(false);
  const owns = () => mounted.current && owner.current === session.get();
  const load = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await client.getTeamPublishing(teamId);
      if (owns()) setState(next);
    } catch (e) {
      if (owns()) setError(errorText(e));
    } finally {
      lock.current = false;
      if (owns()) setBusy(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, []);
  const change = async (allowed: boolean) => {
    if (!state?.can_change || lock.current || !owns()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await client.setTeamPublishing(teamId, allowed);
      if (owns()) setState(next);
    } catch (e) {
      if (owns()) setError(errorText(e));
    } finally {
      lock.current = false;
      if (owns()) setBusy(false);
    }
  };
  const titleId = useId();
  return (
    <section className="team-publishing" aria-labelledby={titleId}>
      <h3 id={titleId}>
        <Globe size={15} aria-hidden="true" /> Pages on the web
      </h3>
      {!state && !error && (
        <p className="muted">Loading publishing settings…</p>
      )}
      {state && (
        <label className="switch-line">
          <input
            type="checkbox"
            role="switch"
            className="ai-switch"
            checked={state.allowed}
            disabled={busy || !state.can_change}
            onChange={(event) => void change(event.target.checked)}
          />
          <span>
            Members can publish pages
            <small>
              {state.published} published.{" "}
              {state.can_change
                ? "Turning this off removes all public team pages."
                : "Owners and admins can change this."}
            </small>
          </span>
        </label>
      )}
      {error && (
        <p role="alert" className="publish-error">
          {error}
        </p>
      )}
      {!state && error && (
        <button disabled={busy} onClick={() => void load()}>
          Retry
        </button>
      )}
    </section>
  );
}
