import {
  CHANGELOG,
  CHANGELOG_HEADINGS,
  CHANGELOG_SECTIONS,
  hasUnseenRelease,
  latestRelease,
  mergePublishedUpdates,
  releaseDate,
  releasesSince,
  type ChangelogRelease,
} from "@orbyn/core";
import { useEffect, useState } from "react";
import { navigate } from "../../lib/router";
import { client } from "../../lib/session";
import { Button, Dialog } from "../../ui/kit";

const SEEN_KEY = "orbyn-whats-new-seen";

const seenRelease = () => {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
};

export const markReleaseSeen = () => {
  try {
    localStorage.setItem(SEEN_KEY, latestRelease().date);
  } catch {
    // It may show once more where storage is refused.
  }
};

/** Opens by itself once after a release; a browser new to Orbyn isn't shown it. */
export function useWhatsNewOnce(ready: boolean) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const seen = seenRelease();
    if (!seen) markReleaseSeen();
    else if (hasUnseenRelease(seen)) setOpen(true);
  }, [ready]);
  return [open, setOpen] as const;
}

function Release({
  release,
  open,
}: {
  release: ChangelogRelease;
  open: boolean;
}) {
  return (
    <details open={open} className="today-release">
      <summary>
        <span>{release.title}</span>
        <small>{releaseDate(release)}</small>
      </summary>
      {release.summary && <p>{release.summary}</p>}
      {CHANGELOG_SECTIONS.filter((key) => release[key].length).map((key) => (
        <div key={key}>
          <h4>{CHANGELOG_HEADINGS[key]}</h4>
          <ul>
            {release[key].map((line, n) => (
              <li key={n}>{line}</li>
            ))}
          </ul>
        </div>
      ))}
    </details>
  );
}

/** The releases since this browser last looked, newest open. */
export function WhatsNew({ onClose }: { onClose: () => void }) {
  const [releases, setReleases] = useState(() => releasesSince(seenRelease()));
  useEffect(() => {
    let live = true;
    markReleaseSeen();
    void client.publishedUpdates().then(
      (updates) =>
        live && setReleases(mergePublishedUpdates(updates, CHANGELOG)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return (
    <Dialog
      title="What's new"
      wide
      onClose={onClose}
      actions={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              onClose();
              navigate("/changelog");
            }}
          >
            Every release
          </Button>
          <Button variant="primary" onClick={onClose}>
            Got it
          </Button>
        </>
      }
    >
      {releases.map((release, n) => (
        <Release key={release.id} release={release} open={n === 0} />
      ))}
    </Dialog>
  );
}
