import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { HttpError, PublicProfile } from "@orbyn/core";
import { client } from "../../lib/api";
import { errorText, minutesLabel } from "../../lib/planning";
import { Message } from "./bookingUi";
import { PublicShell } from "./PublicShell";

type Props = { path: string; onHome?: () => void };

/** `/u/:handle`: someone's short bio and their active booking pages. */
export function PublicProfilePage({ path, onHome }: Props) {
  const handle = decodeURIComponent(path.split("/").filter(Boolean)[1] ?? "");
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [missing, setMissing] = useState(!handle);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "Book a time · Orbyn";
    if (!handle) return;
    let alive = true;
    client.getPublicProfile(handle).then(
      (p) => {
        if (!alive) return;
        setProfile(p);
        document.title = `${p.name} · Book a time`;
      },
      (e) => {
        if (!alive) return;
        if ((e as HttpError).status === 404) setMissing(true);
        else setError(errorText(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [handle]);

  return (
    <PublicShell onHome={onHome} footer="Scheduling by Orbyn.">
      {missing ? (
        <Message
          title="This page doesn't exist."
          body="Check the link and try again."
        />
      ) : !profile ? (
        error ? (
          <Message title="Couldn't load this page." body={error} />
        ) : (
          <section className="public-card">
            <p className="muted">Loading…</p>
          </section>
        )
      ) : (
        <section
          className="public-card profile-page fade-up"
          aria-labelledby="profile-title"
        >
          <span className="eyebrow">BOOK A TIME</span>
          <h1 id="profile-title">{profile.name}</h1>
          {profile.bio && <p className="booking-desc">{profile.bio}</p>}
          {profile.pages.length ? (
            <ul className="profile-pages">
              {profile.pages.map((p) => (
                <li key={p.slug}>
                  <a href={`/book/${encodeURIComponent(p.slug)}`}>
                    <i
                      className="list-dot"
                      style={{ background: p.color }}
                      aria-hidden="true"
                    />
                    <span>
                      <strong>{p.title}</strong>
                      {p.description && <small>{p.description}</small>}
                      <small>{p.durations.map(minutesLabel).join(" / ")}</small>
                    </span>
                    <ArrowRight size={16} aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No booking pages are open right now.</p>
          )}
        </section>
      )}
    </PublicShell>
  );
}
