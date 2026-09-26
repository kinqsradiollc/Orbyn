import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, Globe, X } from "lucide-react";
import { PUBLISH_SLUG, type PublishState } from "@orbyn/core";
import { client } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { copyText } from "../../lib/planning";
import { webOrigin } from "../../lib/links";
import { useConfirm } from "../../components/Confirm";
import "./publish.css";

/**
 * "Publish to web" (SHR-05, SHR-06) for a page or a folder: off until
 * turned on, hidden from search engines unless you say otherwise, an
 * optional password and a description for the card a shared link shows.
 * Unpublish takes it off at once.
 */
export function PublishDialog({
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
  const closeRef = useRef<HTMLButtonElement>(null);

  const take = (s: PublishState) => {
    setState(s);
    setSlug(s.published?.slug ?? "");
    setDescription(s.published?.description ?? "");
    setHidden(s.published?.noindex ?? true);
    setPageDescription(s.web_description);
    setPassword("");
  };
  useEffect(() => {
    client.getPublish(kind, id).then(take, (e) => setError(errorText(e)));
  }, [kind, id]);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async (fn: () => Promise<PublishState | void>, done?: string) => {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const next = await fn();
      if (next) take(next);
      if (done) setNote(done);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const origin = webOrigin() ?? "";
  const published = state?.published ?? null;
  const url = published ? `${origin}${published.path}` : "";
  const viaUrl = state?.via_folder ? `${origin}${state.via_folder.path}` : "";
  const slugOk = !slug || PUBLISH_SLUG.test(slug);
  const noun = kind === "doc" ? "page" : "folder";

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
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal publish-dialog scale-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-title"
      >
        <div className="section-heading">
          <h2 id="publish-title">
            <Globe size={18} aria-hidden="true" /> Publish to web
          </h2>
          <button
            ref={closeRef}
            className="icon-button"
            aria-label="Close"
            onClick={onClose}
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
                  ? `“${name}” is on the web. Anyone with the link can read it, without an account.`
                  : `Put “${name}” on the web: anyone with the link can read it, without an account. It stays off until you publish it.`}
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
                <div className="publish-fields">
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
                      placeholder="A line for the card a shared link shows"
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
                      <small>On: only people with the link find it.</small>
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
                      onClick={() =>
                        void run(
                          () =>
                            client.publish(kind, id, {
                              slug: published.slug,
                              noindex: hidden,
                              description:
                                kind === "folder"
                                  ? description
                                  : pageDescription,
                              password: null,
                            }),
                          "The password is gone.",
                        )
                      }
                    >
                      Remove the password
                    </button>
                  )}
                </div>
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
          {note && (
            <p role="status" className="muted">
              {note}
            </p>
          )}
        </div>
        {state && (
          <div className="publish-foot">
            {published ? (
              <button
                className="danger"
                disabled={busy}
                onClick={() =>
                  void ask({
                    title: `Unpublish this ${noun}?`,
                    body: "The address stops working at once. You can publish it again later.",
                    confirmLabel: "Unpublish",
                    destructive: true,
                  }).then((yes) => {
                    if (yes)
                      void run(
                        () => client.unpublish(kind, id),
                        `The ${noun} is off the web.`,
                      );
                  })
                }
              >
                Unpublish
              </button>
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
  const [state, setState] = useState<{
    allowed: boolean;
    published: number;
    can_change: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    client.getTeamPublishing(teamId).then(setState, () => setState(null));
  }, [teamId]);
  if (!state) return null;
  return (
    <section
      className="card team-publishing"
      aria-labelledby="team-publishing-title"
    >
      <h3 id="team-publishing-title">
        <Globe size={15} aria-hidden="true" /> Pages on the web
      </h3>
      <label className="switch-line">
        <input
          type="checkbox"
          role="switch"
          className="ai-switch"
          checked={state.allowed}
          disabled={!state.can_change}
          onChange={(e) =>
            client.setTeamPublishing(teamId, e.target.checked).then(
              (s) => {
                setError("");
                setState(s);
              },
              (err) => setError(errorText(err)),
            )
          }
        />
        <span>
          Members can publish the team's pages
          <small>
            {state.published
              ? `${state.published} page${state.published === 1 ? " or folder is" : "s or folders are"} published.`
              : "Nothing is published."}{" "}
            {state.can_change
              ? "Turning this off takes them all off the web at once."
              : "Owners and admins can change this."}
          </small>
        </span>
      </label>
      {error && (
        <p role="alert" className="publish-error">
          {error}
        </p>
      )}
    </section>
  );
}
