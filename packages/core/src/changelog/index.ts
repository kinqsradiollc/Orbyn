/**
 * What's new (DSN-03): every release, newest first. The public /changelog
 * page and the apps' "What's new" sheets all read this list, so they never
 * disagree. Each release is a file of its own in this folder; to add one,
 * copy the newest file, then import it here and add it to RELEASES (see
 * README.md). A test checks every file in the folder is listed.
 */
import type { ChangelogRelease } from "./release.js";
import tidier from "./2026-09-27-tidier.js";
import organised from "./2026-09-27-organised.js";
import agents from "./2026-09-27-agents.js";
import phones from "./2026-09-27-phones.js";
import richerPages from "./2026-09-26-pages.js";
import planning from "./2026-09-26-planning.js";
import signIn from "./2026-09-26-connected.js";
import writing from "./2026-09-24-writing.js";
import learns from "./2026-09-24-learns.js";
import study from "./2026-09-23-study.js";
import pagesTogether from "./2026-09-21-pages.js";
import projects from "./2026-09-20-projects.js";
import security from "./2026-09-20-security.js";
import screens from "./2026-09-19-screens.js";
import launch from "./2026-09-15-launch.js";

export * from "./release.js";

/** Releases on the same day keep the order they are listed in here. */
const RELEASES: ChangelogRelease[] = [
  tidier,
  organised,
  agents,
  phones,
  richerPages,
  planning,
  signIn,
  writing,
  learns,
  study,
  pagesTogether,
  projects,
  security,
  screens,
  launch,
];

/** Every release, newest first. */
export const CHANGELOG: ChangelogRelease[] = RELEASES.map((r, i) => ({
  r,
  i,
}))
  .sort((a, b) => b.r.date.localeCompare(a.r.date) || a.i - b.i)
  .map(({ r }) => r);

/** The newest release. */
export const latestRelease = () => CHANGELOG[0];

/**
 * Whether "What's new" should open by itself: there is a release newer than
 * the one this person last saw. Someone who has never seen one (a new
 * account) is not shown it; the first run is enough on day one.
 */
export function hasUnseenRelease(lastSeen: string | null | undefined) {
  if (!lastSeen) return false;
  return CHANGELOG.some((r) => r.date > lastSeen);
}

/**
 * The releases newer than the one last seen, newest first; the newest one
 * alone when nothing is new (or nothing was seen), so the sheet is never
 * empty.
 */
export function releasesSince(lastSeen: string | null | undefined) {
  const fresh = lastSeen ? CHANGELOG.filter((r) => r.date > lastSeen) : [];
  return fresh.length ? fresh : CHANGELOG.slice(0, 1);
}

/** How many items a release has under each heading, and in all. */
export function releaseCounts(r: ChangelogRelease) {
  return {
    new: r.new.length,
    better: r.better.length,
    fixed: r.fixed.length,
    total: r.new.length + r.better.length + r.fixed.length,
  };
}

/** "27 September 2026". */
export const releaseDate = (r: Pick<ChangelogRelease, "date">) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${r.date}T12:00:00Z`));
