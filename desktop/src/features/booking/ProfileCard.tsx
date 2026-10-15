import { useConfirm } from "../../components/Confirm";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../hooks/useModalFocus";
import { Copy, ExternalLink, UserRound } from "lucide-react";
import type { Profile } from "@orbyn/core";
import { client } from "../../lib/api";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { copyText } from "../../lib/planning";

/** Your public profile page: a handle and a short bio, listing your booking pages. */
export function ProfileCard({ report }: { report: (e: unknown) => void }) {
  const { ask } = useConfirm();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("");
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const action = useAction(report);

  useEffect(() => {
    let live = true;
    client.getProfile().then(
      (p) => {
        if (!live) return;
        setProfile(p);
        setHandle(p.handle ?? "");
        setBio(p.bio);
      },
      (error) => {
        if (live) report(error);
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (action.pending) return;
    void action.run(async () => {
      const next = await client.updateProfile({
        handle: handle.trim() ? handle.trim().toLowerCase() : null,
        bio: bio.trim(),
      });
      setProfile(next);
      setHandle(next.handle ?? "");
      setBio(next.bio);
      setCopied(false);
      setEditing(false);
      return next.handle ? "Saved. Your page is live." : "Saved.";
    });
  };
  const turnOff = async () => {
    if (action.pending) return;
    if (
      !(await ask({
        title: "Turn off your profile page? Its link stops working.",
        confirmLabel: "Turn off",
        destructive: true,
      }))
    )
      return;
    void action.run(async () => {
      const next = await client.updateProfile({ handle: null });
      setProfile(next);
      setHandle("");
      setEditing(false);
      return "Your profile page is off.";
    });
  };

  const url =
    profile?.url ??
    (profile?.handle ? `${window.location.origin}/u/${profile.handle}` : null);

  return (
    <section className="card settings-card" aria-labelledby="profile-title">
      <h2 id="profile-title">
        <UserRound size={16} aria-hidden="true" /> Your profile page
      </h2>
      <p className="muted">
        {profile === null
          ? "Loading profile…"
          : profile.handle
            ? "Public · Active booking pages and bio"
            : "Off · Your booking pages stay available"}
      </p>
      {profile === null ? null : (
        <>
          {url && (
            <p className="field-hint" style={{ overflowWrap: "anywhere" }}>
              {url}
            </p>
          )}
          <button
            type="button"
            className="secondary"
            onClick={() => {
              action.setOutcome(null);
              setEditing(true);
            }}
          >
            {profile.handle ? "Edit profile" : "Set up profile"}
          </button>
          {editing && (
            <ProfileEditor
              busy={action.pending}
              onClose={() => setEditing(false)}
            >
              <form className="settings-subform" onSubmit={save}>
                <p className="muted">
                  A handle makes your bio and active booking pages public.
                </p>
                <div className="settings-grid">
                  <div className="settings-field">
                    <label htmlFor="profile-handle">Handle</label>
                    <input
                      disabled={action.pending}
                      id="profile-handle"
                      minLength={3}
                      maxLength={40}
                      pattern="[a-z0-9]+(-[a-z0-9]+)*"
                      title="Lowercase letters, numbers and single dashes"
                      placeholder="sam-lee"
                      spellCheck={false}
                      value={handle}
                      aria-describedby="profile-handle-hint"
                      onChange={(e) => setHandle(e.target.value.toLowerCase())}
                    />
                    <small id="profile-handle-hint" className="field-hint">
                      3–40 lowercase letters, numbers and dashes. Clear to turn
                      the page off.
                    </small>
                  </div>
                  <div className="settings-field wide">
                    <label htmlFor="profile-bio">Bio</label>
                    <textarea
                      disabled={action.pending}
                      id="profile-bio"
                      rows={2}
                      maxLength={300}
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                    />
                    <small className="field-hint">{bio.length}/300</small>
                  </div>
                </div>
                {url && (
                  <div className="secret-row">
                    <code>{url}</code>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void copyText(url).then(setCopied)}
                    >
                      <Copy size={13} /> {copied ? "Copied" : "Copy"}
                    </button>
                    {window.location.protocol !== "file:" && (
                      <a
                        className="link-button"
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink size={12} /> Open
                      </a>
                    )}
                  </div>
                )}
                <OutcomeNote outcome={action.outcome} />
                <div className="button-row start">
                  <button
                    type="button"
                    className="secondary"
                    disabled={action.pending}
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </button>
                  <button className="primary" disabled={action.pending}>
                    Save profile
                  </button>
                  {profile.handle && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={action.pending}
                      onClick={turnOff}
                    >
                      Turn off page
                    </button>
                  )}
                </div>
              </form>
            </ProfileEditor>
          )}
        </>
      )}
      {!editing && <OutcomeNote outcome={action.outcome} />}
    </section>
  );
}

function ProfileEditor({
  busy,
  onClose,
  children,
}: {
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const focus = useModalFocus(onClose, busy);
  useEffect(() => {
    const node = focus.ref.current as HTMLDialogElement;
    node.showModal();
    return () => node.close();
  }, []);
  return createPortal(
    <dialog
      ref={(node) => {
        focus.ref.current = node;
      }}
      className="modal"
      data-modal-focus={focus.id}
      aria-label="Edit profile"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2>Edit profile</h2>
      {children}
    </dialog>,
    document.body,
  );
}
