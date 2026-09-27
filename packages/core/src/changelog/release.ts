/**
 * The shape of one release in What's new (DSN-03). Each release lives in a
 * file of its own in this folder; see README.md for how to add one.
 */

/** The three headings every release is told under, in this order. */
export const CHANGELOG_SECTIONS = ["new", "better", "fixed"] as const;

export type ChangelogSection = (typeof CHANGELOG_SECTIONS)[number];

export const CHANGELOG_HEADINGS: Record<ChangelogSection, string> = {
  new: "New",
  better: "Better",
  fixed: "No longer broken",
};

/** What a release file writes: plain sentences under the three headings. */
export type ReleaseNotes = {
  /** The file's name without `.ts`: the date, then a word or two. */
  id: string;
  /** The day it shipped ("2026-09-27"): how releases are sorted and seen. */
  date: string;
  /** A few words for the release as a whole. */
  title: string;
  /** One sentence on what the release is about. */
  summary: string;
  /** Optional: the one change worth reading if nothing else is. */
  highlight?: string;
  /** One plain sentence per item, written for the person using Orbyn. */
  sections: Partial<Record<ChangelogSection, string[]>>;
};

/** A release as the apps read it: the notes, with every heading filled in. */
export type ChangelogRelease = Omit<ReleaseNotes, "sections"> & {
  sections: Record<ChangelogSection, string[]>;
  new: string[];
  better: string[];
  fixed: string[];
};

/** Turns a release file's notes into a release, empty headings as []. */
export function defineRelease(notes: ReleaseNotes): ChangelogRelease {
  const sections = {
    new: notes.sections.new ?? [],
    better: notes.sections.better ?? [],
    fixed: notes.sections.fixed ?? [],
  };
  return { ...notes, sections, ...sections };
}
