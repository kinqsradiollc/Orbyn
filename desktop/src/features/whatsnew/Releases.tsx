import { useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import {
  CHANGELOG,
  CHANGELOG_HEADINGS,
  CHANGELOG_SECTIONS,
  releaseDate,
  type ChangelogRelease,
  type ChangelogSection,
} from "@orbyn/core";

/** Short words for the counts under a release's summary. */
const COUNT_WORDS: Record<ChangelogSection, string> = {
  new: "new",
  better: "better",
  fixed: "fixed",
};

export type SectionFilter = "all" | ChangelogSection;

/** The anchor a release can be linked to: /changelog#release-<id>. */
export const releaseAnchor = (id: string) => `release-${id}`;

/** Which headings a release shows under a filter, in order. */
const shownSections = (r: ChangelogRelease, filter: SectionFilter) =>
  CHANGELOG_SECTIONS.filter(
    (key) => r[key].length && (filter === "all" || filter === key),
  );

/** Whether a release has anything to show under a filter. */
export const releaseMatches = (r: ChangelogRelease, filter: SectionFilter) =>
  shownSections(r, filter).length > 0;

/**
 * Releases as the changelog and "What's new" both show them (DSN-03): each
 * one a card with its date, title and one-line summary, opening to its
 * highlight and the New, Better and No longer broken lists. Open state is
 * the caller's when `open` is given, else the newest starts open.
 */
export function Releases({
  releases = CHANGELOG,
  headingLevel = 2,
  filter = "all",
  open,
  onToggle,
}: {
  releases?: ChangelogRelease[];
  /** The page's h1 is above; a dialog's title is an h2. */
  headingLevel?: 2 | 3;
  filter?: SectionFilter;
  /** Ids of the open releases, when the caller keeps them. */
  open?: string[];
  onToggle?: (id: string) => void;
}) {
  const [own, setOwn] = useState<string[]>(() =>
    releases.slice(0, 1).map((r) => r.id),
  );
  const openIds = open ?? own;
  const toggle =
    onToggle ??
    ((id: string) =>
      setOwn((ids) =>
        ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
      ));
  const H = headingLevel === 2 ? "h2" : "h3";
  const S = headingLevel === 2 ? "h3" : "h4";
  const shown = releases.filter((r) => releaseMatches(r, filter));
  if (!shown.length)
    return <p className="release-none">Nothing under this heading yet.</p>;
  return (
    <div className="releases">
      {shown.map((r) => {
        const isOpen = openIds.includes(r.id);
        const sections = shownSections(r, filter);
        const body = `${releaseAnchor(r.id)}-body`;
        return (
          <section
            key={r.id}
            id={releaseAnchor(r.id)}
            className={`release${isOpen ? " is-open" : ""}`}
          >
            <H className="release-heading">
              <button
                type="button"
                className="release-toggle"
                aria-expanded={isOpen}
                aria-controls={body}
                onClick={() => toggle(r.id)}
              >
                <span className="release-date">
                  <time dateTime={r.date}>{releaseDate(r)}</time>
                </span>
                <span className="release-title">{r.title}</span>
                <ChevronDown
                  className="release-chevron"
                  size={18}
                  aria-hidden="true"
                />
              </button>
            </H>
            <p className="release-summary">{r.summary}</p>
            <ul className="release-counts" aria-label="In this release">
              {sections.map((key) => (
                <li key={key} className={`is-${key}`}>
                  {r[key].length} {COUNT_WORDS[key]}
                </li>
              ))}
            </ul>
            <div id={body} className="release-body" hidden={!isOpen}>
              {r.highlight && filter === "all" && (
                <p className="release-highlight">
                  <Sparkles size={16} aria-hidden="true" />
                  <span>{r.highlight}</span>
                </p>
              )}
              {sections.map((key) => (
                <div key={key} className={`release-part is-${key}`}>
                  <S>{CHANGELOG_HEADINGS[key]}</S>
                  <ul>
                    {r[key].map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
