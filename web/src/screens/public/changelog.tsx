import {
  CHANGELOG,
  CHANGELOG_HEADINGS,
  CHANGELOG_SECTIONS,
  mergePublishedUpdates,
  releaseDate,
  type ChangelogSection,
} from "@orbyn/core";
import { useEffect, useMemo, useState } from "react";
import { client } from "../../lib/session";
import { useTitle } from "../../lib/router";
import { Field, SelectBox } from "../../ui/kit";
import { PublicFrame } from "./PublicFrame";

type Filter = "all" | ChangelogSection;

export default function Changelog() {
  useTitle("What's new");
  const [releases, setReleases] = useState(CHANGELOG);
  const [filter, setFilter] = useState<Filter>("all");
  useEffect(() => {
    let live = true;
    void client.publishedUpdates().then(
      (updates) =>
        live && setReleases(mergePublishedUpdates(updates, CHANGELOG)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  const shown = useMemo(
    () =>
      releases.filter(
        (release) => filter === "all" || release.sections[filter]?.length,
      ),
    [releases, filter],
  );
  const hash = location.hash.slice(1);
  return (
    <PublicFrame>
      <main className="reading">
        <div className="page-head">
          <h1>What's new</h1>
          <Field label="Show">
            <SelectBox
              value={filter}
              onChange={(event) => setFilter(event.target.value as Filter)}
            >
              <option value="all">Everything</option>
              {CHANGELOG_SECTIONS.map((section) => (
                <option key={section} value={section}>
                  {CHANGELOG_HEADINGS[section]}
                </option>
              ))}
            </SelectBox>
          </Field>
        </div>
        {shown.length === 0 && (
          <p className="muted">Nothing under that heading.</p>
        )}
        {shown.map((release, index) => (
          <details
            key={release.id}
            id={`release-${release.id}`}
            className="release"
            open={index === 0 || hash === `release-${release.id}`}
          >
            <summary>
              <span className="small muted">{releaseDate(release)}</span>
              <h2>{release.title}</h2>
              <p className="muted">{release.summary}</p>
            </summary>
            {release.image && (
              <img src={release.image} alt={release.alt_text ?? ""} />
            )}
            {CHANGELOG_SECTIONS.filter(
              (section) =>
                (filter === "all" || filter === section) &&
                release.sections[section]?.length,
            ).map((section) => (
              <section key={section}>
                <h3>{CHANGELOG_HEADINGS[section]}</h3>
                <ul>
                  {release.sections[section].map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </section>
            ))}
          </details>
        ))}
      </main>
    </PublicFrame>
  );
}
