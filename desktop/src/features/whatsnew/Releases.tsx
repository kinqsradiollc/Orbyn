import {
  CHANGELOG,
  CHANGELOG_HEADINGS,
  releaseDate,
  type ChangelogRelease,
} from "@orbyn/core";

const SECTIONS = ["new", "better", "fixed"] as const;

/**
 * Releases as the changelog and "What's new" both show them: a date, a few
 * words, then New, Better and No longer broken, one sentence each (DSN-03).
 */
export function Releases({
  releases = CHANGELOG,
  headingLevel = 2,
}: {
  releases?: ChangelogRelease[];
  /** The page's h1 is above; a dialog's title is an h2. */
  headingLevel?: 2 | 3;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
  const S = headingLevel === 2 ? "h3" : "h4";
  return (
    <div className="releases">
      {releases.map((r) => (
        <section key={r.date} className="release">
          <p className="release-date">
            <time dateTime={r.date}>{releaseDate(r)}</time>
          </p>
          <H>{r.title}</H>
          {SECTIONS.filter((key) => r[key].length).map((key) => (
            <div key={key} className={`release-part is-${key}`}>
              <S>{CHANGELOG_HEADINGS[key]}</S>
              <ul>
                {r[key].map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
