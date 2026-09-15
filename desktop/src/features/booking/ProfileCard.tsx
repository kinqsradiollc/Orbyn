import { useEffect, useState, type FormEvent } from "react";
import { Copy, ExternalLink, UserRound } from "lucide-react";
import type { Profile } from "@orbyn/core";
import { client } from "../../lib/api";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { copyText } from "../../lib/planning";

/** Your public profile page: a handle and a short bio, listing your booking pages. */
export function ProfileCard({ report }: { report: (e: unknown) => void }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("");
  const [copied, setCopied] = useState(false);
  const action = useAction(report);

  useEffect(() => {
    client.getProfile().then((p) => {
      setProfile(p);
      setHandle(p.handle ?? "");
      setBio(p.bio);
    }, report);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = (e: FormEvent) => {
    e.preventDefault();
    void action.run(async () => {
      const next = await client.updateProfile({
        handle: handle.trim() ? handle.trim().toLowerCase() : null,
        bio: bio.trim(),
      });
      setProfile(next);
      setHandle(next.handle ?? "");
      setCopied(false);
      return next.handle ? "Saved. Your page is live." : "Saved.";
    });
  };
  const turnOff = () => {
    if (!window.confirm("Turn off your profile page? Its link stops working."))
      return;
    void action.run(async () => {
      const next = await client.updateProfile({ handle: null });
      setProfile(next);
      setHandle("");
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
        One link that lists your active booking pages, with a short bio.
      </p>
      {profile === null ? (
        <p className="muted">Loading your profile…</p>
      ) : (
        <form className="settings-subform" onSubmit={save}>
          <div className="settings-grid">
            <div className="settings-field">
              <label htmlFor="profile-handle">Handle</label>
              <input
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
                3 to 40 lowercase letters, numbers and dashes.
              </small>
            </div>
            <div className="settings-field wide">
              <label htmlFor="profile-bio">Bio</label>
              <textarea
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
          <div className="button-row start">
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
      )}
      <OutcomeNote outcome={action.outcome} />
    </section>
  );
}
